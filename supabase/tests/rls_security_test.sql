-- Phase 3 RLS / security test suite.
--
-- Runs entirely inside one transaction and ROLLS BACK: no data is left behind.
-- Setup runs as the migration owner; every assertion runs as the real API
-- roles (`authenticated` with a user's JWT claims, or `anon`), so RLS and
-- grants are actually exercised. The owner / service role bypass RLS and are
-- never used for assertions.
--
-- Run:  psql "$SUPABASE_DB_URL" -f supabase/tests/rls_security_test.sql
-- Output: one NOTICE per check; the script raises an exception if any fail.

begin;

-- ---------------------------------------------------------------------------
-- Test harness (temporary, session-local)
-- ---------------------------------------------------------------------------
create temp table test_results (label text, passed boolean, detail text) on commit drop;
grant all on test_results to public;

create function pg_temp.check(p_label text, p_passed boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into test_results values (p_label, coalesce(p_passed, false), p_detail);
  raise notice '% %', case when coalesce(p_passed, false) then 'PASS' else 'FAIL' end, p_label
    || coalesce(' — ' || p_detail, '');
end $$;

-- Rows visible to the current role.
create function pg_temp.visible(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) q', p_sql) into n;
  return n;
end $$;

-- 'OK:<rows>' or 'ERR:<sqlstate>'
create function pg_temp.attempt(p_sql text) returns text language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'OK:' || n;
exception when others then
  return 'ERR:' || sqlstate;
end $$;

-- 'OK' or the error message (business rules raise stable codes, e.g. AGENT_INACTIVE).
create function pg_temp.error_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.act_as(p_user uuid, p_extra_claims jsonb default '{}') returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    (jsonb_build_object('sub', p_user, 'role', 'authenticated') || p_extra_claims)::text, true);
end $$;

create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures (as owner). Fixed UUIDs make the assertions readable.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-a000-00000000000a', 'rls.admin@test.invalid',    '{"full_name":"RLS Admin"}',    'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000a1', 'rls.agent.a@test.invalid',  '{"full_name":"RLS Agent A"}',  'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000b1', 'rls.agent.b@test.invalid',  '{"full_name":"RLS Agent B"}',  'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000c1', 'rls.inactive@test.invalid', '{"full_name":"RLS Inactive"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000d1', 'rls.benched@test.invalid',  '{}',                           'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000e', 'rls.exadmin@test.invalid',  '{}',                           'authenticated', 'authenticated');

update public.profiles set role = 'ADMIN' where id in ('00000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-00000000000e');
update public.profiles set is_active = false where id in ('00000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-00000000000e');

insert into public.agents (id, profile_id, employee_code, is_active) values
  ('10000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-0000000000a1', 'RLS-A', true),
  ('10000000-0000-4000-a000-0000000000b1', '00000000-0000-4000-a000-0000000000b1', 'RLS-B', true),
  ('10000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-0000000000c1', 'RLS-C', true),   -- profile inactive
  ('10000000-0000-4000-a000-0000000000d1', '00000000-0000-4000-a000-0000000000d1', 'RLS-D', false);  -- agent record inactive

insert into public.customers (id, name) values
  ('20000000-0000-4000-a000-0000000000a1', 'Customer A'),
  ('20000000-0000-4000-a000-0000000000b1', 'Customer B');
insert into public.locations (id, customer_id, location_name, latitude, longitude) values
  ('30000000-0000-4000-a000-0000000000a1', '20000000-0000-4000-a000-0000000000a1', 'Site A', 11.3412340, 77.7178230),
  ('30000000-0000-4000-a000-0000000000b1', '20000000-0000-4000-a000-0000000000b1', 'Site B', 11.0000000, 77.0000000);
insert into public.products (id, sku, product_name, price) values
  ('40000000-0000-4000-a000-0000000000a1', 'RLS-SKU-A', 'Product A', 10),
  ('40000000-0000-4000-a000-0000000000b1', 'RLS-SKU-B', 'Product B', 20);

insert into public.tasks (id, task_type, status, agent_id, customer_id, location_id, title, scheduled_date) values
  ('50000000-0000-4000-a000-0000000000a1', 'DELIVER_PRODUCTS', 'ASSIGNED', '10000000-0000-4000-a000-0000000000a1',
   '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'Task for A', current_date),
  ('50000000-0000-4000-a000-0000000000a2', 'COLLECT_CASH', 'DRAFT', '10000000-0000-4000-a000-0000000000a1',
   '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'Draft for A', current_date),
  ('50000000-0000-4000-a000-0000000000b1', 'DELIVER_PRODUCTS', 'ASSIGNED', '10000000-0000-4000-a000-0000000000b1',
   '20000000-0000-4000-a000-0000000000b1', '30000000-0000-4000-a000-0000000000b1', 'Task for B', current_date),
  ('50000000-0000-4000-a000-0000000000c1', 'SURVEY', 'ASSIGNED', '10000000-0000-4000-a000-0000000000c1',
   '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'Task for inactive', current_date),
  ('50000000-0000-4000-a000-0000000000d1', 'SURVEY', 'ASSIGNED', '10000000-0000-4000-a000-0000000000d1',
   '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'Task for benched', current_date);

insert into public.task_products (task_id, product_id, assigned_quantity) values
  ('50000000-0000-4000-a000-0000000000a1', '40000000-0000-4000-a000-0000000000a1', 10),
  ('50000000-0000-4000-a000-0000000000b1', '40000000-0000-4000-a000-0000000000b1', 5);

insert into public.checkins (id, task_id, agent_id, latitude, longitude, is_within_geofence) values
  ('60000000-0000-4000-a000-0000000000a1', '50000000-0000-4000-a000-0000000000a1', '10000000-0000-4000-a000-0000000000a1', 11.3412, 77.7178, true),
  ('60000000-0000-4000-a000-0000000000b1', '50000000-0000-4000-a000-0000000000b1', '10000000-0000-4000-a000-0000000000b1', 11.0, 77.0, true);
insert into public.task_proofs (id, task_id, agent_id, proof_type) values
  ('70000000-0000-4000-a000-0000000000a1', '50000000-0000-4000-a000-0000000000a1', '10000000-0000-4000-a000-0000000000a1', 'PHOTO'),
  ('70000000-0000-4000-a000-0000000000b1', '50000000-0000-4000-a000-0000000000b1', '10000000-0000-4000-a000-0000000000b1', 'PHOTO');
insert into public.cash_collections (id, task_id, agent_id, expected_amount) values
  ('80000000-0000-4000-a000-0000000000a1', '50000000-0000-4000-a000-0000000000a1', '10000000-0000-4000-a000-0000000000a1', 25000),
  ('80000000-0000-4000-a000-0000000000b1', '50000000-0000-4000-a000-0000000000b1', '10000000-0000-4000-a000-0000000000b1', 15000);
insert into public.agent_location_events (id, agent_id, latitude, longitude) values
  ('90000000-0000-4000-a000-0000000000a1', '10000000-0000-4000-a000-0000000000a1', 11.3, 77.7),
  ('90000000-0000-4000-a000-0000000000b1', '10000000-0000-4000-a000-0000000000b1', 11.0, 77.0);

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  admin_id   constant uuid := '00000000-0000-4000-a000-00000000000a';
  agent_a    constant uuid := '00000000-0000-4000-a000-0000000000a1';
  agent_b    constant uuid := '00000000-0000-4000-a000-0000000000b1';
  inactive   constant uuid := '00000000-0000-4000-a000-0000000000c1';
  benched    constant uuid := '00000000-0000-4000-a000-0000000000d1';
  ex_admin   constant uuid := '00000000-0000-4000-a000-00000000000e';
  fx         constant text := 'RLS-%';  -- fixture marker
  r          text;
  new_task   uuid;
  v_code     text;
begin
  -- ===== ADMIN ==========================================================
  perform pg_temp.act_as(admin_id);
  perform pg_temp.check('ADMIN sees all fixture tasks (incl. drafts)',
    pg_temp.visible($q$select 1 from public.tasks where title like 'Task for %' or title like 'Draft%'$q$) = 5);
  perform pg_temp.check('ADMIN sees all check-ins / proofs / cash / location events',
    pg_temp.visible('select 1 from public.checkins') >= 2
    and pg_temp.visible('select 1 from public.task_proofs') >= 2
    and pg_temp.visible('select 1 from public.cash_collections') >= 2
    and pg_temp.visible('select 1 from public.agent_location_events') >= 2);
  perform pg_temp.check('ADMIN sees all profiles and agents',
    pg_temp.visible($q$select 1 from public.profiles where email like 'rls.%'$q$) = 6
    and pg_temp.visible($q$select 1 from public.agents where employee_code like 'RLS-%'$q$) = 4);

  insert into public.customers (name, customer_code) values ('Admin-created', 'RLS-NEW') ;
  perform pg_temp.check('ADMIN can create a customer', pg_temp.visible($q$select 1 from public.customers where customer_code = 'RLS-NEW'$q$) = 1);

  insert into public.tasks (task_type, customer_id, location_id, title)
  values ('INSPECTION', '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'Admin draft')
  returning id, tasks.task_code into new_task, v_code;
  perform pg_temp.check('ADMIN can create a task; task_code generated by DB',
    v_code ~ '^TASK-\d{8}-\d{6,}$', v_code);
  perform pg_temp.check('Task creation recorded in status history with actor',
    pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and old_status is null and new_status = 'DRAFT' and changed_by = %L$q$, new_task, admin_id)) = 1);

  r := pg_temp.attempt(format($q$update public.tasks set status = 'ASSIGNED', agent_id = '10000000-0000-4000-a000-0000000000a1' where id = %L$q$, new_task));
  perform pg_temp.check('ADMIN can assign a task', r = 'OK:1', r);
  perform pg_temp.check('Assignment recorded in status history (DRAFT → ASSIGNED)',
    pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and old_status = 'DRAFT' and new_status = 'ASSIGNED'$q$, new_task)) = 1);
  perform pg_temp.check('Audit log captured ASSIGN_TASK with changed columns only',
    pg_temp.visible(format($q$select 1 from public.audit_logs where entity_id = %L and action = 'ASSIGN_TASK' and actor_user_id = %L
                             and new_values ? 'status' and new_values ? 'agent_id' and not new_values ? 'title'$q$, new_task, admin_id)) = 1);

  r := pg_temp.attempt(format($q$update public.tasks set task_code = 'HACK' where id = %L$q$, new_task));
  perform pg_temp.check('ADMIN cannot rewrite task_code', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$delete from public.customers where id = '20000000-0000-4000-a000-0000000000b1'$q$);
  perform pg_temp.check('ADMIN cannot hard-delete master data (soft delete only)', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$insert into public.checkins (task_id, agent_id, latitude, longitude, is_within_geofence)
                         values ('50000000-0000-4000-a000-0000000000a1', '10000000-0000-4000-a000-0000000000a1', 0, 0, true)$q$);
  perform pg_temp.check('ADMIN cannot forge check-ins (server-side only)', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$delete from public.audit_logs$q$);
  perform pg_temp.check('ADMIN cannot delete audit logs', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$update public.task_status_history set new_status = 'VERIFIED'$q$);
  perform pg_temp.check('ADMIN cannot rewrite status history', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$update public.profiles set role = 'AGENT' where id = '00000000-0000-4000-a000-0000000000a1'$q$);
  perform pg_temp.check('ADMIN cannot change roles via the API (operator-only for now)', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$insert into public.tasks (task_type, customer_id, location_id, title)
                         values ('OTHER', '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000b1', 'Mismatch')$q$);
  perform pg_temp.check('Task location must belong to the task customer', r = 'ERR:23503', r);
  r := pg_temp.attempt($q$insert into public.agents (profile_id) values ('00000000-0000-4000-a000-00000000000a')$q$);
  perform pg_temp.check('An ADMIN profile cannot be made an agent', r = 'ERR:23514', r);

  -- ===== AGENT A ========================================================
  perform pg_temp.act_as(agent_a);
  perform pg_temp.check('AGENT A sees only own released tasks (not drafts, not B)',
    pg_temp.visible('select 1 from public.tasks') = 2
    and pg_temp.visible($q$select 1 from public.tasks where id = '50000000-0000-4000-a000-0000000000a2'$q$) = 0
    and pg_temp.visible($q$select 1 from public.tasks where agent_id = '10000000-0000-4000-a000-0000000000b1'$q$) = 0);
  perform pg_temp.check('AGENT A sees only customers/locations/products of own tasks',
    pg_temp.visible('select 1 from public.customers') = 1
    and pg_temp.visible('select 1 from public.locations') = 1
    and pg_temp.visible('select 1 from public.products') = 1
    and pg_temp.visible($q$select 1 from public.products where sku = 'RLS-SKU-B'$q$) = 0);
  perform pg_temp.check('AGENT A sees only own task products and status history',
    pg_temp.visible('select 1 from public.task_products') = 1
    and pg_temp.visible($q$select 1 from public.task_status_history where task_id = '50000000-0000-4000-a000-0000000000b1'$q$) = 0);
  perform pg_temp.check('AGENT A cannot see Agent B check-in / proof / cash / location event',
    pg_temp.visible($q$select 1 from public.checkins where id = '60000000-0000-4000-a000-0000000000b1'$q$) = 0
    and pg_temp.visible($q$select 1 from public.task_proofs where id = '70000000-0000-4000-a000-0000000000b1'$q$) = 0
    and pg_temp.visible($q$select 1 from public.cash_collections where id = '80000000-0000-4000-a000-0000000000b1'$q$) = 0
    and pg_temp.visible($q$select 1 from public.agent_location_events where id = '90000000-0000-4000-a000-0000000000b1'$q$) = 0);
  perform pg_temp.check('AGENT A sees own check-in / proof / cash / location event',
    pg_temp.visible('select 1 from public.checkins') = 1
    and pg_temp.visible('select 1 from public.task_proofs') = 1
    and pg_temp.visible('select 1 from public.cash_collections') = 1
    and pg_temp.visible('select 1 from public.agent_location_events') = 1);
  perform pg_temp.check('AGENT A sees only own profile and agent record; no audit logs',
    pg_temp.visible('select 1 from public.profiles') = 1
    and pg_temp.visible('select 1 from public.agents') = 1
    and pg_temp.visible('select 1 from public.audit_logs') = 0);

  -- Role escalation
  r := pg_temp.attempt(format($q$update public.profiles set role = 'ADMIN' where id = %L$q$, agent_a));
  perform pg_temp.check('ESCALATION: agent cannot set own role to ADMIN', r = 'ERR:42501', r);
  r := pg_temp.attempt(format($q$update public.profiles set is_active = true where id = %L$q$, agent_a));
  perform pg_temp.check('ESCALATION: agent cannot change is_active', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$update public.agents set profile_id = '00000000-0000-4000-a000-0000000000b1'$q$);
  perform pg_temp.check('ESCALATION: agent cannot change agents.profile_id', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$update public.agents set is_active = false$q$);
  perform pg_temp.check('Agent cannot (de)activate agent records', r = 'OK:0', r);
  perform pg_temp.act_as(agent_a, '{"user_role":"ADMIN","app_metadata":{"role":"ADMIN"}}');
  perform pg_temp.check('ESCALATION: forged role claims in JWT are ignored',
    not public.is_admin() and pg_temp.visible('select 1 from public.tasks') = 2);
  perform pg_temp.act_as(agent_a);

  -- Task ownership / status
  r := pg_temp.attempt($q$update public.tasks set agent_id = '10000000-0000-4000-a000-0000000000a1' where id = '50000000-0000-4000-a000-0000000000b1'$q$);
  perform pg_temp.check('REASSIGNMENT: agent cannot take Agent B task', r = 'OK:0', r);
  r := pg_temp.attempt($q$update public.tasks set agent_id = '10000000-0000-4000-a000-0000000000b1' where id = '50000000-0000-4000-a000-0000000000a1'$q$);
  perform pg_temp.check('REASSIGNMENT: agent cannot hand own task to another agent', r = 'OK:0', r);
  r := pg_temp.attempt($q$update public.tasks set status = 'VERIFIED' where id = '50000000-0000-4000-a000-0000000000a1'$q$);
  perform pg_temp.check('Agent cannot set task status (e.g. VERIFIED) directly', r = 'OK:0', r);
  r := pg_temp.attempt($q$insert into public.tasks (task_type, customer_id, location_id, title)
                         values ('OTHER', '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'Self-made')$q$);
  perform pg_temp.check('Agent cannot create tasks', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$update public.customers set name = 'Hacked'$q$);
  perform pg_temp.check('Agent cannot modify customers', r = 'OK:0', r);
  r := pg_temp.attempt($q$update public.products set price = 0$q$);
  perform pg_temp.check('Agent cannot modify products', r = 'OK:0', r);

  -- Check-ins (server-side only, immutable)
  r := pg_temp.attempt($q$insert into public.checkins (task_id, agent_id, latitude, longitude, is_within_geofence)
                         values ('50000000-0000-4000-a000-0000000000a1', '10000000-0000-4000-a000-0000000000a1', 0, 0, true)$q$);
  perform pg_temp.check('Agent cannot insert check-in directly (incl. own; values must be server-computed)', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$update public.checkins set is_within_geofence = true$q$);
  perform pg_temp.check('Check-ins are immutable', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$delete from public.checkins$q$);
  perform pg_temp.check('Check-ins cannot be deleted', r = 'ERR:42501', r);

  -- Proofs
  r := pg_temp.attempt($q$insert into public.task_proofs (task_id, agent_id, proof_type)
                         values ('50000000-0000-4000-a000-0000000000a1', '10000000-0000-4000-a000-0000000000a1', 'PHOTO')$q$);
  perform pg_temp.check('Agent can add proof to own task', r = 'OK:1', r);
  r := pg_temp.attempt($q$insert into public.task_proofs (task_id, agent_id, proof_type)
                         values ('50000000-0000-4000-a000-0000000000b1', '10000000-0000-4000-a000-0000000000a1', 'PHOTO')$q$);
  perform pg_temp.check('Agent cannot add proof to Agent B task', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$insert into public.task_proofs (task_id, agent_id, proof_type)
                         values ('50000000-0000-4000-a000-0000000000a1', '10000000-0000-4000-a000-0000000000b1', 'PHOTO')$q$);
  perform pg_temp.check('Agent cannot add proof impersonating Agent B', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$insert into public.task_proofs (task_id, agent_id, proof_type)
                         values ('50000000-0000-4000-a000-0000000000a2', '10000000-0000-4000-a000-0000000000a1', 'PHOTO')$q$);
  perform pg_temp.check('Agent cannot add proof to an unreleased DRAFT task', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$update public.task_proofs set description = 'x'$q$);
  perform pg_temp.check('Proofs are immutable', r = 'ERR:42501', r);

  -- Cash
  r := pg_temp.attempt($q$update public.cash_collections set collected_amount = 1$q$);
  perform pg_temp.check('Agent cannot modify cash collections directly', r = 'OK:0', r);
  r := pg_temp.attempt($q$insert into public.cash_collections (task_id, agent_id, expected_amount)
                         values ('50000000-0000-4000-a000-0000000000a1', '10000000-0000-4000-a000-0000000000a1', 1)$q$);
  perform pg_temp.check('Agent cannot create cash collection records', r = 'ERR:42501', r);

  -- Location events
  r := pg_temp.attempt($q$insert into public.agent_location_events (agent_id, task_id, latitude, longitude)
                         values ('10000000-0000-4000-a000-0000000000a1', '50000000-0000-4000-a000-0000000000a1', 11.1, 77.1)$q$);
  perform pg_temp.check('Agent can record own location event', r = 'OK:1', r);
  r := pg_temp.attempt($q$insert into public.agent_location_events (agent_id, latitude, longitude)
                         values ('10000000-0000-4000-a000-0000000000b1', 11.1, 77.1)$q$);
  perform pg_temp.check('Agent cannot record a location event as Agent B', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$insert into public.agent_location_events (agent_id, task_id, latitude, longitude)
                         values ('10000000-0000-4000-a000-0000000000a1', '50000000-0000-4000-a000-0000000000b1', 11.1, 77.1)$q$);
  perform pg_temp.check('Agent cannot attach a location event to Agent B task', r = 'ERR:42501', r);

  -- History / audit integrity
  r := pg_temp.attempt($q$insert into public.task_status_history (task_id, new_status) values ('50000000-0000-4000-a000-0000000000a1', 'VERIFIED')$q$);
  perform pg_temp.check('Agent cannot write status history', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$insert into public.audit_logs (action, entity_type) values ('FAKE', 'TASK')$q$);
  perform pg_temp.check('Agent cannot write audit logs', r = 'ERR:42501', r);

  -- ===== AGENT B ========================================================
  perform pg_temp.act_as(agent_b);
  perform pg_temp.check('AGENT B sees only own task, not Agent A tasks',
    pg_temp.visible('select 1 from public.tasks') = 1
    and pg_temp.visible($q$select 1 from public.tasks where agent_id = '10000000-0000-4000-a000-0000000000a1'$q$) = 0);
  perform pg_temp.check('AGENT B cannot see Agent A check-in / proofs / cash / location events',
    pg_temp.visible($q$select 1 from public.checkins where agent_id = '10000000-0000-4000-a000-0000000000a1'$q$) = 0
    and pg_temp.visible($q$select 1 from public.task_proofs where agent_id = '10000000-0000-4000-a000-0000000000a1'$q$) = 0
    and pg_temp.visible($q$select 1 from public.cash_collections where agent_id = '10000000-0000-4000-a000-0000000000a1'$q$) = 0
    and pg_temp.visible($q$select 1 from public.agent_location_events where agent_id = '10000000-0000-4000-a000-0000000000a1'$q$) = 0);
  perform pg_temp.check('AGENT B cannot see Customer A / Site A',
    pg_temp.visible($q$select 1 from public.customers where name = 'Customer A'$q$) = 0
    and pg_temp.visible($q$select 1 from public.locations where location_name = 'Site A'$q$) = 0);

  -- ===== Deactivated users ===============================================
  perform pg_temp.act_as(inactive);
  perform pg_temp.check('Inactive profile: assigned tasks hidden, current_agent_id() is NULL',
    pg_temp.visible('select 1 from public.tasks') = 0 and public.current_agent_id() is null and public.get_my_role() is null);
  perform pg_temp.act_as(benched);
  perform pg_temp.check('Inactive agent record: assigned tasks hidden',
    pg_temp.visible('select 1 from public.tasks') = 0);
  perform pg_temp.act_as(ex_admin);
  perform pg_temp.check('Inactive ADMIN loses admin access',
    not public.is_admin() and pg_temp.visible('select 1 from public.tasks') = 0
    and pg_temp.visible('select 1 from public.profiles') = 1);

  -- ===== Unauthenticated ==================================================
  perform pg_temp.act_as_anon();
  perform pg_temp.check('ANON cannot read tasks', pg_temp.attempt('select 1 from public.tasks') = 'ERR:42501');
  perform pg_temp.check('ANON cannot read profiles', pg_temp.attempt('select 1 from public.profiles') = 'ERR:42501');
  perform pg_temp.check('ANON cannot read customers', pg_temp.attempt('select 1 from public.customers') = 'ERR:42501');
  perform pg_temp.check('ANON cannot call RLS helpers', pg_temp.attempt('select public.is_admin()') = 'ERR:42501');

  -- ===== Constraints (as admin) ============================================
  perform pg_temp.act_as(admin_id);
  perform pg_temp.check('Constraint: latitude range',
    pg_temp.attempt($q$insert into public.locations (customer_id, location_name, latitude, longitude) values ('20000000-0000-4000-a000-0000000000a1', 'Bad', 91, 0)$q$) = 'ERR:23514');
  perform pg_temp.check('Constraint: priority 1–5',
    pg_temp.attempt(format($q$update public.tasks set priority = 6 where id = %L$q$, new_task)) = 'ERR:23514');
  perform pg_temp.check('Constraint: delivered ≤ assigned',
    pg_temp.attempt($q$update public.task_products set delivered_quantity = 11 where task_id = '50000000-0000-4000-a000-0000000000a1'$q$) = 'ERR:23514');
  perform pg_temp.check('Constraint: price ≥ 0',
    pg_temp.attempt($q$update public.products set price = -1 where sku = 'RLS-SKU-A'$q$) = 'ERR:23514');
  perform pg_temp.check('Constraint: assigned status requires an agent',
    pg_temp.attempt(format($q$update public.tasks set agent_id = null where id = %L$q$, new_task)) = 'ERR:23514');
  perform pg_temp.check('Constraint: collected cash needs method and time',
    pg_temp.attempt($q$update public.cash_collections set collected_amount = 100 where id = '80000000-0000-4000-a000-0000000000a1'$q$) = 'ERR:23514');

  perform set_config('role', 'postgres', true);
end
$$;

-- ---------------------------------------------------------------------------
-- Phase 4: master-data administration
-- ---------------------------------------------------------------------------
do $$
declare
  admin_id constant uuid := '00000000-0000-4000-a000-00000000000a';
  agent_a  constant uuid := '00000000-0000-4000-a000-0000000000a1';
  agent_b  constant uuid := '00000000-0000-4000-a000-0000000000b1';
  r        text;
begin
  -- ADMIN
  perform pg_temp.act_as(admin_id);
  r := pg_temp.attempt(format($q$update public.profiles set full_name = 'Renamed A', phone = '+91 90000 00000' where id = %L$q$, agent_a));
  perform pg_temp.check('P4 ADMIN can edit an agent''s name and phone', r = 'OK:1', r);
  r := pg_temp.attempt(format($q$update public.profiles set role = 'ADMIN' where id = %L$q$, agent_a));
  perform pg_temp.check('P4 ADMIN still cannot change roles', r = 'ERR:42501', r);
  r := pg_temp.attempt(format($q$update public.profiles set is_active = false where id = %L$q$, agent_a));
  perform pg_temp.check('P4 ADMIN still cannot change account is_active', r = 'ERR:42501', r);
  perform pg_temp.check('P4 ADMIN sees all agents in agent_directory',
    pg_temp.visible($q$select 1 from public.agent_directory where employee_code like 'RLS-%'$q$) = 4);
  perform pg_temp.check('P4 ADMIN sees all locations in location_directory',
    pg_temp.visible($q$select 1 from public.location_directory where location_name like 'Site %'$q$) = 2);
  r := pg_temp.attempt($q$update public.products set is_active = false where sku = 'RLS-SKU-B'$q$);
  perform pg_temp.check('P4 ADMIN can deactivate a product', r = 'OK:1', r);
  perform pg_temp.check('P4 Deactivation audited as DEACTIVATE_PRODUCT',
    pg_temp.visible($q$select 1 from public.audit_logs where action = 'DEACTIVATE_PRODUCT' and entity_id = '40000000-0000-4000-a000-0000000000b1'$q$) = 1);
  perform pg_temp.check('P4 Deactivated product keeps its task lines',
    pg_temp.visible($q$select 1 from public.task_products where product_id = '40000000-0000-4000-a000-0000000000b1'$q$) = 1);
  r := pg_temp.attempt($q$update public.products set is_active = true where sku = 'RLS-SKU-B'$q$);
  perform pg_temp.check('P4 Reactivation audited as ACTIVATE_PRODUCT',
    r = 'OK:1' and pg_temp.visible($q$select 1 from public.audit_logs where action = 'ACTIVATE_PRODUCT'$q$) >= 1);
  perform pg_temp.check('P4 Name change audited as UPDATE_PROFILE with actor',
    pg_temp.visible(format($q$select 1 from public.audit_logs where action = 'UPDATE_PROFILE' and entity_id = %L and actor_user_id = %L and new_values ? 'full_name'$q$, agent_a, admin_id)) = 1);

  -- AGENT
  perform pg_temp.act_as(agent_a);
  r := pg_temp.attempt(format($q$update public.profiles set full_name = 'Self rename' where id = %L$q$, agent_a));
  perform pg_temp.check('P4 AGENT cannot edit own profile details', r = 'OK:0', r);
  r := pg_temp.attempt(format($q$update public.profiles set full_name = 'Hacked' where id = %L$q$, agent_b));
  perform pg_temp.check('P4 AGENT cannot edit another profile', r = 'OK:0', r);
  perform pg_temp.check('P4 AGENT sees only own row in agent_directory',
    pg_temp.visible('select 1 from public.agent_directory') = 1);
  perform pg_temp.check('P4 AGENT sees only own task locations in location_directory',
    pg_temp.visible('select 1 from public.location_directory') = 1
    and pg_temp.visible($q$select 1 from public.location_directory where location_name = 'Site B'$q$) = 0);
  r := pg_temp.attempt($q$insert into public.customers (name) values ('Agent-made')$q$);
  perform pg_temp.check('P4 AGENT cannot insert customers', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$insert into public.products (sku, product_name) values ('AGENT-SKU', 'x')$q$);
  perform pg_temp.check('P4 AGENT cannot insert products', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$insert into public.locations (customer_id, location_name) values ('20000000-0000-4000-a000-0000000000a1', 'x')$q$);
  perform pg_temp.check('P4 AGENT cannot insert locations', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$insert into public.agents (profile_id) values ('00000000-0000-4000-a000-0000000000a1')$q$);
  perform pg_temp.check('P4 AGENT cannot insert agents', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$update public.locations set geofence_radius_meters = 5000$q$);
  perform pg_temp.check('P4 AGENT cannot modify locations', r = 'OK:0', r);
  r := pg_temp.attempt($q$update public.agents set employee_code = 'X'$q$);
  perform pg_temp.check('P4 AGENT cannot modify agent records', r = 'OK:0', r);
  perform pg_temp.check('P4 AGENT cannot delete any master data',
    pg_temp.attempt('delete from public.customers') = 'ERR:42501'
    and pg_temp.attempt('delete from public.products') = 'ERR:42501'
    and pg_temp.attempt('delete from public.locations') = 'ERR:42501'
    and pg_temp.attempt('delete from public.agents') = 'ERR:42501');

  -- ANON
  perform pg_temp.act_as_anon();
  perform pg_temp.check('P4 ANON cannot read directory views',
    pg_temp.attempt('select 1 from public.agent_directory') = 'ERR:42501'
    and pg_temp.attempt('select 1 from public.location_directory') = 'ERR:42501');

  perform set_config('role', 'postgres', true);
end
$$;

-- ---------------------------------------------------------------------------
-- Phase 5: task creation, assignment, editing and cancellation
-- ---------------------------------------------------------------------------
do $$
declare
  admin_id  constant uuid := '00000000-0000-4000-a000-00000000000a';
  agent_a   constant uuid := '00000000-0000-4000-a000-0000000000a1';
  agent_b   constant uuid := '00000000-0000-4000-a000-0000000000b1';
  ag_a      constant text := '10000000-0000-4000-a000-0000000000a1';
  ag_b      constant text := '10000000-0000-4000-a000-0000000000b1';
  cust_a    constant text := '20000000-0000-4000-a000-0000000000a1';
  cust_b    constant text := '20000000-0000-4000-a000-0000000000b1';
  site_a    constant text := '30000000-0000-4000-a000-0000000000a1';
  site_b    constant text := '30000000-0000-4000-a000-0000000000b1';
  prod_a    constant text := '40000000-0000-4000-a000-0000000000a1';
  prod_b    constant text := '40000000-0000-4000-a000-0000000000b1';
  base      jsonb;
  prods     jsonb;
  v_task    uuid;
  v_draft   uuid;
  v_before  timestamptz;
  r         text;

  -- Builds "select admin_save_task(...)" for error_of().
  save_sql  text := 'select public.admin_save_task(p_task_id => %L::uuid, p_task => %L::jsonb, p_products => %L::jsonb, p_assign => %L::boolean)';
begin
  base := jsonb_build_object(
    'task_type', 'DELIVER_PRODUCTS', 'title', 'P5 delivery', 'priority', 3,
    'customer_id', cust_a, 'location_id', site_a, 'agent_id', ag_a,
    'scheduled_date', current_date::text, 'scheduled_start_time', '09:00', 'scheduled_end_time', '11:00');
  prods := jsonb_build_array(jsonb_build_object('product_id', prod_a, 'assigned_quantity', '2.5', 'unit_price', null));

  perform pg_temp.act_as(admin_id);

  -- Test 1: create & assign a delivery task atomically
  v_task := public.admin_save_task(base, prods, true);
  perform pg_temp.check('P5 ADMIN creates DELIVER_PRODUCTS task as ASSIGNED with agent, customer, location',
    pg_temp.visible(format($q$select 1 from public.tasks where id = %L and status = 'ASSIGNED' and agent_id = %L
      and customer_id = %L and location_id = %L and assigned_at is not null and created_by = %L$q$,
      v_task, ag_a, cust_a, site_a, admin_id)) = 1);
  perform pg_temp.check('P5 Product line stored with quantity 2.5 and price copied from product (10.00)',
    pg_temp.visible(format($q$select 1 from public.task_products where task_id = %L and assigned_quantity = 2.5 and unit_price = 10$q$, v_task)) = 1);
  perform pg_temp.check('P5 Creation recorded in status history (→ ASSIGNED) by the admin',
    pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and old_status is null
      and new_status = 'ASSIGNED' and changed_by = %L$q$, v_task, admin_id)) = 1);
  perform pg_temp.check('P5 Audit: CREATE_TASK and ADD_TASK_PRODUCT with admin actor',
    pg_temp.visible(format($q$select 1 from public.audit_logs where entity_id = %L and action = 'CREATE_TASK' and actor_user_id = %L$q$, v_task, admin_id)) = 1
    and pg_temp.visible(format($q$select 1 from public.audit_logs where action = 'ADD_TASK_PRODUCT' and actor_user_id = %L and new_values ->> 'task_id' = %L$q$, admin_id, v_task)) = 1);

  -- Tests 2–8: validation (nothing may be created)
  r := pg_temp.error_of(format(save_sql, null, base || jsonb_build_object('location_id', site_b), prods, true));
  perform pg_temp.check('P5 Location of another customer rejected', r = 'LOCATION_CUSTOMER_MISMATCH', r);
  r := pg_temp.error_of(format(save_sql, null, base || jsonb_build_object('agent_id', '10000000-0000-4000-a000-0000000000d1'), prods, true));
  perform pg_temp.check('P5 Inactive agent record rejected', r = 'AGENT_INACTIVE', r);
  r := pg_temp.error_of(format(save_sql, null, base || jsonb_build_object('agent_id', '10000000-0000-4000-a000-0000000000c1'), prods, true));
  perform pg_temp.check('P5 Agent with inactive account rejected', r = 'AGENT_INACTIVE', r);
  update public.customers set is_active = false where id = cust_b::uuid;
  r := pg_temp.error_of(format(save_sql, null, base || jsonb_build_object('customer_id', cust_b, 'location_id', site_b), prods, true));
  perform pg_temp.check('P5 Inactive customer rejected', r = 'CUSTOMER_INACTIVE', r);
  update public.customers set is_active = true where id = cust_b::uuid;
  update public.locations set is_active = false where id = site_b::uuid;
  r := pg_temp.error_of(format(save_sql, null, base || jsonb_build_object('customer_id', cust_b, 'location_id', site_b), prods, true));
  perform pg_temp.check('P5 Inactive location rejected', r = 'LOCATION_INACTIVE', r);
  update public.locations set is_active = true where id = site_b::uuid;
  update public.products set is_active = false where id = prod_b::uuid;
  r := pg_temp.error_of(format(save_sql, null, base,
    jsonb_build_array(jsonb_build_object('product_id', prod_b, 'assigned_quantity', '1')), true));
  perform pg_temp.check('P5 Inactive product rejected on a new task', r = 'PRODUCT_INACTIVE', r);
  update public.products set is_active = true where id = prod_b::uuid;
  r := pg_temp.error_of(format(save_sql, null, base,
    jsonb_build_array(jsonb_build_object('product_id', prod_a, 'assigned_quantity', '0')), true));
  perform pg_temp.check('P5 Quantity 0 rejected', r = 'QUANTITY_INVALID', r);
  r := pg_temp.attempt(format(save_sql, null, base || jsonb_build_object('priority', 6), prods, true));
  perform pg_temp.check('P5 Priority 6 rejected', r = 'ERR:23514', r);
  r := pg_temp.error_of(format(save_sql, null, base, prods || prods, true));
  perform pg_temp.check('P5 Same product twice rejected', r = 'PRODUCT_DUPLICATE', r);
  r := pg_temp.error_of(format(save_sql, null, base, '[]', true));
  perform pg_temp.check('P5 Assigned delivery task without products rejected', r = 'PRODUCTS_REQUIRED', r);
  r := pg_temp.error_of(format(save_sql, null, base - 'agent_id', prods, true));
  perform pg_temp.check('P5 Assigning without an agent rejected', r = 'AGENT_REQUIRED', r);
  r := pg_temp.attempt(format(save_sql, null, base || jsonb_build_object('scheduled_start_time', '12:00'), prods, true));
  perform pg_temp.check('P5 Start time after end time rejected', r = 'ERR:23514', r);
  perform pg_temp.check('P5 Rejected saves created no tasks',
    pg_temp.visible($q$select 1 from public.tasks where title = 'P5 delivery'$q$) = 1);

  -- Draft → assign
  v_draft := public.admin_save_task(base - 'agent_id' || jsonb_build_object('task_type', 'SURVEY', 'title', 'P5 draft'), '[]', false);
  perform pg_temp.check('P5 Draft created without agent',
    pg_temp.visible(format($q$select 1 from public.tasks where id = %L and status = 'DRAFT' and agent_id is null and assigned_at is null$q$, v_draft)) = 1);
  perform public.admin_save_task(base || jsonb_build_object('task_type', 'SURVEY', 'title', 'P5 draft'), '[]', true, v_draft);
  perform pg_temp.check('P5 DRAFT → ASSIGNED recorded in history with admin as actor',
    pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and old_status = 'DRAFT'
      and new_status = 'ASSIGNED' and changed_by = %L$q$, v_draft, admin_id)) = 1);
  perform pg_temp.check('P5 Audit: ASSIGN_TASK',
    pg_temp.visible(format($q$select 1 from public.audit_logs where entity_id = %L and action = 'ASSIGN_TASK' and actor_user_id = %L$q$, v_draft, admin_id)) = 1);

  -- Reassign / reschedule / line changes
  -- now() is fixed within this single test transaction, so backdate first.
  update public.tasks set assigned_at = assigned_at - interval '1 hour' where id = v_task;
  select assigned_at into v_before from public.tasks where id = v_task;
  perform public.admin_save_task(base || jsonb_build_object('agent_id', ag_b), prods, true, v_task);
  perform pg_temp.check('P5 Reassignment updates agent and assigned_at; audited as REASSIGN_TASK',
    pg_temp.visible(format($q$select 1 from public.tasks where id = %L and agent_id = %L and assigned_at > %L$q$, v_task, ag_b, v_before)) = 1
    and pg_temp.visible(format($q$select 1 from public.audit_logs where entity_id = %L and action = 'REASSIGN_TASK'$q$, v_task)) = 1);
  perform public.admin_save_task(base || jsonb_build_object('agent_id', ag_b, 'scheduled_date', (current_date + 1)::text), prods, true, v_task);
  perform pg_temp.check('P5 Schedule-only change audited as RESCHEDULE_TASK',
    pg_temp.visible(format($q$select 1 from public.audit_logs where entity_id = %L and action = 'RESCHEDULE_TASK'$q$, v_task)) = 1);
  perform public.admin_save_task(base || jsonb_build_object('agent_id', ag_b, 'scheduled_date', (current_date + 1)::text),
    jsonb_build_array(jsonb_build_object('product_id', prod_a, 'assigned_quantity', '4', 'unit_price', '9.50'),
                      jsonb_build_object('product_id', prod_b, 'assigned_quantity', '1')), true, v_task);
  perform public.admin_save_task(base || jsonb_build_object('agent_id', ag_b, 'scheduled_date', (current_date + 1)::text),
    jsonb_build_array(jsonb_build_object('product_id', prod_b, 'assigned_quantity', '1')), true, v_task);
  perform pg_temp.check('P5 Product lines: update, add and remove are applied and audited',
    pg_temp.visible(format($q$select 1 from public.task_products where task_id = %L$q$, v_task)) = 1
    and pg_temp.visible(format($q$select 1 from public.audit_logs where action = 'UPDATE_TASK_PRODUCT' and new_values ->> 'unit_price' = '9.50'$q$)) = 1
    and pg_temp.visible(format($q$select 1 from public.audit_logs where action = 'REMOVE_TASK_PRODUCT' and old_values ->> 'task_id' = %L$q$, v_task)) = 1);

  -- Unchanged links survive later deactivation of the master record
  update public.customers set is_active = false where id = cust_a::uuid;
  r := pg_temp.error_of(format(save_sql, v_task, base || jsonb_build_object('agent_id', ag_b, 'title', 'P5 renamed'),
    jsonb_build_array(jsonb_build_object('product_id', prod_b, 'assigned_quantity', '1')), true));
  perform pg_temp.check('P5 Editing a task whose (unchanged) customer was deactivated still works', r = 'OK', r);
  update public.customers set is_active = true where id = cust_a::uuid;

  -- Cancellation
  r := pg_temp.error_of(format('select public.admin_cancel_task(%L, %L)', v_task, ''));
  perform pg_temp.check('P5 Cancellation needs a reason', r = 'REASON_REQUIRED', r);
  perform public.admin_cancel_task(v_task, 'Customer closed for the day');
  perform pg_temp.check('P5 Cancel: status CANCELLED, reason stored and in history, audited CANCEL_TASK',
    pg_temp.visible(format($q$select 1 from public.tasks where id = %L and status = 'CANCELLED' and cancellation_reason = 'Customer closed for the day'$q$, v_task)) = 1
    and pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and new_status = 'CANCELLED' and reason = 'Customer closed for the day'$q$, v_task)) = 1
    and pg_temp.visible(format($q$select 1 from public.audit_logs where entity_id = %L and action = 'CANCEL_TASK'$q$, v_task)) = 1);
  r := pg_temp.error_of(format(save_sql, v_task, base, prods, true));
  perform pg_temp.check('P5 Cancelled task can no longer be edited', r = 'TASK_NOT_EDITABLE', r);
  r := pg_temp.error_of(format('select public.admin_cancel_task(%L, %L)', v_task, 'again'));
  perform pg_temp.check('P5 Cancelled task cannot be cancelled again', r = 'TASK_NOT_CANCELLABLE', r);

  -- AGENT: no admin operations, only own tasks
  perform pg_temp.act_as(agent_a);
  r := pg_temp.error_of(format(save_sql, null, base, prods, true));
  perform pg_temp.check('P5 AGENT cannot create tasks via admin_save_task', r = 'NOT_ADMIN', r);
  r := pg_temp.error_of(format(save_sql, v_draft, base || jsonb_build_object('task_type', 'SURVEY', 'title', 'P5 draft', 'agent_id', ag_a), '[]', true));
  perform pg_temp.check('P5 AGENT cannot reassign via admin_save_task', r = 'NOT_ADMIN', r);
  r := pg_temp.error_of(format('select public.admin_cancel_task(%L, %L)', v_draft, 'not mine'));
  perform pg_temp.check('P5 AGENT cannot cancel tasks', r = 'NOT_ADMIN', r);
  r := pg_temp.attempt(format($q$update public.tasks set agent_id = %L where id = %L$q$, ag_a, v_draft));
  perform pg_temp.check('P5 AGENT cannot change tasks.agent_id directly', r = 'OK:0', r);
  perform pg_temp.check('P5 AGENT sees own tasks only in task_directory',
    pg_temp.visible($q$select 1 from public.task_directory where agent_id <> '10000000-0000-4000-a000-0000000000a1'$q$) = 0
    and pg_temp.visible(format($q$select 1 from public.task_directory where id = %L$q$, v_draft)) = 1);
  perform pg_temp.act_as(agent_b);
  perform pg_temp.check('P5 AGENT B cannot see Agent A task in task_directory',
    pg_temp.visible(format($q$select 1 from public.task_directory where id = %L$q$, v_draft)) = 0);

  -- ANON
  perform pg_temp.act_as_anon();
  perform pg_temp.check('P5 ANON cannot call task functions or read task_directory',
    pg_temp.attempt(format(save_sql, null, base, prods, true)) = 'ERR:42501'
    and pg_temp.attempt('select 1 from public.task_directory') = 'ERR:42501');

  perform set_config('role', 'postgres', true);
