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
  perform pg_temp.check('Audit log captured UPDATE_TASK with changed columns only',
    pg_temp.visible(format($q$select 1 from public.audit_logs where entity_id = %L and action = 'UPDATE_TASK' and actor_user_id = %L
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
