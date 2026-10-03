-- Phase 5: task creation, assignment and cancellation.
--
-- Idempotent and non-destructive. Adds:
--   * admin_save_task()   — atomic create/update of a task and its product lines
--                           with all business validation, run as the caller
--                           (SECURITY INVOKER) so RLS, status history and audit
--                           triggers all apply with the admin as actor;
--   * admin_cancel_task() — cancellation before execution, with a reason;
--   * task_directory      — search view (task + customer + location + agent);
--   * semantic audit actions for tasks and task product lines.
--
-- Errors are raised with SQLSTATE P0001 and a stable code in the message
-- (e.g. AGENT_INACTIVE) that the app maps to user-facing text.

begin;

-- ===========================================================================
-- 1. Task-code sequence hygiene
-- ===========================================================================
-- Rolled-back test transactions consume sequence values. If no task exists
-- yet, restart numbering at 000001. Never touches a database that has tasks.
do $$
begin
  if not exists (select 1 from public.tasks) then
    perform setval('public.task_code_seq', 1, false);
  end if;
end
$$;

-- ===========================================================================
-- 2. Search view
-- ===========================================================================
create or replace view public.task_directory
with (security_invoker = true) as
select
  t.id,
  t.task_code,
  t.task_type,
  t.status,
  t.priority,
  t.title,
  t.scheduled_date,
  t.scheduled_start_time,
  t.scheduled_end_time,
  t.assigned_at,
  t.created_at,
  t.customer_id,
  c.name          as customer_name,
  c.customer_code,
  t.location_id,
  l.location_name,
  l.city          as location_city,
  t.agent_id,
  a.employee_code,
  p.full_name     as agent_name
from public.tasks t
left join public.customers c on c.id = t.customer_id
left join public.locations l on l.id = t.location_id
left join public.agents    a on a.id = t.agent_id
left join public.profiles  p on p.id = a.profile_id;

revoke all on public.task_directory from anon, authenticated;
grant select on public.task_directory to authenticated;

-- ===========================================================================
-- 3. admin_save_task
-- ===========================================================================
-- p_task      {task_type, title, description, priority, customer_id, location_id,
--              agent_id, scheduled_date, scheduled_start_time, scheduled_end_time}
-- p_products  [{product_id, assigned_quantity, unit_price, notes}] — the complete
--             set of planned lines (lines not listed are removed). unit_price
--             NULL means "use the product's current price".
-- p_assign    true: the task must be (or become) ASSIGNED.
-- p_task_id   omitted/NULL to create, otherwise the task to update (DRAFT/ASSIGNED only).
--
-- Active-record rules: a customer, location, agent or product must be active
-- when it is newly linked (on create, or when changed on edit) and the agent
-- must be active when a task becomes ASSIGNED. Unchanged links on an existing
-- task are kept even if the master record was deactivated later.
-- (An earlier draft of this migration used a different argument order.)
drop function if exists public.admin_save_task(uuid, jsonb, jsonb, boolean);