end
$$;

-- ---------------------------------------------------------------------------
-- Phase 6: agent task execution workflow
-- ---------------------------------------------------------------------------
-- Fixtures created as owner. CHECKED_IN is set directly as the owner to stand
-- in for the GPS check-in of the next phase (TEST-ONLY: no app path can do this).
insert into public.tasks (id, task_type, status, agent_id, customer_id, location_id, title, assigned_at) values
  ('51000000-0000-4000-a000-0000000000a1', 'SURVEY', 'ASSIGNED', '10000000-0000-4000-a000-0000000000a1',
   '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'P6 happy path', now()),
  ('51000000-0000-4000-a000-0000000000a2', 'SURVEY', 'ASSIGNED', '10000000-0000-4000-a000-0000000000a1',
   '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'P6 failure path', now()),
  ('51000000-0000-4000-a000-0000000000a3', 'SURVEY', 'ASSIGNED', '10000000-0000-4000-a000-0000000000a1',
   '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'P6 cancelled underneath', now());

create function pg_temp.agent_move(p_task uuid, p_from text, p_to text, p_reason text default null, p_notes text default null)
returns text language plpgsql as $$
begin
  perform public.agent_transition_task(p_task, p_from::public.task_status, p_to::public.task_status, p_reason, p_notes);
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-a000-00000000000a';
  agent_a  constant uuid := '00000000-0000-4000-a000-0000000000a1';
  agent_b  constant uuid := '00000000-0000-4000-a000-0000000000b1';
  t_happy  constant uuid := '51000000-0000-4000-a000-0000000000a1';
  t_fail   constant uuid := '51000000-0000-4000-a000-0000000000a2';
  t_cancel constant uuid := '51000000-0000-4000-a000-0000000000a3';
  t_b      constant uuid := '50000000-0000-4000-a000-0000000000b1';
  t_draft  constant uuid := '50000000-0000-4000-a000-0000000000a2';
  r        text;
begin
  -- Agent A: happy path up to ARRIVED
  perform pg_temp.act_as(agent_a);
  r := pg_temp.agent_move(t_happy, 'ASSIGNED', 'ACCEPTED');
  perform pg_temp.check('P6 AGENT accepts own task', r = 'OK', r);
  perform pg_temp.check('P6 Accept sets accepted_at; history ASSIGNED→ACCEPTED by the agent',
    pg_temp.visible(format($q$select 1 from public.tasks where id = %L and status = 'ACCEPTED' and accepted_at is not null$q$, t_happy)) = 1
    and pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and old_status = 'ASSIGNED'
      and new_status = 'ACCEPTED' and changed_by = %L$q$, t_happy, agent_a)) = 1);
  r := pg_temp.agent_move(t_happy, 'ASSIGNED', 'ACCEPTED');
  perform pg_temp.check('P6 Stale request (expected ASSIGNED, now ACCEPTED) rejected', r = 'STATUS_CHANGED', r);
  r := pg_temp.agent_move(t_happy, 'ACCEPTED', 'ARRIVED');
  perform pg_temp.check('P6 Skipping a step (ACCEPTED→ARRIVED) rejected', r = 'TRANSITION_NOT_ALLOWED', r);
  r := pg_temp.agent_move(t_happy, 'ACCEPTED', 'ON_THE_WAY');
  perform pg_temp.check('P6 Start travel (ACCEPTED→ON_THE_WAY)', r = 'OK', r);
  r := pg_temp.agent_move(t_happy, 'ON_THE_WAY', 'ARRIVED');
  perform pg_temp.check('P6 Mark arrived (ON_THE_WAY→ARRIVED)', r = 'OK', r);
  r := pg_temp.agent_move(t_happy, 'ARRIVED', 'CHECKED_IN');
  perform pg_temp.check('P6 Agent cannot self-check-in without GPS', r = 'CHECK_IN_REQUIRED', r);
  r := pg_temp.agent_move(t_happy, 'ARRIVED', 'IN_PROGRESS');
  perform pg_temp.check('P6 Agent cannot skip check-in (ARRIVED→IN_PROGRESS)', r = 'TRANSITION_NOT_ALLOWED', r);
  r := pg_temp.agent_move(t_happy, 'ARRIVED', 'COMPLETED');
  perform pg_temp.check('P6 Agent cannot complete before check-in', r = 'TRANSITION_NOT_ALLOWED', r);
  r := pg_temp.attempt(format($q$update public.tasks set status = 'CHECKED_IN' where id = %L$q$, t_happy));
  perform pg_temp.check('P6 Agent cannot set status by direct UPDATE', r = 'OK:0', r);

  -- TEST-ONLY stand-in for the GPS check-in
  perform set_config('role', 'postgres', true);
  update public.tasks set status = 'CHECKED_IN' where id = t_happy;
  perform pg_temp.act_as(agent_a);

  r := pg_temp.agent_move(t_happy, 'CHECKED_IN', 'IN_PROGRESS');
  perform pg_temp.check('P6 Start task after check-in (CHECKED_IN→IN_PROGRESS) sets started_at', r = 'OK'
    and pg_temp.visible(format($q$select 1 from public.tasks where id = %L and started_at is not null$q$, t_happy)) = 1, r);
  r := pg_temp.agent_move(t_happy, 'IN_PROGRESS', 'COMPLETED');
  perform pg_temp.check('P8 Generic transition can no longer complete a task (needs agent_complete_task)', r = 'TRANSITION_NOT_ALLOWED', r);
  r := pg_temp.error_of(format('select public.agent_complete_task(%L, p_notes => %L, p_partial => true)', t_happy, 'Two rooms surveyed'));
  perform pg_temp.check('P6 Partial completion requires a reason', r = 'REASON_REQUIRED', r);
  r := pg_temp.error_of(format('select public.agent_complete_task(%L, p_notes => %L)', t_happy, 'All items handed over'));
  perform pg_temp.check('P6 Complete: completed_at, notes, history note by the agent', r = 'OK'
    and pg_temp.visible(format($q$select 1 from public.tasks where id = %L and status = 'COMPLETED' and completed_at is not null
      and completion_notes = 'All items handed over'$q$, t_happy)) = 1
    and pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and new_status = 'COMPLETED'
      and changed_by = %L and notes = 'All items handed over'$q$, t_happy, agent_a)) = 1, r);
  r := pg_temp.agent_move(t_happy, 'COMPLETED', 'COMPLETED');
  perform pg_temp.check('P6 Completed task cannot be completed again', r = 'TRANSITION_NOT_ALLOWED', r);
  r := pg_temp.agent_move(t_happy, 'COMPLETED', 'VERIFIED');
  perform pg_temp.check('P6 Agent cannot verify', r = 'TRANSITION_NOT_ALLOWED', r);

  -- Failure path
  perform pg_temp.agent_move(t_fail, 'ASSIGNED', 'ACCEPTED');
  perform pg_temp.agent_move(t_fail, 'ACCEPTED', 'ON_THE_WAY');
  r := pg_temp.agent_move(t_fail, 'ON_THE_WAY', 'FAILED');
  perform pg_temp.check('P6 Failure requires a reason', r = 'REASON_REQUIRED', r);
  r := pg_temp.agent_move(t_fail, 'ON_THE_WAY', 'FAILED', 'Customer unavailable', 'Shop shutter down');
  perform pg_temp.check('P6 Report failure: FAILED with reason in task and history', r = 'OK'
    and pg_temp.visible(format($q$select 1 from public.tasks where id = %L and status = 'FAILED'
      and failure_reason = 'Customer unavailable — Shop shutter down'$q$, t_fail)) = 1
    and pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and new_status = 'FAILED'
      and reason = 'Customer unavailable' and notes = 'Shop shutter down'$q$, t_fail)) = 1, r);
  r := pg_temp.agent_move(t_fail, 'FAILED', 'CANCELLED');
  perform pg_temp.check('P6 Agent cannot cancel', r = 'TRANSITION_NOT_ALLOWED', r);

  perform pg_temp.act_as(admin_id); -- agents cannot read audit logs
  perform pg_temp.check('P6 Audit: agent steps recorded with the agent as actor',
    pg_temp.visible(format($q$select distinct action from public.audit_logs where entity_id in (%L, %L) and actor_user_id = %L
      and action in ('ACCEPT_TASK','START_TRAVEL','MARK_ARRIVED','START_TASK','COMPLETE_TASK','REPORT_TASK_FAILURE')$q$,
      t_happy, t_fail, agent_a)) = 6);
  perform pg_temp.act_as(agent_a);

  -- Admin cancels while the agent is on the way; the agent's stale screen fails safely
  perform pg_temp.agent_move(t_cancel, 'ASSIGNED', 'ACCEPTED');
  perform pg_temp.agent_move(t_cancel, 'ACCEPTED', 'ON_THE_WAY');
  perform pg_temp.act_as(admin_id);
  r := pg_temp.error_of(format('select public.admin_cancel_task(%L, %L)', t_cancel, 'Customer closed today'));
  perform pg_temp.check('P6 Admin can cancel a task that is on the way', r = 'OK', r);
  perform pg_temp.act_as(agent_a);
  r := pg_temp.agent_move(t_cancel, 'ON_THE_WAY', 'ARRIVED');
  perform pg_temp.check('P6 Agent action on a task cancelled underneath is rejected', r = 'STATUS_CHANGED', r);
  perform pg_temp.check('P6 History reasons do not leak between transitions',
    pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and new_status = 'ON_THE_WAY'
      and reason is null and notes is null$q$, t_cancel)) = 1);

  -- Ownership
  r := pg_temp.agent_move(t_b, 'ASSIGNED', 'ACCEPTED');
  perform pg_temp.check('P6 Agent A cannot accept Agent B''s task', r = 'TASK_NOT_FOUND', r);
  r := pg_temp.agent_move(t_draft, 'DRAFT', 'ASSIGNED');
  perform pg_temp.check('P6 Agent cannot act on an unreleased draft', r = 'TASK_NOT_FOUND', r);
  r := pg_temp.attempt(format($q$update public.tasks set agent_id = %L, created_by = %L, verified_by = %L where id = %L$q$,
    '10000000-0000-4000-a000-0000000000a1', agent_a, agent_a, t_b));
  perform pg_temp.check('P6 Agent cannot change agent_id / created_by / verified_by', r in ('OK:0', 'ERR:42501'), r);
  perform pg_temp.act_as(agent_b);
  r := pg_temp.agent_move(t_happy, 'COMPLETED', 'VERIFIED');
  perform pg_temp.check('P6 Agent B cannot change Agent A''s task', r = 'TASK_NOT_FOUND', r);
  perform pg_temp.act_as('00000000-0000-4000-a000-0000000000d1');
  r := pg_temp.agent_move(t_happy, 'COMPLETED', 'VERIFIED');
  perform pg_temp.check('P6 Deactivated agent cannot transition tasks', r = 'NOT_AGENT', r);
  perform pg_temp.act_as(admin_id);
  r := pg_temp.agent_move(t_b, 'ASSIGNED', 'ACCEPTED');
  perform pg_temp.check('P6 Admin cannot use the agent transition function', r = 'NOT_AGENT', r);
  perform pg_temp.act_as_anon();
  perform pg_temp.check('P6 ANON cannot call the agent transition function',
    pg_temp.attempt(format($q$select public.agent_transition_task(%L, 'ASSIGNED', 'ACCEPTED')$q$, t_b)) = 'ERR:42501');

  perform set_config('role', 'postgres', true);
