-- ===========================================================================
-- Phase 9 — admin monitoring, realtime updates, task-scoped agent location
--
-- * agent_record_location(): the ONLY way a location event is written. The
--   agent comes from the session, the task must be the agent's own and in an
--   active field state, coordinates/accuracy/timestamp are validated, writes
--   are rate limited per agent and recorded_at is server time.
-- * agent_location_events becomes append-only for everyone but the function
--   (the Phase 3 direct-insert policy is removed).
-- * task_monitor / agent_activity views (security_invoker: RLS applies) and
--   task_status_counts() for the monitoring screens.
-- * Operational tables are added to the supabase_realtime publication;
--   Realtime delivers a change only to subscribers whose RLS allows the row.
--
-- Idempotent. No data is dropped or rewritten.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Settings (server-side only; never taken from the caller)
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('location_min_interval_seconds', 20,
   'Minimum time between stored location events for one agent (seconds). Faster events are ignored.'),
  ('location_max_age_seconds', 120,
   'Ignore a location reading whose device timestamp is older than this (seconds).'),
  ('location_max_accuracy_meters', 2000,
   'Ignore a location reading less accurate than this (metres).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Indexes: latest event per task (the per-agent index already exists)
-- ---------------------------------------------------------------------------
create index if not exists idx_agent_location_events_task_recorded
  on public.agent_location_events (task_id, recorded_at desc);

-- Recent-activity feed: newest rows first, without scanning the whole table.
create index if not exists idx_task_status_history_changed_at
  on public.task_status_history (changed_at desc);
create index if not exists idx_audit_logs_action_created
  on public.audit_logs (action, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Location events are written only through agent_record_location()
-- ---------------------------------------------------------------------------
drop policy if exists "Agents can record own location events" on public.agent_location_events;
revoke insert, update, delete, truncate on public.agent_location_events from anon, authenticated;

create or replace function public.agent_record_location(
  p_task_id     uuid,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy    double precision,
  p_captured_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent        uuid := public.current_agent_id();
  v_task         public.tasks%rowtype;
  v_now          timestamptz := clock_timestamp();
  v_min_interval numeric := public.app_setting('location_min_interval_seconds', 20);
  v_max_age      numeric := public.app_setting('location_max_age_seconds', 120);
  v_max_accuracy numeric := public.app_setting('location_max_accuracy_meters', 2000);
  v_max_skew     numeric := public.app_setting('checkin_max_clock_skew_seconds', 120);
  v_last         timestamptz;
begin
  if v_agent is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  -- Someone else's task (or a draft) is reported as not found. FOR SHARE waits
  -- for a concurrent status change, so an event can't slip in after completion.
  select * into v_task from public.tasks where id = p_task_id for share;
  if not found or v_task.agent_id is distinct from v_agent or v_task.status = 'DRAFT' then
    raise exception using errcode = 'P0001', message = 'TASK_NOT_FOUND';
  end if;
  if v_task.status not in ('ON_THE_WAY', 'ARRIVED', 'CHECKED_IN', 'IN_PROGRESS') then
    raise exception using errcode = 'P0001', message = 'TRACKING_NOT_ACTIVE';
  end if;

  -- NaN compares greater than every number, so the range checks reject it too.
  if p_latitude is null or p_longitude is null
     or not (p_latitude between -90 and 90) or not (p_longitude between -180 and 180) then
    raise exception using errcode = 'P0001', message = 'INVALID_COORDINATES';
  end if;
  if p_accuracy is null or not (p_accuracy >= 0 and p_accuracy < 'Infinity'::double precision) then
    raise exception using errcode = 'P0001', message = 'INVALID_ACCURACY';
  end if;
  if p_captured_at is null
     or p_captured_at < v_now - make_interval(secs => v_max_age)
     or p_captured_at > v_now + make_interval(secs => v_max_skew) then
    raise exception using errcode = 'P0001', message = 'STALE_LOCATION';
  end if;
  if p_accuracy > v_max_accuracy then
    return jsonb_build_object('result', 'LOW_ACCURACY');
  end if;

  -- Rate limit per agent. The advisory lock serialises this agent's requests,
  -- so a burst of parallel calls still stores a single event.
  perform pg_advisory_xact_lock(hashtextextended('agent_location:' || v_agent::text, 0));
  select max(recorded_at) into v_last from public.agent_location_events where agent_id = v_agent;
  if v_last is not null and v_last > clock_timestamp() - make_interval(secs => v_min_interval) then
    return jsonb_build_object('result', 'THROTTLED');
  end if;

  -- recorded_at is server time; the device timestamp is only a freshness check.
  insert into public.agent_location_events (agent_id, task_id, latitude, longitude, accuracy_meters, recorded_at)
  values (v_agent, p_task_id, round(p_latitude::numeric, 7), round(p_longitude::numeric, 7),
          round(p_accuracy::numeric, 2), clock_timestamp());

  return jsonb_build_object('result', 'RECORDED');
end;
$$;

revoke execute on function public.agent_record_location(uuid, double precision, double precision, double precision, timestamptz)
  from public, anon;
grant execute on function public.agent_record_location(uuid, double precision, double precision, double precision, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Monitoring views (security_invoker: the caller's RLS applies to every table)
-- ---------------------------------------------------------------------------
create or replace view public.task_monitor
with (security_invoker = true) as
select
  d.id, d.task_code, d.task_type, d.status, d.priority, d.title,
  d.scheduled_date, d.scheduled_start_time, d.scheduled_end_time, d.created_at,
  d.customer_id, d.customer_name, d.customer_code,
  d.location_id, d.location_name, d.location_city,
  d.agent_id, d.employee_code, d.agent_name,
  t.updated_at,
  t.expected_amount,
  ll.latitude        as last_latitude,
  ll.longitude       as last_longitude,
  ll.accuracy_meters as last_accuracy_meters,
  ll.recorded_at     as last_location_at,
  ci.checked_in_at,
  tp.line_count,
  tp.assigned_total,
  tp.delivered_total,
  cc.collected_amount,
  pr.proof_count
from public.task_directory d
join public.tasks t on t.id = d.id
left join lateral (
  select e.latitude, e.longitude, e.accuracy_meters, e.recorded_at
    from public.agent_location_events e
   where e.task_id = d.id
   order by e.recorded_at desc
   limit 1
) ll on true
left join lateral (
  select c.checked_in_at from public.checkins c where c.task_id = d.id and c.is_within_geofence limit 1
) ci on true
left join lateral (
  select count(*)::int as line_count, sum(p.assigned_quantity) as assigned_total, sum(p.delivered_quantity) as delivered_total
    from public.task_products p where p.task_id = d.id
) tp on true
left join lateral (
  select c.collected_amount from public.cash_collections c where c.task_id = d.id
) cc on true
left join lateral (
  select count(*)::int as proof_count from public.task_proofs p where p.task_id = d.id
) pr on true;

revoke all on public.task_monitor from anon, authenticated;
grant select on public.task_monitor to authenticated;

-- One row per agent: the task they are furthest along with, and when their
-- location was last received (time only — no coordinates on this view).
create or replace view public.agent_activity
with (security_invoker = true) as
select
  a.id, a.employee_code, a.is_active, a.full_name, a.account_active,
  ct.id          as current_task_id,
  ct.task_code   as current_task_code,
  ct.status      as current_task_status,
  ct.task_type   as current_task_type,
  oc.open_tasks,
  ll.recorded_at as last_location_at,
  lc.completed_at as last_completed_at
from public.agent_directory a
left join lateral (
  select t.id, t.task_code, t.status, t.task_type
    from public.tasks t
   where t.agent_id = a.id
     and t.status in ('ASSIGNED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'CHECKED_IN', 'IN_PROGRESS')
   order by array_position(array['ASSIGNED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'CHECKED_IN', 'IN_PROGRESS'], t.status::text) desc,
            t.updated_at desc
   limit 1
) ct on true
left join lateral (
  select count(*)::int as open_tasks
    from public.tasks t
   where t.agent_id = a.id
     and t.status in ('ASSIGNED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'CHECKED_IN', 'IN_PROGRESS')
) oc on true
left join lateral (
  select e.recorded_at from public.agent_location_events e
   where e.agent_id = a.id order by e.recorded_at desc limit 1
) ll on true
left join lateral (
  select max(t.completed_at) as completed_at
    from public.tasks t
   where t.agent_id = a.id and t.status in ('COMPLETED', 'PARTIALLY_COMPLETED', 'VERIFIED')
) lc on true;

revoke all on public.agent_activity from anon, authenticated;
grant select on public.agent_activity to authenticated;

-- Dashboard counts in one round trip: tasks scheduled on the day, plus any
-- task that is still out in the field whatever its date. RLS applies.
create or replace function public.task_status_counts(p_date date)
returns table (status public.task_status, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.status, count(*)
    from public.tasks t
   where t.scheduled_date = p_date
      or t.status in ('ON_THE_WAY', 'ARRIVED', 'CHECKED_IN', 'IN_PROGRESS')
   group by t.status
$$;

revoke execute on function public.task_status_counts(date) from public, anon;
grant execute on function public.task_status_counts(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Realtime: publish only the operational tables the screens listen to.
--    Realtime checks each subscriber's SELECT policy before delivering a row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['tasks', 'task_status_history', 'agent_location_events', 'checkins',
                                   'task_products', 'cash_collections', 'task_proofs'] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;

commit;
