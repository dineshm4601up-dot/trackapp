-- Phase 3: core business schema, RLS helpers, policies and audit foundation.
--
-- Idempotent and non-destructive: creates missing objects only; replaces only
-- the functions, triggers and policies defined here. Never drops tables or data.
--
-- Access model (enforced here, not in the UI):
--   ADMIN  (active profile, role ADMIN)  manages operational data. Master data
--          and tasks are soft-deleted (is_active / CANCELLED), never deleted.
--   AGENT  (active profile + active agents row) reads only tasks assigned to
--          them (excluding DRAFT) and the customer / location / product rows
--          those tasks reference. Agents cannot change tasks, ownership,
--          check-ins or cash records directly: those workflow writes will be
--          SECURITY DEFINER functions that compute trusted values server-side
--          (task workflow, GPS check-in and cash collection phases).
--   anon   no access to any table.
--
-- Deletion policy: history (tasks, check-ins, proofs, cash, status history,
-- audit) is protected with ON DELETE RESTRICT. Deactivate, don't delete.

begin;

-- ===========================================================================
-- 1. Enums
-- ===========================================================================
do $$
begin
  if to_regtype('public.task_type') is null then
    create type public.task_type as enum (
      'COLLECT_CASH', 'DELIVER_PRODUCTS', 'PICKUP', 'VERIFICATION', 'INSPECTION',
      'DOCUMENT_COLLECTION', 'REPLACEMENT', 'SURVEY', 'OTHER'
    );
  end if;
  if to_regtype('public.task_status') is null then
    create type public.task_status as enum (
      'DRAFT', 'ASSIGNED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'CHECKED_IN',
      'IN_PROGRESS', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED',
      'RESCHEDULED', 'VERIFIED'
    );
  end if;
end
$$;

-- ===========================================================================
-- 2. Master data
-- ===========================================================================

-- Agent record for a field user. Name / phone / email live in profiles only.
create table if not exists public.agents (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null unique references public.profiles (id) on delete cascade,
  employee_code  text unique,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint agents_employee_code_not_blank check (employee_code is null or btrim(employee_code) <> '')
);

create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  customer_code  text unique,
  name           text not null,
  phone          text,
  email          text,
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  postal_code    text,
  country        text not null default 'India',
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint customers_name_not_blank check (btrim(name) <> ''),
  constraint customers_code_not_blank check (customer_code is null or btrim(customer_code) <> '')
);

create table if not exists public.locations (
  id                      uuid primary key default gen_random_uuid(),
  customer_id             uuid not null references public.customers (id) on delete restrict,
  location_name           text not null,
  address_line1           text,
  address_line2           text,
  city                    text,
  state                   text,
  postal_code             text,
  country                 text not null default 'India',
  latitude                numeric(10, 7),
  longitude               numeric(10, 7),
  geofence_radius_meters  integer not null default 100,
  contact_person          text,
  contact_phone           text,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint locations_name_not_blank check (btrim(location_name) <> ''),
  constraint locations_latitude_range check (latitude between -90 and 90),
  constraint locations_longitude_range check (longitude between -180 and 180),
  constraint locations_coordinates_paired check ((latitude is null) = (longitude is null)),
  constraint locations_geofence_radius_range check (geofence_radius_meters between 10 and 5000),
  -- Target of tasks' composite FK: guarantees a task's location belongs to its customer.
  constraint locations_id_customer_key unique (id, customer_id)
);

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  sku           text not null unique,
  product_name  text not null,
  description   text,
  unit          text not null default 'PCS',
  price         numeric(14, 2),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint products_sku_not_blank check (btrim(sku) <> ''),
  constraint products_name_not_blank check (btrim(product_name) <> ''),
  constraint products_price_non_negative check (price >= 0)
);

-- ===========================================================================
-- 3. Tasks
-- ===========================================================================

-- Task codes are generated by the database (TASK-YYYYMMDD-000001, date in UTC).
-- The sequence guarantees uniqueness; the date part is informational.
create sequence if not exists public.task_code_seq;

create or replace function public.generate_task_code()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'TASK-' || to_char(now() at time zone 'utc', 'YYYYMMDD') || '-'
         || lpad(nextval('public.task_code_seq')::text, 6, '0')
$$;