end
$$;

-- ---------------------------------------------------------------------------
-- Phase 7: GPS check-in & server-side geofence validation
-- ---------------------------------------------------------------------------
-- Site A is at 11.341234, 77.717823 with a 100 m geofence (fixtures above).
insert into public.locations (id, customer_id, location_name) values
  ('31000000-0000-4000-a000-0000000000a9', '20000000-0000-4000-a000-0000000000a1', 'Site without coordinates');
insert into public.tasks (id, task_type, status, agent_id, customer_id, location_id, title, assigned_at)
select ('52000000-0000-4000-a000-0000000000' || suffix)::uuid, 'SURVEY', status::public.task_status,
       '10000000-0000-4000-a000-0000000000a1', '20000000-0000-4000-a000-0000000000a1',
       coalesce(loc, '30000000-0000-4000-a000-0000000000a1')::uuid, 'P7 ' || suffix, now()
from (values
  ('01', 'ARRIVED', null),     -- success, then duplicate
  ('02', 'ARRIVED', null),     -- outside, then inside
  ('03', 'ARRIVED', null),     -- exactly on the radius
  ('04', 'ARRIVED', null),     -- input validation
  ('05', 'ARRIVED', '31000000-0000-4000-a000-0000000000a9'),  -- location without coordinates
  ('11', 'ASSIGNED', null), ('12', 'ACCEPTED', null), ('13', 'ON_THE_WAY', null),
  ('14', 'IN_PROGRESS', null), ('15', 'COMPLETED', null)
) v(suffix, status, loc);

