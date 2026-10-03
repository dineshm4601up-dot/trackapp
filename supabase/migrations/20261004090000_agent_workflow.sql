-- Phase 6: agent task execution workflow.
--
-- Idempotent and non-destructive. Adds:
--   * tasks.completion_notes — the agent's notes on completion / partial completion;
--   * agent_transition_task() — the ONLY way an agent changes a task's status;
--   * status-history notes support, and semantic audit actions for agent steps;
--   * admin cancellation extended to tasks that are on the way / arrived.
--
-- Check-in (ARRIVED → CHECKED_IN) is deliberately NOT possible here: it will be
-- performed by the server-side GPS/geofence check-in function (next phase).

begin;

-- ===========================================================================
-- 1. Execution field
-- ===========================================================================
alter table public.tasks add column if not exists completion_notes text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_completion_notes_length') then
    alter table public.tasks
      add constraint tasks_completion_notes_length check (char_length(completion_notes) <= 2000);
  end if;
end
$$;

-- Agents never write tasks directly (no UPDATE grant / policy for them);
-- admins don't edit execution fields either, so no column grant is added.

-- ===========================================================================
-- 2. Status history: record optional notes too
-- ===========================================================================
create or replace function public.record_task_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.task_status_history (task_id, old_status, new_status, changed_by, reason, notes)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      auth.uid(),
      nullif(current_setting('app.status_change_reason', true), ''),
      nullif(current_setting('app.status_change_notes', true), '')
    );
  end if;
  return null;
end;
$$;

-- ===========================================================================
-- 3. Agent transitions
-- ===========================================================================
-- Allowed (agent, own task only):
--   ASSIGNED   → ACCEPTED                     (accepted_at)
--   ACCEPTED   → ON_THE_WAY
--   ON_THE_WAY → ARRIVED                      (self-declared; NOT a verified visit)
--   CHECKED_IN → IN_PROGRESS                  (started_at)   — CHECKED_IN is set only by GPS check-in
--   IN_PROGRESS → COMPLETED                   (completed_at, optional notes)
--   IN_PROGRESS → PARTIALLY_COMPLETED         (completed_at, reason required)
--   ACCEPTED / ON_THE_WAY / ARRIVED / CHECKED_IN / IN_PROGRESS → FAILED (reason required)
--
-- p_expected_status must equal the current status (optimistic concurrency):
-- a stale screen can never overwrite a newer state (e.g. an admin cancellation).
-- SECURITY DEFINER because agents have no direct UPDATE on tasks; ownership is
-- checked explicitly against current_agent_id() (active agent + profile only).
create or replace function public.agent_transition_task(
  p_task_id         uuid,
  p_expected_status public.task_status,
  p_to_status       public.task_status,
  p_reason          text default null,
  p_notes           text default null
)
returns public.task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent  uuid := public.current_agent_id();
  v_task   public.tasks%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_agent is null then
    raise exception using errcode = '42501', message = 'NOT_AGENT';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  -- Someone else's task (or an unreleased draft) is reported as not found.
  if not found or v_task.agent_id is distinct from v_agent or v_task.status = 'DRAFT' then
    raise exception using errcode = 'P0001', message = 'TASK_NOT_FOUND';
  end if;

  if v_task.status <> p_expected_status then
    raise exception using errcode = 'P0001', message = 'STATUS_CHANGED';
  end if;

  if p_to_status = 'CHECKED_IN' then
    raise exception using errcode = 'P0001', message = 'CHECK_IN_REQUIRED';
  end if;

  if not (
       (v_task.status = 'ASSIGNED'    and p_to_status = 'ACCEPTED')
    or (v_task.status = 'ACCEPTED'    and p_to_status = 'ON_THE_WAY')
    or (v_task.status = 'ON_THE_WAY'  and p_to_status = 'ARRIVED')
    or (v_task.status = 'CHECKED_IN'  and p_to_status = 'IN_PROGRESS')
    or (v_task.status = 'IN_PROGRESS' and p_to_status in ('COMPLETED', 'PARTIALLY_COMPLETED'))
    or (v_task.status in ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'CHECKED_IN', 'IN_PROGRESS')
        and p_to_status = 'FAILED')
  ) then
    raise exception using errcode = 'P0001', message = 'TRANSITION_NOT_ALLOWED';
  end if;

  if p_to_status in ('FAILED', 'PARTIALLY_COMPLETED')
     and (v_reason is null or char_length(v_reason) < 3) then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED';
  end if;
  if char_length(coalesce(v_reason, '')) > 500 or char_length(coalesce(v_notes, '')) > 2000 then
    raise exception using errcode = 'P0001', message = 'TEXT_TOO_LONG';
  end if;

  perform set_config('app.status_change_reason', coalesce(v_reason, ''), true);
  perform set_config('app.status_change_notes', coalesce(v_notes, ''), true);

  update public.tasks set
    status           = p_to_status,
    accepted_at      = case when p_to_status = 'ACCEPTED' then now() else accepted_at end,
    started_at       = case when p_to_status = 'IN_PROGRESS' then now() else started_at end,
    completed_at     = case when p_to_status in ('COMPLETED', 'PARTIALLY_COMPLETED') then now() else completed_at end,
    failure_reason   = case when p_to_status = 'FAILED'
                            then v_reason || coalesce(' — ' || v_notes, '') else failure_reason end,
    completion_notes = case when p_to_status = 'PARTIALLY_COMPLETED'
                            then v_reason || coalesce(' — ' || v_notes, '')
                            when p_to_status = 'COMPLETED' then v_notes
                            else completion_notes end
  where id = p_task_id;

  -- Don't leak reason/notes into later statements of the same transaction.
  perform set_config('app.status_change_reason', '', true);
  perform set_config('app.status_change_notes', '', true);

  return p_to_status;
end;
$$;

revoke execute on function public.agent_transition_task(uuid, public.task_status, public.task_status, text, text)
  from public, anon;
grant execute on function public.agent_transition_task(uuid, public.task_status, public.task_status, text, text)
  to authenticated;

-- ===========================================================================
-- 4. Admin cancellation: also while the agent is travelling or has arrived
-- ===========================================================================
create or replace function public.admin_cancel_task(p_task_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.task_status;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'NOT_ADMIN';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED';
  end if;

  select status into v_status from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TASK_NOT_FOUND';
  end if;
  -- Before any verified on-site work (check-in) has happened.
  if v_status not in ('DRAFT', 'ASSIGNED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED') then
    raise exception using errcode = 'P0001', message = 'TASK_NOT_CANCELLABLE';
  end if;

  perform set_config('app.status_change_reason', v_reason, true);
  update public.tasks set status = 'CANCELLED', cancellation_reason = v_reason where id = p_task_id;
  perform set_config('app.status_change_reason', '', true);
end;
$$;

revoke execute on function public.admin_cancel_task(uuid, text) from public, anon;
grant execute on function public.admin_cancel_task(uuid, text) to authenticated;

-- ===========================================================================
-- 5. Audit: one semantic action per status step
-- ===========================================================================
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
          when 'CHECKED_IN'          then 'CHECK_IN_TASK'
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

revoke execute on function public.audit_row_change(), public.record_task_status_change()
  from public, anon, authenticated;

commit;
