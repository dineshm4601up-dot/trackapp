-- ===========================================================================
-- Phase 10 — notifications & communication
--
--   business change (task status, assignment, cash, proof)
--        ↓  trigger, same transaction
--   publish_notification(): recipient → preferences → idempotent in-app row
--        ↓  (+ outbox row for e-mail when the type and preferences call for it)
--   communication_queue  ──►  server-side dispatcher (provider adapters)
--                               claim_communications() / complete_communication()
--
-- * Notifications are created only by these SECURITY DEFINER functions; no
--   app user can insert, retarget or delete one. Users mark their own as read
--   through mark_notification_read() / mark_all_notifications_read().
-- * No provider is ever called from the database: an outbox row is written in
--   the transaction and sent afterwards. A provider failure cannot undo a task.
-- * A failure inside notification code is caught and logged as a warning; it
--   never blocks the task operation that caused it.
--
-- Idempotent. No existing table, policy or data is changed or removed.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('communication_max_attempts', 3, 'An external message is tried at most this many times before it is marked FAILED.'),
  ('communication_max_age_hours', 24, 'A queued message older than this is cancelled instead of being sent late.'),
  ('reminder_lead_minutes', 60, 'Remind the agent this long before a task''s scheduled start (minutes).'),
  ('reminder_overdue_minutes', 30, 'A task not started this long after its scheduled time is reported as overdue (minutes).'),
  ('channel_sms_enabled', 0, '1 = queue SMS messages (requires an SMS provider on the server).'),
  ('channel_whatsapp_enabled', 0, '1 = queue WhatsApp messages (requires a WhatsApp provider on the server).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  task_id           uuid references public.tasks (id) on delete set null,
  type              text not null,
  title             text not null,
  message           text not null,
  -- Display snapshot (task code, customer, schedule, link path). Never secrets,
  -- coordinates, amounts or contact details.
  data              jsonb not null default '{}'::jsonb,
  -- One notification per recipient per business event.
  dedupe_key        text not null,
  is_read           boolean not null default false,
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  constraint notifications_type_known check (type in (
    'TASK_ASSIGNED', 'TASK_REASSIGNED', 'TASK_ACCEPTED', 'TASK_ON_THE_WAY', 'TASK_ARRIVED', 'TASK_CHECKED_IN',
    'TASK_STARTED', 'TASK_COMPLETED', 'TASK_PARTIALLY_COMPLETED', 'TASK_FAILED', 'TASK_CANCELLED',
    'TASK_RESCHEDULED', 'TASK_VERIFIED', 'CASH_COLLECTION_RECORDED', 'PROOF_UPLOADED', 'TASK_REMINDER', 'SYSTEM')),
  constraint notifications_title_length check (char_length(title) between 1 and 200),
  constraint notifications_message_length check (char_length(message) between 1 and 1000),
  constraint notifications_read_consistent check (is_read = (read_at is not null)),
  constraint notifications_dedupe unique (recipient_user_id, dedupe_key)
);

create index if not exists idx_notifications_recipient_created
  on public.notifications (recipient_user_id, created_at desc);
create index if not exists idx_notifications_recipient_unread
  on public.notifications (recipient_user_id, created_at desc) where not is_read;
create index if not exists idx_notifications_task on public.notifications (task_id);
create index if not exists idx_notifications_type_created on public.notifications (type, created_at desc);
create index if not exists idx_notifications_created on public.notifications (created_at desc);

-- Outbox and delivery history for external channels (one row per message).
create table if not exists public.communication_queue (
  id                  uuid primary key default gen_random_uuid(),
  notification_id     uuid references public.notifications (id) on delete set null,
  recipient_user_id   uuid references public.profiles (id) on delete set null,
  channel             text not null,
  provider            text,
  recipient_address   text not null,
  subject             text,
  message             text not null,
  payload             jsonb not null default '{}'::jsonb,
  status              text not null default 'PENDING',
  attempt_count       integer not null default 0,
  provider_message_id text,
  scheduled_at        timestamptz not null default now(),
  sent_at             timestamptz,
  failed_at           timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint communication_queue_channel_known check (channel in ('EMAIL', 'SMS', 'WHATSAPP')),
  constraint communication_queue_status_known check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED')),
  constraint communication_queue_attempts_non_negative check (attempt_count >= 0),
  constraint communication_queue_one_per_channel unique (notification_id, channel)
);

