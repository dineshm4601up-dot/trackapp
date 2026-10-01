-- Phase 2: authentication profiles and roles.
--
-- Reconciles with objects that may already exist (created earlier via the
-- Dashboard) and creates any that are missing. Idempotent and non-destructive:
-- never drops tables or data; only replaces functions, triggers and policies
-- it owns, using the existing object names.
--
-- Security model:
--   * Every auth user gets exactly one profile (id = auth.users.id), created by
--     a trigger with role AGENT and is_active TRUE. Role is never read from
--     client-supplied metadata.
--   * Signed-in users can read only their own profile and hold no write
--     privileges on profiles. Promotion to ADMIN and deactivation are done by
--     trusted operators (SQL editor / service role) only.

begin;

-- 1. Role enum ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'user_role'
  ) then
    create type public.user_role as enum ('ADMIN', 'AGENT');
  end if;
end
$$;

-- 2. Profiles table ----------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text not null,
  phone       text,
  role        public.user_role not null default 'AGENT',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user (id = auth.users.id). role and is_active are managed by trusted operators only.';

create index if not exists idx_profiles_role on public.profiles (role);
create index if not exists idx_profiles_is_active on public.profiles (is_active);

-- 3. updated_at maintenance (shared by all tables) ----------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 4. Auth user -> profile -----------------------------------------------------
-- full_name comes from user metadata for display only. role and is_active are
-- fixed here (AGENT, TRUE) — never taken from client-supplied metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role, is_active)
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    new.email,
    'AGENT',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for auth users created before the trigger existed.
insert into public.profiles (id, full_name, email)
select u.id, nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), u.email
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- Normalise blank names written by an earlier trigger version.
update public.profiles set full_name = null where btrim(full_name) = '';

-- 5. Role helper ----------------------------------------------------------------
-- The caller's role, or NULL if they have no profile or are inactive.
create or replace function public.get_my_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
$$;

revoke execute on function public.get_my_role() from public, anon;
grant execute on function public.get_my_role() to authenticated;

-- 6. Row Level Security ---------------------------------------------------------
alter table public.profiles enable row level security;

-- Least privilege: RLS already denies writes (no write policies), but table
-- grants are removed too so a future policy can never expose role/is_active.
revoke all on public.profiles from anon;
revoke insert, update, delete, truncate, references, trigger on public.profiles from authenticated;
grant select on public.profiles to authenticated;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

commit;
