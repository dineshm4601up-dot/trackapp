-- Phase 4: master-data administration support.
--
-- Idempotent and non-destructive. Adds:
--   * admin editing of profile display fields (full_name, phone) — role and
--     is_active stay non-writable through the API;
--   * search views over agents+profiles and locations+customers. They are
--     SECURITY INVOKER, so the caller's RLS on the underlying tables applies;
--   * ACTIVATE_* / DEACTIVATE_* audit actions for activation toggles.

begin;

-- 1. Admins can edit agent display details stored on profiles ----------------
grant update (full_name, phone) on public.profiles to authenticated;

drop policy if exists "Admins can update profile details" on public.profiles;
create policy "Admins can update profile details" on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 2. Search views (RLS of the underlying tables applies) ----------------------
create or replace view public.agent_directory
with (security_invoker = true) as
select
  a.id,
  a.profile_id,
  a.employee_code,
  a.is_active,
  a.created_at,
  a.updated_at,
  p.full_name,
  p.email,
  p.phone,
  p.is_active as account_active
from public.agents a
join public.profiles p on p.id = a.profile_id;

create or replace view public.location_directory
with (security_invoker = true) as
select
  l.id,
  l.customer_id,
  l.location_name,
  l.address_line1,
  l.address_line2,
  l.city,
  l.state,
  l.postal_code,
  l.country,
  l.latitude,
  l.longitude,
  l.geofence_radius_meters,
  l.contact_person,
  l.contact_phone,
  l.is_active,
  l.created_at,
  l.updated_at,
  c.name as customer_name,
  c.customer_code,
  c.is_active as customer_active
from public.locations l
join public.customers c on c.id = l.customer_id;

revoke all on public.agent_directory, public.location_directory from anon, authenticated;
grant select on public.agent_directory, public.location_directory to authenticated;

-- 3. Audit: name activation toggles explicitly --------------------------------
-- Same as the Phase 3 function, except an update that changes only is_active
-- is logged as ACTIVATE_<ENTITY> / DEACTIVATE_<ENTITY>.
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
  verb      text;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, old_row -> n.key), jsonb_object_agg(n.key, n.value)
      into old_diff, new_diff
      from jsonb_each(new_row) n
     where n.key <> 'updated_at' and n.value is distinct from old_row -> n.key;
    if new_diff is null then
      return null; -- no-op update
    end if;
    verb := case
      when (select array_agg(k) from jsonb_object_keys(new_diff) k) = array['is_active']
        then case when (new_diff ->> 'is_active')::boolean then 'ACTIVATE_' else 'DEACTIVATE_' end
      else 'UPDATE_'
    end;
  else
    old_diff := old_row - 'updated_at';
    new_diff := new_row - 'updated_at';
    verb := case tg_op when 'INSERT' then 'CREATE_' else 'DELETE_' end;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values)
  values (auth.uid(), verb || entity, entity, (coalesce(new_row, old_row) ->> 'id')::uuid, old_diff, new_diff);
  return null;
end;
$$;

revoke execute on function public.audit_row_change() from public, anon, authenticated;

commit;