create function pg_temp.check_in(p_task uuid, p_lat double precision, p_lng double precision,
  p_acc double precision default 10, p_at timestamptz default now())
returns text language plpgsql as $$
declare r jsonb;
begin
  r := public.agent_check_in(p_task, p_lat, p_lng, p_acc, p_at, 'test-device');
  return r ->> 'result';
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-a000-00000000000a';
  agent_a  constant uuid := '00000000-0000-4000-a000-0000000000a1';
  agent_b  constant uuid := '00000000-0000-4000-a000-0000000000b1';
  site_lat constant double precision := 11.341234;
  site_lng constant double precision := 77.717823;
  -- Moving due north by d metres changes latitude by d / (R·π/180) degrees.
  m_per_deg constant double precision := 6371008.8 * pi() / 180;
  t1 constant uuid := '52000000-0000-4000-a000-000000000001';
  t2 constant uuid := '52000000-0000-4000-a000-000000000002';
  t3 constant uuid := '52000000-0000-4000-a000-000000000003';
  t4 constant uuid := '52000000-0000-4000-a000-000000000004';
  t5 constant uuid := '52000000-0000-4000-a000-000000000005';
  r  text;
  s  text;
begin
  perform pg_temp.act_as(agent_a);

  -- Inside (~15 m) → success
  r := pg_temp.check_in(t1, site_lat + 15 / m_per_deg, site_lng);
  perform pg_temp.check('P7 Inside geofence (~15 m) → CHECKED_IN', r = 'CHECKED_IN', r);
  perform pg_temp.check('P7 Check-in row: server distance ≈15 m, radius 100 from DB, within, agent, accuracy',
    pg_temp.visible(format($q$select 1 from public.checkins where task_id = %L and agent_id = '10000000-0000-4000-a000-0000000000a1'
      and distance_from_location_meters between 14.9 and 15.1 and geofence_radius_meters = 100 and is_within_geofence
      and accuracy_meters = 10 and device_id = 'test-device'$q$, t1)) = 1);
  perform pg_temp.check('P7 Task CHECKED_IN; history ARRIVED→CHECKED_IN by the agent with reason',
    pg_temp.visible(format($q$select 1 from public.tasks where id = %L and status = 'CHECKED_IN'$q$, t1)) = 1
    and pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and old_status = 'ARRIVED'
      and new_status = 'CHECKED_IN' and changed_by = %L and reason = 'GPS geofence check-in'$q$, t1, agent_a)) = 1);

  -- Duplicate request after success
  r := pg_temp.check_in(t1, site_lat, site_lng);
  perform pg_temp.check('P7 Second check-in on the same task rejected', r = 'CHECKIN_ALREADY_EXISTS', r);
  perform pg_temp.check('P7 Exactly one successful check-in and one transition',
    pg_temp.visible(format($q$select 1 from public.checkins where task_id = %L and is_within_geofence$q$, t1)) = 1
    and pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and new_status = 'CHECKED_IN'$q$, t1)) = 1);

  -- Outside (~150 m) → rejected, nothing transitions
  r := pg_temp.check_in(t2, site_lat + 150 / m_per_deg, site_lng);
  perform pg_temp.check('P7 Outside geofence (~150 m) → OUTSIDE_GEOFENCE', r = 'OUTSIDE_GEOFENCE', r);
  perform pg_temp.check('P7 Rejected: task stays ARRIVED, no history, attempt stored as not within',
    pg_temp.visible(format($q$select 1 from public.tasks where id = %L and status = 'ARRIVED'$q$, t2)) = 1
    and pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and new_status = 'CHECKED_IN'$q$, t2)) = 0
    and pg_temp.visible(format($q$select 1 from public.checkins where task_id = %L and not is_within_geofence
      and distance_from_location_meters between 149.9 and 150.1$q$, t2)) = 1);
  r := pg_temp.check_in(t2, site_lat + 40 / m_per_deg, site_lng);
  perform pg_temp.check('P7 Retry after moving closer succeeds', r = 'CHECKED_IN', r);

  -- Exactly on the boundary
  r := pg_temp.check_in(t3, site_lat + 100 / m_per_deg, site_lng);
  perform pg_temp.check('P7 Exactly on the 100 m radius → accepted', r = 'CHECKED_IN'
    and pg_temp.visible(format($q$select 1 from public.checkins where task_id = %L and distance_from_location_meters = 100.00$q$, t3)) = 1, r);

  -- Input validation (task t4 stays ARRIVED throughout)
  perform pg_temp.check('P7 latitude > 90 rejected', pg_temp.check_in(t4, 90.5, site_lng) = 'INVALID_COORDINATES');
  perform pg_temp.check('P7 latitude < -90 rejected', pg_temp.check_in(t4, -90.5, site_lng) = 'INVALID_COORDINATES');
  perform pg_temp.check('P7 longitude > 180 rejected', pg_temp.check_in(t4, site_lat, 180.5) = 'INVALID_COORDINATES');
  perform pg_temp.check('P7 longitude < -180 rejected', pg_temp.check_in(t4, site_lat, -180.5) = 'INVALID_COORDINATES');
  perform pg_temp.check('P7 NaN coordinate rejected', pg_temp.check_in(t4, 'NaN'::double precision, site_lng) = 'INVALID_COORDINATES');
  perform pg_temp.check('P7 Infinity coordinate rejected', pg_temp.check_in(t4, site_lat, 'Infinity'::double precision) = 'INVALID_COORDINATES');
  perform pg_temp.check('P7 Negative accuracy rejected', pg_temp.check_in(t4, site_lat, site_lng, -1) = 'INVALID_ACCURACY');
  perform pg_temp.check('P7 NaN accuracy rejected', pg_temp.check_in(t4, site_lat, site_lng, 'NaN'::double precision) = 'INVALID_ACCURACY');
  perform pg_temp.check('P7 Poor accuracy (150 m > 100 m limit) rejected', pg_temp.check_in(t4, site_lat, site_lng, 150) = 'GPS_ACCURACY_TOO_LOW');
  perform pg_temp.check('P7 Accuracy exactly at the limit accepted for further checks',
    pg_temp.check_in(t4, site_lat + 500 / m_per_deg, site_lng, 100) = 'OUTSIDE_GEOFENCE');
  perform pg_temp.check('P7 Stale reading (10 min old) rejected',
    pg_temp.check_in(t4, site_lat, site_lng, 10, now() - interval '10 minutes') = 'STALE_LOCATION');
  perform pg_temp.check('P7 Future-dated reading (10 min ahead) rejected',
    pg_temp.check_in(t4, site_lat, site_lng, 10, now() + interval '10 minutes') = 'STALE_LOCATION');
  perform pg_temp.check('P7 Invalid inputs left the task ARRIVED with no successful check-in',
    pg_temp.visible(format($q$select 1 from public.tasks where id = %L and status = 'ARRIVED'$q$, t4)) = 1
    and pg_temp.visible(format($q$select 1 from public.checkins where task_id = %L and is_within_geofence$q$, t4)) = 0);
  r := pg_temp.check_in(t5, site_lat, site_lng);
  perform pg_temp.check('P7 Location without coordinates → INVALID_LOCATION_CONFIGURATION', r = 'INVALID_LOCATION_CONFIGURATION', r);

  -- Status: only ARRIVED may check in
  foreach s in array array['11:ASSIGNED', '12:ACCEPTED', '13:ON_THE_WAY', '14:IN_PROGRESS', '15:COMPLETED'] loop
    r := pg_temp.check_in(('52000000-0000-4000-a000-0000000000' || split_part(s, ':', 1))::uuid, site_lat, site_lng);
    perform pg_temp.check('P7 ' || split_part(s, ':', 2) || ' → CHECKED_IN rejected', r = 'INVALID_TASK_STATUS', r);
  end loop;

  -- Client tampering: the function has no distance/radius/within parameters at all.
  r := pg_temp.error_of(format($q$select public.agent_check_in(p_task_id => %L, p_latitude => 0, p_longitude => 0,
    p_accuracy => 5, p_captured_at => now(), distance_from_location_meters => 1, is_within_geofence => true,
    geofence_radius_meters => 999999)$q$, t4));
  perform pg_temp.check('P7 Client-supplied distance / is_within_geofence / radius cannot be passed',
    r like '%does not exist%', left(r, 60));
  perform pg_temp.check('P7 Far-away coordinates stay rejected however the request is dressed up',
    pg_temp.check_in(t4, 0, 0) = 'OUTSIDE_GEOFENCE');

  -- Direct writes stay impossible
  r := pg_temp.attempt(format($q$insert into public.checkins (task_id, agent_id, latitude, longitude, is_within_geofence)
    values (%L, '10000000-0000-4000-a000-0000000000a1', 0, 0, true)$q$, t4));
  perform pg_temp.check('P7 Agent cannot insert a check-in directly', r = 'ERR:42501', r);
  perform pg_temp.check('P7 Agent cannot read check-in settings',
    pg_temp.visible('select 1 from public.app_settings') = 0);

  -- Cross-agent / roles
  perform pg_temp.act_as(agent_b);
  r := pg_temp.check_in(t4, site_lat, site_lng);
  perform pg_temp.check('P7 Agent B cannot check in to Agent A''s task', r = 'TASK_NOT_FOUND', r);
  perform pg_temp.check('P7 Agent B cannot see Agent A''s check-ins',
    pg_temp.visible($q$select 1 from public.checkins where agent_id = '10000000-0000-4000-a000-0000000000a1'$q$) = 0);
  perform pg_temp.act_as('00000000-0000-4000-a000-0000000000d1');
  r := pg_temp.check_in(t4, site_lat, site_lng);
  perform pg_temp.check('P7 Deactivated agent cannot check in', r = 'UNAUTHORIZED', r);
  perform pg_temp.act_as(admin_id);
  r := pg_temp.check_in(t4, site_lat, site_lng);
  perform pg_temp.check('P7 Admin cannot check in on an agent''s behalf', r = 'UNAUTHORIZED', r);
  perform pg_temp.check('P7 Admin sees check-ins (success and rejected attempts) and settings',
    pg_temp.visible($q$select 1 from public.checkins where task_id = '52000000-0000-4000-a000-000000000002'$q$) = 2
    and pg_temp.visible('select 1 from public.app_settings') >= 4);
  perform pg_temp.check('P7 Audit: TASK_CHECK_IN by the agent only for successful check-ins',
    pg_temp.visible(format($q$select 1 from public.audit_logs where action = 'TASK_CHECK_IN' and actor_user_id = %L
      and entity_id in ('52000000-0000-4000-a000-000000000001', '52000000-0000-4000-a000-000000000002', '52000000-0000-4000-a000-000000000003')$q$, agent_a)) = 3
    and pg_temp.visible($q$select 1 from public.audit_logs where action = 'TASK_CHECK_IN'
      and entity_id = '52000000-0000-4000-a000-000000000004'$q$) = 0);
  perform pg_temp.act_as_anon();
  perform pg_temp.check('P7 ANON cannot call agent_check_in',
    pg_temp.attempt(format('select public.agent_check_in(%L, 0, 0, 5, now())', t4)) = 'ERR:42501');

  perform set_config('role', 'postgres', true);