create table if not exists public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  task_code             text not null unique default public.generate_task_code(),
  task_type             public.task_type not null,
  status                public.task_status not null default 'DRAFT',
  agent_id              uuid references public.agents (id) on delete restrict,
  customer_id           uuid not null references public.customers (id) on delete restrict,
  location_id           uuid not null,
  title                 text not null,
  description           text,
  priority              integer not null default 3,
  scheduled_date        date,
  scheduled_start_time  time,
  scheduled_end_time    time,
  assigned_at           timestamptz,
  accepted_at           timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  verified_at           timestamptz,
  failure_reason        text,
  cancellation_reason   text,
  created_by            uuid default auth.uid() references public.profiles (id) on delete restrict,
  verified_by           uuid references public.profiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint tasks_location_belongs_to_customer
    foreign key (location_id, customer_id) references public.locations (id, customer_id) on delete restrict,
  constraint tasks_title_not_blank check (btrim(title) <> ''),
  -- 1 = highest … 5 = lowest
  constraint tasks_priority_range check (priority between 1 and 5),
  constraint tasks_schedule_window check (
    scheduled_start_time is null or scheduled_end_time is null
    or scheduled_end_time > scheduled_start_time
  ),
  -- Any status past DRAFT (except a cancelled draft) needs an assigned agent.
  constraint tasks_agent_required check (status in ('DRAFT', 'CANCELLED') or agent_id is not null)
);

create table if not exists public.task_products (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references public.tasks (id) on delete cascade,
  product_id          uuid not null references public.products (id) on delete restrict,
  assigned_quantity   numeric(14, 3) not null,
  delivered_quantity  numeric(14, 3) not null default 0,
  unit_price          numeric(14, 2),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint task_products_task_product_key unique (task_id, product_id),
  constraint task_products_assigned_positive check (assigned_quantity > 0),
  constraint task_products_delivered_range check (
    delivered_quantity >= 0 and delivered_quantity <= assigned_quantity
  ),
  constraint task_products_unit_price_non_negative check (unit_price >= 0)
);

-- ===========================================================================
-- 4. Field execution records (append-only history)
-- ===========================================================================

-- Distance / geofence values must be computed server-side; agents get no
-- direct INSERT. Rows are immutable once written.
create table if not exists public.checkins (
  id                             uuid primary key default gen_random_uuid(),
  task_id                        uuid not null references public.tasks (id) on delete restrict,
  agent_id                       uuid not null references public.agents (id) on delete restrict,
  latitude                       numeric(10, 7) not null,
  longitude                      numeric(10, 7) not null,
  accuracy_meters                numeric(10, 2),
  distance_from_location_meters  numeric(12, 2),
  geofence_radius_meters         integer,
  is_within_geofence             boolean not null,
  checked_in_at                  timestamptz not null default now(),
  device_id                      text,
  notes                          text,
  constraint checkins_latitude_range check (latitude between -90 and 90),
  constraint checkins_longitude_range check (longitude between -180 and 180),
  constraint checkins_accuracy_non_negative check (accuracy_meters >= 0),
  constraint checkins_distance_non_negative check (distance_from_location_meters >= 0),
  constraint checkins_radius_positive check (geofence_radius_meters > 0)
);

-- Metadata for files in Supabase Storage (binary content is never stored here).
create table if not exists public.task_proofs (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.tasks (id) on delete restrict,
  agent_id         uuid not null references public.agents (id) on delete restrict,
  proof_type       text not null,
  storage_path     text unique,
  file_name        text,
  mime_type        text,
  file_size_bytes  bigint,
  description      text,
  created_at       timestamptz not null default now(),
  constraint task_proofs_type_valid check (proof_type in ('PHOTO', 'DOCUMENT', 'SIGNATURE', 'OTHER')),
  constraint task_proofs_size_positive check (file_size_bytes > 0)
);

create table if not exists public.cash_collections (
  id                    uuid primary key default gen_random_uuid(),
  task_id               uuid not null references public.tasks (id) on delete restrict,
  agent_id              uuid not null references public.agents (id) on delete restrict,
  expected_amount       numeric(14, 2) not null,
  collected_amount      numeric(14, 2) not null default 0,
  currency              text not null default 'INR',
  payment_method        text,
  collection_reference  text,
  collected_at          timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint cash_collections_expected_non_negative check (expected_amount >= 0),
  constraint cash_collections_collected_non_negative check (collected_amount >= 0),
  constraint cash_collections_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint cash_collections_method_valid check (
    payment_method in ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER')
  ),
  -- A recorded collection must say how and when it was collected.
  constraint cash_collections_collected_details check (
    collected_amount = 0 or (payment_method is not null and collected_at is not null)
  )
);

-- Written only by the trigger on tasks below; immutable for everyone.
create table if not exists public.task_status_history (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete restrict,
  old_status  public.task_status,
  new_status  public.task_status not null,
  changed_by  uuid references public.profiles (id) on delete restrict,
  changed_at  timestamptz not null default now(),
  reason      text,
  notes       text
);