create or replace function public.admin_save_task(
  p_task     jsonb,
  p_products jsonb,
  p_assign   boolean,
  p_task_id  uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing    public.tasks%rowtype;
  v_is_new      boolean := p_task_id is null;
  v_type        public.task_type := (p_task ->> 'task_type')::public.task_type;
  v_customer    uuid := (p_task ->> 'customer_id')::uuid;
  v_location    uuid := (p_task ->> 'location_id')::uuid;
  v_agent       uuid := nullif(p_task ->> 'agent_id', '')::uuid;
  v_status      public.task_status;
  v_assigned_at timestamptz;
  v_task_id     uuid;
  v_loc         record;
  v_line        jsonb;
  v_product     record;
  v_product_ids uuid[] := '{}';
  v_qty         numeric;
  v_price       numeric;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'NOT_ADMIN';
  end if;

  if not v_is_new then
    select * into v_existing from public.tasks where id = p_task_id for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'TASK_NOT_FOUND';
    end if;
    if v_existing.status not in ('DRAFT', 'ASSIGNED') then
      raise exception using errcode = 'P0001', message = 'TASK_NOT_EDITABLE';
    end if;
  end if;

  -- Status transition: create → DRAFT/ASSIGNED; DRAFT → DRAFT/ASSIGNED;
  -- ASSIGNED stays ASSIGNED (un-assigning is not supported; cancel instead).
  v_status := case
    when not v_is_new and v_existing.status = 'ASSIGNED' then 'ASSIGNED'
    when p_assign then 'ASSIGNED'
    else 'DRAFT'
  end;

  -- Customer
  if not exists (select 1 from public.customers where id = v_customer) then
    raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_FOUND';
  end if;
  if (v_is_new or v_customer is distinct from v_existing.customer_id)
     and not exists (select 1 from public.customers where id = v_customer and is_active) then
    raise exception using errcode = 'P0001', message = 'CUSTOMER_INACTIVE';
  end if;

  -- Location: must exist, belong to the customer, and be active if newly linked.
  select customer_id, is_active into v_loc from public.locations where id = v_location;
  if not found then
    raise exception using errcode = 'P0001', message = 'LOCATION_NOT_FOUND';
  end if;
  if v_loc.customer_id <> v_customer then
    raise exception using errcode = 'P0001', message = 'LOCATION_CUSTOMER_MISMATCH';
  end if;
  if (v_is_new or v_location is distinct from v_existing.location_id) and not v_loc.is_active then
    raise exception using errcode = 'P0001', message = 'LOCATION_INACTIVE';
  end if;

  -- Agent
  if v_status = 'ASSIGNED' and v_agent is null then
    raise exception using errcode = 'P0001', message = 'AGENT_REQUIRED';
  end if;
  if v_agent is not null then
    if not exists (select 1 from public.agents where id = v_agent) then
      raise exception using errcode = 'P0001', message = 'AGENT_NOT_FOUND';
    end if;
    if (v_is_new or v_agent is distinct from v_existing.agent_id
        or (v_status = 'ASSIGNED' and v_existing.status = 'DRAFT'))
       and not exists (
         select 1 from public.agents a join public.profiles p on p.id = a.profile_id
         where a.id = v_agent and a.is_active and p.is_active and p.role = 'AGENT'
       ) then
      raise exception using errcode = 'P0001', message = 'AGENT_INACTIVE';
    end if;
  end if;

  -- assigned_at: set when the task becomes ASSIGNED or is handed to another agent.
  v_assigned_at := case
    when v_status <> 'ASSIGNED' then null
    when v_is_new or v_existing.status = 'DRAFT' then now()
    when v_agent is distinct from v_existing.agent_id then now()
    else v_existing.assigned_at
  end;

  -- Product lines: validate everything before writing anything.
  if jsonb_typeof(coalesce(p_products, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'P0001', message = 'PRODUCTS_INVALID';
  end if;
  for v_line in select * from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) loop
    select id, is_active, price into v_product
      from public.products where id = (v_line ->> 'product_id')::uuid;
    if not found then
      raise exception using errcode = 'P0001', message = 'PRODUCT_NOT_FOUND';
    end if;
    if v_product.id = any(v_product_ids) then
      raise exception using errcode = 'P0001', message = 'PRODUCT_DUPLICATE';
    end if;
    -- An inactive product may stay on a task it is already on, but not be added.
    if not v_product.is_active and (v_is_new or not exists (
         select 1 from public.task_products where task_id = p_task_id and product_id = v_product.id)) then
      raise exception using errcode = 'P0001', message = 'PRODUCT_INACTIVE';
    end if;
    v_qty := (v_line ->> 'assigned_quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception using errcode = 'P0001', message = 'QUANTITY_INVALID';
    end if;
    v_price := (v_line ->> 'unit_price')::numeric;
    if v_price is not null and v_price < 0 then
      raise exception using errcode = 'P0001', message = 'PRICE_INVALID';
    end if;
    v_product_ids := v_product_ids || v_product.id;
  end loop;

  if v_status = 'ASSIGNED' and v_type = 'DELIVER_PRODUCTS' and cardinality(v_product_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'PRODUCTS_REQUIRED';
  end if;

  -- Write the task. created_by defaults to auth.uid(); task_code to the sequence.
  if v_is_new then
    insert into public.tasks (
      task_type, status, agent_id, customer_id, location_id, title, description, priority,
      scheduled_date, scheduled_start_time, scheduled_end_time, assigned_at
    ) values (
      v_type, v_status, v_agent, v_customer, v_location,
      p_task ->> 'title', nullif(p_task ->> 'description', ''), (p_task ->> 'priority')::integer,
      nullif(p_task ->> 'scheduled_date', '')::date,
      nullif(p_task ->> 'scheduled_start_time', '')::time,
      nullif(p_task ->> 'scheduled_end_time', '')::time,
      v_assigned_at
    )
    returning id into v_task_id;
  else
    v_task_id := p_task_id;
    update public.tasks set
      task_type            = v_type,
      status               = v_status,
      agent_id             = v_agent,
      customer_id          = v_customer,
      location_id          = v_location,
      title                = p_task ->> 'title',
      description          = nullif(p_task ->> 'description', ''),
      priority             = (p_task ->> 'priority')::integer,
      scheduled_date       = nullif(p_task ->> 'scheduled_date', '')::date,
      scheduled_start_time = nullif(p_task ->> 'scheduled_start_time', '')::time,
      scheduled_end_time   = nullif(p_task ->> 'scheduled_end_time', '')::time,
      assigned_at          = v_assigned_at
    where id = v_task_id;
  end if;

  -- Planned lines (no execution data exists while DRAFT/ASSIGNED): remove
  -- lines no longer listed, then add new ones / update changed ones.
  delete from public.task_products
   where task_id = v_task_id and not (product_id = any(v_product_ids));

  insert into public.task_products (task_id, product_id, assigned_quantity, unit_price, notes)
  select v_task_id,
         p.id,
         (l ->> 'assigned_quantity')::numeric,
         coalesce((l ->> 'unit_price')::numeric, p.price),
         nullif(l ->> 'notes', '')
    from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) l
    join public.products p on p.id = (l ->> 'product_id')::uuid
  on conflict (task_id, product_id) do update set
    assigned_quantity = excluded.assigned_quantity,
    unit_price        = excluded.unit_price,
    notes             = excluded.notes
  where (task_products.assigned_quantity, task_products.unit_price, task_products.notes)
        is distinct from (excluded.assigned_quantity, excluded.unit_price, excluded.notes);

  return v_task_id;
end;
$$;

revoke execute on function public.admin_save_task(jsonb, jsonb, boolean, uuid) from public, anon;
grant execute on function public.admin_save_task(jsonb, jsonb, boolean, uuid) to authenticated;

-- ===========================================================================
-- 4. admin_cancel_task
-- ===========================================================================
-- Allowed before execution starts (DRAFT, ASSIGNED, ACCEPTED). The reason is
-- stored on the task and in the status history.
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
  if v_status not in ('DRAFT', 'ASSIGNED', 'ACCEPTED') then
    raise exception using errcode = 'P0001', message = 'TASK_NOT_CANCELLABLE';
  end if;

  perform set_config('app.status_change_reason', v_reason, true);
  update public.tasks set status = 'CANCELLED', cancellation_reason = v_reason where id = p_task_id;
end;
$$;

revoke execute on function public.admin_cancel_task(uuid, text) from public, anon;
grant execute on function public.admin_cancel_task(uuid, text) to authenticated;

-- ===========================================================================
-- 5. Audit: semantic action names for tasks and task product lines
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
      when entity = 'TASK' and new_diff ->> 'status' = 'CANCELLED' then 'CANCEL_TASK'
      when entity = 'TASK' and new_diff ->> 'status' = 'ASSIGNED' and old_diff ->> 'status' = 'DRAFT' then 'ASSIGN_TASK'
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