end
$$;

-- ---------------------------------------------------------------------------
-- Phase 8: task execution — delivery, cash, proof
-- ---------------------------------------------------------------------------
insert into public.tasks (id, task_type, status, agent_id, customer_id, location_id, title, assigned_at, expected_amount)
select ('53000000-0000-4000-a000-0000000000' || s)::uuid, t::public.task_type, st::public.task_status,
       coalesce(ag, '10000000-0000-4000-a000-0000000000a1')::uuid,
       '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'P8 ' || s, now(), amt
from (values
  ('01', 'DELIVER_PRODUCTS', 'IN_PROGRESS', null, null),          -- full delivery
  ('02', 'DELIVER_PRODUCTS', 'IN_PROGRESS', null, null),          -- partial delivery
  ('03', 'DELIVER_PRODUCTS', 'IN_PROGRESS', null, null),          -- zero delivery
  ('04', 'COLLECT_CASH', 'IN_PROGRESS', null, 10000.00),          -- full cash
  ('05', 'COLLECT_CASH', 'IN_PROGRESS', null, 10000.00),          -- partial cash
  ('06', 'DOCUMENT_COLLECTION', 'IN_PROGRESS', null, null),       -- proof required, then failure
  ('07', 'COLLECT_CASH', 'IN_PROGRESS', '10000000-0000-4000-a000-0000000000b1', 10000.00)  -- agent B
) v(s, t, st, ag, amt);
insert into public.task_products (id, task_id, product_id, assigned_quantity, unit_price) values
  ('54000000-0000-4000-a000-000000000011', '53000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-0000000000a1', 10, 100),
  ('54000000-0000-4000-a000-000000000012', '53000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-0000000000b1', 5, 250),
  ('54000000-0000-4000-a000-000000000021', '53000000-0000-4000-a000-000000000002', '40000000-0000-4000-a000-0000000000a1', 10, 100),
  ('54000000-0000-4000-a000-000000000022', '53000000-0000-4000-a000-000000000002', '40000000-0000-4000-a000-0000000000b1', 5, 250),
  ('54000000-0000-4000-a000-000000000031', '53000000-0000-4000-a000-000000000003', '40000000-0000-4000-a000-0000000000a1', 4, 100);
