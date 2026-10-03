-- ===========================================================================
-- Phase 11 — reporting & analytics (read-only)
--
--   operational tables
--        ↓
--   report_task_facts()      one row per task with everything the reports need
--        ↓
--   report_*()               SQL aggregation (counts, sums, durations, lists)
--        ↓
--   server-side analytics service → dashboards, tables, exports
--
-- * Nothing here writes to an operational table or changes the task workflow.
-- * Every function is SECURITY INVOKER: the caller's RLS applies to every
--   table read. The organisation-wide reports additionally require an admin.
-- * One period rule for every report: a task belongs to the day it is
--   scheduled for (or, if unscheduled, the day it was created) in the business
--   time zone, which the caller passes in.
-- * Location history (agent_location_events) is not used by any report.
--
-- Idempotent.
-- ===========================================================================
begin;

-- Unscheduled tasks are placed by creation time.
create index if not exists idx_tasks_unscheduled_created
  on public.tasks (created_at) where scheduled_date is null;

-- ---------------------------------------------------------------------------
-- 1. Task facts
-- ---------------------------------------------------------------------------
drop function if exists public.report_task_facts(date, date, text, uuid, public.task_type, public.task_status, uuid, uuid, integer) cascade;
create function public.report_task_facts(
  p_from     date,
  p_to       date,
  p_tz       text default 'Asia/Kolkata',
  p_agent    uuid default null,
  p_type     public.task_type default null,
  p_status   public.task_status default null,
  p_customer uuid default null,
  p_location uuid default null,
  p_priority integer default null
)
returns table (
  id uuid, task_code text, title text, task_type public.task_type, status public.task_status, priority integer,
  task_date date, scheduled_date date, scheduled_start_time time, scheduled_end_time time,
  agent_id uuid, agent_name text, employee_code text,
  customer_id uuid, customer_name text, location_id uuid, location_name text, location_city text,
  created_at timestamptz, assigned_at timestamptz, accepted_at timestamptz, on_the_way_at timestamptz,
  arrived_at timestamptz, checked_in_at timestamptz, started_at timestamptz, completed_at timestamptz,
  is_eligible boolean, is_active boolean, is_completed boolean, is_partial boolean, is_failed boolean,
  is_cancelled boolean, is_closed boolean,
  due_at timestamp, is_overdue boolean, on_time boolean,
  accept_seconds numeric, depart_seconds numeric, travel_seconds numeric, checkin_seconds numeric,
  start_seconds numeric, execution_seconds numeric,
  line_count integer, assigned_qty numeric, delivered_qty numeric, delivery_outcome text,
  expected_amount numeric, collected_amount numeric, outstanding_amount numeric, payment_method text, cash_outcome text,
  checkin_attempts integer, checkin_rejected integer, checkin_ok boolean,
  checkin_accuracy_m numeric, checkin_distance_m numeric,
  proof_count integer, missing_proof boolean, needs_verification boolean
)
language sql
stable
security invoker
-- No SET clause on purpose: a plain STABLE SQL function is inlined by the planner, so
-- the date indexes are used and unused joins are dropped (about 15x faster on a month
-- of 3,000 tasks). It runs with the caller's rights and every object is schema-qualified.
as $$
  with base as (
    select t.*,
           coalesce(t.scheduled_date, (t.created_at at time zone p_tz)::date) as task_date,
           t.status in ('ASSIGNED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'CHECKED_IN', 'IN_PROGRESS') as is_active,
           t.status in ('COMPLETED', 'VERIFIED') as is_completed,
           t.status in ('COMPLETED', 'VERIFIED', 'PARTIALLY_COMPLETED', 'FAILED') as is_closed
      from public.tasks t
     where t.status <> 'DRAFT'
       and (t.scheduled_date between p_from and p_to
            or (t.scheduled_date is null
                and t.created_at >= (p_from::timestamp at time zone p_tz)
                and t.created_at <  ((p_to + 1)::timestamp at time zone p_tz)))
       and (p_agent is null or t.agent_id = p_agent)
       and (p_type is null or t.task_type = p_type)
       and (p_status is null or t.status = p_status)
       and (p_customer is null or t.customer_id = p_customer)
       and (p_location is null or t.location_id = p_location)
       and (p_priority is null or t.priority = p_priority)
  )
  select
    b.id, b.task_code, b.title, b.task_type, b.status, b.priority,
    b.task_date, b.scheduled_date, b.scheduled_start_time, b.scheduled_end_time,
    b.agent_id, p.full_name, a.employee_code,
    b.customer_id, c.name, b.location_id, l.location_name, l.city,
    b.created_at, b.assigned_at, b.accepted_at, h.on_the_way_at, h.arrived_at, h.checked_in_at,
    coalesce(b.started_at, h.in_progress_at), b.completed_at,
    -- Eligible = was actually given to an agent to do (not cancelled / rescheduled).
    b.status not in ('CANCELLED', 'RESCHEDULED'),
    b.is_active,
    b.is_completed,
    b.status = 'PARTIALLY_COMPLETED',
    b.status = 'FAILED',
    b.status = 'CANCELLED',
    b.is_closed,
    d.due_at,
    coalesce(b.is_active and d.due_at < (now() at time zone p_tz), false), -- unscheduled tasks are never overdue
    -- On time is only defined for completed tasks that had a scheduled end.
    case when b.is_completed and b.completed_at is not null and b.scheduled_date is not null and b.scheduled_end_time is not null
         then (b.completed_at at time zone p_tz) <= (b.scheduled_date + b.scheduled_end_time) end,
    -- Stage durations: only when both timestamps exist and are in order. Never zero for "unknown".
    case when b.accepted_at >= b.assigned_at then extract(epoch from b.accepted_at - b.assigned_at) end,
    case when h.on_the_way_at >= b.accepted_at then extract(epoch from h.on_the_way_at - b.accepted_at) end,
    case when h.arrived_at >= h.on_the_way_at then extract(epoch from h.arrived_at - h.on_the_way_at) end,
    case when h.checked_in_at >= h.arrived_at then extract(epoch from h.checked_in_at - h.arrived_at) end,
    case when coalesce(b.started_at, h.in_progress_at) >= h.checked_in_at
         then extract(epoch from coalesce(b.started_at, h.in_progress_at) - h.checked_in_at) end,
    case when b.status in ('COMPLETED', 'VERIFIED', 'PARTIALLY_COMPLETED')
              and b.completed_at >= coalesce(b.started_at, h.in_progress_at)
         then extract(epoch from b.completed_at - coalesce(b.started_at, h.in_progress_at)) end,
    coalesce(tp.line_count, 0), tp.assigned_qty,
    -- delivered_quantity defaults to 0, so it only means something once the task is closed.
    case when b.task_type = 'DELIVER_PRODUCTS' and b.is_closed
         then case when b.status = 'FAILED' then 0 else tp.delivered_qty end end,
    case when b.task_type <> 'DELIVER_PRODUCTS' or tp.assigned_qty is null then null
         when not b.is_closed then case when b.is_active then 'OPEN' end
         when b.status = 'FAILED' then 'FAILED'
         when tp.delivered_qty >= tp.assigned_qty then 'FULL'
         else 'PARTIAL' end,
    case when b.task_type = 'COLLECT_CASH' then b.expected_amount end,
    cc.collected_amount,
    case when b.task_type = 'COLLECT_CASH' and b.is_closed and b.expected_amount is not null
         then b.expected_amount - coalesce(cc.collected_amount, 0) end,
    cc.payment_method,
    case when b.task_type <> 'COLLECT_CASH' or b.expected_amount is null then null
         when not b.is_closed then case when b.is_active then 'OPEN' end
         when coalesce(cc.collected_amount, 0) = 0 then 'ZERO'
         when cc.collected_amount > b.expected_amount then 'OVER'   -- shown, never capped
         when cc.collected_amount = b.expected_amount then 'FULL'
         else 'PARTIAL' end,
    coalesce(ci.attempts, 0), coalesce(ci.rejected, 0), coalesce(ci.ok, false),
    ci.accuracy_m, ci.distance_m,
    coalesce(pr.proof_count, 0),
    b.status in ('COMPLETED', 'VERIFIED', 'PARTIALLY_COMPLETED')
      and b.task_type in ('DELIVER_PRODUCTS', 'DOCUMENT_COLLECTION') and coalesce(pr.proof_count, 0) = 0,
    b.status in ('COMPLETED', 'PARTIALLY_COMPLETED')
  from base b
  left join public.agents a on a.id = b.agent_id
  left join public.profiles p on p.id = a.profile_id
  left join public.customers c on c.id = b.customer_id
  left join public.locations l on l.id = b.location_id
  cross join lateral (
    select b.scheduled_date + coalesce(b.scheduled_end_time, b.scheduled_start_time, time '23:59:59') as due_at
  ) d
  left join lateral (
    select min(s.changed_at) filter (where s.new_status = 'ON_THE_WAY')  as on_the_way_at,
           min(s.changed_at) filter (where s.new_status = 'ARRIVED')     as arrived_at,
           min(s.changed_at) filter (where s.new_status = 'CHECKED_IN')  as checked_in_at,
           min(s.changed_at) filter (where s.new_status = 'IN_PROGRESS') as in_progress_at
      from public.task_status_history s where s.task_id = b.id
  ) h on true
  left join lateral (
    select count(*)::int as line_count, sum(x.assigned_quantity) as assigned_qty, sum(x.delivered_quantity) as delivered_qty
      from public.task_products x where x.task_id = b.id
  ) tp on true
  left join lateral (
    select x.collected_amount, x.payment_method from public.cash_collections x where x.task_id = b.id
  ) cc on true
  left join lateral (
    select count(*)::int as attempts,
           (count(*) filter (where not x.is_within_geofence))::int as rejected,
           bool_or(x.is_within_geofence) as ok,
           max(x.accuracy_meters) filter (where x.is_within_geofence) as accuracy_m,
           max(x.distance_from_location_meters) filter (where x.is_within_geofence) as distance_m
      from public.checkins x where x.task_id = b.id
  ) ci on true
  left join lateral (
    select count(*)::int as proof_count from public.task_proofs x where x.task_id = b.id
  ) pr on true
$$;

-- ---------------------------------------------------------------------------
-- 2. Overview (KPIs, distributions, trend) — one round trip
-- ---------------------------------------------------------------------------
create or replace function public.report_overview(
  p_from date, p_to date, p_tz text default 'Asia/Kolkata',
  p_agent uuid default null, p_type public.task_type default null, p_status public.task_status default null,
  p_customer uuid default null, p_location uuid default null, p_priority integer default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_days   integer := p_to - p_from + 1;
  v_bucket text := case when v_days > 366 then 'month' when v_days > 92 then 'week' else 'day' end;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'NOT_ADMIN';
  end if;
  if p_from is null or p_to is null or p_to < p_from or v_days > 1830 then
    raise exception using errcode = 'P0001', message = 'INVALID_RANGE';
  end if;

  with f as materialized (
    select * from public.report_task_facts(p_from, p_to, p_tz, p_agent, p_type, p_status, p_customer, p_location, p_priority)
  ),
  buckets as (
    select g::date as bucket
      from generate_series(date_trunc(v_bucket, p_from::timestamp), p_to::timestamp, ('1 ' || v_bucket)::interval) g
  )
  select jsonb_build_object(
    'bucket', v_bucket,
    'totals', (select jsonb_build_object(
      'total', count(*),
      'eligible', count(*) filter (where is_eligible),
      'active', count(*) filter (where is_active),
      'completed', count(*) filter (where is_completed),
      'partial', count(*) filter (where is_partial),
      'failed', count(*) filter (where is_failed),
      'cancelled', count(*) filter (where is_cancelled),
      'rescheduled', count(*) filter (where status = 'RESCHEDULED'),
      'overdue', count(*) filter (where is_overdue),
      'on_time', count(*) filter (where on_time),
      'late', count(*) filter (where not on_time),
      'today', count(*) filter (where task_date = (now() at time zone p_tz)::date),
      'active_agents', count(distinct agent_id) filter (where is_active),
      'checkin_ok', count(*) filter (where checkin_ok),
      'checkin_attempts', coalesce(sum(checkin_attempts), 0),
      'checkin_rejected', coalesce(sum(checkin_rejected), 0),
      'cash_expected', coalesce(sum(expected_amount) filter (where is_closed), 0),
      'cash_collected', coalesce(sum(collected_amount) filter (where is_closed), 0),
      'cash_open', coalesce(sum(expected_amount) filter (where cash_outcome = 'OPEN'), 0),
      'cash_tasks_closed', count(*) filter (where is_closed and expected_amount is not null),
      'qty_assigned', coalesce(sum(assigned_qty) filter (where delivery_outcome in ('FULL', 'PARTIAL', 'FAILED')), 0),
      'qty_delivered', coalesce(sum(delivered_qty), 0),
      'qty_open', coalesce(sum(assigned_qty) filter (where delivery_outcome = 'OPEN'), 0),
      'delivery_tasks_closed', count(*) filter (where delivery_outcome in ('FULL', 'PARTIAL', 'FAILED'))
    ) from f),
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('key', status, 'n', n) order by n desc)
                    from (select status, count(*) n from f group by status) s), '[]'::jsonb),
    'by_type', coalesce((select jsonb_agg(to_jsonb(s) order by s.total desc) from (
                    select task_type as key, count(*) total,
                           count(*) filter (where is_eligible) eligible,
                           count(*) filter (where is_completed) completed,
                           count(*) filter (where is_partial) partial,
                           count(*) filter (where is_failed) failed,
                           count(*) filter (where is_cancelled) cancelled,
                           round(avg(execution_seconds)) avg_execution_seconds,
                           count(execution_seconds) execution_samples
                      from f group by task_type) s), '[]'::jsonb),
    'by_priority', coalesce((select jsonb_agg(to_jsonb(s) order by s.key) from (
                    select priority as key, count(*) total,
                           count(*) filter (where is_eligible) eligible,
                           count(*) filter (where is_completed) completed,
                           count(*) filter (where is_failed) failed
                      from f group by priority) s), '[]'::jsonb),
    'trend', coalesce((select jsonb_agg(to_jsonb(s) order by s.bucket) from (
                    select k.bucket,
                           count(f.id) total,
                           count(f.id) filter (where f.is_eligible) eligible,
                           count(f.id) filter (where f.is_completed) completed,
                           count(f.id) filter (where f.is_partial) partial,
                           count(f.id) filter (where f.is_failed) failed,
                           count(f.id) filter (where f.is_cancelled) cancelled,
                           count(f.id) filter (where f.is_active) active,
                           coalesce(sum(f.collected_amount), 0) collected
                      from buckets k
                      left join f on date_trunc(v_bucket, f.task_date::timestamp)::date = k.bucket
                     group by k.bucket) s), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Dimension reports (rows; ordered and paginated by the caller)
-- ---------------------------------------------------------------------------
create or replace function public.report_agents(
  p_from date, p_to date, p_tz text default 'Asia/Kolkata',
  p_agent uuid default null, p_type public.task_type default null, p_status public.task_status default null,
  p_customer uuid default null, p_location uuid default null, p_priority integer default null
)
returns table (
  agent_id uuid, agent_name text, employee_code text,
  assigned bigint, accepted bigint, started bigint, active bigint, completed bigint, partial bigint, failed bigint,
  cancelled bigint, overdue bigint, on_time bigint, late bigint,
  avg_accept_seconds numeric, accept_samples bigint,
  avg_start_seconds numeric, start_samples bigint,
  avg_checkin_seconds numeric, checkin_samples bigint,
  avg_execution_seconds numeric, median_execution_seconds numeric, execution_samples bigint,
  checkins_ok bigint, checkins_rejected bigint,
  deliveries_closed bigint, qty_assigned numeric, qty_delivered numeric,
  cash_expected numeric, cash_collected numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.agent_id, max(f.agent_name), max(f.employee_code),
         count(*) filter (where f.is_eligible),
         count(*) filter (where f.is_eligible and f.accepted_at is not null),
         count(*) filter (where f.is_eligible and f.started_at is not null),
         count(*) filter (where f.is_active),
         count(*) filter (where f.is_completed),
         count(*) filter (where f.is_partial),
         count(*) filter (where f.is_failed),
         count(*) filter (where f.is_cancelled),
         count(*) filter (where f.is_overdue),
         count(*) filter (where f.on_time),
         count(*) filter (where not f.on_time),
         round(avg(f.accept_seconds)), count(f.accept_seconds),
         round(avg(f.start_seconds)), count(f.start_seconds),
         round(avg(f.checkin_seconds)), count(f.checkin_seconds),
         round(avg(f.execution_seconds)),
         round((percentile_cont(0.5) within group (order by f.execution_seconds))::numeric),
         count(f.execution_seconds),
         count(*) filter (where f.checkin_ok),
         coalesce(sum(f.checkin_rejected), 0),
         count(*) filter (where f.delivery_outcome in ('FULL', 'PARTIAL', 'FAILED')),
         coalesce(sum(f.assigned_qty) filter (where f.delivery_outcome in ('FULL', 'PARTIAL', 'FAILED')), 0),
         coalesce(sum(f.delivered_qty), 0),
         coalesce(sum(f.expected_amount) filter (where f.is_closed), 0),
         coalesce(sum(f.collected_amount) filter (where f.is_closed), 0)
    from public.report_task_facts(p_from, p_to, p_tz, p_agent, p_type, p_status, p_customer, p_location, p_priority) f
   where (select public.is_admin()) and f.agent_id is not null
   group by f.agent_id
$$;

create or replace function public.report_customers(
  p_from date, p_to date, p_tz text default 'Asia/Kolkata',
  p_agent uuid default null, p_type public.task_type default null, p_status public.task_status default null,
  p_customer uuid default null, p_location uuid default null, p_priority integer default null
)
returns table (
  customer_id uuid, customer_name text, locations bigint,
  tasks bigint, active bigint, completed bigint, partial bigint, failed bigint, cancelled bigint,
  qty_assigned numeric, qty_delivered numeric, cash_expected numeric, cash_collected numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.customer_id, max(f.customer_name), count(distinct f.location_id),
         count(*) filter (where f.is_eligible),
         count(*) filter (where f.is_active),
         count(*) filter (where f.is_completed),
         count(*) filter (where f.is_partial),
         count(*) filter (where f.is_failed),
         count(*) filter (where f.is_cancelled),
         coalesce(sum(f.assigned_qty) filter (where f.delivery_outcome in ('FULL', 'PARTIAL', 'FAILED')), 0),
         coalesce(sum(f.delivered_qty), 0),
         coalesce(sum(f.expected_amount) filter (where f.is_closed), 0),
         coalesce(sum(f.collected_amount) filter (where f.is_closed), 0)
    from public.report_task_facts(p_from, p_to, p_tz, p_agent, p_type, p_status, p_customer, p_location, p_priority) f
   where (select public.is_admin())
   group by f.customer_id
$$;

create or replace function public.report_locations(
  p_from date, p_to date, p_tz text default 'Asia/Kolkata',
  p_agent uuid default null, p_type public.task_type default null, p_status public.task_status default null,
  p_customer uuid default null, p_location uuid default null, p_priority integer default null
)
returns table (
  location_id uuid, location_name text, location_city text, customer_id uuid, customer_name text,
  tasks bigint, active bigint, completed bigint, partial bigint, failed bigint,
  checkin_attempts bigint, checkins_ok bigint, checkins_rejected bigint,
  deliveries_closed bigint, deliveries_partial bigint,
  avg_execution_seconds numeric, execution_samples bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.location_id, max(f.location_name), max(f.location_city), (array_agg(f.customer_id))[1], max(f.customer_name),
         count(*) filter (where f.is_eligible),
         count(*) filter (where f.is_active),
         count(*) filter (where f.is_completed),
         count(*) filter (where f.is_partial),
         count(*) filter (where f.is_failed),
         coalesce(sum(f.checkin_attempts), 0),
         count(*) filter (where f.checkin_ok),
         coalesce(sum(f.checkin_rejected), 0),
         count(*) filter (where f.delivery_outcome in ('FULL', 'PARTIAL', 'FAILED')),
         count(*) filter (where f.delivery_outcome = 'PARTIAL'),
         round(avg(f.execution_seconds)), count(f.execution_seconds)
    from public.report_task_facts(p_from, p_to, p_tz, p_agent, p_type, p_status, p_customer, p_location, p_priority) f
   where (select public.is_admin())
   group by f.location_id
$$;

-- Fulfilment per product, over closed delivery tasks (a failed delivery counts as nothing delivered).
create or replace function public.report_products(
  p_from date, p_to date, p_tz text default 'Asia/Kolkata',
  p_agent uuid default null, p_type public.task_type default null, p_status public.task_status default null,
  p_customer uuid default null, p_location uuid default null, p_priority integer default null
)
returns table (
  product_id uuid, sku text, product_name text, unit text,
  tasks bigint, assigned_qty numeric, delivered_qty numeric, outstanding_qty numeric, partial_lines bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select pr.id, pr.sku, pr.product_name, pr.unit,
         count(distinct f.id),
         sum(tp.assigned_quantity),
         sum(case when f.status = 'FAILED' then 0 else tp.delivered_quantity end),
         sum(tp.assigned_quantity - case when f.status = 'FAILED' then 0 else tp.delivered_quantity end),
         count(*) filter (where f.status <> 'FAILED' and tp.delivered_quantity < tp.assigned_quantity)
    from public.report_task_facts(p_from, p_to, p_tz, p_agent, p_type, p_status, p_customer, p_location, p_priority) f
    join public.task_products tp on tp.task_id = f.id
    join public.products pr on pr.id = tp.product_id
   where (select public.is_admin()) and f.delivery_outcome in ('FULL', 'PARTIAL', 'FAILED')
   group by pr.id, pr.sku, pr.product_name, pr.unit
$$;

-- ---------------------------------------------------------------------------
-- 4. Cash, check-ins, durations
-- ---------------------------------------------------------------------------
create or replace function public.report_cash(
  p_from date, p_to date, p_tz text default 'Asia/Kolkata',
  p_agent uuid default null, p_type public.task_type default null, p_status public.task_status default null,
  p_customer uuid default null, p_location uuid default null, p_priority integer default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'NOT_ADMIN';
  end if;
  with f as materialized (
    select * from public.report_task_facts(p_from, p_to, p_tz, p_agent, p_type, p_status, p_customer, p_location, p_priority)
     where cash_outcome is not null
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
      'tasks_closed', count(*) filter (where cash_outcome <> 'OPEN'),
      'expected', coalesce(sum(expected_amount) filter (where cash_outcome <> 'OPEN'), 0),
      'collected', coalesce(sum(collected_amount) filter (where cash_outcome <> 'OPEN'), 0),
      'outstanding', coalesce(sum(outstanding_amount) filter (where outstanding_amount > 0), 0),
      'over', coalesce(sum(-outstanding_amount) filter (where outstanding_amount < 0), 0),
      'tasks_open', count(*) filter (where cash_outcome = 'OPEN'),
      'expected_open', coalesce(sum(expected_amount) filter (where cash_outcome = 'OPEN'), 0),
      'full', count(*) filter (where cash_outcome = 'FULL'),
      'partial', count(*) filter (where cash_outcome = 'PARTIAL'),
      'zero', count(*) filter (where cash_outcome = 'ZERO'),
      'over_count', count(*) filter (where cash_outcome = 'OVER')
    ) from f),
    'by_method', coalesce((select jsonb_agg(to_jsonb(s) order by s.amount desc) from (
        select coalesce(payment_method, 'UNKNOWN') as key, count(*) n, sum(collected_amount) amount
          from f where collected_amount is not null and cash_outcome <> 'OPEN' group by 1) s), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(to_jsonb(s) order by s.day) from (
        select task_date as day, sum(expected_amount) expected, coalesce(sum(collected_amount), 0) collected, count(*) n
          from f where cash_outcome <> 'OPEN' group by task_date) s), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- Check-in attempts of the period's tasks. Aggregates only: no coordinates leave the database.
create or replace function public.report_checkins(
  p_from date, p_to date, p_tz text default 'Asia/Kolkata',
  p_agent uuid default null, p_type public.task_type default null, p_status public.task_status default null,
  p_customer uuid default null, p_location uuid default null, p_priority integer default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'NOT_ADMIN';
  end if;
  with f as materialized (
    select id, agent_id, agent_name, location_id, location_name, task_date
      from public.report_task_facts(p_from, p_to, p_tz, p_agent, p_type, p_status, p_customer, p_location, p_priority)
  ),
  c as materialized (
    select f.*, x.is_within_geofence as ok, x.accuracy_meters, x.distance_from_location_meters,
           (x.checked_in_at at time zone p_tz)::date as day
      from f join public.checkins x on x.task_id = f.id
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
      'attempts', count(*),
      'ok', count(*) filter (where ok),
      'rejected', count(*) filter (where not ok),
      'tasks', count(distinct id),
      'tasks_with_rejections', count(distinct id) filter (where not ok),
      'avg_accuracy_m', round(avg(accuracy_meters) filter (where ok), 1),
      'avg_distance_m', round(avg(distance_from_location_meters) filter (where ok), 1),
      'avg_rejected_distance_m', round(avg(distance_from_location_meters) filter (where not ok), 1)
    ) from c),
    'by_day', coalesce((select jsonb_agg(to_jsonb(s) order by s.day) from (
        select day, count(*) filter (where ok) ok, count(*) filter (where not ok) rejected from c group by day) s), '[]'::jsonb),
    'by_agent', coalesce((select jsonb_agg(to_jsonb(s) order by s.attempts desc) from (
        select agent_id as id, max(agent_name) as name, count(*) attempts, count(*) filter (where ok) ok,
               count(*) filter (where not ok) rejected, round(avg(accuracy_meters) filter (where ok), 1) avg_accuracy_m
          from c group by agent_id) s), '[]'::jsonb),
    'by_location', coalesce((select jsonb_agg(to_jsonb(s) order by s.rejected desc, s.attempts desc) from (
        select location_id as id, max(location_name) as name, count(*) attempts, count(*) filter (where ok) ok,
               count(*) filter (where not ok) rejected, round(avg(distance_from_location_meters) filter (where ok), 1) avg_distance_m
          from c group by location_id order by count(*) filter (where not ok) desc, count(*) desc limit 100) s), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.report_durations(
  p_from date, p_to date, p_tz text default 'Asia/Kolkata',
  p_agent uuid default null, p_type public.task_type default null, p_status public.task_status default null,
  p_customer uuid default null, p_location uuid default null, p_priority integer default null
)
returns table (stage text, stage_order integer, samples bigint, avg_seconds numeric, median_seconds numeric, min_seconds numeric, max_seconds numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as materialized (
    select * from public.report_task_facts(p_from, p_to, p_tz, p_agent, p_type, p_status, p_customer, p_location, p_priority)
     where (select public.is_admin())
  )
  select v.stage, v.stage_order, count(v.seconds), round(avg(v.seconds)),
         round((percentile_cont(0.5) within group (order by v.seconds))::numeric), round(min(v.seconds)), round(max(v.seconds))
    from f
   cross join lateral (values
      ('Assigned → Accepted', 1, f.accept_seconds),
      ('Accepted → On the way', 2, f.depart_seconds),
      ('On the way → Arrived', 3, f.travel_seconds),
      ('Arrived → Checked in', 4, f.checkin_seconds),
      ('Checked in → Started', 5, f.start_seconds),
      ('Started → Completed', 6, f.execution_seconds)
   ) v(stage, stage_order, seconds)
   group by v.stage, v.stage_order
$$;

-- ---------------------------------------------------------------------------
-- 5. Data quality (read-only checks; nothing is ever "fixed" automatically)
-- ---------------------------------------------------------------------------
create or replace function public.report_data_quality(p_from date, p_to date, p_tz text default 'Asia/Kolkata')
returns table (issue text, severity text, task_id uuid, task_code text, detail text)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as materialized (
    select * from public.report_task_facts(p_from, p_to, p_tz) where (select public.is_admin())
  )
  select 'Delivered more than assigned', 'high', f.id, f.task_code,
         'Delivered ' || trim(to_char(x.delivered_quantity, 'FM999999990.###')) || ' of ' || trim(to_char(x.assigned_quantity, 'FM999999990.###')) || ' on a line'
    from f join public.task_products x on x.task_id = f.id where x.delivered_quantity > x.assigned_quantity
  union all
  select 'Collected more than expected', 'high', f.id, f.task_code, 'Collected exceeds the expected amount'
    from f where f.collected_amount > f.expected_amount
  union all
  select 'Completed before it started', 'high', f.id, f.task_code, 'Completion time is earlier than the start time'
    from f where f.completed_at < f.started_at
  union all
  select 'Accepted before it was assigned', 'high', f.id, f.task_code, 'Acceptance time is earlier than the assignment time'
    from f where f.accepted_at < f.assigned_at
  union all
  select 'Checked in after completion', 'high', f.id, f.task_code, 'Check-in time is later than the completion time'
    from f where f.checked_in_at > f.completed_at
  union all
  select 'No agent on an assigned task', 'high', f.id, f.task_code, 'Status ' || f.status || ' without an agent'
    from f where f.is_eligible and f.agent_id is null
  union all
  select 'Finished without a completion time', 'medium', f.id, f.task_code, 'Status ' || f.status || ' has no completion time'
    from f where f.status in ('COMPLETED', 'VERIFIED', 'PARTIALLY_COMPLETED') and f.completed_at is null
  union all
  select 'Finished without a verified check-in', 'medium', f.id, f.task_code, 'No successful GPS check-in is recorded'
    from f where f.status in ('COMPLETED', 'VERIFIED', 'PARTIALLY_COMPLETED') and not f.checkin_ok
  union all
  select 'Cash task closed without a collection record', 'medium', f.id, f.task_code, 'Completed cash task has no collection'
    from f where f.task_type = 'COLLECT_CASH' and f.status in ('COMPLETED', 'VERIFIED', 'PARTIALLY_COMPLETED') and f.collected_amount is null
  union all
  select 'Cash task without an expected amount', 'medium', f.id, f.task_code, 'No amount to collect is set'
    from f where f.task_type = 'COLLECT_CASH' and f.is_eligible and (select t.expected_amount from public.tasks t where t.id = f.id) is null
  union all
  select 'Delivery task without products', 'medium', f.id, f.task_code, 'No product lines on a delivery task'
    from f where f.task_type = 'DELIVER_PRODUCTS' and f.is_eligible and f.line_count = 0
  union all
  select 'Unusually long execution', 'low', f.id, f.task_code, 'Started → completed took ' || round(f.execution_seconds / 3600.0, 1) || ' hours'
    from f where f.execution_seconds > 12 * 3600
  union all
  select 'Unusually short execution', 'low', f.id, f.task_code, 'Started → completed took ' || round(f.execution_seconds) || ' seconds'
    from f where f.execution_seconds < 30
  union all
  select 'Required proof is missing', 'medium', f.id, f.task_code, 'Finished without the required proof'
    from f where f.missing_proof
$$;

-- ---------------------------------------------------------------------------
-- 6. The signed-in agent's own numbers (RLS: only their tasks are visible)
-- ---------------------------------------------------------------------------
create or replace function public.my_task_summary(p_from date, p_to date, p_tz text default 'Asia/Kolkata')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'eligible', count(*) filter (where f.is_eligible),
    'active', count(*) filter (where f.is_active),
    'completed', count(*) filter (where f.is_completed),
    'partial', count(*) filter (where f.is_partial),
    'failed', count(*) filter (where f.is_failed),
    'on_time', count(*) filter (where f.on_time),
    'late', count(*) filter (where not f.on_time))
    from public.report_task_facts(p_from, p_to, p_tz) f
   where f.agent_id = (select public.current_agent_id())
$$;

do $$
declare
  f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('report_task_facts', 'report_overview', 'report_agents', 'report_customers', 'report_locations',
                         'report_products', 'report_cash', 'report_checkins', 'report_durations', 'report_data_quality',
                         'my_task_summary')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

commit;
