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
  -- Phase 9: location events are written only through agent_record_location().
  perform pg_temp.check('Agent cannot insert a location event directly (function only)', r = 'ERR:42501', r);
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

-- ---------------------------------------------------------------------------
-- Phase 9: task-scoped location events, monitoring views, realtime publication
-- ---------------------------------------------------------------------------
insert into public.tasks (id, task_type, status, agent_id, customer_id, location_id, title, assigned_at)
select ('55000000-0000-4000-a000-0000000000' || s)::uuid, 'SURVEY', st::public.task_status, ag::uuid,
       '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'P9 ' || s, now()
from (values
  ('01', 'ON_THE_WAY',  '10000000-0000-4000-a000-0000000000a1'),
  ('02', 'IN_PROGRESS', '10000000-0000-4000-a000-0000000000a1'),
  ('03', 'COMPLETED',   '10000000-0000-4000-a000-0000000000a1'),
  ('04', 'FAILED',      '10000000-0000-4000-a000-0000000000a1'),
  ('05', 'CANCELLED',   '10000000-0000-4000-a000-0000000000a1'),
  ('06', 'ON_THE_WAY',  '10000000-0000-4000-a000-0000000000b1'),
  ('07', 'ASSIGNED',    '10000000-0000-4000-a000-0000000000a1'),
  ('08', 'ARRIVED',     '10000000-0000-4000-a000-0000000000a1'),
  ('09', 'CHECKED_IN',  '10000000-0000-4000-a000-0000000000a1'),
  ('10', 'ACCEPTED',    '10000000-0000-4000-a000-0000000000a1'),
  ('11', 'PARTIALLY_COMPLETED', '10000000-0000-4000-a000-0000000000a1')
) v(s, st, ag);

-- 'RECORDED' / 'THROTTLED' / 'LOW_ACCURACY', or the error code.
create function pg_temp.loc(p_task uuid, p_lat double precision, p_lng double precision,
  p_acc double precision default 15, p_at timestamptz default clock_timestamp())
returns text language plpgsql as $$
begin
  return public.agent_record_location(p_task, p_lat, p_lng, p_acc, p_at) ->> 'result';
exception when others then
  return sqlerrm;
end $$;

-- Lets the rate-limit window pass (as owner; agents cannot modify events).
create function pg_temp.age_events() returns void language sql security definer as $$
  update public.agent_location_events set recorded_at = recorded_at - interval '5 minutes'
$$;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-a000-00000000000a';
  agent_a  constant uuid := '00000000-0000-4000-a000-0000000000a1';
  agent_b  constant uuid := '00000000-0000-4000-a000-0000000000b1';
  inactive constant uuid := '00000000-0000-4000-a000-0000000000c1';
  a_agent  constant uuid := '10000000-0000-4000-a000-0000000000a1';
  t_way    constant uuid := '55000000-0000-4000-a000-000000000001';
  t_work   constant uuid := '55000000-0000-4000-a000-000000000002';
  t_b      constant uuid := '55000000-0000-4000-a000-000000000006';
  r text;
  n bigint;
  i int;