-- Stored objects as the Storage service would record them (owner fixture).
insert into storage.objects (bucket_id, name, metadata) values
  ('task-proofs', 'tasks/53000000-0000-4000-a000-000000000001/proofs/aaaaaaaa-0000-4000-a000-000000000001.jpg', '{"size": 120000, "mimetype": "image/jpeg"}'),
  ('task-proofs', 'tasks/53000000-0000-4000-a000-000000000001/proofs/aaaaaaaa-0000-4000-a000-000000000002.jpg', '{"size": 120000, "mimetype": "image/jpeg"}'),
  ('task-proofs', 'tasks/53000000-0000-4000-a000-000000000001/proofs/aaaaaaaa-0000-4000-a000-000000000003.jpg', '{"size": 120000, "mimetype": "application/pdf"}'),
  ('task-proofs', 'tasks/53000000-0000-4000-a000-000000000001/proofs/aaaaaaaa-0000-4000-a000-000000000004.jpg', '{"size": 20000000, "mimetype": "image/jpeg"}'),
  ('task-proofs', 'tasks/53000000-0000-4000-a000-000000000002/proofs/aaaaaaaa-0000-4000-a000-000000000005.png', '{"size": 90000, "mimetype": "image/png"}'),
  ('task-proofs', 'tasks/53000000-0000-4000-a000-000000000006/proofs/aaaaaaaa-0000-4000-a000-000000000006.pdf', '{"size": 50000, "mimetype": "application/pdf"}');

