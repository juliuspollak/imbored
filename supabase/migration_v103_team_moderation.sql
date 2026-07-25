begin;

-- Removal allows a player to request access again. Blocking is a separate,
-- reversible moderation decision that prevents requests, approval and invites.
create table if not exists public.team_member_blocks (
  team_id bigint not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_by uuid references public.profiles(id) on delete set null,
  blocked_at timestamp with time zone not null default now(),
  reason text,
  primary key(team_id,user_id)
);

alter table public.team_member_blocks enable row level security;

drop policy if exists "team managers view blocks" on public.team_member_blocks;
create policy "team managers view blocks"
on public.team_member_blocks for select to authenticated
using (
  public.is_admin(auth.uid())
  or exists(
    select 1 from public.teams
    where teams.id=team_member_blocks.team_id
      and teams.created_by=auth.uid()
  )
);

-- Members see their own teams; application admins need the same compact
-- roster for moderation across all teams.
create or replace function public.get_my_team_rosters()
returns table(
  team_id bigint,
  user_id uuid,
  member_name text,
  member_icon text,
  member_mood text,
  is_owner boolean
)
language sql
security definer
stable
set search_path=public
as $$
  select
    tm.team_id,
    tm.user_id,
    p.name::text,
    p.icon::text,
    p.mood::text,
    (t.created_by=tm.user_id)
  from public.team_members tm
  join public.teams t on t.id=tm.team_id
  join public.profiles p on p.id=tm.user_id
  where (
    public.is_admin(auth.uid())
    or exists(
      select 1 from public.team_members mine
      where mine.team_id=tm.team_id and mine.user_id=auth.uid()
    )
  )
    and p.account_deleted_at is null
  order by tm.team_id,(t.created_by=tm.user_id) desc,p.name;
$$;

revoke all on function public.get_my_team_rosters() from public;
grant execute on function public.get_my_team_rosters() to authenticated;

create or replace function public.get_my_managed_team_blocks()
returns table(
  team_id bigint,
  user_id uuid,
  member_name text,
  member_icon text,
  blocked_at timestamp with time zone,
  reason text
)
language sql
security definer
stable
set search_path=public
as $$
  select b.team_id,b.user_id,p.name::text,p.icon::text,b.blocked_at,b.reason
  from public.team_member_blocks b
  join public.teams t on t.id=b.team_id
  join public.profiles p on p.id=b.user_id
  where public.is_admin(auth.uid()) or t.created_by=auth.uid()
  order by b.blocked_at desc;
$$;

revoke all on function public.get_my_managed_team_blocks() from public;
grant execute on function public.get_my_managed_team_blocks() to authenticated;