create index if not exists idx_communication_queue_due
  on public.communication_queue (scheduled_at) where status in ('PENDING', 'PROCESSING');
create index if not exists idx_communication_queue_created on public.communication_queue (created_at desc);
create index if not exists idx_communication_queue_status_created on public.communication_queue (status, created_at desc);

drop trigger if exists communication_queue_updated_at on public.communication_queue;
create trigger communication_queue_updated_at
  before update on public.communication_queue
  for each row execute function public.set_updated_at();

create table if not exists public.notification_preferences (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references public.profiles (id) on delete cascade,
  email_enabled    boolean not null default true,
  sms_enabled      boolean not null default false,
  whatsapp_enabled boolean not null default false,
  task_assignment  boolean not null default true,
  task_status      boolean not null default true,
  task_reminder    boolean not null default true,
  cash_collection  boolean not null default true,
  proof_upload     boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists notification_preferences_audit on public.notification_preferences;
create trigger notification_preferences_audit
  after insert or update on public.notification_preferences
  for each row execute function public.audit_row_change('NOTIFICATION_PREFERENCES');

-- ---------------------------------------------------------------------------
-- 3. Row Level Security and grants
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.communication_queue enable row level security;
alter table public.notification_preferences enable row level security;

revoke all on public.notifications, public.communication_queue, public.notification_preferences from anon, authenticated;
-- Read only: creation, read-marking and delivery all go through functions.
grant select on public.notifications to authenticated;
grant select on public.communication_queue to authenticated;
grant select on public.notification_preferences to authenticated;
grant insert (user_id, email_enabled, sms_enabled, whatsapp_enabled, task_assignment, task_status, task_reminder,
              cash_collection, proof_upload) on public.notification_preferences to authenticated;
grant update (email_enabled, sms_enabled, whatsapp_enabled, task_assignment, task_status, task_reminder,
              cash_collection, proof_upload) on public.notification_preferences to authenticated;

drop policy if exists "Users can view own notifications" on public.notifications;
create policy "Users can view own notifications" on public.notifications
  for select to authenticated
  using (recipient_user_id = (select auth.uid()) and (select public.get_my_role()) is not null);

drop policy if exists "Admins can view notifications" on public.notifications;
create policy "Admins can view notifications" on public.notifications
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admins can view communication_queue" on public.communication_queue;
create policy "Admins can view communication_queue" on public.communication_queue
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Users can view own notification preferences" on public.notification_preferences;
create policy "Users can view own notification preferences" on public.notification_preferences
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.get_my_role()) is not null);

drop policy if exists "Users can create own notification preferences" on public.notification_preferences;
create policy "Users can create own notification preferences" on public.notification_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.get_my_role()) is not null);

drop policy if exists "Users can update own notification preferences" on public.notification_preferences;
create policy "Users can update own notification preferences" on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.get_my_role()) is not null)
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Publishing
-- ---------------------------------------------------------------------------
create or replace function public.notification_category(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type in ('TASK_ASSIGNED', 'TASK_REASSIGNED') then 'task_assignment'
    when p_type = 'TASK_REMINDER' then 'task_reminder'
    when p_type = 'CASH_COLLECTION_RECORDED' then 'cash_collection'
    when p_type = 'PROOF_UPLOADED' then 'proof_upload'
    when p_type = 'SYSTEM' then 'system'
    else 'task_status'
  end
$$;

-- Display snapshot of a task for one recipient. The link path depends on the
-- recipient's role, never on anything a client sends.
create or replace function public.notification_task_data(p_task_id uuid, p_recipient uuid, p_link boolean default true)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'task_code', t.task_code,
    'task_type', t.task_type,
    'task_title', t.title,
    'customer', c.name,
    'location', l.location_name,
    'city', l.city,
    'scheduled_date', t.scheduled_date,
    'scheduled_start_time', t.scheduled_start_time,
    'priority', t.priority,
    'path', case
      when not p_link then case when p.role = 'ADMIN' then '/admin/tasks' else '/agent/tasks' end
      when p.role = 'ADMIN' then '/admin/tasks/' || t.id
      else '/agent/tasks/' || t.id
    end))
  from public.tasks t
  join public.profiles p on p.id = p_recipient
  left join public.customers c on c.id = t.customer_id
  left join public.locations l on l.id = t.location_id
  where t.id = p_task_id
