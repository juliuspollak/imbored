-- A private profile is intentionally invisible to other players and cannot
-- participate in circles. Enforce this at the database boundary so every UI,
-- RPC and future client follows the same rule.

create or replace function public.enforce_public_circle_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.profiles p
    where p.id = new.user_id
      and p.is_private = true
  ) then
    raise exception 'Private profiles cannot join circles. Switch your profile to public first.';
  end if;

  return new;
end;
$$;

drop trigger if exists circle_members_require_public_profile on public.circle_members;
create trigger circle_members_require_public_profile
before insert or update of user_id on public.circle_members
for each row
execute function public.enforce_public_circle_member();

create or replace function public.remove_private_profile_from_circles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_private = true and old.is_private is distinct from true then
    delete from public.circle_members
    where user_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_leave_circles_when_private on public.profiles;
create trigger profiles_leave_circles_when_private
after update of is_private on public.profiles
for each row
execute function public.remove_private_profile_from_circles();

-- Clean up any existing private memberships immediately when this migration
-- is applied. This also removes them from active circle standings/rosters.
delete from public.circle_members cm
using public.profiles p
where p.id = cm.user_id
  and p.is_private = true;
