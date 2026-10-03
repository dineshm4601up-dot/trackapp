-- Phase 7: GPS check-in with server-side geofence validation.
--
-- Idempotent and non-destructive. Reuses the Phase 3 `checkins` table. Adds:
--   * app_settings          — check-in thresholds, read by the database itself
--                             (never accepted from the caller);
--   * haversine_meters()    — great-circle distance (no PostGIS needed);
--   * one successful check-in per task (partial unique index);
--   * agent_check_in()      — the ONLY way to reach CHECKED_IN;
--   * audit action TASK_CHECK_IN.
--
-- The client sends only raw GPS readings (lat, lng, accuracy, timestamp).
-- Distance, radius and inside/outside are computed here from the task's
-- location in the database.

begin;

-- ===========================================================================
-- 1. Settings (operator-managed; read by functions, never by the browser)
-- ===========================================================================
create table if not exists public.app_settings (
  key         text primary key,
  value       numeric not null,
  description text not null,
  updated_at  timestamptz not null default now()
);

insert into public.app_settings (key, value, description) values
  ('checkin_max_accuracy_meters', 100,
   'Reject a check-in when the device reports GPS accuracy worse than this (metres).'),
  ('checkin_max_location_age_seconds', 300,
   'Reject a GPS reading older than this (seconds), based on the device timestamp.'),
  ('checkin_max_clock_skew_seconds', 120,
   'Tolerate a device clock this far ahead of the server (seconds).'),
  ('checkin_max_geofence_radius_meters', 5000,
   'Locations with a larger radius are treated as misconfigured (metres).')
on conflict (key) do nothing;

drop trigger if exists app_settings_updated_at on public.app_settings;
create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
drop policy if exists "Admins can view settings" on public.app_settings;
create policy "Admins can view settings" on public.app_settings
  for select to authenticated using ((select public.is_admin()));

create or replace function public.app_setting(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.app_settings where key = p_key), p_default)
$$;
revoke execute on function public.app_setting(text, numeric) from public, anon, authenticated;

-- ===========================================================================
-- 2. Distance
-- ===========================================================================
-- Haversine great-circle distance in metres (mean Earth radius 6,371,008.8 m).
-- Accurate to well under a metre at geofence scales.
create or replace function public.haversine_meters(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
         )))
$$;

-- ===========================================================================
-- 3. At most one successful check-in per task
-- ===========================================================================
-- Rejected (outside-geofence) attempts are kept as evidence; only one row per
-- task may be a successful check-in.
create unique index if not exists checkins_one_success_per_task
  on public.checkins (task_id) where is_within_geofence;