begin
  -- Ownership and task state (earlier fixtures hold fresh events: let the rate-limit window pass)
  perform pg_temp.age_events();
  perform pg_temp.act_as(agent_a);
  r := pg_temp.loc(t_way, 11.3412, 77.7178);
  perform pg_temp.check('P9 Agent A records location for own ON_THE_WAY task', r = 'RECORDED', r);
  perform pg_temp.check('P9 Event stored with the session''s agent, server time, rounded values, no device id',
    pg_temp.visible(format($q$select 1 from public.agent_location_events where task_id = %L and agent_id = %L
      and latitude = 11.3412 and longitude = 77.7178 and accuracy_meters = 15 and device_id is null
      and recorded_at between now() - interval '1 minute' and clock_timestamp()$q$, t_way, a_agent)) = 1);

  -- Rate limit
  r := pg_temp.loc(t_way, 11.3413, 77.7179);
  perform pg_temp.check('P9 Second event inside the minimum interval is throttled', r = 'THROTTLED', r);
  for i in 1..12 loop
    perform pg_temp.loc(t_way, 11.34 + i * 0.0001, 77.71);
  end loop;
  perform pg_temp.check('P9 Burst of 12 rapid requests stores nothing more (1 event)',
    pg_temp.visible(format('select 1 from public.agent_location_events where task_id = %L', t_way)) = 1);
  r := pg_temp.loc(t_work, 11.3412, 77.7178);
  perform pg_temp.check('P9 Rate limit is per agent, not per task (other task also throttled)', r = 'THROTTLED', r);

  perform pg_temp.age_events();
  r := pg_temp.loc(t_work, 11.3412, 77.7178);
  perform pg_temp.check('P9 IN_PROGRESS task: location allowed (after the interval)', r = 'RECORDED', r);
  perform pg_temp.age_events();
  r := pg_temp.loc('55000000-0000-4000-a000-000000000008', 11.3412, 77.7178);
  perform pg_temp.check('P9 ARRIVED task: location allowed', r = 'RECORDED', r);
  perform pg_temp.age_events();
  r := pg_temp.loc('55000000-0000-4000-a000-000000000009', 11.3412, 77.7178);
  perform pg_temp.check('P9 CHECKED_IN task: location allowed', r = 'RECORDED', r);
  perform pg_temp.age_events();

  perform pg_temp.check('P9 COMPLETED / PARTIALLY_COMPLETED / FAILED / CANCELLED tasks: location rejected',
    pg_temp.loc('55000000-0000-4000-a000-000000000003', 11.34, 77.71) = 'TRACKING_NOT_ACTIVE'
    and pg_temp.loc('55000000-0000-4000-a000-000000000011', 11.34, 77.71) = 'TRACKING_NOT_ACTIVE'
    and pg_temp.loc('55000000-0000-4000-a000-000000000004', 11.34, 77.71) = 'TRACKING_NOT_ACTIVE'
    and pg_temp.loc('55000000-0000-4000-a000-000000000005', 11.34, 77.71) = 'TRACKING_NOT_ACTIVE');
  perform pg_temp.check('P9 ASSIGNED / ACCEPTED tasks (not yet travelling): location rejected',
    pg_temp.loc('55000000-0000-4000-a000-000000000007', 11.34, 77.71) = 'TRACKING_NOT_ACTIVE'
    and pg_temp.loc('55000000-0000-4000-a000-000000000010', 11.34, 77.71) = 'TRACKING_NOT_ACTIVE');
  r := pg_temp.loc(t_b, 11.34, 77.71);
  perform pg_temp.check('P9 Agent A cannot record location for Agent B''s task', r = 'TASK_NOT_FOUND', r);
  r := pg_temp.loc('55000000-0000-4000-a000-0000000000ff', 11.34, 77.71);
  perform pg_temp.check('P9 Unknown task id rejected', r = 'TASK_NOT_FOUND', r);

  -- Coordinate / accuracy / timestamp tampering
  perform pg_temp.check('P9 Invalid latitude / longitude rejected',
    pg_temp.loc(t_way, 91, 77.71) = 'INVALID_COORDINATES' and pg_temp.loc(t_way, -90.01, 77.71) = 'INVALID_COORDINATES'
    and pg_temp.loc(t_way, 11.34, 181) = 'INVALID_COORDINATES' and pg_temp.loc(t_way, 11.34, -180.5) = 'INVALID_COORDINATES'
    and pg_temp.loc(t_way, null, 77.71) = 'INVALID_COORDINATES');
  perform pg_temp.check('P9 NaN / Infinity coordinates rejected',
    pg_temp.loc(t_way, 'NaN', 77.71) = 'INVALID_COORDINATES' and pg_temp.loc(t_way, 11.34, 'NaN') = 'INVALID_COORDINATES'
    and pg_temp.loc(t_way, 'Infinity', 77.71) = 'INVALID_COORDINATES' and pg_temp.loc(t_way, 11.34, '-Infinity') = 'INVALID_COORDINATES');
  perform pg_temp.check('P9 Negative / NaN / Infinity / missing accuracy rejected',
    pg_temp.loc(t_way, 11.34, 77.71, -1) = 'INVALID_ACCURACY' and pg_temp.loc(t_way, 11.34, 77.71, 'NaN') = 'INVALID_ACCURACY'
    and pg_temp.loc(t_way, 11.34, 77.71, 'Infinity') = 'INVALID_ACCURACY' and pg_temp.loc(t_way, 11.34, 77.71, null) = 'INVALID_ACCURACY');
  perform pg_temp.check('P9 Stale and future-dated device timestamps rejected',
    pg_temp.loc(t_way, 11.34, 77.71, 15, clock_timestamp() - interval '10 minutes') = 'STALE_LOCATION'
    and pg_temp.loc(t_way, 11.34, 77.71, 15, clock_timestamp() + interval '10 minutes') = 'STALE_LOCATION'
    and pg_temp.loc(t_way, 11.34, 77.71, 15, null) = 'STALE_LOCATION');
  r := pg_temp.loc(t_way, 11.34, 77.71, 5000);
  perform pg_temp.check('P9 Very inaccurate reading is ignored, not stored', r = 'LOW_ACCURACY'
    and pg_temp.visible(format('select 1 from public.agent_location_events where task_id = %L', t_way)) = 1, r);
  r := pg_temp.attempt(format($q$select public.agent_record_location(p_task_id => %L, p_latitude => 11.34, p_longitude => 77.71,
    p_accuracy => 15, p_captured_at => now(), p_agent_id => '10000000-0000-4000-a000-0000000000b1')$q$, t_way));
  perform pg_temp.check('P9 Client-supplied agent_id / recorded_at cannot be passed (no such parameters)', r = 'ERR:42883'
    and pg_temp.attempt(format($q$select public.agent_record_location(p_task_id => %L, p_latitude => 11.34, p_longitude => 77.71,
      p_accuracy => 15, p_captured_at => now(), p_recorded_at => '2000-01-01')$q$, t_way)) = 'ERR:42883', r);

  -- Append-only
  perform pg_temp.check('P9 Agent cannot insert / update / delete location events directly',
    pg_temp.attempt(format($q$insert into public.agent_location_events (agent_id, task_id, latitude, longitude)
      values (%L, %L, 11.1, 77.1)$q$, a_agent, t_way)) = 'ERR:42501'
    and pg_temp.attempt('update public.agent_location_events set latitude = 0') = 'ERR:42501'
    and pg_temp.attempt('delete from public.agent_location_events') = 'ERR:42501');

  -- Location events never change a task
  perform pg_temp.check('P9 Location events do not check in or complete a task',
    pg_temp.visible(format($q$select 1 from public.tasks where id = %L and status = 'ON_THE_WAY'$q$, t_way)) = 1
    and pg_temp.visible(format('select 1 from public.checkins where task_id = %L', t_way)) = 0);

  -- Tracking stops with the task (server side)
  r := pg_temp.complete(t_work, null, null, 'Survey done');
  perform pg_temp.check('P9 Task completed through the execution function', r = 'COMPLETED', r);
  r := pg_temp.loc(t_work, 11.3412, 77.7178);
  perform pg_temp.check('P9 After completion a new location event is rejected', r = 'TRACKING_NOT_ACTIVE', r);

  -- Agent views: own data only
  perform pg_temp.check('P9 Agent A: monitoring views expose only own tasks and own agent row',
    pg_temp.visible('select 1 from public.task_monitor where agent_id <> ''10000000-0000-4000-a000-0000000000a1'' or agent_id is null') = 0
    and pg_temp.visible('select 1 from public.agent_activity') = 1
    and pg_temp.visible(format('select 1 from public.task_monitor where id = %L', t_b)) = 0);

  -- Agent B isolation
  perform pg_temp.act_as(agent_b);
  perform pg_temp.check('P9 Agent B cannot read Agent A''s location events (table or views)',
    pg_temp.visible(format('select 1 from public.agent_location_events where agent_id = %L', a_agent)) = 0
    and pg_temp.visible('select 1 from public.task_monitor where id::text like ''55000000-%'' and last_location_at is not null') = 0
    and pg_temp.visible(format('select 1 from public.agent_activity where id = %L', a_agent)) = 0);
  r := pg_temp.loc(t_way, 11.34, 77.71);
  perform pg_temp.check('P9 Agent B cannot record location for Agent A''s task', r = 'TASK_NOT_FOUND', r);
  r := pg_temp.loc(t_b, 12.9716, 77.5946);
  perform pg_temp.check('P9 Agent B records location for own task (own rate limit)', r = 'RECORDED', r);

  -- Inactive account / anonymous
  perform pg_temp.act_as(inactive);
  r := pg_temp.loc(t_way, 11.34, 77.71);
  perform pg_temp.check('P9 Inactive agent cannot record location', r = 'UNAUTHORIZED', r);
  perform pg_temp.act_as_anon();
  perform pg_temp.check('P9 Anonymous: no location function, no events, no monitoring views',
    pg_temp.attempt(format('select public.agent_record_location(%L, 11.34, 77.71, 15, now())', t_way)) = 'ERR:42501'
    and pg_temp.attempt('select 1 from public.agent_location_events') = 'ERR:42501'
    and pg_temp.attempt('select 1 from public.task_monitor') = 'ERR:42501'
    and pg_temp.attempt('select 1 from public.agent_activity') = 'ERR:42501'
    and pg_temp.attempt('select * from public.task_status_counts(current_date)') = 'ERR:42501');

  -- Admin
  perform pg_temp.act_as(admin_id);
  perform pg_temp.check('P9 Admin sees both agents'' events and latest location per task',
    pg_temp.visible('select distinct agent_id from public.agent_location_events where task_id::text like ''55000000-%''') = 2
    and pg_temp.visible(format($q$select 1 from public.task_monitor where id = %L and last_latitude = 12.9716
      and last_longitude = 77.5946 and last_accuracy_meters = 15 and last_location_at is not null$q$, t_b)) = 1);
  perform pg_temp.check('P9 Admin: task_monitor returns one row per task (latest event only)',
    pg_temp.visible('select 1 from public.task_monitor where id::text like ''55000000-%''') = 11);
  perform pg_temp.check('P9 Admin: agent_activity shows the furthest-along open task and last location time',
    pg_temp.visible(format($q$select 1 from public.agent_activity where id = %L
      and current_task_status in ('CHECKED_IN', 'IN_PROGRESS') and open_tasks >= 4 and last_location_at is not null and last_completed_at is not null$q$, a_agent)) = 1);
  select coalesce(sum(total), 0) into n from public.task_status_counts('1900-01-01')
   where status in ('ON_THE_WAY', 'ARRIVED', 'CHECKED_IN', 'IN_PROGRESS');
  perform pg_temp.check('P9 Admin: status counts include tasks still in the field', n >= 4, n::text);
  perform pg_temp.check('P9 Admin cannot insert / update / delete location events either (append-only)',
    pg_temp.attempt(format($q$insert into public.agent_location_events (agent_id, task_id, latitude, longitude)
      values (%L, %L, 11.1, 77.1)$q$, a_agent, t_way)) = 'ERR:42501'
    and pg_temp.attempt('update public.agent_location_events set latitude = 0') = 'ERR:42501'
    and pg_temp.attempt('delete from public.agent_location_events') = 'ERR:42501');
  r := pg_temp.loc(t_way, 11.34, 77.71);
  perform pg_temp.check('P9 Admin (not an agent) cannot record location events', r = 'UNAUTHORIZED', r);

  perform set_config('role', 'postgres', true);
  perform pg_temp.check('P9 Location events are not copied into audit_logs',
    pg_temp.visible($q$select 1 from public.audit_logs where entity_type ilike '%LOCATION_EVENT%'$q$) = 0);
  perform pg_temp.check('P9 Realtime publishes exactly the operational tables',
    (select array_agg(tablename::text order by tablename) from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public')
      = array['agent_location_events', 'cash_collections', 'checkins', 'notifications', 'task_products', 'task_proofs', 'task_status_history', 'tasks']);
  perform pg_temp.check('P9 Every published table has RLS enabled',
    not exists (select 1 from pg_publication_tables p join pg_class c on c.relname = p.tablename
                  join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = p.schemaname
                 where p.pubname = 'supabase_realtime' and not c.relrowsecurity));
end
$$;

-- ---------------------------------------------------------------------------
-- Phase 10: notifications, preferences, outbox, reminders
-- ---------------------------------------------------------------------------
-- Rows for one recipient about one task (as owner; RLS is tested separately).
create function pg_temp.notes(p_user uuid, p_task uuid, p_type text default null) returns bigint
language sql security definer as $$
  select count(*) from public.notifications
   where recipient_user_id = p_user and task_id = p_task and (p_type is null or type = p_type)
$$;
create function pg_temp.queued(p_user uuid, p_task uuid, p_type text default null) returns bigint
language sql security definer as $$
  select count(*) from public.communication_queue q join public.notifications n on n.id = q.notification_id
   where q.recipient_user_id = p_user and n.task_id = p_task and (p_type is null or n.type = p_type)
$$;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-a000-00000000000a';
  agent_a  constant uuid := '00000000-0000-4000-a000-0000000000a1';
  agent_b  constant uuid := '00000000-0000-4000-a000-0000000000b1';
  inactive constant uuid := '00000000-0000-4000-a000-0000000000c1';
  a_agent  constant uuid := '10000000-0000-4000-a000-0000000000a1';
  b_agent  constant uuid := '10000000-0000-4000-a000-0000000000b1';
  base jsonb := '{"task_type":"SURVEY","title":"P10 survey","priority":2,
    "customer_id":"20000000-0000-4000-a000-0000000000a1","location_id":"30000000-0000-4000-a000-0000000000a1",
    "agent_id":"10000000-0000-4000-a000-0000000000a1","scheduled_date":"2030-01-15","scheduled_start_time":"10:00"}';
  t1 uuid; t2 uuid; t3 uuid; t4 uuid;
  n_id uuid; q_id uuid; q2 uuid; q3 uuid;
  r text;
  n bigint;
  row_ public.communication_queue%rowtype;