-- Storage foundation for optional periodic location tracking (not used yet).
create table if not exists public.agent_location_events (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.agents (id) on delete restrict,
  task_id          uuid references public.tasks (id) on delete set null,
  latitude         numeric(10, 7) not null,
  longitude        numeric(10, 7) not null,
  accuracy_meters  numeric(10, 2),
  recorded_at      timestamptz not null default now(),
  device_id        text,
  constraint agent_location_events_latitude_range check (latitude between -90 and 90),
  constraint agent_location_events_longitude_range check (longitude between -180 and 180),
  constraint agent_location_events_accuracy_non_negative check (accuracy_meters >= 0)
);

-- Who / what / when / which entity / old → new. Written by triggers and
-- trusted functions only; never contains credentials or tokens.
create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid references public.profiles (id) on delete restrict,
  action         text not null,
  entity_type    text not null,
  entity_id      uuid,
  old_values     jsonb,
  new_values     jsonb,
  created_at     timestamptz not null default now()
);

-- ===========================================================================
-- 5. Indexes (unique constraints above already index task_code, sku,
--    customer_code, employee_code, agents.profile_id, task_products(task_id, …))
-- ===========================================================================
create index if not exists idx_locations_customer_id on public.locations (customer_id);

-- Main agent query: "my tasks for a date (by status)". Also serves agent_id-only lookups.
create index if not exists idx_tasks_agent_schedule_status on public.tasks (agent_id, scheduled_date, status);
-- Admin board: "tasks for a date (by status)". Also serves scheduled_date-only lookups.
create index if not exists idx_tasks_schedule_status on public.tasks (scheduled_date, status);
create index if not exists idx_tasks_status on public.tasks (status);
create index if not exists idx_tasks_customer_id on public.tasks (customer_id);
create index if not exists idx_tasks_location_id on public.tasks (location_id);

create index if not exists idx_task_products_product_id on public.task_products (product_id);

create index if not exists idx_checkins_task_id on public.checkins (task_id);
create index if not exists idx_checkins_agent_checked_in on public.checkins (agent_id, checked_in_at desc);
create index if not exists idx_checkins_checked_in_at on public.checkins (checked_in_at);

create index if not exists idx_task_proofs_task_id on public.task_proofs (task_id);
create index if not exists idx_task_proofs_agent_id on public.task_proofs (agent_id);

create index if not exists idx_cash_collections_task_id on public.cash_collections (task_id);
create index if not exists idx_cash_collections_agent_id on public.cash_collections (agent_id);

create index if not exists idx_task_status_history_task_changed on public.task_status_history (task_id, changed_at);

create index if not exists idx_agent_location_events_agent_recorded
  on public.agent_location_events (agent_id, recorded_at desc);

create index if not exists idx_audit_logs_actor on public.audit_logs (actor_user_id);
create index if not exists idx_audit_logs_entity on public.audit_logs (entity_type, entity_id, created_at desc);

-- ===========================================================================
-- 6. RLS helper functions
--    SECURITY DEFINER so policies can consult profiles/agents without
--    recursive RLS; fixed empty search_path; callable by signed-in users only.
-- ===========================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'ADMIN' and p.is_active
  )
$$;

create or replace function public.is_agent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'AGENT' and p.is_active
  )
$$;

-- The caller's agents.id, or NULL unless both the profile and agent record are active.
create or replace function public.current_agent_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.agents a
  join public.profiles p on p.id = a.profile_id
  where a.profile_id = (select auth.uid())
    and a.is_active and p.is_active and p.role = 'AGENT'
$$;

-- True if the task is assigned to the caller and has been released (not DRAFT).
create or replace function public.is_my_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and t.agent_id = public.current_agent_id()
      and t.status <> 'DRAFT'
  )
$$;

revoke execute on function public.is_admin(), public.is_agent(), public.current_agent_id(),
  public.is_my_task(uuid), public.generate_task_code() from public, anon;
grant execute on function public.is_admin(), public.is_agent(), public.current_agent_id(),
  public.is_my_task(uuid), public.generate_task_code() to authenticated;
revoke all on sequence public.task_code_seq from public, anon, authenticated;

-- ===========================================================================
-- 7. Triggers
-- ===========================================================================

-- updated_at (shared function from the profiles migration)
do $$
declare
  t text;
begin
  foreach t in array array['agents', 'customers', 'locations', 'products', 'tasks',
                           'task_products', 'cash_collections']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_updated_at', t);
  end loop;
end
$$;