-- ===========================================================================
-- 4. agent_check_in()
-- ===========================================================================
-- Errors (raised, nothing is written):
--   UNAUTHORIZED, TASK_NOT_FOUND, CHECKIN_ALREADY_EXISTS, INVALID_TASK_STATUS,
--   INVALID_COORDINATES, INVALID_ACCURACY, GPS_ACCURACY_TOO_LOW, STALE_LOCATION,
--   INVALID_LOCATION_CONFIGURATION, TEXT_TOO_LONG
-- Results (returned, committed):
--   {"result":"CHECKED_IN", ...}       check-in row + ARRIVED → CHECKED_IN
--   {"result":"OUTSIDE_GEOFENCE", ...} rejected attempt row only; task stays ARRIVED
create or replace function public.agent_check_in(
  p_task_id     uuid,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy    double precision,
  p_captured_at timestamptz,
  p_device_id   text default null,
  p_notes       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent        uuid := public.current_agent_id();
  v_task         public.tasks%rowtype;
  v_loc          record;
  v_max_accuracy numeric := public.app_setting('checkin_max_accuracy_meters', 100);
  v_max_age      numeric := public.app_setting('checkin_max_location_age_seconds', 300);
  v_max_skew     numeric := public.app_setting('checkin_max_clock_skew_seconds', 120);
  v_max_radius   numeric := public.app_setting('checkin_max_geofence_radius_meters', 5000);
  v_distance     numeric;
  v_within       boolean;
  v_checked_at   timestamptz := now();
  v_notes        text := nullif(btrim(coalesce(p_notes, '')), '');
  v_device       text := nullif(btrim(coalesce(p_device_id, '')), '');
begin
  -- 1. Who: an active agent (active profile + active agent record).
  if v_agent is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  -- 2. Which task: own, released task. Row lock serialises concurrent attempts.
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or v_task.agent_id is distinct from v_agent or v_task.status = 'DRAFT' then
    raise exception using errcode = 'P0001', message = 'TASK_NOT_FOUND';
  end if;

  -- 3. Current status, read inside the lock (stale screens can't win).
  if exists (select 1 from public.checkins where task_id = p_task_id and is_within_geofence) then
    raise exception using errcode = 'P0001', message = 'CHECKIN_ALREADY_EXISTS';
  end if;
  if v_task.status <> 'ARRIVED' then
    raise exception using errcode = 'P0001', message = 'INVALID_TASK_STATUS';
  end if;

  -- 4. Raw GPS reading. NaN / ±Infinity fail the range checks.
  if p_latitude is null or p_longitude is null
     or not (p_latitude between -90 and 90) or not (p_longitude between -180 and 180) then
    raise exception using errcode = 'P0001', message = 'INVALID_COORDINATES';
  end if;
  if p_accuracy is null or not (p_accuracy >= 0 and p_accuracy < 'Infinity'::double precision) then
    raise exception using errcode = 'P0001', message = 'INVALID_ACCURACY';
  end if;
  if p_accuracy > v_max_accuracy then
    raise exception using errcode = 'P0001', message = 'GPS_ACCURACY_TOO_LOW';
  end if;
  if p_captured_at is null
     or p_captured_at < v_checked_at - make_interval(secs => v_max_age)
     or p_captured_at > v_checked_at + make_interval(secs => v_max_skew) then
    raise exception using errcode = 'P0001', message = 'STALE_LOCATION';
  end if;
  if char_length(coalesce(v_notes, '')) > 500 or char_length(coalesce(v_device, '')) > 100 then
    raise exception using errcode = 'P0001', message = 'TEXT_TOO_LONG';
  end if;

  -- 5. Target from the database (never from the caller).
  select l.latitude, l.longitude, l.geofence_radius_meters as radius
    into v_loc
    from public.locations l
   where l.id = v_task.location_id;
  if not found or v_loc.latitude is null or v_loc.longitude is null
     or v_loc.radius is null or v_loc.radius <= 0 or v_loc.radius > v_max_radius then
    raise exception using errcode = 'P0001', message = 'INVALID_LOCATION_CONFIGURATION';
  end if;

  -- 6. Distance and geofence decision, server-side.
  v_distance := round(public.haversine_meters(v_loc.latitude::double precision, v_loc.longitude::double precision,
                                              p_latitude, p_longitude)::numeric, 2);
  v_within := v_distance <= v_loc.radius;

  insert into public.checkins (
    task_id, agent_id, latitude, longitude, accuracy_meters,
    distance_from_location_meters, geofence_radius_meters, is_within_geofence,
    checked_in_at, device_id, notes
  ) values (
    p_task_id, v_agent, round(p_latitude::numeric, 7), round(p_longitude::numeric, 7), round(p_accuracy::numeric, 2),
    v_distance, v_loc.radius, v_within, v_checked_at, v_device, v_notes
  );

  if not v_within then
    -- Attempt recorded as evidence; the task stays ARRIVED.
    return jsonb_build_object('result', 'OUTSIDE_GEOFENCE',
      'distance_meters', v_distance, 'radius_meters', v_loc.radius);
  end if;

  -- 7. Transition (history + audit via triggers, with the agent as actor).
  perform set_config('app.status_change_reason', 'GPS geofence check-in', true);
  perform set_config('app.status_change_notes',
    format('Within %s m of the location (allowed %s m, GPS accuracy ±%s m)',
           round(v_distance), v_loc.radius, round(p_accuracy::numeric)), true);
  update public.tasks set status = 'CHECKED_IN' where id = p_task_id;
  perform set_config('app.status_change_reason', '', true);
  perform set_config('app.status_change_notes', '', true);

  return jsonb_build_object('result', 'CHECKED_IN', 'checked_in_at', v_checked_at,
    'distance_meters', v_distance, 'radius_meters', v_loc.radius);
end;
$$;

revoke execute on function public.agent_check_in(uuid, double precision, double precision, double precision, timestamptz, text, text)
  from public, anon;
grant execute on function public.agent_check_in(uuid, double precision, double precision, double precision, timestamptz, text, text)
  to authenticated;

-- ===========================================================================
-- 5. Audit name for the check-in transition
-- ===========================================================================
-- Same as Phase 6, with CHECKED_IN → TASK_CHECK_IN.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entity    text := tg_argv[0];
  old_row   jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_row   jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  old_diff  jsonb;
  new_diff  jsonb;
  keys      text[];
  action    text;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, old_row -> n.key), jsonb_object_agg(n.key, n.value)
      into old_diff, new_diff
      from jsonb_each(new_row) n
     where n.key <> 'updated_at' and n.value is distinct from old_row -> n.key;
    if new_diff is null then
      return null; -- no-op update
    end if;
    select array_agg(k order by k) into keys from jsonb_object_keys(new_diff) k;

    action := case
      when entity = 'TASK' and new_diff ? 'status' then
        case new_diff ->> 'status'
          when 'ASSIGNED'            then case when old_diff ->> 'status' = 'DRAFT' then 'ASSIGN_TASK' else 'UPDATE_TASK' end
          when 'ACCEPTED'            then 'ACCEPT_TASK'
          when 'ON_THE_WAY'          then 'START_TRAVEL'
          when 'ARRIVED'             then 'MARK_ARRIVED'
          when 'CHECKED_IN'          then 'TASK_CHECK_IN'
          when 'IN_PROGRESS'         then 'START_TASK'
          when 'COMPLETED'           then 'COMPLETE_TASK'
          when 'PARTIALLY_COMPLETED' then 'PARTIALLY_COMPLETE_TASK'
          when 'FAILED'              then 'REPORT_TASK_FAILURE'
          when 'CANCELLED'           then 'CANCEL_TASK'
          when 'VERIFIED'            then 'VERIFY_TASK'
          else 'UPDATE_TASK'
        end
      when entity = 'TASK' and new_diff ? 'agent_id' then 'REASSIGN_TASK'
      when entity = 'TASK'
           and keys <@ array['scheduled_date', 'scheduled_start_time', 'scheduled_end_time'] then 'RESCHEDULE_TASK'
      when entity = 'TASK_PRODUCT' then 'UPDATE_TASK_PRODUCT'
      when keys = array['is_active'] then
        case when (new_diff ->> 'is_active')::boolean then 'ACTIVATE_' else 'DEACTIVATE_' end || entity
      else 'UPDATE_' || entity
    end;
  else
    old_diff := old_row - 'updated_at';
    new_diff := new_row - 'updated_at';
    action := case
      when entity = 'TASK_PRODUCT' and tg_op = 'INSERT' then 'ADD_TASK_PRODUCT'
      when entity = 'TASK_PRODUCT' and tg_op = 'DELETE' then 'REMOVE_TASK_PRODUCT'
      when tg_op = 'INSERT' then 'CREATE_' || entity
      else 'DELETE_' || entity
    end;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values)
  values (auth.uid(), action, entity, (coalesce(new_row, old_row) ->> 'id')::uuid, old_diff, new_diff);
  return null;
end;
$$;

revoke execute on function public.audit_row_change() from public, anon, authenticated;

commit;