create function pg_temp.complete(p_task uuid, p_lines jsonb default null, p_cash jsonb default null,
  p_notes text default null, p_reason text default null) returns text language plpgsql as $$
begin
  return public.agent_complete_task(p_task, p_lines, p_cash, p_notes, p_reason) ->> 'status';
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.add_proof(p_task uuid, p_file text, p_type text, p_sha text) returns text language plpgsql as $$
begin
  perform public.agent_add_task_proof(p_task, 'tasks/' || p_task || '/proofs/' || p_file, p_type, 'photo.jpg', p_sha);
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-a000-00000000000a';
  agent_a  constant uuid := '00000000-0000-4000-a000-0000000000a1';
  agent_b  constant uuid := '00000000-0000-4000-a000-0000000000b1';
  d1 constant uuid := '53000000-0000-4000-a000-000000000001';
  d2 constant uuid := '53000000-0000-4000-a000-000000000002';
  d3 constant uuid := '53000000-0000-4000-a000-000000000003';
  c1 constant uuid := '53000000-0000-4000-a000-000000000004';
  c2 constant uuid := '53000000-0000-4000-a000-000000000005';
  doc constant uuid := '53000000-0000-4000-a000-000000000006';
  cb constant uuid := '53000000-0000-4000-a000-000000000007';
  sha1 constant text := repeat('a', 64);
  sha2 constant text := repeat('b', 64);
  full_lines jsonb := '[{"task_product_id":"54000000-0000-4000-a000-000000000011","delivered_quantity":10},
                        {"task_product_id":"54000000-0000-4000-a000-000000000012","delivered_quantity":5}]';
  r text;