-- An agents row may only point at a profile whose role is AGENT.
create or replace function public.ensure_agent_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = new.profile_id and p.role = 'AGENT'
  ) then
    raise exception 'agents.profile_id must reference a profile with role AGENT'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists agents_require_agent_role on public.agents;
create trigger agents_require_agent_role
  before insert or update of profile_id on public.agents
  for each row execute function public.ensure_agent_profile_role();

-- Status history: one row on creation and on every status change. A trusted
-- workflow function may set `app.status_change_reason` (transaction-local)
-- before updating the status to record why.
create or replace function public.record_task_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.task_status_history (task_id, old_status, new_status, changed_by, reason)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      auth.uid(),
      nullif(current_setting('app.status_change_reason', true), '')
    );
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_record_status_change on public.tasks;
create trigger tasks_record_status_change
  after insert or update of status on public.tasks
  for each row execute function public.record_task_status_change();

-- Generic audit: records only the columns that changed (updated_at excluded).
-- Action names: CREATE_<ENTITY>, UPDATE_<ENTITY>, DELETE_<ENTITY>. Semantic
-- actions (ASSIGN_TASK, VERIFY_TASK, …) are logged by the workflow functions.
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
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, old_row -> n.key), jsonb_object_agg(n.key, n.value)
      into old_diff, new_diff
      from jsonb_each(new_row) n
     where n.key <> 'updated_at' and n.value is distinct from old_row -> n.key;
    if new_diff is null then
      return null; -- no-op update
    end if;
  else
    old_diff := old_row - 'updated_at';
    new_diff := new_row - 'updated_at';
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values)
  values (
    auth.uid(),
    case tg_op when 'INSERT' then 'CREATE_' when 'UPDATE' then 'UPDATE_' else 'DELETE_' end || entity,
    entity,
    (coalesce(new_row, old_row) ->> 'id')::uuid,
    old_diff,
    new_diff
  );
  return null;
end;
$$;

do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('profiles', 'PROFILE'), ('agents', 'AGENT'), ('customers', 'CUSTOMER'),
      ('locations', 'LOCATION'), ('products', 'PRODUCT'), ('tasks', 'TASK'),
      ('task_products', 'TASK_PRODUCT'), ('cash_collections', 'CASH_COLLECTION')
    ) as v(tbl, entity)
  loop
    execute format('drop trigger if exists %I on public.%I', target.tbl || '_audit', target.tbl);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function public.audit_row_change(%L)',
      target.tbl || '_audit', target.tbl, target.entity);
  end loop;
end
$$;

revoke execute on function public.ensure_agent_profile_role(), public.record_task_status_change(),
  public.audit_row_change() from public, anon, authenticated;

-- ===========================================================================
-- 8. Privileges: deny by default, then grant exactly what policies may use.
-- ===========================================================================
revoke all on public.agents, public.customers, public.locations, public.products, public.tasks,
  public.task_products, public.checkins, public.task_proofs, public.cash_collections,
  public.task_status_history, public.agent_location_events, public.audit_logs
  from anon, authenticated;

grant select, insert on public.agents to authenticated;
grant update (employee_code, is_active) on public.agents to authenticated;  -- profile_id is immutable

grant select, insert, update on public.customers, public.locations, public.products to authenticated;

grant select, insert on public.tasks to authenticated;
-- task_code, created_by and created_at are immutable.
grant update (
  task_type, status, agent_id, customer_id, location_id, title, description, priority,
  scheduled_date, scheduled_start_time, scheduled_end_time,
  assigned_at, accepted_at, started_at, completed_at, verified_at,
  failure_reason, cancellation_reason, verified_by
) on public.tasks to authenticated;

grant select, insert, update, delete on public.task_products to authenticated;
grant select on public.checkins to authenticated;
grant select, insert on public.task_proofs to authenticated;
grant select, insert, update on public.cash_collections to authenticated;
grant select on public.task_status_history to authenticated;
grant select, insert on public.agent_location_events to authenticated;
grant select on public.audit_logs to authenticated;

-- ===========================================================================
-- 9. Row Level Security policies
-- ===========================================================================
alter table public.agents                enable row level security;
alter table public.customers             enable row level security;
alter table public.locations             enable row level security;
alter table public.products              enable row level security;
alter table public.tasks                 enable row level security;
alter table public.task_products         enable row level security;
alter table public.checkins              enable row level security;
alter table public.task_proofs           enable row level security;
alter table public.cash_collections      enable row level security;
alter table public.task_status_history   enable row level security;
alter table public.agent_location_events enable row level security;
alter table public.audit_logs            enable row level security;

