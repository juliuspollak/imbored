-- v153: hidden profiles must never appear in social presence, including to admins.
--
-- Admins can still manage hidden profiles in the dedicated admin screen, but
-- the public online/presence surface has no administrative visibility bypass.

create or replace function public.is_user_hidden(target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path=public
as $$
  select coalesce((
    select
      coalesce(profile.hidden_from_others,false)
      or profile.account_deleted_at is not null
    from public.profiles profile
    where profile.id=target_user_id
  ),true);
$$;

revoke all on function public.is_user_hidden(uuid) from public;
grant execute on function public.is_user_hidden(uuid) to authenticated;

drop policy if exists "presence is publicly readable" on public.presence;
drop policy if exists "presence follows player visibility" on public.presence;
create policy "presence follows player visibility"
on public.presence for select
using (
  not public.is_user_hidden(user_id)
  and not public.is_user_incognito(user_id)
);

drop policy if exists "users insert visible presence" on public.presence;
drop policy if exists "users update visible presence" on public.presence;

create policy "users insert visible presence"
on public.presence for insert
with check (
  auth.uid() = user_id
  and not public.is_user_hidden(auth.uid())
  and not public.is_user_incognito(auth.uid())
);

create policy "users update visible presence"
on public.presence for update
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and not public.is_user_hidden(auth.uid())
  and not public.is_user_incognito(auth.uid())
);

create or replace function public.clear_hidden_user_presence()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.hidden_from_others
    and new.hidden_from_others is distinct from old.hidden_from_others
  then
    delete from public.presence where user_id=new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_hidden_user_presence() from public;

drop trigger if exists clear_hidden_user_presence_trigger on public.profiles;
create trigger clear_hidden_user_presence_trigger
after update of hidden_from_others on public.profiles
for each row execute function public.clear_hidden_user_presence();

create or replace function public.set_user_hidden(target_user_id uuid,hidden boolean)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;

  update public.profiles
  set hidden_from_others=coalesce(hidden,false)
  where id=target_user_id;

  if not found then
    raise exception 'Player not found.' using errcode='22023';
  end if;
end;
$$;

revoke all on function public.set_user_hidden(uuid,boolean) from public;
grant execute on function public.set_user_hidden(uuid,boolean) to authenticated;

notify pgrst,'reload schema';