begin
  perform pg_temp.act_as(agent_a);

  -- Storage policies (insert = what an upload does)
  r := pg_temp.attempt(format($q$insert into storage.objects (bucket_id, name) values ('task-proofs', 'tasks/%s/proofs/bbbbbbbb-0000-4000-a000-000000000001.jpg')$q$, d1));
  perform pg_temp.check('P8 Storage: agent can upload into own in-progress task folder', r = 'OK:1', r);
  r := pg_temp.attempt(format($q$insert into storage.objects (bucket_id, name) values ('task-proofs', 'tasks/%s/proofs/bbbbbbbb-0000-4000-a000-000000000002.jpg')$q$, cb));
  perform pg_temp.check('P8 Storage: agent cannot upload into Agent B''s task folder', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$insert into storage.objects (bucket_id, name) values ('task-proofs', 'tasks/../../53000000-0000-4000-a000-000000000007/proofs/x.jpg')$q$);
  perform pg_temp.check('P8 Storage: path traversal (../../other-task/file) rejected', r = 'ERR:42501', r);
  r := pg_temp.attempt(format($q$insert into storage.objects (bucket_id, name) values ('task-proofs', 'tasks/%s/proofs/bbbbbbbb-0000-4000-a000-000000000003.exe')$q$, d1));
  perform pg_temp.check('P8 Storage: executable extension rejected', r = 'ERR:42501', r);
  r := pg_temp.attempt($q$insert into storage.objects (bucket_id, name) values ('task-proofs', 'tasks/51000000-0000-4000-a000-0000000000a1/proofs/bbbbbbbb-0000-4000-a000-000000000004.jpg')$q$);
  perform pg_temp.check('P8 Storage: no uploads to a finished task', r = 'ERR:42501', r);
  r := pg_temp.attempt(format($q$update storage.objects set name = name where bucket_id = 'task-proofs' and name like 'tasks/%s/%%'$q$, d1));
  perform pg_temp.check('P8 Storage: agents cannot modify stored proof', r in ('OK:0', 'ERR:42501'), r);

  -- Proof registration
  perform pg_temp.check('P8 Proof: register own photo',
    pg_temp.add_proof(d1, 'aaaaaaaa-0000-4000-a000-000000000001.jpg', 'PHOTO', sha1) = 'OK'
    and pg_temp.visible(format($q$select 1 from public.task_proofs where task_id = %L and agent_id = '10000000-0000-4000-a000-0000000000a1'
      and mime_type = 'image/jpeg' and file_size_bytes = 120000$q$, d1)) = 1);
  perform pg_temp.check('P8 Proof: identical file (same hash) rejected',
    pg_temp.add_proof(d1, 'aaaaaaaa-0000-4000-a000-000000000002.jpg', 'PHOTO', sha1) = 'PROOF_DUPLICATE');
  perform pg_temp.check('P8 Proof: path of another task rejected',
    pg_temp.error_of(format($q$select public.agent_add_task_proof(%L, 'tasks/%s/proofs/aaaaaaaa-0000-4000-a000-000000000005.png', 'PHOTO', 'x.png', %L)$q$, d1, d2, sha2)) = 'INVALID_PATH');
  perform pg_temp.check('P8 Proof: missing object rejected',
    pg_temp.add_proof(d1, 'aaaaaaaa-0000-4000-a000-0000000000ff.jpg', 'PHOTO', sha2) = 'FILE_NOT_FOUND');
  perform pg_temp.check('P8 Proof: stored type not matching extension rejected',
    pg_temp.add_proof(d1, 'aaaaaaaa-0000-4000-a000-000000000003.jpg', 'PHOTO', sha2) = 'INVALID_FILE_TYPE');
  perform pg_temp.check('P8 Proof: file over size limit rejected',
    pg_temp.add_proof(d1, 'aaaaaaaa-0000-4000-a000-000000000004.jpg', 'PHOTO', sha2) = 'FILE_TOO_LARGE');

  -- Delivery
  perform pg_temp.check('P8 Delivery: delivered > assigned (100 of 10) rejected',
    pg_temp.complete(d1, '[{"task_product_id":"54000000-0000-4000-a000-000000000011","delivered_quantity":100},
                          {"task_product_id":"54000000-0000-4000-a000-000000000012","delivered_quantity":5}]') = 'QUANTITY_INVALID');
  perform pg_temp.check('P8 Delivery: negative quantity rejected',
    pg_temp.complete(d1, '[{"task_product_id":"54000000-0000-4000-a000-000000000011","delivered_quantity":-1},
                          {"task_product_id":"54000000-0000-4000-a000-000000000012","delivered_quantity":5}]') = 'QUANTITY_INVALID');
  perform pg_temp.check('P8 Delivery: missing line rejected',
    pg_temp.complete(d1, '[{"task_product_id":"54000000-0000-4000-a000-000000000011","delivered_quantity":10}]') = 'LINES_MISMATCH');
  perform pg_temp.check('P8 Delivery: line of another task rejected',
    pg_temp.complete(d1, '[{"task_product_id":"54000000-0000-4000-a000-000000000011","delivered_quantity":10},
                          {"task_product_id":"54000000-0000-4000-a000-000000000021","delivered_quantity":5}]') = 'LINES_MISMATCH');
  perform pg_temp.check('P8 Delivery: rejected attempts saved nothing',
    pg_temp.visible(format($q$select 1 from public.task_products where task_id = %L and delivered_quantity <> 0$q$, d1)) = 0);
  r := pg_temp.complete(d1, full_lines, null, 'All handed over');
  perform pg_temp.check('P8 Delivery: all lines full (+ photo) → COMPLETED', r = 'COMPLETED', r);
  perform pg_temp.check('P8 Delivery: quantities saved, history "Full delivery" by the agent',
    pg_temp.visible(format($q$select 1 from public.task_products where task_id = %L and delivered_quantity = assigned_quantity$q$, d1)) = 2
    and pg_temp.visible(format($q$select 1 from public.task_status_history where task_id = %L and old_status = 'IN_PROGRESS'
      and new_status = 'COMPLETED' and changed_by = %L and reason = 'Full delivery'$q$, d1, agent_a)) = 1);
  perform pg_temp.check('P8 Locked: no new proof after completion',
    pg_temp.add_proof(d1, 'aaaaaaaa-0000-4000-a000-000000000002.jpg', 'PHOTO', sha2) = 'INVALID_TASK_STATUS');
  perform pg_temp.check('P8 Locked: cannot complete twice', pg_temp.complete(d1, full_lines) = 'STATUS_CHANGED');
  r := pg_temp.attempt(format($q$update public.task_products set delivered_quantity = 1 where task_id = %L$q$, d1));
  perform pg_temp.check('P8 Locked: agent cannot edit delivered quantities directly', r in ('OK:0', 'ERR:42501'), r);

  perform pg_temp.check('P8 Partial delivery: photo required first',
    pg_temp.complete(d2, '[{"task_product_id":"54000000-0000-4000-a000-000000000021","delivered_quantity":10},
                          {"task_product_id":"54000000-0000-4000-a000-000000000022","delivered_quantity":3}]', null, null, 'Rest tomorrow') = 'PROOF_REQUIRED');
  perform pg_temp.add_proof(d2, 'aaaaaaaa-0000-4000-a000-000000000005.png', 'PHOTO', sha2);
  perform pg_temp.check('P8 Partial delivery: reason required',
    pg_temp.complete(d2, '[{"task_product_id":"54000000-0000-4000-a000-000000000021","delivered_quantity":10},
                          {"task_product_id":"54000000-0000-4000-a000-000000000022","delivered_quantity":3}]') = 'REASON_REQUIRED');
  r := pg_temp.complete(d2, '[{"task_product_id":"54000000-0000-4000-a000-000000000021","delivered_quantity":10},
                              {"task_product_id":"54000000-0000-4000-a000-000000000022","delivered_quantity":3, "notes":"Customer requested remaining quantity later."}]',
                        null, null, 'Customer requested remaining quantity later.');
  perform pg_temp.check('P8 Partial delivery: 10/10 + 3/5 → PARTIALLY_COMPLETED, outstanding 2', r = 'PARTIALLY_COMPLETED'
    and pg_temp.visible(format($q$select 1 from public.task_products where id = '54000000-0000-4000-a000-000000000022'
      and assigned_quantity - delivered_quantity = 2 and delivery_notes like 'Customer requested%%'$q$)) = 1, r);
  perform pg_temp.check('P8 Zero delivery cannot complete (report a failure instead)',
    pg_temp.complete(d3, '[{"task_product_id":"54000000-0000-4000-a000-000000000031","delivered_quantity":0}]') = 'NOTHING_DELIVERED');

  -- Cash
  perform pg_temp.check('P8 Cash: over-collection (50,000 of 10,000) rejected',
    pg_temp.complete(c1, null, '{"collected_amount":50000,"payment_method":"CASH"}') = 'OVER_COLLECTION');
  perform pg_temp.check('P8 Cash: zero collection rejected',
    pg_temp.complete(c1, null, '{"collected_amount":0,"payment_method":"CASH"}') = 'NOTHING_COLLECTED');
  perform pg_temp.check('P8 Cash: unknown payment method rejected',
    pg_temp.complete(c1, null, '{"collected_amount":10000,"payment_method":"BITCOIN"}') = 'INVALID_PAYMENT_METHOD');
  perform pg_temp.check('P8 Cash: UPI needs a reference',
    pg_temp.complete(c1, null, '{"collected_amount":10000,"payment_method":"UPI"}') = 'REFERENCE_REQUIRED');
  perform pg_temp.check('P8 Cash: card-number-like reference refused (no card data stored)',
    pg_temp.complete(c1, null, '{"collected_amount":10000,"payment_method":"CARD","reference":"4111 1111 1111 1111"}') = 'SENSITIVE_REFERENCE');
  r := pg_temp.complete(c1, null, '{"collected_amount":10000,"payment_method":"UPI","reference":"UPI-123456"}');
  perform pg_temp.check('P8 Cash: full collection → COMPLETED', r = 'COMPLETED', r);
  perform pg_temp.check('P8 Cash: record has server agent, expected snapshot, method, reference, time',
    pg_temp.visible(format($q$select 1 from public.cash_collections where task_id = %L and agent_id = '10000000-0000-4000-a000-0000000000a1'
      and expected_amount = 10000 and collected_amount = 10000 and payment_method = 'UPI'
      and collection_reference = 'UPI-123456' and collected_at is not null$q$, c1)) = 1);
  perform pg_temp.check('P8 Cash: partial needs a reason',
    pg_temp.complete(c2, null, '{"collected_amount":7500,"payment_method":"CASH"}') = 'REASON_REQUIRED');
  r := pg_temp.complete(c2, null, '{"collected_amount":7500,"payment_method":"CASH"}', null, 'Customer paid partial amount.');
  perform pg_temp.check('P8 Cash: 7,500 of 10,000 → PARTIALLY_COMPLETED, outstanding 2,500', r = 'PARTIALLY_COMPLETED'
    and pg_temp.visible(format($q$select 1 from public.cash_collections where task_id = %L and expected_amount - collected_amount = 2500$q$, c2)) = 1, r);
  r := pg_temp.attempt(format($q$update public.cash_collections set collected_amount = 1 where task_id = %L$q$, c1));
  perform pg_temp.check('P8 Cash: agent cannot alter a submitted collection', r in ('OK:0', 'ERR:42501'), r);

  -- Other types
  perform pg_temp.check('P8 Document collection: proof required', pg_temp.complete(doc) = 'PROOF_REQUIRED');
  r := pg_temp.agent_move(doc, 'IN_PROGRESS', 'FAILED', 'Customer unavailable', 'Office closed');
  perform pg_temp.check('P8 Failure from IN_PROGRESS with reason → FAILED', r = 'OK'
    and pg_temp.visible(format($q$select 1 from public.tasks where id = %L and status = 'FAILED' and failure_reason = 'Customer unavailable — Office closed'$q$, doc)) = 1, r);

  -- Isolation
  perform pg_temp.check('P8 Agent A cannot complete Agent B''s task',
    pg_temp.complete(cb, null, '{"collected_amount":10000,"payment_method":"CASH"}') = 'TASK_NOT_FOUND');
  perform pg_temp.act_as(agent_b);
  perform pg_temp.check('P8 Agent B cannot see Agent A''s cash, proofs or proof files',
    pg_temp.visible(format($q$select 1 from public.cash_collections where task_id in (%L, %L)$q$, c1, c2)) = 0
    and pg_temp.visible(format($q$select 1 from public.task_proofs where task_id = %L$q$, d1)) = 0
    and pg_temp.visible(format($q$select 1 from storage.objects where name like 'tasks/%s/%%'$q$, d1)) = 0);
  perform pg_temp.check('P8 Agent B cannot register proof on Agent A''s task',
    pg_temp.add_proof(d2, 'aaaaaaaa-0000-4000-a000-000000000005.png', 'PHOTO', repeat('c', 64)) = 'TASK_NOT_FOUND');
  perform pg_temp.act_as(agent_a);
  perform pg_temp.check('P8 Agent A can read own proof files',
    pg_temp.visible(format($q$select 1 from storage.objects where name like 'tasks/%s/%%'$q$, d1)) >= 4);

  -- Admin
  perform pg_temp.act_as(admin_id);
  perform pg_temp.check('P8 Admin sees proof files, proofs and collections',
    pg_temp.visible(format($q$select 1 from storage.objects where name like 'tasks/%s/%%'$q$, d1)) >= 4
    and pg_temp.visible(format($q$select 1 from public.cash_collections where task_id = %L$q$, c1)) = 1);
  r := pg_temp.attempt(format($q$update public.cash_collections set collection_reference = 'UPI-123457' where task_id = %L$q$, c1));
  perform pg_temp.check('P8 Admin correction of a collection is audited (old & new kept)', r = 'OK:1'
    and pg_temp.visible(format($q$select 1 from public.audit_logs where action = 'CORRECT_CASH_COLLECTION' and actor_user_id = %L
      and old_values ->> 'collection_reference' = 'UPI-123456' and new_values ->> 'collection_reference' = 'UPI-123457'$q$, admin_id)) = 1, r);
  perform pg_temp.check('P8 Audit: execution actions by the agent',
    pg_temp.visible(format($q$select distinct action from public.audit_logs where actor_user_id = %L and action in
      ('UPLOAD_TASK_PROOF', 'UPDATE_DELIVERY_QUANTITY', 'SUBMIT_CASH_COLLECTION', 'COMPLETE_TASK', 'PARTIALLY_COMPLETE_TASK', 'REPORT_TASK_FAILURE')$q$, agent_a)) = 6);
  r := pg_temp.error_of($q$select public.admin_save_task('{"task_type":"COLLECT_CASH","title":"P8 cash","priority":3,
      "customer_id":"20000000-0000-4000-a000-0000000000a1","location_id":"30000000-0000-4000-a000-0000000000a1",
      "agent_id":"10000000-0000-4000-a000-0000000000a1"}'::jsonb, '[]'::jsonb, true)$q$);
  perform pg_temp.check('P8 Admin: assigned cash task needs an expected amount', r = 'EXPECTED_AMOUNT_REQUIRED', r);
  r := pg_temp.error_of($q$select public.admin_save_task('{"task_type":"COLLECT_CASH","title":"P8 cash","priority":3,"expected_amount":"0",
      "customer_id":"20000000-0000-4000-a000-0000000000a1","location_id":"30000000-0000-4000-a000-0000000000a1",
      "agent_id":"10000000-0000-4000-a000-0000000000a1"}'::jsonb, '[]'::jsonb, true)$q$);
  perform pg_temp.check('P8 Admin: expected amount must be positive', r = 'AMOUNT_INVALID', r);

  perform set_config('role', 'postgres', true);
end
$$;

-- Summary and verdict
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from test_results;
do $$
begin
  if exists (select 1 from test_results where not passed) then
    raise exception 'RLS test suite FAILED: % check(s)', (select count(*) from test_results where not passed);
  end if;
end
$$;

rollback;