-- profiles: admins can read every profile (agent names, roles). Users keep
-- read access to their own row via the Phase 2 policy. No write policies.
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles" on public.profiles
  for select to authenticated using ((select public.is_admin()));

-- Admin manage policies (FOR ALL: effective commands are limited by grants above).
do $$
declare
  t text;
begin
  foreach t in array array['agents', 'customers', 'locations', 'products', 'tasks',
                           'task_products', 'cash_collections']
  loop
    execute format('drop policy if exists "Admins can manage %s" on public.%I', t, t);
    execute format(
      'create policy "Admins can manage %s" on public.%I for all to authenticated '
      'using ((select public.is_admin())) with check ((select public.is_admin()))', t, t);
  end loop;

  foreach t in array array['checkins', 'task_proofs', 'task_status_history',
                           'agent_location_events', 'audit_logs']
  loop
    execute format('drop policy if exists "Admins can view %s" on public.%I', t, t);
    execute format(
      'create policy "Admins can view %s" on public.%I for select to authenticated '
      'using ((select public.is_admin()))', t, t);
  end loop;
end
$$;

-- agents: an agent can read their own agent record.
drop policy if exists "Agents can view own agent record" on public.agents;
create policy "Agents can view own agent record" on public.agents
  for select to authenticated using (profile_id = (select auth.uid()));

-- tasks: an agent can read released tasks assigned to them. No agent writes.
drop policy if exists "Agents can view assigned tasks" on public.tasks;
create policy "Agents can view assigned tasks" on public.tasks
  for select to authenticated
  using (agent_id = (select public.current_agent_id()) and status <> 'DRAFT');

-- Master data: an agent can read only rows referenced by their tasks.
drop policy if exists "Agents can view customers of assigned tasks" on public.customers;
create policy "Agents can view customers of assigned tasks" on public.customers
  for select to authenticated
  using (exists (
    select 1 from public.tasks t
    where t.customer_id = customers.id and public.is_my_task(t.id)
  ));

drop policy if exists "Agents can view locations of assigned tasks" on public.locations;
create policy "Agents can view locations of assigned tasks" on public.locations
  for select to authenticated
  using (exists (
    select 1 from public.tasks t
    where t.location_id = locations.id and public.is_my_task(t.id)
  ));

drop policy if exists "Agents can view products of assigned tasks" on public.products;
create policy "Agents can view products of assigned tasks" on public.products
  for select to authenticated
  using (exists (
    select 1 from public.task_products tp
    where tp.product_id = products.id and public.is_my_task(tp.task_id)
  ));

drop policy if exists "Agents can view products on assigned tasks" on public.task_products;
create policy "Agents can view products on assigned tasks" on public.task_products
  for select to authenticated using (public.is_my_task(task_id));

drop policy if exists "Agents can view status history of assigned tasks" on public.task_status_history;
create policy "Agents can view status history of assigned tasks" on public.task_status_history
  for select to authenticated using (public.is_my_task(task_id));

-- Check-ins: read own; creation is reserved for the server-side check-in function.
drop policy if exists "Agents can view own check-ins" on public.checkins;
create policy "Agents can view own check-ins" on public.checkins
  for select to authenticated using (agent_id = (select public.current_agent_id()));

-- Proofs: read own; add proof only as themselves, only for their own task. Immutable.
drop policy if exists "Agents can view own proofs" on public.task_proofs;
create policy "Agents can view own proofs" on public.task_proofs
  for select to authenticated using (agent_id = (select public.current_agent_id()));

drop policy if exists "Agents can add proofs to assigned tasks" on public.task_proofs;
create policy "Agents can add proofs to assigned tasks" on public.task_proofs
  for insert to authenticated
  with check (agent_id = (select public.current_agent_id()) and public.is_my_task(task_id));

-- Cash: read own; recording a collection is reserved for the server-side function.
drop policy if exists "Agents can view own cash collections" on public.cash_collections;
create policy "Agents can view own cash collections" on public.cash_collections
  for select to authenticated using (agent_id = (select public.current_agent_id()));

-- Location events: read and write own only; task (if given) must be theirs.
drop policy if exists "Agents can view own location events" on public.agent_location_events;
create policy "Agents can view own location events" on public.agent_location_events
  for select to authenticated using (agent_id = (select public.current_agent_id()));

drop policy if exists "Agents can record own location events" on public.agent_location_events;
create policy "Agents can record own location events" on public.agent_location_events
  for insert to authenticated
  with check (
    agent_id = (select public.current_agent_id())
    and (task_id is null or public.is_my_task(task_id))
  );

commit;
