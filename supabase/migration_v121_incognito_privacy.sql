-- v121: make incognito mode server-authoritative and race-safe.
--
-- The client still removes its presence row, but privacy must not depend on
-- that request winning a race or even succeeding. These policies hide an
-- incognito player's row, reject stale heartbeat writes, and prevent pokes.

alter table public.profiles
  add column if not exists incognito_mode boolean not null default false;

create or replace function public.is_user_incognito(target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select p.incognito_mode
    from public.profiles p
    where p.id = target_user_id
  ), false);
$$;

revoke all on function public.is_user_incognito(uuid) from public;
grant execute on function public.is_user_incognito(uuid) to authenticated;

drop policy if exists "presence is publicly readable" on public.presence;
drop policy if exists "presence follows player visibility" on public.presence;
create policy "presence follows player visibility"
on public.presence for select
using (
  public.can_view_user(user_id)
  and not public.is_user_incognito(user_id)
);

drop policy if exists "users manage their own presence" on public.presence;
drop policy if exists "users update their own presence" on public.presence;
drop policy if exists "users insert visible presence" on public.presence;
drop policy if exists "users update visible presence" on public.presence;

create policy "users insert visible presence"
on public.presence for insert
with check (
  auth.uid() = user_id
  and not public.is_user_incognito(auth.uid())
);

create policy "users update visible presence"
on public.presence for update
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and not public.is_user_incognito(auth.uid())
);

drop policy if exists "users can send a poke" on public.pokes;
create policy "users can send a poke"
on public.pokes for insert
with check (
  auth.uid() = from_user
  and public.can_view_user(from_user)
  and public.can_view_user(to_user)
  and not public.is_user_incognito(to_user)
);