create or replace function public.moderate_team_member(
  target_team_id bigint,
  target_user_id uuid,
  moderation_action text,
  moderation_reason text default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  team_owner uuid;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;

  select created_by into team_owner
  from public.teams
  where id=target_team_id
  for update;
  if not found then raise exception 'Team not found.'; end if;

  if auth.uid()<>team_owner and not public.is_admin(auth.uid()) then
    raise exception 'Only the team owner or an app administrator can manage members.' using errcode='42501';
  end if;
  if target_user_id=team_owner then
    raise exception 'The team owner cannot be removed or blocked.';
  end if;

  if moderation_action='remove' then
    delete from public.team_members
    where team_id=target_team_id and user_id=target_user_id;
    delete from public.team_join_requests
    where team_id=target_team_id and user_id=target_user_id;
  elsif moderation_action='block' then
    delete from public.team_members
    where team_id=target_team_id and user_id=target_user_id;
    delete from public.team_join_requests
    where team_id=target_team_id and user_id=target_user_id;
    insert into public.team_member_blocks(team_id,user_id,blocked_by,reason)
    values(target_team_id,target_user_id,auth.uid(),nullif(btrim(moderation_reason),''))
    on conflict(team_id,user_id) do update set
      blocked_by=excluded.blocked_by,
      blocked_at=now(),
      reason=excluded.reason;
  elsif moderation_action='unblock' then
    delete from public.team_member_blocks
    where team_id=target_team_id and user_id=target_user_id;
  else
    raise exception 'Invalid team moderation action.';
  end if;
end;
$$;

revoke all on function public.moderate_team_member(bigint,uuid,text,text) from public;
grant execute on function public.moderate_team_member(bigint,uuid,text,text) to authenticated;

create or replace function public.delete_managed_team(
  target_team_id bigint,
  expected_team_name text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  target_team public.teams;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  select * into target_team from public.teams where id=target_team_id for update;
  if not found then raise exception 'Team not found.'; end if;
  if auth.uid()<>target_team.created_by and not public.is_admin(auth.uid()) then
    raise exception 'Only the team owner or an app administrator can delete this team.' using errcode='42501';
  end if;
  if btrim(coalesce(expected_team_name,''))<>target_team.name then
    raise exception 'Enter the exact team name to confirm deletion.';
  end if;

  delete from public.teams where id=target_team_id;
end;
$$;

revoke all on function public.delete_managed_team(bigint,text) from public;
grant execute on function public.delete_managed_team(bigint,text) to authenticated;

-- Apply the block consistently to every way a player can enter a team.
create or replace function public.request_team_join(target_team_id bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if exists(select 1 from public.profiles where id=auth.uid() and coalesce(hidden_from_others,false)) then
    raise exception 'Hidden players cannot join teams';
  end if;
  if exists(select 1 from public.team_member_blocks where team_id=target_team_id and user_id=auth.uid()) then
    raise exception 'You cannot request access to this team.';
  end if;
  if exists(select 1 from public.team_members where team_id=target_team_id and user_id=auth.uid()) then
    raise exception 'You are already a member';
  end if;
  delete from public.team_join_requests where team_id=target_team_id and user_id=auth.uid() and status<>'pending';
  insert into public.team_join_requests(team_id,user_id,status)
  values(target_team_id,auth.uid(),'pending')
  on conflict do nothing;
end;
$$;

revoke all on function public.request_team_join(bigint) from public;
grant execute on function public.request_team_join(bigint) to authenticated;

create or replace function public.decide_team_join_request(request_id bigint, approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare r public.team_join_requests; owner_id uuid;
begin
  select * into r from public.team_join_requests where id=request_id and status='pending' for update;
  if not found then raise exception 'Request is no longer pending'; end if;
  select created_by into owner_id from public.teams where id=r.team_id;
  if owner_id<>auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'Only the team owner or an app administrator can decide this request';
  end if;
  if approve then
    if exists(select 1 from public.team_member_blocks where team_id=r.team_id and user_id=r.user_id) then
      raise exception 'This player is blocked from the team.';
    end if;
    if exists(select 1 from public.profiles where id=r.user_id and coalesce(hidden_from_others,false)) then
      raise exception 'Hidden players cannot join teams';
    end if;
    insert into public.team_members(team_id,user_id) values(r.team_id,r.user_id) on conflict do nothing;
  end if;
  update public.team_join_requests set
    status=case when approve then 'approved' else 'declined' end,
    decided_at=now(),decided_by=auth.uid(),user_seen_at=null
  where id=request_id;
end;
$$;

revoke all on function public.decide_team_join_request(bigint,boolean) from public;
grant execute on function public.decide_team_join_request(bigint,boolean) to authenticated;

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
    where id=target_team_id
      and (created_by=auth.uid() or public.is_admin(auth.uid()))
  ) then
    raise exception 'Only the team owner or an app administrator can invite players.' using errcode='42501';
  end if;
  if exists(select 1 from public.team_member_blocks where team_id=target_team_id and user_id=target_user_id) then
    raise exception 'This player is blocked from the team.';
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

notify pgrst, 'reload schema';
commit;