$$;

-- The single place a notification is created.
create or replace function public.publish_notification(
  p_recipient uuid,
  p_type      text,
  p_task_id   uuid,
  p_title     text,
  p_message   text,
  p_dedupe    text,
  p_link      boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile  public.profiles%rowtype;
  v_prefs    public.notification_preferences%rowtype;
  v_category text := public.notification_category(p_type);
  -- Always delivered in-app: the recipient must know their work changed.
  v_critical boolean := p_type in ('TASK_ASSIGNED', 'TASK_REASSIGNED', 'TASK_CANCELLED', 'SYSTEM');
  v_wanted   boolean;
  v_data     jsonb;
  v_id       uuid;
  v_subject  text;
begin
  if p_recipient is null then
    return null;
  end if;
  select * into v_profile from public.profiles where id = p_recipient and is_active;
  if not found then
    return null;
  end if;

  select * into v_prefs from public.notification_preferences where user_id = p_recipient;
  v_wanted := not found or case v_category
    when 'task_assignment' then v_prefs.task_assignment
    when 'task_status'     then v_prefs.task_status
    when 'task_reminder'   then v_prefs.task_reminder
    when 'cash_collection' then v_prefs.cash_collection
    when 'proof_upload'    then v_prefs.proof_upload
    else true
  end;
  if not (v_critical or v_wanted) then
    return null;
  end if;

  v_data := coalesce(public.notification_task_data(p_task_id, p_recipient, p_link), '{}'::jsonb);

  insert into public.notifications (recipient_user_id, task_id, type, title, message, data, dedupe_key)
  values (p_recipient, p_task_id, p_type, p_title, p_message, v_data, p_dedupe)
  on conflict (recipient_user_id, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    return null; -- this event was already published to this recipient
  end if;

  -- External channels: only for events worth a message outside the app, only
  -- if the recipient wants them. Sent later by the dispatcher (outbox).
  if v_wanted and p_type in ('TASK_ASSIGNED', 'TASK_REASSIGNED', 'TASK_COMPLETED', 'TASK_PARTIALLY_COMPLETED', 'TASK_FAILED',
                             'TASK_CANCELLED', 'TASK_RESCHEDULED', 'TASK_VERIFIED', 'TASK_REMINDER') then
    v_subject := p_title || coalesce(' — ' || (v_data ->> 'task_code'), '');
    if coalesce(v_prefs.email_enabled, true) and nullif(btrim(coalesce(v_profile.email, '')), '') is not null then
      insert into public.communication_queue (notification_id, recipient_user_id, channel, recipient_address, subject, message, payload)
      values (v_id, p_recipient, 'EMAIL', v_profile.email, v_subject, p_message, v_data || jsonb_build_object('type', p_type, 'title', p_title))
      on conflict (notification_id, channel) do nothing;
    end if;
    if nullif(btrim(coalesce(v_profile.phone, '')), '') is not null then
      if coalesce(v_prefs.sms_enabled, false) and public.app_setting('channel_sms_enabled', 0) = 1 then
        insert into public.communication_queue (notification_id, recipient_user_id, channel, recipient_address, subject, message, payload)
        values (v_id, p_recipient, 'SMS', v_profile.phone, null, p_message, v_data || jsonb_build_object('type', p_type, 'title', p_title))
        on conflict (notification_id, channel) do nothing;
      end if;
      if coalesce(v_prefs.whatsapp_enabled, false) and public.app_setting('channel_whatsapp_enabled', 0) = 1 then
        insert into public.communication_queue (notification_id, recipient_user_id, channel, recipient_address, subject, message, payload)
        values (v_id, p_recipient, 'WHATSAPP', v_profile.phone, null, p_message, v_data || jsonb_build_object('type', p_type, 'title', p_title))
        on conflict (notification_id, channel) do nothing;
      end if;
    end if;
  end if;

  return v_id;
end;
$$;

-- Every active admin except the one who caused the event.
create or replace function public.notify_admins(
  p_type text, p_task_id uuid, p_title text, p_message text, p_dedupe text, p_except uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid;
  v_count integer := 0;
begin
  for v_admin in
    select id from public.profiles where role = 'ADMIN' and is_active and id is distinct from p_except
  loop
    if public.publish_notification(v_admin, p_type, p_task_id, p_title, p_message, p_dedupe) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.notification_category(text),
  public.notification_task_data(uuid, uuid, boolean),
  public.publish_notification(uuid, text, uuid, text, text, text, boolean),
  public.notify_admins(text, uuid, text, text, text, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Events (after the business change, in its transaction)
-- ---------------------------------------------------------------------------
-- Status events come from task_status_history: one row per real transition,
-- so its id is the idempotency key. Travel and arrival are not notified
-- (they are visible live on the monitoring board).
create or replace function public.notify_task_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task   public.tasks%rowtype;
  v_agent  uuid;   -- the assigned agent's user id
  v_name   text;
  v_code   text;
  v_key    text := 'status:' || new.id;
begin
  select * into v_task from public.tasks where id = new.task_id;
  if not found then
    return null;
  end if;
  v_code := 'Task #' || v_task.task_code;
  select a.profile_id, coalesce(p.full_name, 'The agent') into v_agent, v_name
    from public.agents a join public.profiles p on p.id = a.profile_id
   where a.id = v_task.agent_id;
  v_name := coalesce(v_name, 'The agent');

  case new.new_status
    when 'ASSIGNED' then
      if v_agent is distinct from new.changed_by then
        perform public.publish_notification(v_agent, 'TASK_ASSIGNED', v_task.id, 'New Task Assigned',
          v_code || ' has been assigned to you.', v_key);
      end if;
    when 'ACCEPTED' then
      perform public.notify_admins('TASK_ACCEPTED', v_task.id, 'Task Accepted',
        v_name || ' has accepted ' || lower(left(v_code, 1)) || substr(v_code, 2) || '.', v_key, new.changed_by);
    when 'CHECKED_IN' then
      perform public.notify_admins('TASK_CHECKED_IN', v_task.id, 'Agent Checked In',
        v_name || ' has checked in for ' || lower(left(v_code, 1)) || substr(v_code, 2) || '.', v_key, new.changed_by);
    when 'IN_PROGRESS' then
      perform public.notify_admins('TASK_STARTED', v_task.id, 'Task In Progress', v_code || ' has started.', v_key, new.changed_by);
    when 'COMPLETED' then
      perform public.notify_admins('TASK_COMPLETED', v_task.id, 'Task Completed', v_code || ' has been completed.', v_key, new.changed_by);
    when 'PARTIALLY_COMPLETED' then
      perform public.notify_admins('TASK_PARTIALLY_COMPLETED', v_task.id, 'Task Partially Completed',
        v_code || ' was partially completed.', v_key, new.changed_by);
    when 'FAILED' then
      perform public.notify_admins('TASK_FAILED', v_task.id, 'Task Failed', v_code || ' was marked as failed.', v_key, new.changed_by);
    when 'CANCELLED' then
      if v_agent is distinct from new.changed_by then
        perform public.publish_notification(v_agent, 'TASK_CANCELLED', v_task.id, 'Task Cancelled',
          v_code || ' has been cancelled.', v_key);
      end if;
    when 'RESCHEDULED' then
      if v_agent is distinct from new.changed_by then
        perform public.publish_notification(v_agent, 'TASK_RESCHEDULED', v_task.id, 'Task Rescheduled',
          v_code || ' has been rescheduled.', v_key);
      end if;
    when 'VERIFIED' then
      if v_agent is distinct from new.changed_by then
        perform public.publish_notification(v_agent, 'TASK_VERIFIED', v_task.id, 'Task Verified',
          v_code || ' has been verified.', v_key);
      end if;
    else
      null;
  end case;
  return null;
exception when others then
  -- A notification problem must never undo the task operation.
  raise warning 'notification for status event % failed: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists task_status_history_notify on public.task_status_history;
create trigger task_status_history_notify
  after insert on public.task_status_history
  for each row execute function public.notify_task_status_event();

-- Reassignment and schedule changes that do not change the status.
create or replace function public.notify_task_change_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_user uuid;
  v_new_user uuid;
  v_code     text := 'Task #' || new.task_code;
  v_stamp    text := extract(epoch from now())::text;
begin
  if new.status is distinct from old.status or new.status = 'DRAFT' then
    return null; -- status events are handled from the history
  end if;

  if new.agent_id is distinct from old.agent_id and new.status in ('ASSIGNED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED') then
    select profile_id into v_old_user from public.agents where id = old.agent_id;
    select profile_id into v_new_user from public.agents where id = new.agent_id;
    -- The previous agent learns only that the task is no longer theirs.
    perform public.publish_notification(v_old_user, 'TASK_REASSIGNED', new.id, 'Task Reassigned',
      v_code || ' is no longer assigned to you.', 'reassigned-from:' || new.id || ':' || v_stamp, false);
    perform public.publish_notification(v_new_user, 'TASK_ASSIGNED', new.id, 'New Task Assigned',
      v_code || ' has been assigned to you.', 'reassigned-to:' || new.id || ':' || v_stamp);
  elsif new.agent_id is not null
        and new.status in ('ASSIGNED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED')
        and (new.scheduled_date, new.scheduled_start_time, new.scheduled_end_time)
            is distinct from (old.scheduled_date, old.scheduled_start_time, old.scheduled_end_time) then
    select profile_id into v_new_user from public.agents where id = new.agent_id;
    if v_new_user is distinct from auth.uid() then
      perform public.publish_notification(v_new_user, 'TASK_RESCHEDULED', new.id, 'Task Rescheduled',
        v_code || ' has a new schedule.', 'schedule:' || new.id || ':' || v_stamp);
    end if;
  end if;
  return null;
exception when others then
  raise warning 'notification for task change % failed: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists tasks_notify_change on public.tasks;
create trigger tasks_notify_change
  after update on public.tasks
  for each row execute function public.notify_task_change_event();

create or replace function public.notify_execution_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  select 'task #' || task_code into v_code from public.tasks where id = new.task_id;
  if tg_table_name = 'cash_collections' then
    -- No amounts or references: the task page has the details.
    perform public.notify_admins('CASH_COLLECTION_RECORDED', new.task_id, 'Cash Collection Recorded',
      'Cash collection recorded for ' || v_code || '.', 'cash:' || new.id, auth.uid());
  else
    -- Once per task, however many files are uploaded.
    perform public.notify_admins('PROOF_UPLOADED', new.task_id, 'Proof Uploaded',
      'Proof was uploaded for ' || v_code || '.', 'proof:' || new.task_id, auth.uid());
  end if;
  return null;
exception when others then
  raise warning 'notification for % failed: %', tg_table_name, sqlerrm;
  return null;
end;
$$;

drop trigger if exists cash_collections_notify on public.cash_collections;
create trigger cash_collections_notify
  after insert on public.cash_collections
  for each row execute function public.notify_execution_event();

drop trigger if exists task_proofs_notify on public.task_proofs;
create trigger task_proofs_notify
  after insert on public.task_proofs
  for each row execute function public.notify_execution_event();

revoke execute on function public.notify_task_status_event(), public.notify_task_change_event(),
  public.notify_execution_event() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Reading
-- ---------------------------------------------------------------------------
create or replace function public.mark_notification_read(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if public.get_my_role() is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;
  update public.notifications set is_read = true, read_at = now()
   where id = p_id and recipient_user_id = auth.uid() and not is_read;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if public.get_my_role() is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;
  update public.notifications set is_read = true, read_at = now()
   where recipient_user_id = auth.uid() and not is_read;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function public.mark_notification_read(uuid), public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_notification_read(uuid), public.mark_all_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Outbox processing (server only: service_role)
-- ---------------------------------------------------------------------------
create or replace function public.claim_communications(p_limit integer default 20)
returns setof public.communication_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_age      numeric := public.app_setting('communication_max_age_hours', 24);
  v_max_attempts numeric := public.app_setting('communication_max_attempts', 3);
begin
  -- Never send something late: it would no longer be true or useful.
  update public.communication_queue
     set status = 'CANCELLED', last_error = 'Expired before it could be sent'
   where status = 'PENDING' and created_at < now() - make_interval(hours => v_max_age::int);

  -- A worker that died mid-send: give the message back, within the attempt limit.
  update public.communication_queue
     set status = case when attempt_count >= v_max_attempts then 'FAILED' else 'PENDING' end,
         failed_at = case when attempt_count >= v_max_attempts then now() end,
         last_error = 'Sending did not finish'
   where status = 'PROCESSING' and updated_at < now() - interval '10 minutes';

  return query
    with due as (
      select id from public.communication_queue
       where status = 'PENDING' and scheduled_at <= now()
       order by scheduled_at
       limit greatest(1, least(coalesce(p_limit, 20), 100))
       for update skip locked
    )
    update public.communication_queue q
       set status = 'PROCESSING', attempt_count = q.attempt_count + 1
      from due
     where q.id = due.id
    returning q.*;
end;
$$;

-- p_outcome: SENT | RETRY (temporary failure) | FAILED (permanent) | CANCELLED (channel not available)
create or replace function public.complete_communication(
  p_id uuid, p_outcome text, p_provider text default null, p_provider_message_id text default null, p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row          public.communication_queue%rowtype;
  v_max_attempts numeric := public.app_setting('communication_max_attempts', 3);
  v_status       text;
  v_error        text := left(nullif(btrim(coalesce(p_error, '')), ''), 500);
begin
  select * into v_row from public.communication_queue where id = p_id for update;
  if not found or v_row.status <> 'PROCESSING' then
    return null;
  end if;

  v_status := case
    when p_outcome = 'SENT' then 'SENT'
    when p_outcome = 'CANCELLED' then 'CANCELLED'
    when p_outcome = 'RETRY' and v_row.attempt_count < v_max_attempts then 'PENDING'
    else 'FAILED'
  end;

  update public.communication_queue
     set status = v_status,
         provider = coalesce(p_provider, provider),
         provider_message_id = case when v_status = 'SENT' then p_provider_message_id else provider_message_id end,
         sent_at = case when v_status = 'SENT' then now() end,
         failed_at = case when v_status = 'FAILED' then now() end,
         last_error = case when v_status = 'SENT' then null else v_error end,
         -- Bounded back-off: 1 minute, then 5.
         scheduled_at = case when v_status = 'PENDING'
                             then now() + make_interval(mins => case when v_row.attempt_count <= 1 then 1 else 5 end)
                             else scheduled_at end
   where id = p_id;

  if v_status in ('SENT', 'FAILED') then
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, new_values)
    values (null, case v_status when 'SENT' then 'SEND_NOTIFICATION' else 'NOTIFICATION_FAILED' end, 'COMMUNICATION', p_id,
            jsonb_build_object('channel', v_row.channel, 'provider', coalesce(p_provider, v_row.provider),
                               'attempt_count', v_row.attempt_count, 'notification_id', v_row.notification_id));
  end if;
  return v_status;
end;
$$;

-- Admin: give a failed message one more round of attempts. History stays in the audit log.
create or replace function public.admin_retry_communication(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'NOT_ADMIN';
  end if;
  update public.communication_queue
     set status = 'PENDING', attempt_count = 0, scheduled_at = now(), failed_at = null
   where id = p_id and status = 'FAILED'
     and created_at > now() - make_interval(hours => public.app_setting('communication_max_age_hours', 24)::int);
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, new_values)
    values (auth.uid(), 'RETRY_NOTIFICATION', 'COMMUNICATION', p_id, jsonb_build_object('status', 'PENDING'));
  end if;
  return v_rows = 1;
end;
$$;

-- Reminders. Scheduled times are wall-clock values in the business time zone,
-- which the caller (the scheduler) passes in. Each reminder is created once.
create or replace function public.enqueue_task_reminders(p_time_zone text default 'Asia/Kolkata')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamp;
  v_lead    numeric := public.app_setting('reminder_lead_minutes', 60);
  v_overdue numeric := public.app_setting('reminder_overdue_minutes', 30);
  v_task    record;
  v_count   integer := 0;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception using errcode = 'P0001', message = 'INVALID_TIME_ZONE';
  end if;
  v_now := now() at time zone p_time_zone;

  -- Starting soon → the assigned agent
  for v_task in
    select t.id, t.task_code, a.profile_id, (t.scheduled_date + t.scheduled_start_time) as starts_at
      from public.tasks t join public.agents a on a.id = t.agent_id
     where t.status in ('ASSIGNED', 'ACCEPTED')
       and t.scheduled_date is not null and t.scheduled_start_time is not null
       and (t.scheduled_date + t.scheduled_start_time) > v_now
       and (t.scheduled_date + t.scheduled_start_time) <= v_now + make_interval(mins => v_lead::int)
  loop
    if public.publish_notification(v_task.profile_id, 'TASK_REMINDER', v_task.id, 'Task Starting Soon',
         'Task #' || v_task.task_code || ' starts at ' || to_char(v_task.starts_at, 'HH12:MI AM') || '.',
         'reminder:start:' || v_task.id || ':' || to_char(v_task.starts_at, 'YYYYMMDDHH24MI')) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  -- Overdue (not started well after its time; last 7 days only) → agent and admins
  for v_task in
    select t.id, t.task_code, t.scheduled_date, a.profile_id
      from public.tasks t join public.agents a on a.id = t.agent_id
     where t.status in ('ASSIGNED', 'ACCEPTED', 'ON_THE_WAY')
       and t.scheduled_date is not null
       and t.scheduled_date >= (v_now - interval '7 days')::date
       and (t.scheduled_date + coalesce(t.scheduled_end_time, t.scheduled_start_time, time '23:59'))
           < v_now - make_interval(mins => v_overdue::int)
  loop
    if public.publish_notification(v_task.profile_id, 'TASK_REMINDER', v_task.id, 'Task Overdue',
         'Task #' || v_task.task_code || ' is overdue.',
         'reminder:overdue:' || v_task.id || ':' || v_task.scheduled_date) is not null then
      v_count := v_count + 1;
    end if;
    v_count := v_count + public.notify_admins('TASK_REMINDER', v_task.id, 'Task Overdue',
      'Task #' || v_task.task_code || ' is overdue.', 'reminder:overdue:' || v_task.id || ':' || v_task.scheduled_date);
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.claim_communications(integer),
  public.complete_communication(uuid, text, text, text, text),
  public.enqueue_task_reminders(text)
  from public, anon, authenticated;
grant execute on function public.claim_communications(integer),
  public.complete_communication(uuid, text, text, text, text),
  public.enqueue_task_reminders(text)
  to service_role;

revoke execute on function public.admin_retry_communication(uuid) from public, anon;
grant execute on function public.admin_retry_communication(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Admin view: every notification with its channels (RLS applies)
-- ---------------------------------------------------------------------------
create or replace view public.communication_log
with (security_invoker = true) as
select
  n.id::text || ':IN_APP' as id,
  n.id               as notification_id,
  null::uuid         as queue_id,
  n.created_at,
  n.type,
  n.title,
  n.task_id,
  t.task_code,
  n.recipient_user_id,
  p.full_name        as recipient_name,
  'IN_APP'::text     as channel,
  case when n.is_read then 'READ' else 'DELIVERED' end as status,
  null::text         as provider,
  null::text         as recipient_address,
  0                  as attempt_count,
  n.created_at       as sent_at,
  null::timestamptz  as failed_at,
  null::text         as last_error
from public.notifications n
join public.profiles p on p.id = n.recipient_user_id
left join public.tasks t on t.id = n.task_id
union all
select
  q.id::text,
  q.notification_id,
  q.id,
  q.created_at,
  coalesce(n.type, q.payload ->> 'type'),
  coalesce(q.subject, n.title, q.payload ->> 'title'),
  n.task_id,
  coalesce(t.task_code, q.payload ->> 'task_code'),
  q.recipient_user_id,
  p.full_name,
  q.channel,
  q.status,
  q.provider,
  q.recipient_address,
  q.attempt_count,
  q.sent_at,
  q.failed_at,
  q.last_error
from public.communication_queue q
left join public.notifications n on n.id = q.notification_id
left join public.profiles p on p.id = q.recipient_user_id
left join public.tasks t on t.id = n.task_id;

revoke all on public.communication_log from anon, authenticated;
grant select on public.communication_log to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Realtime: a user's notification centre listens to their own rows
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

commit;
