-- ===========================================================================
-- Phase 12 — AI decision support (advisory only)
--
--   operational data → report_task_facts() (Phase 11)
--        ↓
--   ai_task_features() / ai_agent_workload() / ai_volume_history() / ai_detect_anomalies()
--        ↓  features and baselines, computed from data available NOW
--   server-side models (src/lib/ai) → predictions with confidence + explanation
--        ↓
--   ai_store_predictions() / ai_store_recommendations() / ai_store_summary()
--        ↓
--   admin screens → human decision (ai_review_recommendation, ai_submit_feedback)
--
-- * Nothing in this migration can change a task, an assignment, a schedule, a
--   payment, a quantity or a check-in. The AI tables are separate, and no AI
--   function writes to an operational table.
-- * Reads use the caller's rights (RLS). Writes go through SECURITY DEFINER
--   functions that require an admin or the server's service role.
-- * Historical baselines only use tasks that are already closed, so a
--   prediction never sees information from after the moment it is made.
-- * Location history (agent_location_events) is not used.
--
-- Idempotent. No operational data is changed.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.ai_settings (
  key         text primary key,
  enabled     boolean not null default true,
  description text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

insert into public.ai_settings (key, description) values
  ('ai_enabled', 'Master switch for every AI feature.'),
  ('task_risk', 'Delay-risk and failure-risk estimates for active tasks.'),
  ('eta', 'Estimated completion time for tasks in the field.'),
  ('forecast', 'Workload forecast for the next 7 days.'),
  ('anomalies', 'Operational anomaly detection.'),
  ('recommendations', 'Attention recommendations for administrators.'),
  ('summary', 'Daily operational summary.')
on conflict (key) do nothing;

create table if not exists public.ai_models (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  version         text not null,
  model_type      text not null,
  status          text not null default 'EXPERIMENTAL',
  feature_version text not null,
  description     text not null,
  created_at      timestamptz not null default now(),
  constraint ai_models_type_known check (model_type in ('CLASSIFICATION', 'REGRESSION', 'TIME_SERIES', 'ANOMALY_DETECTION', 'LLM', 'RULES')),
  constraint ai_models_status_known check (status in ('EXPERIMENTAL', 'ACTIVE', 'RETIRED')),
  constraint ai_models_name_version unique (name, version)
);

insert into public.ai_models (name, version, model_type, feature_version, description) values
  ('task-delay-risk', '1.0', 'CLASSIFICATION', '1',
   'Compares the time a task has left with how long similar tasks historically took from the same stage. Statistical baseline, not a trained model.'),
  ('task-failure-risk', '1.0', 'CLASSIFICATION', '1',
   'Historical failure rate of similar tasks (same type, same location), smoothed towards the overall rate. Statistical baseline.'),
  ('task-eta', '1.0', 'REGRESSION', '1',
   'Median and quartiles of the time similar tasks took from the current stage to completion. Operational estimate; no traffic data.'),
  ('workload-forecast', '1.0', 'TIME_SERIES', '1',
   'Same-weekday moving average over the last 8 weeks, shown next to what is already scheduled.'),
  ('operational-anomalies', '1.0', 'ANOMALY_DETECTION', '1',
   'Rule-based comparison of recent figures with their historical baseline.'),
  ('attention-rules', '1.0', 'RULES', '1',
   'Turns high risks, overdue tasks and repeated rejected check-ins into recommendations for review.'),
  ('operational-summary', '1.0', 'LLM', '1',
   'Daily summary written from validated analytics figures; a built-in template is used when no language model is configured.')
on conflict (name, version) do nothing;

create table if not exists public.ai_predictions (
  id               uuid primary key default gen_random_uuid(),
  prediction_type  text not null,
  entity_type      text not null,
  entity_id        uuid not null,
  prediction_value jsonb not null,
  confidence       numeric(5, 4),
  model_name       text not null,
  model_version    text not null,
  feature_version  text not null,
  explanation      jsonb not null default '{}'::jsonb,
  -- Short digest of the result: an unchanged prediction is refreshed, not duplicated.
  fingerprint      text not null,
  generated_at     timestamptz not null default now(),
  expires_at       timestamptz,
  -- Ground truth, filled in once the task is closed (for later evaluation).
  outcome          jsonb,
  evaluated_at     timestamptz,
  created_at       timestamptz not null default now(),
  constraint ai_predictions_type_known check (prediction_type in
    ('TASK_DELAY_RISK', 'TASK_FAILURE_RISK', 'TASK_ETA', 'WORKLOAD_FORECAST', 'ANOMALY')),
  constraint ai_predictions_entity_known check (entity_type in ('TASK', 'LOCATION', 'AGENT', 'ORGANISATION')),
  constraint ai_predictions_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists idx_ai_predictions_entity
  on public.ai_predictions (entity_type, entity_id, prediction_type, generated_at desc);
create index if not exists idx_ai_predictions_type_generated
  on public.ai_predictions (prediction_type, generated_at desc);
create index if not exists idx_ai_predictions_unevaluated
  on public.ai_predictions (entity_id) where outcome is null and entity_type = 'TASK';

create table if not exists public.ai_recommendations (
  id                  uuid primary key default gen_random_uuid(),
  recommendation_type text not null,
  entity_type         text not null,
  entity_id           uuid,
  title               text not null,
  description         text not null,
  reasoning           jsonb not null default '{}'::jsonb,
  confidence          numeric(5, 4),
  status              text not null default 'PENDING',
  dedupe_key          text not null unique,
  model_name          text not null,
  model_version       text not null,
  created_at          timestamptz not null default now(),
  reviewed_at         timestamptz,
  reviewed_by         uuid references public.profiles (id) on delete set null,
  review_notes        text,
  constraint ai_recommendations_status_known check (status in ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
  constraint ai_recommendations_entity_known check (entity_type in ('TASK', 'LOCATION', 'AGENT', 'ORGANISATION')),
  constraint ai_recommendations_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint ai_recommendations_notes_length check (review_notes is null or char_length(review_notes) <= 500)
);

create index if not exists idx_ai_recommendations_status_created on public.ai_recommendations (status, created_at desc);
create index if not exists idx_ai_recommendations_entity on public.ai_recommendations (entity_type, entity_id);

create table if not exists public.ai_feedback (
  id            uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.ai_predictions (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  rating        text not null,
  notes         text,
  created_at    timestamptz not null default now(),
  constraint ai_feedback_rating_known check (rating in ('USEFUL', 'NOT_USEFUL', 'INCORRECT')),
  constraint ai_feedback_notes_length check (notes is null or char_length(notes) <= 500),
  constraint ai_feedback_one_per_user unique (prediction_id, user_id)
);

-- Observability: one row per generation run (never per calculation).
create table if not exists public.ai_runs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  status        text not null default 'RUNNING',
  trigger       text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   integer,
  predictions   integer not null default 0,
  insufficient  integer not null default 0,
  recommendations integer not null default 0,
  provider      text,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  error         text,
  started_by    uuid references public.profiles (id) on delete set null,
  constraint ai_runs_kind_known check (kind in ('PREDICTIONS', 'SUMMARY')),
  constraint ai_runs_status_known check (status in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  constraint ai_runs_trigger_known check (trigger in ('MANUAL', 'SCHEDULED'))
);

create index if not exists idx_ai_runs_kind_started on public.ai_runs (kind, started_at desc);

create table if not exists public.ai_summaries (
  id           uuid primary key default gen_random_uuid(),
  period       date not null,
  content      jsonb not null,
  -- The exact figures the summary was written from.
  facts        jsonb not null,
  provider     text not null,
  model        text,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles (id) on delete set null
);

create index if not exists idx_ai_summaries_period on public.ai_summaries (period desc, generated_at desc);

-- ---------------------------------------------------------------------------
-- 2. Access: admins read; nobody writes directly
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['ai_settings', 'ai_models', 'ai_predictions', 'ai_recommendations', 'ai_feedback', 'ai_runs', 'ai_summaries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists "Admins can view %s" on public.%I', t, t);
    execute format('create policy "Admins can view %s" on public.%I for select to authenticated using ((select public.is_admin()))', t, t);
  end loop;
end;
$$;

-- An admin in the app, or the server's scheduled job.
create or replace function public.ai_caller_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or coalesce(auth.role(), '') = 'service_role'
$$;

create or replace function public.ai_feature_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from public.ai_settings where key = 'ai_enabled'), false)
     and coalesce((select enabled from public.ai_settings where key = p_key), false)
$$;

-- ---------------------------------------------------------------------------
-- 3. Features (SECURITY INVOKER: the caller's RLS applies)
-- ---------------------------------------------------------------------------
-- One row per ACTIVE task: its own state plus historical baselines of similar
-- CLOSED tasks from the last 180 days. Every input exists at prediction time.
create or replace function public.ai_task_features(p_tz text default 'Asia/Kolkata')
returns table (
  task_id uuid, task_code text, title text, task_type public.task_type, status public.task_status, priority integer,
  agent_id uuid, agent_name text, location_id uuid, location_name text, customer_name text,
  due_at timestamp, minutes_to_due numeric, is_overdue boolean,
  stage_entered_at timestamptz, minutes_in_stage numeric,
  line_count integer, checkin_rejected integer, checkin_ok boolean,
  baseline_scope text, remaining_samples bigint,
  remaining_p25_minutes numeric, remaining_median_minutes numeric, remaining_p75_minutes numeric,
  type_closed bigint, type_failed bigint, type_scheduled_completed bigint, type_late bigint,
  location_closed bigint, location_failed bigint,
  all_closed bigint, all_failed bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (select (now() at time zone p_tz)::date as d),
  hist as materialized (
    select f.* from today, public.report_task_facts(today.d - 180, today.d, p_tz) f
     where f.is_closed and (select public.ai_caller_allowed())
  ),
  act as materialized (
    select f.* from today, public.report_task_facts(today.d - 365, today.d + 365, p_tz) f
     where f.is_active and (select public.ai_caller_allowed())
  ),
  totals as (select count(*) as all_closed, count(*) filter (where is_failed) as all_failed from hist)
  select
    a.id, a.task_code, a.title, a.task_type, a.status, a.priority,
    a.agent_id, a.agent_name, a.location_id, a.location_name, a.customer_name,
    a.due_at,
    round((extract(epoch from a.due_at - (now() at time zone p_tz)) / 60)::numeric, 1),
    a.is_overdue,
    st.entered_at,
    round((extract(epoch from now() - st.entered_at) / 60)::numeric, 1),
    a.line_count, a.checkin_rejected, a.checkin_ok,
    case when coalesce(same.n, 0) >= 5 then 'TYPE' else 'ALL' end,
    case when coalesce(same.n, 0) >= 5 then same.n else anyt.n end,
    case when coalesce(same.n, 0) >= 5 then same.p25 else anyt.p25 end,
    case when coalesce(same.n, 0) >= 5 then same.p50 else anyt.p50 end,
    case when coalesce(same.n, 0) >= 5 then same.p75 else anyt.p75 end,
    ty.closed, ty.failed, ty.scheduled_completed, ty.late,
    lo.closed, lo.failed,
    totals.all_closed, totals.all_failed
  from act a
  cross join totals
  cross join lateral (
    select case a.status
      when 'ASSIGNED' then a.assigned_at when 'ACCEPTED' then a.accepted_at when 'ON_THE_WAY' then a.on_the_way_at
      when 'ARRIVED' then a.arrived_at when 'CHECKED_IN' then a.checked_in_at when 'IN_PROGRESS' then a.started_at end as entered_at
  ) st
  -- How long finished tasks took from the stage this task is in now, to completion.
  left join lateral (
    select count(x.minutes) as n,
           round((percentile_cont(0.25) within group (order by x.minutes))::numeric, 1) as p25,
           round((percentile_cont(0.5) within group (order by x.minutes))::numeric, 1) as p50,
           round((percentile_cont(0.75) within group (order by x.minutes))::numeric, 1) as p75
      from (
        select extract(epoch from h.completed_at - (case a.status
                 when 'ASSIGNED' then h.assigned_at when 'ACCEPTED' then h.accepted_at when 'ON_THE_WAY' then h.on_the_way_at
                 when 'ARRIVED' then h.arrived_at when 'CHECKED_IN' then h.checked_in_at when 'IN_PROGRESS' then h.started_at end)) / 60 as minutes
          from hist h
         where h.task_type = a.task_type and h.id <> a.id and not h.is_failed and h.completed_at is not null
      ) x
     where x.minutes >= 0
  ) same on true
  left join lateral (
    select count(x.minutes) as n,
           round((percentile_cont(0.25) within group (order by x.minutes))::numeric, 1) as p25,
           round((percentile_cont(0.5) within group (order by x.minutes))::numeric, 1) as p50,
           round((percentile_cont(0.75) within group (order by x.minutes))::numeric, 1) as p75
      from (
        select extract(epoch from h.completed_at - (case a.status
                 when 'ASSIGNED' then h.assigned_at when 'ACCEPTED' then h.accepted_at when 'ON_THE_WAY' then h.on_the_way_at
                 when 'ARRIVED' then h.arrived_at when 'CHECKED_IN' then h.checked_in_at when 'IN_PROGRESS' then h.started_at end)) / 60 as minutes
          from hist h
         where h.id <> a.id and not h.is_failed and h.completed_at is not null
      ) x
     where x.minutes >= 0
  ) anyt on true
  left join lateral (
    select count(*) as closed, count(*) filter (where h.is_failed) as failed,
           count(*) filter (where h.on_time is not null) as scheduled_completed,
           count(*) filter (where h.on_time = false) as late
      from hist h where h.task_type = a.task_type and h.id <> a.id
  ) ty on true
  left join lateral (
    select count(*) as closed, count(*) filter (where h.is_failed) as failed
      from hist h where h.location_id = a.location_id and h.id <> a.id
  ) lo on true
$$;

-- Open work per active agent. Counts only; no location data.
create or replace function public.ai_agent_workload(p_tz text default 'Asia/Kolkata')
returns table (agent_id uuid, agent_name text, active_tasks bigint, due_today bigint, overdue bigint, in_field bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.agent_id, max(f.agent_name), count(*),
         count(*) filter (where f.task_date = (now() at time zone p_tz)::date),
         count(*) filter (where f.is_overdue),
         count(*) filter (where f.status in ('ON_THE_WAY', 'ARRIVED', 'CHECKED_IN', 'IN_PROGRESS'))
    from public.report_task_facts((now() at time zone p_tz)::date - 365, (now() at time zone p_tz)::date + 30, p_tz) f
   where f.is_active and f.agent_id is not null and (select public.ai_caller_allowed())
   group by f.agent_id
$$;

-- Task volume per day: the last 8 weeks (what happened) and the next 7 days (what is already scheduled).
create or replace function public.ai_volume_history(p_tz text default 'Asia/Kolkata')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (select (now() at time zone p_tz)::date as d),
  f as materialized (
    select f.task_date, f.task_type, f.location_name
      from today, public.report_task_facts(today.d - 56, today.d + 7, p_tz) f
     where f.is_eligible and (select public.ai_caller_allowed())
  ),
  days as (select g::date as day from today, generate_series(today.d - 56, today.d + 7, interval '1 day') g)
  select jsonb_build_object(
    'today', (select d from today),
    'days', (select jsonb_agg(jsonb_build_object('day', days.day, 'total', (select count(*) from f where f.task_date = days.day)) order by days.day) from days),
    'by_type', coalesce((select jsonb_agg(to_jsonb(s) order by s.n desc) from (
        select f.task_type as key, count(*) n from f, today where f.task_date between today.d - 28 and today.d - 1 group by f.task_type) s), '[]'::jsonb),
    'by_location', coalesce((select jsonb_agg(to_jsonb(s) order by s.n desc) from (
        select f.location_name as key, count(*) n from f, today where f.task_date between today.d - 28 and today.d - 1
         group by f.location_name order by count(*) desc limit 5) s), '[]'::jsonb)
  )
$$;

-- Rule-based anomalies: a recent figure against its own historical baseline.
-- Wording is about operations and places, never about a person.
create or replace function public.ai_detect_anomalies(p_tz text default 'Asia/Kolkata')
returns table (kind text, severity text, entity_type text, entity_id uuid, entity_label text, title text,
               observed numeric, baseline numeric, unit text, detail text, dedupe_key text)
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (select (now() at time zone p_tz)::date as d),
  f as materialized (
    select f.* from today, public.report_task_facts(today.d - 63, today.d, p_tz) f
     where (select public.ai_caller_allowed())
  ),
  type_base as (
    select task_type, count(execution_seconds) as n,
           percentile_cont(0.5) within group (order by execution_seconds) as median_seconds
      from f, today where task_date < today.d - 7 and execution_seconds is not null group by task_type
  ),
  overall as (
    select count(*) filter (where is_closed) as closed, count(*) filter (where is_failed) as failed from f
  )
  -- 1. A recently finished task took far longer than similar tasks usually do.
  select 'LONG_DURATION', case when f.execution_seconds >= 4 * b.median_seconds then 'high' else 'medium' end,
         'TASK', f.id, f.task_code, 'Unusually long task duration',
         round((f.execution_seconds / 60)::numeric, 1), round((b.median_seconds / 60)::numeric, 1), 'minutes',
         'Execution took about ' || round((f.execution_seconds / b.median_seconds)::numeric, 1) || '× the recent median for '
           || initcap(replace(f.task_type::text, '_', ' ')) || ' tasks (' || b.n || ' tasks measured).',
         'long-duration:' || f.id
    from f join type_base b on b.task_type = f.task_type, today
   where f.task_date >= today.d - 7 and b.n >= 5 and b.median_seconds > 0 and f.execution_seconds >= 2.5 * b.median_seconds
  union all
  -- 2. Repeated rejected check-ins at one location.
  select 'REPEATED_CHECKIN_REJECTION', case when sum(f.checkin_rejected) >= 6 then 'high' else 'medium' end,
         'LOCATION', f.location_id, max(f.location_name), 'Repeated rejected check-ins at a location',
         sum(f.checkin_rejected)::numeric, 0, 'rejected attempts',
         sum(f.checkin_rejected) || ' check-in attempts were rejected at this location in the last 7 days, across '
           || count(*) filter (where f.checkin_rejected > 0) || ' task(s). The site pin or its radius may need checking.',
         'checkin-rejections:' || f.location_id || ':' || (select d from today)
    from f, today where f.task_date >= today.d - 7 group by f.location_id having sum(f.checkin_rejected) >= 3
  union all
  -- 3. A location fails much more often than the organisation as a whole.
  select 'HIGH_FAILURE_RATE', 'medium', 'LOCATION', f.location_id, max(f.location_name), 'Unusually high failure rate at a location',
         round(100.0 * count(*) filter (where f.is_failed) / count(*), 1),
         round(100.0 * max(o.failed) / nullif(max(o.closed), 0), 1), 'percent failed',
         count(*) filter (where f.is_failed) || ' of ' || count(*) || ' closed tasks at this location failed in the last 30 days.',
         'failure-rate:' || f.location_id || ':' || (select d from today)
    from f cross join overall o, today
   where f.is_closed and f.task_date >= today.d - 30
   group by f.location_id
  having count(*) >= 4 and count(*) filter (where f.is_failed) * 2 >= count(*)
     and count(*) filter (where f.is_failed)::numeric / count(*) >= 2 * (max(o.failed)::numeric / nullif(max(o.closed), 0))
  union all
  -- 4. Cash left outstanding this week against the weekly average before it.
  select 'CASH_OUTSTANDING', 'medium', 'ORGANISATION', '00000000-0000-0000-0000-000000000000'::uuid, 'All locations',
         'Cash outstanding above the recent average',
         round(w.recent, 2), round(w.baseline, 2), 'currency per week',
         'Outstanding cash on tasks closed in the last 7 days is about ' || round(w.recent / w.baseline, 1)
           || '× the weekly average of the previous 8 weeks (' || w.n || ' closed cash tasks in the baseline).',
         'cash-outstanding:' || (select d from today)
    from (
      select coalesce(sum(greatest(f.outstanding_amount, 0)) filter (where f.task_date >= today.d - 7), 0) as recent,
             coalesce(sum(greatest(f.outstanding_amount, 0)) filter (where f.task_date < today.d - 7), 0) / 8.0 as baseline,
             count(*) filter (where f.task_date < today.d - 7 and f.outstanding_amount is not null) as n
        from f, today
    ) w
   where w.n >= 10 and w.baseline > 0 and w.recent >= 2 * w.baseline
  union all
  -- 5. Today's task volume against the same weekday in earlier weeks.
  select 'TASK_VOLUME', 'medium', 'ORGANISATION', '00000000-0000-0000-0000-000000000000'::uuid, 'All locations',
         'Unusual task volume today',
         v.today_total, round(v.average, 1), 'tasks',
         'Today has ' || v.today_total || ' tasks; the same weekday averaged ' || round(v.average, 1) || ' over the last ' || v.weeks || ' weeks.',
         'task-volume:' || (select d from today)
    from (
      select (select count(*) from f, today where f.is_eligible and f.task_date = today.d)::numeric as today_total,
             avg(c.n) as average, count(*) as weeks
        from (
          select g::date as day, (select count(*) from f where f.is_eligible and f.task_date = g::date) as n
            from today, generate_series(today.d - 56, today.d - 7, interval '7 days') g
        ) c
    ) v
   where v.weeks >= 4 and v.average >= 3 and v.today_total >= 2 * v.average
  union all
  -- 6. A burst of failed outgoing messages.
  select 'COMMUNICATION_FAILURES', 'medium', 'ORGANISATION', '00000000-0000-0000-0000-000000000000'::uuid, 'Notifications',
         'Several messages could not be delivered',
         q.n::numeric, 0, 'failed messages',
         q.n || ' outgoing messages failed in the last 24 hours. Check the e-mail provider and the delivery log.',
         'communication-failures:' || (select d from today)
    from (select count(*) as n from public.communication_queue where status = 'FAILED' and failed_at >= now() - interval '24 hours') q
   where q.n >= 3 and (select public.ai_caller_allowed())
$$;

-- ---------------------------------------------------------------------------
-- 4. Writing results (admin or the scheduled job only)
-- ---------------------------------------------------------------------------
-- Starts a run, or refuses if one of the same kind started too recently.
create or replace function public.ai_begin_run(p_kind text, p_trigger text, p_min_interval_seconds integer default 30)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.ai_caller_allowed() then
    raise exception using errcode = '42501', message = 'NOT_ALLOWED';
  end if;
  if not public.ai_feature_enabled('ai_enabled') then
    raise exception using errcode = 'P0001', message = 'AI_DISABLED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_run:' || p_kind, 0));
  if exists (select 1 from public.ai_runs where kind = p_kind
              and started_at > now() - make_interval(secs => greatest(coalesce(p_min_interval_seconds, 30), 0))) then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;
  insert into public.ai_runs (kind, trigger, started_by) values (p_kind, p_trigger, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.ai_finish_run(
  p_run uuid, p_status text, p_predictions integer default 0, p_insufficient integer default 0, p_recommendations integer default 0,
  p_provider text default null, p_model text default null, p_input_tokens integer default null, p_output_tokens integer default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.ai_caller_allowed() then
    raise exception using errcode = '42501', message = 'NOT_ALLOWED';
  end if;
  update public.ai_runs
     set status = p_status, finished_at = now(),
         duration_ms = (extract(epoch from now() - started_at) * 1000)::integer,
         predictions = coalesce(p_predictions, 0), insufficient = coalesce(p_insufficient, 0),
         recommendations = coalesce(p_recommendations, 0),
         provider = p_provider, model = p_model, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
         error = left(p_error, 500)
   where id = p_run and status = 'RUNNING';
  if found and p_status = 'SUCCEEDED' then
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, new_values)
    select auth.uid(), 'AI_PREDICTION_GENERATED', 'AI_RUN', p_run,
           jsonb_build_object('kind', kind, 'predictions', predictions, 'insufficient', insufficient, 'recommendations', recommendations)
      from public.ai_runs where id = p_run;
  end if;
end;
$$;

-- Stores predictions. A result identical to the current one refreshes it instead of adding a row.
create or replace function public.ai_store_predictions(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item  jsonb;
  v_last  public.ai_predictions%rowtype;
  v_count integer := 0;
  v_expires timestamptz;
begin
  if not public.ai_caller_allowed() then
    raise exception using errcode = '42501', message = 'NOT_ALLOWED';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) > 2000 then
    raise exception using errcode = 'P0001', message = 'INVALID_ITEMS';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_expires := now() + make_interval(mins => greatest(1, least(coalesce((v_item ->> 'ttl_minutes')::int, 30), 10080)));
    select * into v_last from public.ai_predictions
     where prediction_type = v_item ->> 'prediction_type' and entity_type = v_item ->> 'entity_type'
       and entity_id = (v_item ->> 'entity_id')::uuid
       -- several anomalies can concern the same entity: match each by its own key
       and (prediction_type <> 'ANOMALY' or fingerprint = v_item ->> 'fingerprint')
     order by generated_at desc limit 1;
    if found and v_last.fingerprint = v_item ->> 'fingerprint' and v_last.outcome is null
       and v_last.model_version = v_item ->> 'model_version' then
      update public.ai_predictions
         set generated_at = clock_timestamp(), expires_at = v_expires, prediction_value = v_item -> 'value',
             explanation = coalesce(v_item -> 'explanation', '{}'::jsonb), confidence = (v_item ->> 'confidence')::numeric
       where id = v_last.id;
    else
      insert into public.ai_predictions (prediction_type, entity_type, entity_id, prediction_value, confidence, model_name,
                                         model_version, feature_version, explanation, fingerprint, expires_at, generated_at)
      values (v_item ->> 'prediction_type', v_item ->> 'entity_type', (v_item ->> 'entity_id')::uuid, v_item -> 'value',
              (v_item ->> 'confidence')::numeric, v_item ->> 'model_name', v_item ->> 'model_version', v_item ->> 'feature_version',
              coalesce(v_item -> 'explanation', '{}'::jsonb), v_item ->> 'fingerprint', v_expires, clock_timestamp());
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Stores recommendations (once each) and retires pending ones that no longer apply.
create or replace function public.ai_store_recommendations(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item  jsonb;
  v_id    uuid;
  v_count integer := 0;
begin
  if not public.ai_caller_allowed() then
    raise exception using errcode = '42501', message = 'NOT_ALLOWED';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) > 500 then
    raise exception using errcode = 'P0001', message = 'INVALID_ITEMS';
  end if;
  -- A recommendation about a task that is finished, or that nobody reviewed in 3 days, is no longer useful.
  update public.ai_recommendations r
     set status = 'EXPIRED'
   where r.status = 'PENDING'
     and (r.created_at < now() - interval '3 days'
          or (r.entity_type = 'TASK' and exists (
                select 1 from public.tasks t where t.id = r.entity_id
                   and t.status not in ('ASSIGNED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'CHECKED_IN', 'IN_PROGRESS'))));
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.ai_recommendations (recommendation_type, entity_type, entity_id, title, description, reasoning, confidence,
                                           dedupe_key, model_name, model_version)
    values (v_item ->> 'recommendation_type', v_item ->> 'entity_type', (v_item ->> 'entity_id')::uuid, left(v_item ->> 'title', 200),
            left(v_item ->> 'description', 1000), coalesce(v_item -> 'reasoning', '{}'::jsonb), (v_item ->> 'confidence')::numeric,
            v_item ->> 'dedupe_key', v_item ->> 'model_name', v_item ->> 'model_version')
    on conflict (dedupe_key) do nothing
    returning id into v_id;
    if v_id is not null then
      v_count := v_count + 1;
      insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, new_values)
      values (auth.uid(), 'AI_RECOMMENDATION_CREATED', 'AI_RECOMMENDATION', v_id,
              jsonb_build_object('recommendation_type', v_item ->> 'recommendation_type', 'entity_id', v_item ->> 'entity_id'));
    end if;
    v_id := null;
  end loop;
  return v_count;
end;
$$;

create or replace function public.ai_store_summary(
  p_period date, p_content jsonb, p_facts jsonb, p_provider text, p_model text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.ai_caller_allowed() then
    raise exception using errcode = '42501', message = 'NOT_ALLOWED';
  end if;
  if jsonb_typeof(p_content -> 'summary') <> 'string' or jsonb_typeof(p_content -> 'observations') <> 'array'
     or jsonb_typeof(p_content -> 'attention_items') <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_SUMMARY';
  end if;
  insert into public.ai_summaries (period, content, facts, provider, model, generated_by)
  values (p_period, p_content, p_facts, p_provider, p_model, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Ground truth for later evaluation: what actually happened to a task that had predictions.
create or replace function public.ai_record_outcomes(p_tz text default 'Asia/Kolkata')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.ai_caller_allowed() then
    raise exception using errcode = '42501', message = 'NOT_ALLOWED';
  end if;
  update public.ai_predictions p
     set outcome = jsonb_build_object(
           'status', t.status,
           'completed_at', t.completed_at,
           'failed', t.status = 'FAILED',
           'late', case when t.completed_at is not null and t.scheduled_date is not null
                        then (t.completed_at at time zone p_tz)
                             > t.scheduled_date + coalesce(t.scheduled_end_time, t.scheduled_start_time, time '23:59:59') end,
           'eta_error_minutes', case when p.prediction_type = 'TASK_ETA' and t.completed_at is not null
                                       and p.prediction_value ->> 'eta' is not null
                                     then round((extract(epoch from t.completed_at - (p.prediction_value ->> 'eta')::timestamptz) / 60)::numeric, 1) end),
         evaluated_at = now()
    from public.tasks t
   where p.entity_type = 'TASK' and p.entity_id = t.id and p.outcome is null
     and p.prediction_type in ('TASK_DELAY_RISK', 'TASK_FAILURE_RISK', 'TASK_ETA')
     and t.status in ('COMPLETED', 'VERIFIED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Human decisions (admin only). None of these touches an operational table.
-- ---------------------------------------------------------------------------
create or replace function public.ai_review_recommendation(p_id uuid, p_decision text, p_notes text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'NOT_ADMIN';
  end if;
  if p_decision not in ('ACCEPTED', 'REJECTED') then
    raise exception using errcode = 'P0001', message = 'INVALID_DECISION';
  end if;
  if char_length(coalesce(v_notes, '')) > 500 then
    raise exception using errcode = 'P0001', message = 'TEXT_TOO_LONG';
  end if;
  -- Accepting acknowledges the recommendation. It performs no action on the task.
  update public.ai_recommendations
     set status = p_decision, reviewed_at = now(), reviewed_by = auth.uid(), review_notes = v_notes
   where id = p_id and status = 'PENDING';
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_PENDING';
  end if;
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, new_values)
  values (auth.uid(), 'AI_RECOMMENDATION_' || p_decision, 'AI_RECOMMENDATION', p_id, jsonb_build_object('status', p_decision));
  return p_decision;
end;
$$;

create or replace function public.ai_submit_feedback(p_prediction_id uuid, p_rating text, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'NOT_ADMIN';
  end if;
  if p_rating not in ('USEFUL', 'NOT_USEFUL', 'INCORRECT') then
    raise exception using errcode = 'P0001', message = 'INVALID_RATING';
  end if;
  if char_length(coalesce(v_notes, '')) > 500 then
    raise exception using errcode = 'P0001', message = 'TEXT_TOO_LONG';
  end if;
  if not exists (select 1 from public.ai_predictions where id = p_prediction_id) then
    raise exception using errcode = 'P0001', message = 'PREDICTION_NOT_FOUND';
  end if;
  insert into public.ai_feedback (prediction_id, user_id, rating, notes)
  values (p_prediction_id, auth.uid(), p_rating, v_notes)
  on conflict (prediction_id, user_id) do update set rating = excluded.rating, notes = excluded.notes, created_at = now()
  returning id into v_id;
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, new_values)
  values (auth.uid(), 'AI_FEEDBACK_SUBMITTED', 'AI_FEEDBACK', v_id, jsonb_build_object('prediction_id', p_prediction_id, 'rating', p_rating));
  return v_id;
end;
$$;

create or replace function public.ai_set_setting(p_key text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'NOT_ADMIN';
  end if;
  select enabled into v_old from public.ai_settings where key = p_key for update;
  if not found or p_enabled is null then
    raise exception using errcode = 'P0001', message = 'UNKNOWN_SETTING';
  end if;
  if v_old is distinct from p_enabled then
    update public.ai_settings set enabled = p_enabled, updated_at = now(), updated_by = auth.uid() where key = p_key;
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values)
    values (auth.uid(), 'AI_SETTINGS_CHANGED', 'AI_SETTING', null,
            jsonb_build_object('key', p_key, 'enabled', v_old), jsonb_build_object('key', p_key, 'enabled', p_enabled));
  end if;
  return p_enabled;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Views (security_invoker: RLS applies — admins only)
-- ---------------------------------------------------------------------------
-- The newest prediction of each kind for each entity, and whether it is past its freshness limit.
create or replace view public.ai_current_predictions
with (security_invoker = true) as
select distinct on (p.prediction_type, p.entity_type, p.entity_id)
  p.id, p.prediction_type, p.entity_type, p.entity_id, p.prediction_value, p.confidence, p.model_name, p.model_version,
  p.feature_version, p.explanation, p.generated_at, p.expires_at, p.outcome,
  (p.expires_at is not null and p.expires_at < now()) as is_stale
from public.ai_predictions p
order by p.prediction_type, p.entity_type, p.entity_id, p.generated_at desc;

-- Evaluation foundation: predictions whose real outcome is known, per model version.
-- Figures are counts and errors only; no accuracy is claimed from them here.
create or replace view public.ai_evaluation
with (security_invoker = true) as
select
  p.prediction_type, p.model_name, p.model_version,
  count(*) as predictions,
  count(*) filter (where p.outcome is not null) as evaluated,
  count(*) filter (where p.prediction_type = 'TASK_DELAY_RISK' and p.prediction_value ->> 'level' = 'HIGH' and (p.outcome ->> 'late')::boolean) as high_and_late,
  count(*) filter (where p.prediction_type = 'TASK_DELAY_RISK' and p.prediction_value ->> 'level' = 'HIGH' and (p.outcome ->> 'late')::boolean = false) as high_not_late,
  count(*) filter (where p.prediction_type = 'TASK_DELAY_RISK' and p.prediction_value ->> 'level' in ('LOW', 'MEDIUM') and (p.outcome ->> 'late')::boolean) as not_high_but_late,
  count(*) filter (where p.prediction_type = 'TASK_DELAY_RISK' and p.prediction_value ->> 'level' in ('LOW', 'MEDIUM') and (p.outcome ->> 'late')::boolean = false) as not_high_not_late,
  count(*) filter (where p.prediction_type = 'TASK_FAILURE_RISK' and p.prediction_value ->> 'level' = 'HIGH' and (p.outcome ->> 'failed')::boolean) as high_and_failed,
  count(*) filter (where p.prediction_type = 'TASK_FAILURE_RISK' and (p.outcome ->> 'failed')::boolean) as failed_total,
  round(avg(abs((p.outcome ->> 'eta_error_minutes')::numeric)) filter (where p.prediction_type = 'TASK_ETA'), 1) as eta_mean_abs_error_minutes,
  count(*) filter (where p.prediction_type = 'TASK_ETA' and p.outcome ->> 'eta_error_minutes' is not null) as eta_evaluated
from public.ai_predictions p
where p.prediction_type in ('TASK_DELAY_RISK', 'TASK_FAILURE_RISK', 'TASK_ETA') and p.prediction_value ->> 'available' = 'true'
group by p.prediction_type, p.model_name, p.model_version;

revoke all on public.ai_current_predictions, public.ai_evaluation from anon, authenticated;
grant select on public.ai_current_predictions, public.ai_evaluation to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Function privileges
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname like 'ai\_%'
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;

-- The scheduled job computes features with the service role.
grant execute on function public.report_task_facts(date, date, text, uuid, public.task_type, public.task_status, uuid, uuid, integer) to service_role;

commit;