begin
  -- ---------------------------------------------------------------- assignment
  perform pg_temp.act_as(admin_id);
  t1 := public.admin_save_task(base, '[]', true);
  perform pg_temp.check('P10 Assigning a task notifies the assigned agent only (not the acting admin, not other agents)',
    pg_temp.notes(agent_a, t1, 'TASK_ASSIGNED') = 1 and pg_temp.notes(admin_id, t1) = 0 and pg_temp.notes(agent_b, t1) = 0);
  perform set_config('role', 'postgres', true);
  select id into n_id from public.notifications where recipient_user_id = agent_a and task_id = t1;
  perform pg_temp.check('P10 Assignment notification: title, task code, link to the agent task, no contact data or coordinates',
    exists (select 1 from public.notifications nn join public.tasks t on t.id = nn.task_id
             where nn.id = n_id and nn.title = 'New Task Assigned'
               and nn.message = 'Task #' || t.task_code || ' has been assigned to you.'
               and nn.data ->> 'path' = '/agent/tasks/' || t.id and nn.data ->> 'task_code' = t.task_code
               and nn.data ? 'customer' and nn.data ? 'scheduled_date' and nn.data ? 'priority'
               and not (nn.data ?| array['phone', 'email', 'latitude', 'longitude', 'expected_amount', 'agent_id'])));
  perform pg_temp.check('P10 Assignment queues exactly one e-mail to the agent''s address (PENDING, nothing sent in the transaction)',
    (select count(*) from public.communication_queue where notification_id = n_id and channel = 'EMAIL' and status = 'PENDING'
        and recipient_address = 'rls.agent.a@test.invalid' and attempt_count = 0 and sent_at is null) = 1);

  perform pg_temp.act_as(admin_id);
  perform public.admin_save_task(base || '{"title":"P10 survey (edited)"}', '[]', true, t1);
  perform pg_temp.check('P10 Saving an assigned task again does not notify again',
    pg_temp.notes(agent_a, t1) = 1 and pg_temp.queued(agent_a, t1) = 1);

  -- ---------------------------------------------------------------- reassignment
  perform public.admin_save_task(base || jsonb_build_object('agent_id', b_agent), '[]', true, t1);
  perform pg_temp.check('P10 Reassignment: previous agent told it is no longer theirs; new agent gets the assignment',
    pg_temp.notes(agent_a, t1, 'TASK_REASSIGNED') = 1 and pg_temp.notes(agent_b, t1, 'TASK_ASSIGNED') = 1
    and pg_temp.notes(admin_id, t1) = 0);
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('P10 Reassignment notice links to the task list and names nobody',
    exists (select 1 from public.notifications where recipient_user_id = agent_a and task_id = t1 and type = 'TASK_REASSIGNED'
             and data ->> 'path' = '/agent/tasks' and message like 'Task #% is no longer assigned to you.'
             and message not ilike '%Agent B%' and data::text not ilike '%Agent B%'));

  -- ---------------------------------------------------------------- reschedule
  perform pg_temp.act_as(admin_id);
  perform public.admin_save_task(base || jsonb_build_object('agent_id', b_agent, 'scheduled_date', '2030-01-16'), '[]', true, t1);
  perform pg_temp.check('P10 Changing the schedule of an assigned task notifies its agent',
    pg_temp.notes(agent_b, t1, 'TASK_RESCHEDULED') = 1);

  -- ---------------------------------------------------------------- status events
  perform pg_temp.act_as(agent_b);
  r := pg_temp.agent_move(t1, 'ASSIGNED', 'ACCEPTED');
  perform pg_temp.check('P10 Accept → admins notified once; the agent is not notified about their own action',
    r = 'OK' and pg_temp.notes(admin_id, t1, 'TASK_ACCEPTED') = 1 and pg_temp.notes(agent_b, t1, 'TASK_ACCEPTED') = 0, r);
  perform pg_temp.agent_move(t1, 'ACCEPTED', 'ON_THE_WAY');
  perform pg_temp.agent_move(t1, 'ON_THE_WAY', 'ARRIVED');
  perform pg_temp.check('P10 Travel and arrival create no notifications (shown live on monitoring instead)',
    pg_temp.notes(admin_id, t1) = 1 and pg_temp.notes(agent_b, t1) = 2);
  perform set_config('role', 'postgres', true);
  update public.tasks set status = 'CHECKED_IN' where id = t1; -- check-in itself is covered in Phase 7
  perform pg_temp.act_as(agent_b);
  perform pg_temp.agent_move(t1, 'CHECKED_IN', 'IN_PROGRESS');
  r := pg_temp.complete(t1, null, null, 'Survey done');
  perform pg_temp.check('P10 Check-in, start and completion each notify the admin exactly once',
    r = 'COMPLETED' and pg_temp.notes(admin_id, t1, 'TASK_CHECKED_IN') = 1 and pg_temp.notes(admin_id, t1, 'TASK_STARTED') = 1
    and pg_temp.notes(admin_id, t1, 'TASK_COMPLETED') = 1 and pg_temp.notes(admin_id, t1) = 4, r);
  perform pg_temp.check('P10 Only completion (not accept / check-in / start) queues an e-mail for the admin',
    pg_temp.queued(admin_id, t1) = 1 and pg_temp.queued(admin_id, t1, 'TASK_COMPLETED') = 1);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true); -- verified by the system, not by the agent
  update public.tasks set status = 'VERIFIED' where id = t1;
  perform pg_temp.check('P10 Verification notifies the agent',
    pg_temp.notes(agent_b, t1, 'TASK_VERIFIED') = 1);
  perform pg_temp.check('P10 One notification per status-history row (the idempotency key)',
    not exists (select 1 from public.notifications where task_id = t1 and dedupe_key like 'status:%'
                 group by recipient_user_id, dedupe_key having count(*) > 1)
    and pg_temp.attempt(format($q$insert into public.notifications (recipient_user_id, task_id, type, title, message, dedupe_key)
          select recipient_user_id, task_id, type, title, message, dedupe_key from public.notifications where task_id = %L limit 1$q$, t1)) = 'ERR:23505');

  -- failure, cancellation
  perform pg_temp.act_as(admin_id);
  t2 := public.admin_save_task(base || '{"title":"P10 to fail"}', '[]', true);
  t3 := public.admin_save_task(base || '{"title":"P10 to cancel"}', '[]', true);
  perform public.admin_cancel_task(t3, 'Customer called off');
  perform pg_temp.check('P10 Cancellation notifies the agent (with an e-mail), not the admin who cancelled',
    pg_temp.notes(agent_a, t3, 'TASK_CANCELLED') = 1 and pg_temp.queued(agent_a, t3, 'TASK_CANCELLED') = 1 and pg_temp.notes(admin_id, t3) = 0);
  perform pg_temp.act_as(agent_a);
  perform pg_temp.agent_move(t2, 'ASSIGNED', 'ACCEPTED');
  r := pg_temp.agent_move(t2, 'ACCEPTED', 'FAILED', 'Customer unavailable');
  perform pg_temp.check('P10 Failure notifies the admin (with an e-mail)',
    r = 'OK' and pg_temp.notes(admin_id, t2, 'TASK_FAILED') = 1 and pg_temp.queued(admin_id, t2, 'TASK_FAILED') = 1, r);

  -- cash and proof
  perform set_config('role', 'postgres', true);
  insert into public.tasks (id, task_type, status, agent_id, customer_id, location_id, title, assigned_at, expected_amount)
  values ('56000000-0000-4000-a000-000000000001', 'COLLECT_CASH', 'IN_PROGRESS', a_agent,
          '20000000-0000-4000-a000-0000000000a1', '30000000-0000-4000-a000-0000000000a1', 'P10 cash', now(), 4321.00);
  t4 := '56000000-0000-4000-a000-000000000001';
  perform pg_temp.act_as(agent_a);
  r := pg_temp.complete(t4, null, '{"collected_amount":"4321.00","payment_method":"UPI","reference":"UPIREF777"}'::jsonb);
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('P10 Cash collection notifies the admin without the amount or reference', r = 'COMPLETED'
    and pg_temp.notes(admin_id, t4, 'CASH_COLLECTION_RECORDED') = 1
    and not exists (select 1 from public.notifications where task_id = t4
                     and (message || title || data::text) ~ '4321|UPIREF777|UPI'), r);
  insert into public.task_proofs (task_id, agent_id, proof_type) values (t2, a_agent, 'PHOTO'), (t2, a_agent, 'PHOTO'), (t2, a_agent, 'DOCUMENT');
  perform pg_temp.check('P10 Several proof uploads on a task produce one notification per admin',
    pg_temp.notes(admin_id, t2, 'PROOF_UPLOADED') = 1);
  perform pg_temp.check('P10 Location events have no notification trigger',
    not exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
                 where g.tgrelid = 'public.agent_location_events'::regclass and not g.tgisinternal and p.proname like 'notify%'));

  -- ---------------------------------------------------------------- a notification failure never blocks the task
  alter table public.notifications add constraint p10_break check (type <> 'TASK_ACCEPTED') not valid;
  perform pg_temp.act_as(admin_id);
  t3 := public.admin_save_task(base || '{"title":"P10 resilient"}', '[]', true);
  perform pg_temp.act_as(agent_a);
  r := pg_temp.agent_move(t3, 'ASSIGNED', 'ACCEPTED');
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('P10 If creating the notification fails, the task transition still succeeds', r = 'OK'
    and (select status from public.tasks where id = t3) = 'ACCEPTED' and pg_temp.notes(admin_id, t3) = 0, r);
  alter table public.notifications drop constraint p10_break;

  -- ---------------------------------------------------------------- RLS
  perform pg_temp.act_as(agent_a);
  perform pg_temp.check('P10 Agent A reads only own notifications',
    pg_temp.visible('select 1 from public.notifications') > 0
    and pg_temp.visible(format('select 1 from public.notifications where recipient_user_id <> %L', agent_a)) = 0
    and pg_temp.visible('select 1 from public.communication_log where channel <> ''IN_APP''') = 0
    and pg_temp.visible(format('select 1 from public.communication_log where recipient_user_id <> %L', agent_a)) = 0);
  perform pg_temp.check('P10 Agent cannot read the outbox / delivery history',
    pg_temp.visible('select 1 from public.communication_queue') = 0);
  perform pg_temp.check('P10 Agent cannot create, retarget, edit or delete notifications',
    pg_temp.attempt(format($q$insert into public.notifications (recipient_user_id, type, title, message, dedupe_key)
      values (%L, 'SYSTEM', 'Hello', 'Injected', 'x')$q$, agent_b)) = 'ERR:42501'
    and pg_temp.attempt(format($q$insert into public.notifications (recipient_user_id, type, title, message, dedupe_key)
      values (%L, 'SYSTEM', 'Hello', 'Injected', 'x')$q$, agent_a)) = 'ERR:42501'
    and pg_temp.attempt(format('update public.notifications set recipient_user_id = %L', agent_b)) = 'ERR:42501'
    and pg_temp.attempt('update public.notifications set is_read = true') = 'ERR:42501'
    and pg_temp.attempt('update public.notifications set message = ''changed''') = 'ERR:42501'
    and pg_temp.attempt('delete from public.notifications') = 'ERR:42501');
  perform pg_temp.check('P10 Agent cannot call the publishing or outbox functions',
    pg_temp.attempt(format($q$select public.publish_notification(%L, 'SYSTEM', null, 'Hi', 'Injected', 'x')$q$, agent_b)) = 'ERR:42501'
    and pg_temp.attempt($q$select public.notify_admins('SYSTEM', null, 'Hi', 'Injected', 'x')$q$) = 'ERR:42501'
    and pg_temp.attempt('select public.claim_communications(10)') = 'ERR:42501'
    and pg_temp.attempt(format($q$select public.complete_communication(%L, 'SENT')$q$, n_id)) = 'ERR:42501'
    and pg_temp.attempt('select public.enqueue_task_reminders()') = 'ERR:42501'
    and pg_temp.error_of(format('select public.admin_retry_communication(%L)', n_id)) = 'NOT_ADMIN');
  perform pg_temp.check('P10 Agent cannot modify the outbox',
    pg_temp.attempt('update public.communication_queue set status = ''SENT''') = 'ERR:42501'
    and pg_temp.attempt('delete from public.communication_queue') = 'ERR:42501'
    and pg_temp.attempt($q$insert into public.communication_queue (channel, recipient_address, message) values ('EMAIL', 'x@example.com', 'spam')$q$) = 'ERR:42501');

  -- read marking
  select id into q_id from public.notifications where recipient_user_id = agent_b limit 1; -- not visible to A: null
  perform set_config('role', 'postgres', true);
  select id into q_id from public.notifications where recipient_user_id = agent_b and not is_read limit 1;
  perform pg_temp.act_as(agent_a);
  perform pg_temp.check('P10 Agent A cannot mark Agent B''s notification as read',
    public.mark_notification_read(q_id) = false);
  perform pg_temp.check('P10 Agent A marks own notification as read (once)',
    public.mark_notification_read(n_id) = true and public.mark_notification_read(n_id) = false
    and pg_temp.visible(format('select 1 from public.notifications where id = %L and is_read and read_at is not null', n_id)) = 1);
  select public.mark_all_notifications_read() into n;
  perform pg_temp.check('P10 Mark all as read affects only the caller''s notifications', n >= 1
    and pg_temp.visible('select 1 from public.notifications where not is_read') = 0, n::text);
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('P10 … and leaves other users'' notifications unread',
    exists (select 1 from public.notifications where id = q_id and not is_read)
    and exists (select 1 from public.notifications where recipient_user_id = admin_id and not is_read));

  -- inactive / anonymous
  perform pg_temp.check('P10 An inactive user is never a recipient',
    public.publish_notification(inactive, 'SYSTEM', null, 'Hi', 'Message', 'p10-inactive') is null);
  perform pg_temp.act_as(inactive);
  perform pg_temp.check('P10 Inactive user: no notifications, cannot mark read, cannot save preferences',
    pg_temp.visible('select 1 from public.notifications') = 0
    and pg_temp.error_of('select public.mark_all_notifications_read()') = 'UNAUTHORIZED'
    and pg_temp.attempt(format('insert into public.notification_preferences (user_id) values (%L)', inactive)) = 'ERR:42501');
  perform pg_temp.act_as_anon();
  perform pg_temp.check('P10 Anonymous: no notifications, outbox, preferences, log or functions',
    pg_temp.attempt('select 1 from public.notifications') = 'ERR:42501'
    and pg_temp.attempt('select 1 from public.communication_queue') = 'ERR:42501'
    and pg_temp.attempt('select 1 from public.notification_preferences') = 'ERR:42501'
    and pg_temp.attempt('select 1 from public.communication_log') = 'ERR:42501'
    and pg_temp.attempt('select public.mark_all_notifications_read()') = 'ERR:42501'
    and pg_temp.attempt('select public.claim_communications(1)') = 'ERR:42501');

  -- admin
  perform pg_temp.act_as(admin_id);
  perform pg_temp.check('P10 Admin reads all notifications and the delivery history',
    pg_temp.visible(format('select 1 from public.notifications where recipient_user_id = %L', agent_a)) > 0
    and pg_temp.visible('select 1 from public.communication_queue') > 0
    and pg_temp.visible('select 1 from public.communication_log where channel = ''EMAIL''') > 0
    and pg_temp.visible('select 1 from public.communication_log where channel = ''IN_APP''') > 0);
  perform pg_temp.check('P10 Admin cannot edit or delete notifications or delivery history, or read for someone else',
    pg_temp.attempt('update public.notifications set message = ''x''') = 'ERR:42501'
    and pg_temp.attempt('delete from public.notifications') = 'ERR:42501'
    and pg_temp.attempt('update public.communication_queue set status = ''SENT'', last_error = null') = 'ERR:42501'
    and pg_temp.attempt('delete from public.communication_queue') = 'ERR:42501'
    and public.mark_notification_read(q_id) = false
    and pg_temp.attempt('select public.claim_communications(1)') = 'ERR:42501');

  -- ---------------------------------------------------------------- preferences
  perform pg_temp.act_as(agent_a);
  perform pg_temp.check('P10 Agent cannot create or change another user''s preferences',
    pg_temp.attempt(format('insert into public.notification_preferences (user_id, email_enabled) values (%L, false)', agent_b)) = 'ERR:42501');
  insert into public.notification_preferences (user_id, email_enabled, task_assignment, task_status)
  values (agent_a, false, false, false);
  perform pg_temp.check('P10 Agent cannot move their preferences to another user',
    pg_temp.attempt(format('update public.notification_preferences set user_id = %L', agent_b)) = 'ERR:42501');
  perform pg_temp.act_as(admin_id);
  t3 := public.admin_save_task(base || '{"title":"P10 prefs"}', '[]', true);
  perform pg_temp.check('P10 With e-mail and assignment e-mails off: assignment still appears in-app, no e-mail queued',
    pg_temp.notes(agent_a, t3, 'TASK_ASSIGNED') = 1 and pg_temp.queued(agent_a, t3) = 0);
  perform set_config('role', 'postgres', true);
  update public.tasks set status = 'VERIFIED' where id = t3;
  perform pg_temp.check('P10 A switched-off, non-critical category is not delivered at all',
    pg_temp.notes(agent_a, t3, 'TASK_VERIFIED') = 0);
  perform pg_temp.check('P10 Preference changes are audited',
    exists (select 1 from public.audit_logs where action = 'CREATE_NOTIFICATION_PREFERENCES' and actor_user_id = agent_a));

  -- ---------------------------------------------------------------- outbox: retries, limits, expiry
  select q.id into q_id from public.communication_queue q join public.notifications nn on nn.id = q.notification_id
   where nn.task_id = t1 and q.recipient_user_id = agent_a and nn.type = 'TASK_ASSIGNED';
  select q.id into q2 from public.communication_queue q join public.notifications nn on nn.id = q.notification_id
   where nn.task_id = t2 and nn.type = 'TASK_FAILED' and q.recipient_user_id = admin_id;
  select q.id into q3 from public.communication_queue q join public.notifications nn on nn.id = q.notification_id
   where nn.task_id = t1 and nn.type = 'TASK_COMPLETED' and q.recipient_user_id = admin_id;
  -- only our three rows are due
  update public.communication_queue set scheduled_at = now() + interval '1 hour' where id not in (q_id, q2, q3);
  update public.communication_queue set created_at = now() - interval '3 days' where id = q3;

  perform set_config('role', 'service_role', true);
  select count(*) into n from public.claim_communications(10);
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('P10 Claim: due messages become PROCESSING (attempt 1); a 3-day-old one is cancelled, not sent',
    n = 2 and (select count(*) from public.communication_queue where id in (q_id, q2) and status = 'PROCESSING' and attempt_count = 1) = 2
    and (select status || ':' || last_error from public.communication_queue where id = q3) = 'CANCELLED:Expired before it could be sent', n::text);
  perform set_config('role', 'service_role', true);
  select count(*) into n from public.claim_communications(10);
  perform pg_temp.check('P10 A claimed message is not handed out twice', n = 0, n::text);

  r := public.complete_communication(q_id, 'SENT', 'resend', 'msg_123');
  perform set_config('role', 'postgres', true);
  select * into row_ from public.communication_queue where id = q_id;
  perform pg_temp.check('P10 Sent: status, provider id and time recorded; audited as SEND_NOTIFICATION', r = 'SENT'
    and row_.status = 'SENT' and row_.provider = 'resend' and row_.provider_message_id = 'msg_123' and row_.sent_at is not null
    and row_.last_error is null
    and exists (select 1 from public.audit_logs where action = 'SEND_NOTIFICATION' and entity_id = q_id), r);

  perform set_config('role', 'service_role', true);
  r := public.complete_communication(q2, 'RETRY', 'resend', null, 'HTTP 503');
  perform set_config('role', 'postgres', true);
  select * into row_ from public.communication_queue where id = q2;
  perform pg_temp.check('P10 Temporary failure 1 → queued again after a delay, error kept', r = 'PENDING'
    and row_.status = 'PENDING' and row_.scheduled_at > now() + interval '30 seconds' and row_.last_error = 'HTTP 503', r);
  perform set_config('role', 'service_role', true);
  select count(*) into n from public.claim_communications(10);
  perform pg_temp.check('P10 … and not retried before its delay has passed', n = 0, n::text);
  perform set_config('role', 'postgres', true);
  update public.communication_queue set scheduled_at = now() - interval '1 second' where id = q2;
  perform set_config('role', 'service_role', true);
  perform public.claim_communications(10);
  r := public.complete_communication(q2, 'RETRY', 'resend', null, 'HTTP 503');
  perform set_config('role', 'postgres', true);
  update public.communication_queue set scheduled_at = now() - interval '1 second' where id = q2;
  perform set_config('role', 'service_role', true);
  perform public.claim_communications(10);
  r := r || '>' || public.complete_communication(q2, 'RETRY', 'resend', null, 'HTTP 503 again');
  perform set_config('role', 'postgres', true);
  select * into row_ from public.communication_queue where id = q2;
  perform pg_temp.check('P10 Third temporary failure → FAILED (maximum attempts), audited as NOTIFICATION_FAILED', r = 'PENDING>FAILED'
    and row_.status = 'FAILED' and row_.attempt_count = 3 and row_.failed_at is not null and row_.last_error = 'HTTP 503 again'
    and exists (select 1 from public.audit_logs where action = 'NOTIFICATION_FAILED' and entity_id = q2), r);
  perform set_config('role', 'service_role', true);
  select count(*) into n from public.claim_communications(10);
  perform pg_temp.check('P10 A FAILED message is never retried automatically; a finished one cannot be completed again',
    n = 0 and public.complete_communication(q_id, 'FAILED') is null and public.complete_communication(q2, 'SENT') is null, n::text);
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('P10 The failed e-mail did not change the task: it is still FAILED-by-agent with its notification',
    (select status from public.tasks where id = t2) = 'FAILED' and pg_temp.notes(admin_id, t2, 'TASK_FAILED') = 1);

  perform pg_temp.act_as(admin_id);
  perform pg_temp.check('P10 Admin can retry a FAILED message (audited); a SENT one cannot be re-queued',
    public.admin_retry_communication(q2) = true and public.admin_retry_communication(q_id) = false
    and pg_temp.visible(format($q$select 1 from public.communication_queue where id = %L and status = 'PENDING' and attempt_count = 0$q$, q2)) = 1
    and pg_temp.visible(format($q$select 1 from public.audit_logs where action = 'RETRY_NOTIFICATION' and entity_id = %L and actor_user_id = %L$q$, q2, admin_id)) = 1);
  perform set_config('role', 'service_role', true);
  perform public.claim_communications(10);
  r := public.complete_communication(q2, 'FAILED', 'resend', null, 'HTTP 422 invalid address');
  perform pg_temp.check('P10 A permanent failure is final on the first attempt', r = 'FAILED', r);

  -- ---------------------------------------------------------------- reminders
  perform set_config('role', 'postgres', true);
  insert into public.tasks (id, task_type, status, agent_id, customer_id, location_id, title, assigned_at, scheduled_date, scheduled_start_time)
  values
    ('56000000-0000-4000-a000-000000000002', 'SURVEY', 'ASSIGNED', b_agent, '20000000-0000-4000-a000-0000000000a1',
     '30000000-0000-4000-a000-0000000000a1', 'P10 soon', now(),
     ((now() at time zone 'Asia/Kolkata') + interval '30 minutes')::date, ((now() at time zone 'Asia/Kolkata') + interval '30 minutes')::time),
    ('56000000-0000-4000-a000-000000000003', 'SURVEY', 'ASSIGNED', b_agent, '20000000-0000-4000-a000-0000000000a1',
     '30000000-0000-4000-a000-0000000000a1', 'P10 overdue', now(),
     ((now() at time zone 'Asia/Kolkata') - interval '1 day')::date, '09:00'),
    ('56000000-0000-4000-a000-000000000004', 'SURVEY', 'COMPLETED', b_agent, '20000000-0000-4000-a000-0000000000a1',
     '30000000-0000-4000-a000-0000000000a1', 'P10 done yesterday', now(),
     ((now() at time zone 'Asia/Kolkata') - interval '1 day')::date, '09:00');
  perform set_config('role', 'service_role', true);
  perform public.enqueue_task_reminders('Asia/Kolkata');
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('P10 Reminders: "starting soon" to the agent; "overdue" to agent and admin; nothing for finished tasks',
    (select count(*) from public.notifications where task_id = '56000000-0000-4000-a000-000000000002' and type = 'TASK_REMINDER'
        and recipient_user_id = agent_b and title = 'Task Starting Soon') = 1
    and pg_temp.notes(admin_id, '56000000-0000-4000-a000-000000000002', 'TASK_REMINDER') = 0
    and (select count(*) from public.notifications where task_id = '56000000-0000-4000-a000-000000000003' and type = 'TASK_REMINDER'
        and title = 'Task Overdue' and recipient_user_id in (agent_b, admin_id)) = 2
    and pg_temp.notes(agent_b, '56000000-0000-4000-a000-000000000004', 'TASK_REMINDER') = 0);
  select count(*) into n from public.notifications where type = 'TASK_REMINDER';
  perform set_config('role', 'service_role', true);
  perform public.enqueue_task_reminders('Asia/Kolkata');
  perform public.enqueue_task_reminders('Asia/Kolkata');
  perform pg_temp.check('P10 Running the reminder job again creates no duplicates; an unknown time zone is rejected',
    pg_temp.error_of('select public.enqueue_task_reminders(''Mars/Olympus'')') = 'INVALID_TIME_ZONE');
  perform set_config('role', 'postgres', true);
  perform pg_temp.check('P10 … reminder count unchanged after two more runs',
    (select count(*) from public.notifications where type = 'TASK_REMINDER') = n, n::text);

  perform pg_temp.check('P10 RLS is enabled on all notification tables',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.notifications'::regclass,
       'public.communication_queue'::regclass, 'public.notification_preferences'::regclass)));
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
