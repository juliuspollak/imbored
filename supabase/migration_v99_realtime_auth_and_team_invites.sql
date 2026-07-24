begin;

-- Distinguish a historical profile from a historical profile whose Auth user
-- and provider identities have actually been removed.
alter table public.profiles
  add column if not exists auth_deleted_at timestamp with time zone;

-- Backfill accounts whose Auth user was removed before this status existed.
update public.profiles p
set auth_deleted_at=coalesce(p.auth_deleted_at,now())
where p.account_deleted_at is not null
  and not exists(select 1 from auth.users u where u.id=p.id);

-- Owners may invite visible, active players. Keep this server-side because
-- the previous helper allowed any signed-in player to add someone to a team.
create or replace function public.add_player_to_team(target_user_id uuid, target_team_id bigint)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.teams
    where id=target_team_id and created_by=auth.uid()
  ) then
    raise exception 'Only the team owner can invite players.' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.profiles
    where id=target_user_id
      and account_deleted_at is null
      and coalesce(is_blocked,false)=false
      and coalesce(is_approved,false)=true
      and coalesce(is_private,false)=false
      and coalesce(hidden_from_others,false)=false
  ) then
    raise exception 'This player is not available for team invitations.';
  end if;

  insert into public.team_members(team_id,user_id)
  values(target_team_id,target_user_id)
  on conflict do nothing;
end;
$$;

revoke all on function public.add_player_to_team(uuid,bigint) from public;
grant execute on function public.add_player_to_team(uuid,bigint) to authenticated;

-- These tables drive small notification surfaces. Realtime removes the need
-- for browser polling every few seconds. The guards make this migration safe
-- to run more than once.
do $$
declare table_name text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach table_name in array array[
      'pokes',
      'feedback',
      'direct_messages',
      'points_transactions',
      'profiles',
      'team_members',
      'team_join_requests'
    ] loop
      if to_regclass('public.' || table_name) is not null
         and not exists(
           select 1 from pg_publication_tables
           where pubname='supabase_realtime'
             and schemaname='public'
             and tablename=table_name
         ) then
        execute format('alter publication supabase_realtime add table public.%I',table_name);
      end if;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
