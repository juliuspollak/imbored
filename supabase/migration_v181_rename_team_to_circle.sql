-- v181: Rename Team -> Circle everywhere, full backend rename.
--
-- Tables/columns are handled with ALTER ... RENAME, which Postgres tracks
-- automatically for RLS policies, indexes, constraints and triggers (they
-- store OID-bound references, not text) — so none of those need to be
-- touched separately. Only function BODIES are opaque text and must be
-- re-authored; every function here is dropped under its old name and
-- recreated under its new name with every internal team-> circle
-- reference updated, using each function's current source as of v180.
-- Run after v180.

begin;

-- ============================================================
-- 1. Table renames
-- ============================================================
alter table if exists public.teams rename to circles;
alter table if exists public.team_members rename to circle_members;
alter table if exists public.team_invitations rename to circle_invitations;
alter table if exists public.team_member_blocks rename to circle_member_blocks;
alter table if exists public.team_join_requests rename to circle_join_requests;
alter table if exists public.team_weekly_challenges rename to circle_weekly_challenges;
alter table if exists public.team_challenge_rounds rename to circle_challenge_rounds;
alter table if exists public.team_challenge_starts rename to circle_challenge_starts;
alter table if exists public.team_challenge_reward_awards rename to circle_challenge_reward_awards;
alter table if exists public.team_challenge_stake_acceptances rename to circle_challenge_stake_acceptances;

-- ============================================================
-- 2. Column renames
-- ============================================================
alter table public.circle_members rename column team_id to circle_id;
alter table public.circle_invitations rename column team_id to circle_id;
alter table public.circle_member_blocks rename column team_id to circle_id;
alter table public.circle_join_requests rename column team_id to circle_id;
alter table public.circle_weekly_challenges rename column team_id to circle_id;
alter table public.rewards rename column team_id to circle_id;
alter table public.game_stats rename column team_id to circle_id;
alter table public.game_stats rename column team_challenge_id to circle_challenge_id;

-- ============================================================
-- 3. Drop every old team-named function/trigger before recreating
--    under the new name (old bodies would reference renamed tables).
-- ============================================================
-- These policies reference is_team_reward_approver/etc. in their USING/CHECK
-- expressions; they must be dropped before the functions below, or the
-- function drops fail with "cannot drop function because other objects
-- depend on it". Equivalent circle-named policies are recreated in step 4.
drop policy if exists "team members and admins view rewards" on public.rewards;
drop policy if exists "team reward approvers update rewards" on public.rewards;
drop policy if exists "team members can view approvals" on public.reward_approvals;

drop trigger if exists sync_team_challenge_rounds_trigger on public.circle_weekly_challenges;
drop trigger if exists team_challenge_reward_cap_trigger on public.circle_weekly_challenges;
drop trigger if exists validate_team_challenge_games_trigger on public.circle_weekly_challenges;
-- These three are on game_stats (not circle_weekly_challenges) and must be
-- dropped before their underlying functions, or the function drops below
-- fail with "cannot drop function because other objects depend on it".
drop trigger if exists validate_team_challenge_attempt_trigger on public.game_stats;
drop trigger if exists award_completed_team_challenge_trigger on public.game_stats;
drop trigger if exists game_stats_notify_team_daily_challenge on public.game_stats;

drop function if exists public.create_team(text,text);
drop function if exists public.leave_team(bigint);
drop function if exists public.delete_managed_team(bigint,text);
drop function if exists public.add_player_to_team(uuid,bigint);
drop function if exists public.remove_player_from_team(bigint,uuid);
drop function if exists public.moderate_team_member(bigint,uuid,text,text);
drop function if exists public.request_team_join(bigint);
drop function if exists public.decide_team_join_request(bigint,boolean);
drop function if exists public.mark_my_team_request_updates_seen();
drop function if exists public.get_my_team_rosters();
drop function if exists public.get_my_managed_team_blocks();
drop function if exists public.invite_player_to_team(uuid,bigint);
drop function if exists public.get_my_pending_team_invitations();
-- Leftover from the old guardian-circles feature (migration_v170); v179's
-- merge into teams missed dropping this one, and its OUT columns differ
-- from the team-invitations version recreated below under the same name.
drop function if exists public.get_my_pending_circle_invitations();
drop function if exists public.decide_team_invitation(bigint,boolean);
drop function if exists public.get_my_active_team_challenges();
drop function if exists public.get_my_team_challenge_lifecycle();
drop function if exists public.get_my_team_challenge_history(integer);
drop function if exists public.set_team_weekly_challenge(bigint,text[],integer[],integer,text,text,bigint,text,boolean,integer);
drop function if exists public.notify_team_daily_challenge_completed();
drop function if exists public.enforce_team_challenge_reward_cap();
drop function if exists public.validate_team_challenge_games();
drop function if exists public.ensure_team_challenge_rounds(bigint);
drop function if exists public.sync_team_challenge_rounds();
drop function if exists public.team_challenge_daily_score(text,date,integer,integer,integer);
drop function if exists public.start_team_challenge_game(bigint,text,date);
drop function if exists public.validate_team_challenge_attempt();
drop function if exists public.finalize_team_challenge(bigint);
drop function if exists public.finalize_due_team_challenges();
drop function if exists public.award_completed_team_challenge();
drop function if exists public.get_my_reward_teams();
drop function if exists public.set_team_reward_approver(bigint,uuid,boolean);
drop function if exists public.transfer_team_ownership(bigint,uuid);
drop function if exists public.set_team_challenge_stake(bigint,bigint,text);
drop function if exists public.search_players_to_invite(text,bigint);
drop function if exists public.is_team_reward_approver(bigint,uuid);

-- ============================================================
-- 4. Recreate under circle-based names
-- ============================================================

create or replace function public.create_circle(circle_name text, circle_emoji text default '⭐')
returns public.circles
language plpgsql
security definer
set search_path=public
as $$
declare result public.circles;
begin
  if not public.is_available_player(auth.uid()) then
    raise exception 'Your account must be active and approved first.' using errcode='42501';
  end if;
  if exists(
    select 1 from public.profiles profile
    where profile.id=auth.uid() and coalesce(profile.hidden_from_others,false)
  ) then
    raise exception 'Hidden players cannot create circles.' using errcode='42501';
  end if;
  if nullif(btrim(circle_name),'') is null then
    raise exception 'Circle name is required.' using errcode='22023';
  end if;

  insert into public.circles(name,emoji,created_by)
  values(btrim(circle_name),coalesce(nullif(btrim(circle_emoji),''),'⭐'),auth.uid())
  returning * into result;

  insert into public.circle_members(circle_id,user_id)
  values(result.id,auth.uid());
  return result;
end;
$$;
revoke all on function public.create_circle(text,text) from public;
grant execute on function public.create_circle(text,text) to authenticated;

-- Circle creator leaving transfers ownership to the earliest remaining member.
create or replace function public.leave_circle(target_circle_id bigint)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare was_owner boolean; next_owner uuid;
begin
  if not public.is_approved_user(auth.uid()) then raise exception 'Your account must be approved first.' using errcode='42501'; end if;
  select exists(select 1 from public.circles c where c.id=target_circle_id and c.created_by=auth.uid()) into was_owner;
  delete from public.circle_members where circle_id=target_circle_id and user_id=auth.uid();
  if not found then raise exception 'You are not a member of this circle.'; end if;

  select cm.user_id into next_owner from public.circle_members cm
  where cm.circle_id=target_circle_id order by cm.joined_at asc nulls last,cm.user_id limit 1;
  if next_owner is null then
    delete from public.circles where id=target_circle_id;
  elsif was_owner then
    update public.circles set created_by=next_owner where id=target_circle_id;
  end if;
end;
$$;
grant execute on function public.leave_circle(bigint) to authenticated;

create or replace function public.delete_managed_circle(
  target_circle_id bigint,
  expected_circle_name text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  target_circle public.circles;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  select * into target_circle from public.circles where id=target_circle_id for update;
  if not found then raise exception 'Circle not found.'; end if;
  if auth.uid()<>target_circle.created_by and not public.is_admin(auth.uid()) then
    raise exception 'Only the circle owner or an app administrator can delete this circle.' using errcode='42501';
  end if;
  if btrim(coalesce(expected_circle_name,''))<>target_circle.name then
    raise exception 'Enter the exact circle name to confirm deletion.';
  end if;

  delete from public.circles where id=target_circle_id;
end;
$$;
revoke all on function public.delete_managed_circle(bigint,text) from public;
grant execute on function public.delete_managed_circle(bigint,text) to authenticated;

create or replace function public.add_player_to_circle(target_user_id uuid, target_circle_id bigint)
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
    select 1 from public.circles
    where id=target_circle_id
      and (created_by=auth.uid() or public.is_admin(auth.uid()))
  ) then
    raise exception 'Only the circle owner or an app administrator can invite players.' using errcode='42501';
  end if;
  if exists(select 1 from public.circle_member_blocks where circle_id=target_circle_id and user_id=target_user_id) then
    raise exception 'This player is blocked from the circle.';
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
    raise exception 'This player is not available for circle invitations.';
  end if;
  insert into public.circle_members(circle_id,user_id)
  values(target_circle_id,target_user_id)
  on conflict do nothing;
end;
$$;
revoke all on function public.add_player_to_circle(uuid,bigint) from public;
grant execute on function public.add_player_to_circle(uuid,bigint) to authenticated;

-- Membership removal is deliberately owner-only. The owner cannot remove
-- themselves through this action; deleting/leaving an owned circle remains a
-- separate, explicit workflow.
create or replace function public.remove_player_from_circle(
  target_circle_id bigint,
  target_user_id uuid
)
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
    select 1
    from public.circles
    where id=target_circle_id
      and created_by=auth.uid()
  ) then
    raise exception 'Only the circle owner can remove members.' using errcode='42501';
  end if;
  if target_user_id=auth.uid() then
    raise exception 'The circle owner cannot remove themselves.';
  end if;

  delete from public.circle_members
  where circle_id=target_circle_id
    and user_id=target_user_id;

  delete from public.circle_join_requests
  where circle_id=target_circle_id
    and user_id=target_user_id;
end;
$$;

create or replace function public.moderate_circle_member(
  target_circle_id bigint,
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
  circle_owner uuid;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;

  select created_by into circle_owner
  from public.circles
  where id=target_circle_id
  for update;
  if not found then raise exception 'Circle not found.'; end if;

  if auth.uid()<>circle_owner and not public.is_admin(auth.uid()) then
    raise exception 'Only the circle owner or an app administrator can manage members.' using errcode='42501';
  end if;
  if target_user_id=circle_owner then
    raise exception 'The circle owner cannot be removed or blocked.';
  end if;

  if moderation_action='remove' then
    delete from public.circle_members
    where circle_id=target_circle_id and user_id=target_user_id;
    delete from public.circle_join_requests
    where circle_id=target_circle_id and user_id=target_user_id;
  elsif moderation_action='block' then
    delete from public.circle_members
    where circle_id=target_circle_id and user_id=target_user_id;
    delete from public.circle_join_requests
    where circle_id=target_circle_id and user_id=target_user_id;
    insert into public.circle_member_blocks(circle_id,user_id,blocked_by,reason)
    values(target_circle_id,target_user_id,auth.uid(),nullif(btrim(moderation_reason),''))
    on conflict(circle_id,user_id) do update set
      blocked_by=excluded.blocked_by,
      blocked_at=now(),
      reason=excluded.reason;
  elsif moderation_action='unblock' then
    delete from public.circle_member_blocks
    where circle_id=target_circle_id and user_id=target_user_id;
  else
    raise exception 'Invalid circle moderation action.';
  end if;
end;
$$;
revoke all on function public.moderate_circle_member(bigint,uuid,text,text) from public;
grant execute on function public.moderate_circle_member(bigint,uuid,text,text) to authenticated;

-- Apply the block consistently to every way a player can enter a circle.
create or replace function public.request_circle_join(target_circle_id bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if exists(select 1 from public.profiles where id=auth.uid() and coalesce(hidden_from_others,false)) then
    raise exception 'Hidden players cannot join circles';
  end if;
  if exists(select 1 from public.circle_member_blocks where circle_id=target_circle_id and user_id=auth.uid()) then
    raise exception 'You cannot request access to this circle.';
  end if;
  if exists(select 1 from public.circle_members where circle_id=target_circle_id and user_id=auth.uid()) then
    raise exception 'You are already a member';
  end if;
  delete from public.circle_join_requests where circle_id=target_circle_id and user_id=auth.uid() and status<>'pending';
  insert into public.circle_join_requests(circle_id,user_id,status)
  values(target_circle_id,auth.uid(),'pending')
  on conflict do nothing;
end;
$$;
revoke all on function public.request_circle_join(bigint) from public;
grant execute on function public.request_circle_join(bigint) to authenticated;

create or replace function public.decide_circle_join_request(request_id bigint, approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare r public.circle_join_requests; owner_id uuid;
begin
  select * into r from public.circle_join_requests where id=request_id and status='pending' for update;
  if not found then raise exception 'Request is no longer pending'; end if;
  select created_by into owner_id from public.circles where id=r.circle_id;
  if owner_id<>auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'Only the circle owner or an app administrator can decide this request';
  end if;
  if approve then
    if exists(select 1 from public.circle_member_blocks where circle_id=r.circle_id and user_id=r.user_id) then
      raise exception 'This player is blocked from the circle.';
    end if;
    if exists(select 1 from public.profiles where id=r.user_id and coalesce(hidden_from_others,false)) then
      raise exception 'Hidden players cannot join circles';
    end if;
    insert into public.circle_members(circle_id,user_id) values(r.circle_id,r.user_id) on conflict do nothing;
  end if;
  update public.circle_join_requests set
    status=case when approve then 'approved' else 'declined' end,
    decided_at=now(),decided_by=auth.uid(),user_seen_at=null
  where id=request_id;
end;
$$;
revoke all on function public.decide_circle_join_request(bigint,boolean) from public;
grant execute on function public.decide_circle_join_request(bigint,boolean) to authenticated;

create or replace function public.mark_my_circle_request_updates_seen()
returns void language sql security definer set search_path=public as $$
 update public.circle_join_requests set user_seen_at=now()
 where user_id=auth.uid() and status<>'pending' and user_seen_at is null;
$$;
grant execute on function public.mark_my_circle_request_updates_seen() to authenticated;

-- Members see their own circles; application admins need the same compact
-- roster for moderation across all circles.
create or replace function public.get_my_circle_rosters()
returns table(
  circle_id bigint,
  user_id uuid,
  member_name text,
  member_icon text,
  member_mood text,
  is_owner boolean,
  show_stats_to_others boolean,
  can_approve_rewards boolean
)
language sql
security definer
stable
set search_path=public
as $$
  select
    membership.circle_id,
    membership.user_id,
    profile.name::text,
    profile.icon::text,
    profile.mood::text,
    (circle.created_by=membership.user_id),
    profile.show_stats_to_others,
    membership.can_approve_rewards
  from public.circle_members membership
  join public.circles circle on circle.id=membership.circle_id
  join public.profiles profile on profile.id=membership.user_id
  where (
    public.is_admin(auth.uid())
    or exists(
      select 1
      from public.circle_members mine
      where mine.circle_id=membership.circle_id
        and mine.user_id=auth.uid()
    )
  )
    and coalesce(profile.hidden_from_others,false)=false
    and profile.account_deleted_at is null
  order by
    membership.circle_id,
    (circle.created_by=membership.user_id) desc,
    profile.name;
$$;
revoke all on function public.get_my_circle_rosters() from public;
grant execute on function public.get_my_circle_rosters() to authenticated;

create or replace function public.get_my_managed_circle_blocks()
returns table(
  circle_id bigint,
  user_id uuid,
  member_name text,
  member_icon text,
  blocked_at timestamptz,
  reason text
)
language sql
security definer
stable
set search_path=public
as $$
  select block.circle_id,block.user_id,profile.name::text,profile.icon::text,block.blocked_at,block.reason
  from public.circle_member_blocks block
  join public.circles circle on circle.id=block.circle_id
  join public.profiles profile on profile.id=block.user_id
  where (public.is_admin(auth.uid()) or circle.created_by=auth.uid())
    and coalesce(profile.hidden_from_others,false)=false
    and profile.account_deleted_at is null
  order by block.blocked_at desc;
$$;
revoke all on function public.get_my_managed_circle_blocks() from public;
grant execute on function public.get_my_managed_circle_blocks() to authenticated;

create or replace function public.invite_player_to_circle(
  target_user_id uuid,
  target_circle_id bigint
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  invitation_id bigint;
  inviter_name text;
  circle_name text;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.circle_members
    where circle_id=target_circle_id and user_id=auth.uid()
  ) then
    raise exception 'Only circle members can invite players.' using errcode='42501';
  end if;
  if target_user_id=auth.uid() then raise exception 'You are already on this circle.'; end if;
  if exists(
    select 1 from public.circle_members
    where circle_id=target_circle_id and user_id=target_user_id
  ) then raise exception 'This player is already on the circle.'; end if;
  if exists(
    select 1 from public.circle_member_blocks
    where circle_id=target_circle_id and user_id=target_user_id
  ) then raise exception 'This player cannot be invited to the circle.'; end if;
  if not exists(
    select 1 from public.profiles
    where id=target_user_id
      and account_deleted_at is null
      and coalesce(is_blocked,false)=false
      and coalesce(is_approved,false)=true
      and coalesce(is_private,false)=false
      and coalesce(hidden_from_others,false)=false
  ) then raise exception 'This player is not available for invitations.'; end if;

  insert into public.circle_invitations(circle_id,invited_user_id,invited_by)
  values(target_circle_id,target_user_id,auth.uid())
  on conflict(circle_id,invited_user_id) where status='pending'
  do update set invited_by=excluded.invited_by,created_at=now()
  returning id into invitation_id;

  select name into inviter_name from public.profiles where id=auth.uid();
  select name into circle_name from public.circles where id=target_circle_id;

  delete from public.direct_messages
  where activity_type='circle_invitation'
    and source_stat_id=invitation_id
    and recipient_id=target_user_id;
  insert into public.direct_messages(
    sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
  ) values(
    auth.uid(),target_user_id,
    format('💌 %s invited you to join %s. Tap to respond.',coalesce(inviter_name,'A player'),coalesce(circle_name,'a circle')),
    true,'circle_invitation',invitation_id
  );
end;
$$;
revoke all on function public.invite_player_to_circle(uuid,bigint) from public;
grant execute on function public.invite_player_to_circle(uuid,bigint) to authenticated;

create or replace function public.get_my_pending_circle_invitations()
returns table(
  invitation_id bigint,circle_id bigint,circle_name text,circle_emoji text,
  invited_by uuid,inviter_name text,inviter_icon text,created_at timestamptz
)
language sql
security definer
stable
set search_path=public
as $$
  select i.id,c.id,c.name::text,c.emoji::text,i.invited_by,p.name::text,p.icon::text,i.created_at
  from public.circle_invitations i
  join public.circles c on c.id=i.circle_id
  join public.profiles p on p.id=i.invited_by
  where i.invited_user_id=auth.uid() and i.status='pending'
  order by i.created_at desc;
$$;
revoke all on function public.get_my_pending_circle_invitations() from public;
grant execute on function public.get_my_pending_circle_invitations() to authenticated;

create or replace function public.decide_circle_invitation(
  target_invitation_id bigint,
  accept_invitation boolean
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  item public.circle_invitations;
begin
  select * into item from public.circle_invitations
  where id=target_invitation_id and invited_user_id=auth.uid() and status='pending'
  for update;
  if not found then raise exception 'Invitation is no longer available.'; end if;

  if accept_invitation then
    if exists(
      select 1 from public.circle_member_blocks
      where circle_id=item.circle_id and user_id=auth.uid()
    ) then raise exception 'You cannot join this circle.'; end if;
    insert into public.circle_members(circle_id,user_id)
    values(item.circle_id,auth.uid())
    on conflict do nothing;
  end if;

  update public.circle_invitations
  set status=case when accept_invitation then 'accepted' else 'declined' end,
      decided_at=now()
  where id=item.id;
  update public.direct_messages
  set read_at=coalesce(read_at,now())
  where activity_type='circle_invitation'
    and source_stat_id=item.id
    and recipient_id=auth.uid();
end;
$$;
revoke all on function public.decide_circle_invitation(bigint,boolean) from public;
grant execute on function public.decide_circle_invitation(bigint,boolean) to authenticated;

create or replace function public.notify_circle_daily_challenge_completed()
returns trigger language plpgsql security definer set search_path=public as $$
declare player_name text; game_label text; notification_body text;
begin
  if new.mode is distinct from 'challenge' or new.challenge_date is null or new.circle_challenge_id is null or new.circle_id is null then return new; end if;
  select coalesce(nullif(btrim(p.name),''),'A teammate') into player_name from public.profiles p where p.id=new.user_id;
  game_label:=case lower(new.game) when 'hive' then 'Hive' when 'tango' then 'Tango' when 'gridly' then 'Gridly' when 'minisudoku' then 'Mini Sudoku' when 'geo' then 'Geo' else initcap(replace(new.game,'_',' ')) end;
  notification_body:=format('🏁 %s finished the %s circle challenge! Think you can beat them? 🎮',coalesce(player_name,'A teammate'),game_label);
  insert into public.direct_messages(sender_id,recipient_id,body,system_generated,activity_type,source_stat_id)
  select new.user_id,cm.user_id,notification_body,true,'circle_daily_challenge',new.id
  from public.circle_members cm where cm.circle_id=new.circle_id and cm.user_id<>new.user_id
  on conflict do nothing;
  return new;
end;$$;

create or replace function public.enforce_circle_challenge_reward_cap()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if coalesce(new.reward_points,0) not between 0 and 50 then
    raise exception 'A circle challenge winner''s prize must be between 0 and 50 points.';
  end if;
  return new;
end;
$$;

create trigger circle_challenge_reward_cap_trigger
before insert or update of reward_points
on public.circle_weekly_challenges
for each row execute function public.enforce_circle_challenge_reward_cap();

create or replace function public.validate_circle_challenge_games()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from unnest(coalesce(new.game_ids, array[]::text[])) selected(game_id)
    left join public.game_config config
      on config.game_id = selected.game_id
    where coalesce(config.challenge_enabled, false) = false
  ) then
    raise exception 'One or more selected games are not available in Challenges.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;
revoke all on function public.validate_circle_challenge_games() from public;

create trigger validate_circle_challenge_games_trigger
before insert or update of game_ids
on public.circle_weekly_challenges
for each row execute function public.validate_circle_challenge_games();

create or replace function public.ensure_circle_challenge_rounds(
  target_challenge_id bigint
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  challenge public.circle_weekly_challenges;
begin
  select *
  into challenge
  from public.circle_weekly_challenges
  where id=target_challenge_id;

  if not found
     or coalesce(cardinality(challenge.game_ids),0)=0
     or coalesce(cardinality(challenge.active_days),0)=0 then
    return;
  end if;

  insert into public.circle_challenge_rounds(
    challenge_id,challenge_date,game,round_number
  )
  select
    challenge.id,
    challenge.week_start+(scheduled.iso_day-1),
    coalesce(
      (
        select result.game
        from public.game_stats result
        where result.circle_challenge_id=challenge.id
          and result.mode='challenge'
          and result.challenge_date=challenge.week_start+(scheduled.iso_day-1)
          and result.game=any(challenge.game_ids)
        order by result.completed_at,result.id
        limit 1
      ),
      challenge.game_ids[
        ((scheduled.ordinality::integer-1)%cardinality(challenge.game_ids))+1
      ]
    ),
    scheduled.ordinality::integer
  from (
    select
      selected_day.iso_day,
      row_number() over(order by selected_day.iso_day) as ordinality
    from (
      select distinct unnest(challenge.active_days) as iso_day
    ) selected_day
    where selected_day.iso_day between 1 and 7
  ) scheduled
  on conflict(challenge_id,challenge_date) do nothing;
end;
$$;
revoke all on function public.ensure_circle_challenge_rounds(bigint) from public;

create or replace function public.sync_circle_challenge_rounds()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='UPDATE'
     and (
       old.week_start is distinct from new.week_start
       or old.game_ids is distinct from new.game_ids
       or old.active_days is distinct from new.active_days
     )
     and not exists(
       select 1 from public.circle_challenge_starts
       where challenge_id=new.id
     )
     and not exists(
       select 1 from public.game_stats
       where circle_challenge_id=new.id
     ) then
    delete from public.circle_challenge_rounds
    where challenge_id=new.id;
  end if;

  perform public.ensure_circle_challenge_rounds(new.id);
  return new;
end;
$$;

create trigger sync_circle_challenge_rounds_trigger
after insert or update
on public.circle_weekly_challenges
for each row execute function public.sync_circle_challenge_rounds();

create or replace function public.circle_challenge_daily_score(
  target_game text,
  target_challenge_date date,
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer
)
returns integer
language sql
security definer
stable
set search_path=public
as $$
  select greatest(
    20,
    least(
      150,
      round(
        100
        * coalesce(
          (
            select benchmark.effective_seconds
            from public.game_time_benchmarks benchmark
            where benchmark.game=target_game
              and benchmark.mode='challenge'
              and benchmark.day_index=
                extract(isodow from target_challenge_date)::integer-1
            order by benchmark.updated_at desc nulls last
            limit 1
          ),
          100
        )
        / greatest(
          1,
          greatest(coalesce(elapsed_seconds,0),0)
          + greatest(coalesce(hint_count,0),0)*30
          + greatest(coalesce(mistake_count,0),0)*15
        )
      )::integer
    )
  )
$$;
revoke all on function public.circle_challenge_daily_score(
  text,date,integer,integer,integer
) from public;

create or replace function public.start_circle_challenge_game(
  target_challenge_id bigint,
  target_game text,
  target_challenge_date date
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  challenge public.circle_weekly_challenges;
  assigned_round public.circle_challenge_rounds;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.'
      using errcode='42501';
  end if;

  select *
  into challenge
  from public.circle_weekly_challenges
  where id=target_challenge_id;

  if not found then
    raise exception 'Circle challenge not found.' using errcode='22023';
  end if;
  if challenge.closed_at is not null then
    raise exception 'This circle challenge is finished.' using errcode='55000';
  end if;
  if not exists(
    select 1
    from public.circle_members member
    where member.circle_id=challenge.circle_id
      and member.user_id=auth.uid()
  ) then
    raise exception 'You are not a member of this circle.' using errcode='42501';
  end if;
  if challenge.stake_reward_id is not null and not exists(
    select 1 from public.circle_challenge_stake_acceptances a
    where a.challenge_id=challenge.id and a.user_id=auth.uid()
  ) then
    raise exception 'Accept this challenge''s stake before playing today''s round.' using errcode='42501';
  end if;
  if target_challenge_date is distinct from public.app_today() then
    raise exception 'Circle challenge rounds can only be played on their scheduled day.'
      using errcode='22023';
  end if;

  perform public.ensure_circle_challenge_rounds(challenge.id);

  select *
  into assigned_round
  from public.circle_challenge_rounds
  where challenge_id=challenge.id
    and challenge_date=target_challenge_date;

  if not found then
    raise exception 'This circle challenge has no round scheduled today.'
      using errcode='22023';
  end if;
  if assigned_round.game is distinct from target_game then
    raise exception 'Today''s assigned game is %.',assigned_round.game
      using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        'circle-challenge-round:%s:%s:%s',
        challenge.id,
        auth.uid(),
        target_challenge_date
      ),
      0
    )
  );

  if exists(
    select 1
    from public.game_stats result
    where result.circle_challenge_id=challenge.id
      and result.user_id=auth.uid()
      and result.challenge_date=target_challenge_date
  ) then
    raise exception 'You already completed today''s challenge round.'
      using errcode='23505';
  end if;

  insert into public.circle_challenge_starts(
    challenge_id,player_id,game,challenge_date
  )
  values(
    challenge.id,auth.uid(),assigned_round.game,target_challenge_date
  )
  on conflict do nothing;

  update public.circle_weekly_challenges
  set locked_at=coalesce(locked_at,now())
  where id=challenge.id;
end;
$$;
revoke all on function public.start_circle_challenge_game(bigint,text,date) from public;
grant execute on function public.start_circle_challenge_game(bigint,text,date) to authenticated;

create or replace function public.validate_circle_challenge_attempt()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  challenge public.circle_weekly_challenges;
  assigned_round public.circle_challenge_rounds;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.'
      using errcode='42501';
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'You can only save your own result.' using errcode='42501';
  end if;
  if new.mode is distinct from 'challenge'
     or new.circle_challenge_id is null then
    return new;
  end if;

  select *
  into challenge
  from public.circle_weekly_challenges
  where id=new.circle_challenge_id;

  if not found then
    raise exception 'Circle challenge not found.';
  end if;
  if challenge.closed_at is not null then
    raise exception 'This circle challenge is finished.' using errcode='55000';
  end if;
  if new.circle_id is distinct from challenge.circle_id then
    raise exception 'Circle challenge does not match the selected circle.';
  end if;
  if not exists(
    select 1
    from public.circle_members member
    where member.circle_id=challenge.circle_id
      and member.user_id=new.user_id
  ) then
    raise exception 'You are not a member of this circle.';
  end if;

  perform public.ensure_circle_challenge_rounds(challenge.id);

  select *
  into assigned_round
  from public.circle_challenge_rounds
  where challenge_id=challenge.id
    and challenge_date=new.challenge_date;

  if not found
     or assigned_round.game is distinct from new.game then
    raise exception 'This is not the game assigned to that challenge round.';
  end if;
  if not exists(
    select 1
    from public.circle_challenge_starts challenge_start
    where challenge_start.challenge_id=challenge.id
      and challenge_start.player_id=new.user_id
      and challenge_start.game=assigned_round.game
      and challenge_start.challenge_date=assigned_round.challenge_date
  ) then
    raise exception 'Start this circle challenge from the challenge screen first.'
      using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        'circle-challenge-round:%s:%s:%s',
        challenge.id,
        new.user_id,
        new.challenge_date
      ),
      0
    )
  );

  if exists(
    select 1
    from public.game_stats result
    where result.circle_challenge_id=challenge.id
      and result.user_id=new.user_id
      and result.challenge_date=new.challenge_date
      and result.id is distinct from new.id
  ) then
    raise exception 'You already completed this challenge round.'
      using errcode='23505';
  end if;

  update public.circle_weekly_challenges
  set locked_at=coalesce(locked_at,now())
  where id=challenge.id;

  return new;
end;
$$;

create or replace function public.finalize_circle_challenge(
  target_challenge_id bigint
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  challenge public.circle_weekly_challenges;
  required_rounds integer;
  member_count integer;
  finisher_count integer;
  deadline date;
  winner_id uuid;
  winner_stat_id bigint;
  winner_name text;
  circle_name text;
  award_created bigint;
  existing_winner uuid;
  winning_score integer;
begin
  select *
  into challenge
  from public.circle_weekly_challenges
  where id=target_challenge_id
  for update;

  if not found then
    return null;
  end if;

  select award.player_id
  into existing_winner
  from public.circle_challenge_reward_awards award
  where award.challenge_id=challenge.id
  order by award.awarded_at,award.id
  limit 1;

  if challenge.closed_at is not null then
    return existing_winner;
  end if;
  if existing_winner is not null then
    update public.circle_weekly_challenges
    set closed_at=coalesce(closed_at,now()),updated_at=now()
    where id=challenge.id;
    return existing_winner;
  end if;

  perform public.ensure_circle_challenge_rounds(challenge.id);

  select count(*),max(round_item.challenge_date)
  into required_rounds,deadline
  from public.circle_challenge_rounds round_item
  where round_item.challenge_id=challenge.id;

  select count(*)
  into member_count
  from public.circle_members member
  where member.circle_id=challenge.circle_id;

  select count(*)
  into finisher_count
  from (
    select member.user_id
    from public.circle_members member
    cross join public.circle_challenge_rounds round_item
    left join public.game_stats result
      on result.circle_challenge_id=challenge.id
     and result.user_id=member.user_id
     and result.mode='challenge'
     and result.challenge_date=round_item.challenge_date
     and result.game=round_item.game
    where member.circle_id=challenge.circle_id
      and round_item.challenge_id=challenge.id
    group by member.user_id
    having count(distinct result.challenge_date)=required_rounds
  ) finishers;

  if required_rounds=0
     or (
       public.app_today()<=deadline
       and (member_count=0 or finisher_count<member_count)
     ) then
    return null;
  end if;

  with member_rounds as (
    select
      member.user_id,
      round_item.challenge_date,
      round_item.game,
      result.id as stat_id,
      result.seconds,
      result.hints,
      result.mistakes,
      result.completed_at
    from public.circle_members member
    cross join public.circle_challenge_rounds round_item
    left join lateral (
      select stat.*
      from public.game_stats stat
      where stat.circle_challenge_id=challenge.id
        and stat.user_id=member.user_id
        and stat.mode='challenge'
        and stat.challenge_date=round_item.challenge_date
        and stat.game=round_item.game
      order by stat.completed_at,stat.id
      limit 1
    ) result on true
    where member.circle_id=challenge.circle_id
      and round_item.challenge_id=challenge.id
  ),
  totals as (
    select
      user_id,
      count(stat_id)::integer as rounds_played,
      sum(
        case
          when stat_id is null then -100
          else public.circle_challenge_daily_score(
            game,
            challenge_date,
            seconds,
            hints,
            mistakes
          )
        end
      )::integer as challenge_score,
      sum(greatest(coalesce(hints,0),0))::integer as total_hints,
      sum(greatest(coalesce(mistakes,0),0))::integer as total_mistakes,
      sum(
        case when stat_id is null then 0 else
          greatest(coalesce(seconds,0),0)
          + greatest(coalesce(hints,0),0)*30
          + greatest(coalesce(mistakes,0),0)*15
        end
      )::bigint as adjusted_seconds,
      max(completed_at) as finished_at,
      max(stat_id) as last_stat_id
    from member_rounds
    group by user_id
  )
  select
    totals.user_id,
    totals.last_stat_id,
    totals.challenge_score
  into winner_id,winner_stat_id,winning_score
  from totals
  where totals.rounds_played>0
  order by
    totals.challenge_score desc,
    totals.rounds_played desc,
    totals.total_hints,
    totals.total_mistakes,
    totals.adjusted_seconds,
    totals.finished_at,
    totals.user_id
  limit 1;

  if winner_id is null then
    update public.circle_weekly_challenges
    set closed_at=now(),updated_at=now()
    where id=challenge.id;
    return null;
  end if;

  insert into public.circle_challenge_reward_awards(
    challenge_id,player_id,points
  )
  values(
    challenge.id,
    winner_id,
    case when challenge.reward_type='points'
      then greatest(challenge.reward_points,0)
      else 0
    end
  )
  on conflict(challenge_id,player_id) do nothing
  returning id into award_created;

  if award_created is null then
    update public.circle_weekly_challenges
    set closed_at=coalesce(closed_at,now()),updated_at=now()
    where id=challenge.id;
    return winner_id;
  end if;

  if challenge.reward_type='points' and challenge.reward_points>0 then
    perform public.ensure_player_progress(winner_id);
    update public.player_progress
    set
      available_points=available_points+challenge.reward_points,
      lifetime_points=lifetime_points+challenge.reward_points,
      current_level=public.points_level(lifetime_points+challenge.reward_points),
      updated_at=now()
    where player_id=winner_id;
  end if;

  insert into public.points_transactions(
    player_id,points,reason_code,metadata,created_by
  )
  values(
    winner_id,
    case when challenge.reward_type='points'
      then greatest(challenge.reward_points,0)
      else 0
    end,
    'TEAM_CHALLENGE_WINNER',
    jsonb_build_object(
      'circle_id',challenge.circle_id,
      'circle_challenge_id',challenge.id,
      'week_start',challenge.week_start,
      'reward_points',case when challenge.reward_type='points'
        then greatest(challenge.reward_points,0)
        else 0
      end,
      'reward_label',case when challenge.reward_type='prize'
        then challenge.reward_label
        else null
      end
    ),
    winner_id
  );

  select coalesce(nullif(btrim(profile.name),''),'A teammate')
  into winner_name
  from public.profiles profile
  where profile.id=winner_id;

  select circle.name
  into circle_name
  from public.circles circle
  where circle.id=challenge.circle_id;

  insert into public.direct_messages(
    sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
  )
  select
    winner_id,
    member.user_id,
    case
      when member.user_id=winner_id and challenge.reward_type='points' then
        format(
          '🏆 You won %s and earned the %s-point winner''s prize!',
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_points
        )
      when member.user_id=winner_id then
        format(
          '🏆 You won %s — your prize is %s.',
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_label
        )
      when challenge.reward_type='points' then
        format(
          '🏆 %s won %s and earned the %s-point winner''s prize.',
          winner_name,
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_points
        )
      else
        format(
          '🏆 %s won %s — prize: %s.',
          winner_name,
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_label
        )
    end,
    true,
    'circle_challenge_winner',
    winner_stat_id
  from public.circle_members member
  where member.circle_id=challenge.circle_id
  on conflict do nothing;

  update public.circle_weekly_challenges
  set closed_at=now(),updated_at=now()
  where id=challenge.id;

  return winner_id;
end;
$$;
revoke all on function public.finalize_circle_challenge(bigint) from public;

create or replace function public.finalize_due_circle_challenges()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  due_challenge record;
  finalised_count integer:=0;
begin
  if not public.is_approved_user(auth.uid()) then
    return 0;
  end if;

  for due_challenge in
    select distinct challenge.id
    from public.circle_members membership
    join public.circle_weekly_challenges challenge
      on challenge.circle_id=membership.circle_id
    where membership.user_id=auth.uid()
      and challenge.closed_at is null
      and public.app_today()>(
        challenge.week_start+
        (select max(day_number)-1 from unnest(challenge.active_days) day_number)
      )
  loop
    perform public.finalize_circle_challenge(due_challenge.id);
    finalised_count:=finalised_count+1;
  end loop;

  return finalised_count;
end;
$$;
revoke all on function public.finalize_due_circle_challenges() from public;
grant execute on function public.finalize_due_circle_challenges() to authenticated;

create or replace function public.award_completed_circle_challenge()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.mode='challenge' and new.circle_challenge_id is not null then
    perform public.finalize_circle_challenge(new.circle_challenge_id);
  end if;
  return new;
end;
$$;

create or replace function public.get_my_active_circle_challenges()
returns table(
  challenge_id bigint,
  circle_id bigint,
  circle_name text,
  circle_emoji text,
  challenge_title text,
  game_ids text[],
  active_days integer[],
  reward_points integer,
  reward_type text,
  reward_label text,
  active_today boolean,
  is_locked boolean,
  repeats_weekly boolean,
  series_weeks integer,
  occurrence_number integer,
  closes_on date,
  stake_reward_id bigint,
  stake_reward_name text,
  stake_split_method text,
  stake_accepted boolean
)
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.finalize_due_circle_challenges();

  return query
  select
    challenge.id,
    circle.id,
    circle.name::text,
    coalesce(circle.emoji,'⭐')::text,
    coalesce(nullif(btrim(challenge.title),''),'Weekly challenge')::text,
    challenge.game_ids,
    challenge.active_days,
    challenge.reward_points,
    challenge.reward_type,
    challenge.reward_label,
    extract(isodow from public.app_today())::integer=any(challenge.active_days),
    (
      challenge.locked_at is not null
      or exists(
        select 1
        from public.circle_challenge_starts challenge_start
        where challenge_start.challenge_id=challenge.id
      )
      or exists(
        select 1
        from public.game_stats result
        where result.circle_challenge_id=challenge.id
      )
    ),
    challenge.repeats_weekly,
    challenge.series_weeks,
    challenge.occurrence_number,
    challenge.week_start+
      (select max(day_number)-1 from unnest(challenge.active_days) day_number),
    challenge.stake_reward_id,
    stake_reward.name::text,
    challenge.stake_split_method,
    exists(
      select 1 from public.circle_challenge_stake_acceptances a
      where a.challenge_id=challenge.id and a.user_id=auth.uid()
    )
  from public.circle_members membership
  join public.circles circle on circle.id=membership.circle_id
  join public.circle_weekly_challenges challenge
    on challenge.circle_id=circle.id
   and challenge.week_start=public.current_week_start()
  left join public.rewards stake_reward on stake_reward.id=challenge.stake_reward_id
  where membership.user_id=auth.uid()
    and public.is_approved_user(auth.uid())
    and challenge.closed_at is null
  order by circle.name,challenge.created_at,challenge.id;
end;
$$;
revoke all on function public.get_my_active_circle_challenges() from public;
grant execute on function public.get_my_active_circle_challenges() to authenticated;

create or replace function public.get_my_circle_challenge_lifecycle()
returns table(
  challenge_id bigint,
  member_count integer,
  finished_count integer,
  current_user_finished boolean,
  winner_id uuid,
  winner_name text,
  winner_icon text,
  awarded_at timestamptz,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.finalize_due_circle_challenges();

  return query
  with my_challenges as (
    select challenge.id,challenge.circle_id,challenge.game_ids,challenge.closed_at
    from public.circle_members membership
    join public.circle_weekly_challenges challenge
      on challenge.circle_id=membership.circle_id
     and challenge.week_start=public.current_week_start()
    where membership.user_id=auth.uid()
      and public.is_approved_user(auth.uid())
  ),
  member_progress as (
    select
      challenge.id as challenge_id,
      member.user_id,
      count(distinct result.game) filter(
        where result.game=any(challenge.game_ids)
      )=cardinality(challenge.game_ids) as finished
    from my_challenges challenge
    join public.circle_members member on member.circle_id=challenge.circle_id
    left join public.game_stats result
      on result.user_id=member.user_id
     and result.circle_challenge_id=challenge.id
     and result.mode='challenge'
    group by challenge.id,challenge.game_ids,member.user_id
  )
  select
    challenge.id,
    count(progress.user_id)::integer,
    count(*) filter(where progress.finished)::integer,
    coalesce(
      bool_or(progress.finished) filter(where progress.user_id=auth.uid()),
      false
    ),
    award.player_id,
    winner.name::text,
    winner.icon::text,
    award.awarded_at,
    challenge.closed_at
  from my_challenges challenge
  join member_progress progress on progress.challenge_id=challenge.id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.circle_challenge_reward_awards item
    where item.challenge_id=challenge.id
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  group by
    challenge.id,
    challenge.closed_at,
    award.player_id,
    award.awarded_at,
    winner.name,
    winner.icon
  order by challenge.id;
end;
$$;
revoke all on function public.get_my_circle_challenge_lifecycle() from public;
grant execute on function public.get_my_circle_challenge_lifecycle() to authenticated;

create or replace function public.get_my_circle_challenge_history(
  history_limit_in integer default 30
)
returns table(
  challenge_id bigint,
  circle_id bigint,
  circle_name text,
  circle_emoji text,
  challenge_title text,
  week_start date,
  closed_at timestamptz,
  game_ids text[],
  active_days integer[],
  reward_points integer,
  reward_type text,
  reward_label text,
  winner_id uuid,
  winner_name text,
  winner_icon text,
  entry_count integer,
  finisher_count integer,
  current_user_finished boolean,
  repeats_weekly boolean,
  series_weeks integer,
  occurrence_number integer
)
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.finalize_due_circle_challenges();

  return query
  select
    challenge.id,
    circle.id,
    circle.name::text,
    coalesce(circle.emoji,'⭐')::text,
    coalesce(nullif(btrim(challenge.title),''),'Weekly challenge')::text,
    challenge.week_start,
    challenge.closed_at,
    challenge.game_ids,
    challenge.active_days,
    challenge.reward_points,
    challenge.reward_type,
    challenge.reward_label,
    award.player_id,
    winner.name::text,
    winner.icon::text,
    coalesce(progress.entry_count,0)::integer,
    coalesce(progress.finisher_count,0)::integer,
    coalesce(progress.current_user_finished,false),
    challenge.repeats_weekly,
    challenge.series_weeks,
    challenge.occurrence_number
  from public.circle_members membership
  join public.circles circle on circle.id=membership.circle_id
  join public.circle_weekly_challenges challenge
    on challenge.circle_id=circle.id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.circle_challenge_reward_awards item
    where item.challenge_id=challenge.id
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  left join lateral (
    select
      count(*) filter(where totals.games_completed>0)::integer as entry_count,
      count(*) filter(
        where totals.games_completed=cardinality(challenge.game_ids)
      )::integer as finisher_count,
      coalesce(
        bool_or(
          totals.games_completed=cardinality(challenge.game_ids)
        ) filter(where totals.user_id=auth.uid()),
        false
      ) as current_user_finished
    from (
      select
        member.user_id,
        count(distinct result.game) filter(
          where result.game=any(challenge.game_ids)
        ) as games_completed
      from public.circle_members member
      left join public.game_stats result
        on result.user_id=member.user_id
       and result.circle_challenge_id=challenge.id
       and result.mode='challenge'
      where member.circle_id=challenge.circle_id
      group by member.user_id
    ) totals
  ) progress on true
  where membership.user_id=auth.uid()
    and public.is_approved_user(auth.uid())
    and challenge.closed_at is not null
  order by challenge.closed_at desc,challenge.week_start desc,challenge.id desc
  limit least(greatest(coalesce(history_limit_in,30),1),100);
end;
$$;
revoke all on function public.get_my_circle_challenge_history(integer) from public;
grant execute on function public.get_my_circle_challenge_history(integer) to authenticated;

create function public.set_circle_weekly_challenge(
  target_circle_id bigint,
  selected_games text[],
  selected_days integer[],
  reward_points_in integer default 0,
  reward_type_in text default 'points',
  reward_label_in text default null,
  target_challenge_id bigint default null,
  challenge_title_in text default null,
  repeat_weekly_in boolean default null,
  duration_weeks_in integer default null
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  current_challenge public.circle_weekly_challenges;
  result_id bigint;
  series_key bigint;
  week_offset integer;
  clean_games text[];
  clean_days integer[];
  clean_title text:=nullif(btrim(challenge_title_in),'');
  clean_reward_type text:=coalesce(nullif(btrim(reward_type_in),''),'points');
  clean_duration integer;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1
    from public.circles
    where id=target_circle_id and created_by=auth.uid()
  ) then
    raise exception 'Only the circle owner can manage challenges.' using errcode='42501';
  end if;
  if repeat_weekly_in is null then
    raise exception 'Choose whether this challenge runs once or repeats weekly.';
  end if;

  clean_duration:=case
    when repeat_weekly_in then coalesce(duration_weeks_in,0)
    else 1
  end;

  if repeat_weekly_in and clean_duration not between 2 and 52 then
    raise exception 'Choose a repeat duration between 2 and 52 weeks.';
  end if;

  select array_agg(game order by first_position)
  into clean_games
  from (
    select game,min(selected.ordinality) as first_position
    from unnest(selected_games) with ordinality selected(game,ordinality)
    where game in ('hive','tango','gridly','minisudoku','geo','zoom')
    group by game
  ) valid_games;

  select array_agg(distinct day order by day)
  into clean_days
  from unnest(selected_days) day
  where day between 1 and 7;

  if coalesce(cardinality(clean_games),0)=0 then
    raise exception 'Choose at least one game.';
  end if;
  if coalesce(cardinality(clean_days),0)=0 then
    raise exception 'Choose at least one playing day.';
  end if;
  if clean_title is null then
    raise exception 'Enter a challenge name.';
  end if;
  if char_length(clean_title)>60 then
    raise exception 'Challenge names can be up to 60 characters.';
  end if;
  if coalesce(reward_points_in,0) not between 0 and 500 then
    raise exception 'Reward must be between 0 and 500 points.';
  end if;
  if clean_reward_type not in ('points','prize') then
    raise exception 'Invalid reward type.';
  end if;
  if clean_reward_type='prize'
     and nullif(btrim(reward_label_in),'') is null then
    raise exception 'Enter the prize.';
  end if;

  if target_challenge_id is not null then
    select *
    into current_challenge
    from public.circle_weekly_challenges
    where id=target_challenge_id
      and circle_id=target_circle_id
      and week_start=public.current_week_start()
      and closed_at is null
    for update;

    if not found then
      raise exception 'Challenge not found.';
    end if;
    if current_challenge.locked_at is not null
       or exists(
         select 1
         from public.circle_challenge_starts
         where challenge_id=current_challenge.id
       )
       or exists(
         select 1
         from public.game_stats
         where circle_challenge_id=current_challenge.id
       ) then
      update public.circle_weekly_challenges
      set locked_at=coalesce(locked_at,now())
      where id=current_challenge.id;
      raise exception 'This challenge is already in progress and is locked.'
        using errcode='55000';
    end if;

    series_key:=coalesce(current_challenge.series_id,current_challenge.id);

    if exists(
      select 1
      from public.circle_weekly_challenges future_challenge
      where future_challenge.series_id=series_key
        and future_challenge.week_start>=public.current_week_start()
        and (
          future_challenge.locked_at is not null
          or exists(
            select 1
            from public.circle_challenge_starts future_start
            where future_start.challenge_id=future_challenge.id
          )
          or exists(
            select 1
            from public.game_stats future_result
            where future_result.circle_challenge_id=future_challenge.id
          )
        )
    ) then
      raise exception 'A scheduled week in this series has already started.'
        using errcode='55000';
    end if;

    delete from public.circle_weekly_challenges
    where series_id=series_key
      and week_start>=public.current_week_start();
  else
    series_key:=null;
  end if;

  for week_offset in 0..clean_duration-1 loop
    if (
      select count(*)
      from public.circle_weekly_challenges
      where circle_id=target_circle_id
        and week_start=public.current_week_start()+(week_offset*7)
    )>=10 then
      raise exception 'A circle can create up to 10 challenges in any week.';
    end if;

    insert into public.circle_weekly_challenges(
      circle_id,
      week_start,
      title,
      game_ids,
      active_days,
      reward_points,
      reward_type,
      reward_label,
      locked_at,
      created_by,
      series_id,
      repeats_weekly,
      series_weeks,
      occurrence_number,
      closed_at
    )
    values(
      target_circle_id,
      public.current_week_start()+(week_offset*7),
      clean_title,
      clean_games,
      clean_days,
      case when clean_reward_type='points'
        then greatest(coalesce(reward_points_in,0),0)
        else 0
      end,
      clean_reward_type,
      case when clean_reward_type='prize'
        then nullif(btrim(reward_label_in),'')
        else null
      end,
      null,
      auth.uid(),
      series_key,
      repeat_weekly_in,
      clean_duration,
      week_offset+1,
      null
    )
    returning id into result_id;

    if series_key is null then
      series_key:=result_id;
      update public.circle_weekly_challenges
      set series_id=series_key
      where id=result_id;
    end if;

    if week_offset=0 then
      target_challenge_id:=result_id;
    end if;
  end loop;

  return target_challenge_id;
end;
$$;
revoke all on function public.set_circle_weekly_challenge(
  bigint,text[],integer[],integer,text,text,bigint,text,boolean,integer
) from public;
grant execute on function public.set_circle_weekly_challenge(
  bigint,text[],integer[],integer,text,text,bigint,text,boolean,integer
) to authenticated;

-- ---------- Reward-store side of the rename ----------

create or replace function public.is_circle_reward_approver(target_circle_id bigint, uid uuid)
returns boolean language sql stable set search_path=public as $$
  select public.is_admin(uid) or exists(
    select 1 from circle_members where circle_id=target_circle_id and user_id=uid and can_approve_rewards=true
  );
$$;
grant execute on function public.is_circle_reward_approver(bigint,uuid) to authenticated;

create policy "circle members and admins view rewards" on public.rewards
  for select using (is_admin(auth.uid()) or exists(select 1 from circle_members where circle_id=rewards.circle_id and user_id=auth.uid()));
create policy "circle reward approvers update rewards" on public.rewards
  for update using (is_circle_reward_approver(circle_id,auth.uid())) with check (is_circle_reward_approver(circle_id,auth.uid()));

create policy "circle members can view approvals" on public.reward_approvals
  for select using (
    is_admin(auth.uid())
    or exists(select 1 from rewards rw join circle_members cm on cm.circle_id=rw.circle_id where rw.id=reward_approvals.reward_id and cm.user_id=auth.uid())
  );

create or replace function public.get_my_reward_circles()
returns table(circle_id bigint,circle_name text,can_approve boolean,member_count int,approver_count int)
language sql security definer stable set search_path=public as $$
  select c.id,c.name::text,
    coalesce(cm.can_approve_rewards,is_admin(auth.uid())),
    (select count(*)::int from circle_members m where m.circle_id=c.id),
    (select count(*)::int from circle_members m where m.circle_id=c.id and m.can_approve_rewards=true)
  from circles c
  left join circle_members cm on cm.circle_id=c.id and cm.user_id=auth.uid()
  where cm.user_id is not null or is_admin(auth.uid())
  order by c.name;
$$;
revoke all on function public.get_my_reward_circles() from public;
grant execute on function public.get_my_reward_circles() to authenticated;

create or replace function public.set_circle_reward_approver(target_circle_id bigint, target_user_id uuid, approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare circle_owner uuid;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  select created_by into circle_owner from public.circles where id=target_circle_id for update;
  if not found then raise exception 'Circle not found.'; end if;
  if auth.uid()<>circle_owner and not public.is_admin(auth.uid()) then
    raise exception 'Only the circle owner or an app administrator can manage reward approvers.' using errcode='42501';
  end if;
  update public.circle_members set can_approve_rewards=approve where circle_id=target_circle_id and user_id=target_user_id;
  if not found then raise exception 'That person is not a member of this circle.'; end if;
end; $$;
revoke all on function public.set_circle_reward_approver(bigint,uuid,boolean) from public;
grant execute on function public.set_circle_reward_approver(bigint,uuid,boolean) to authenticated;

create or replace function public.transfer_circle_ownership(target_circle_id bigint, new_owner_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare circle_owner uuid;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  select created_by into circle_owner from public.circles where id=target_circle_id for update;
  if not found then raise exception 'Circle not found.'; end if;
  if auth.uid()<>circle_owner and not public.is_admin(auth.uid()) then
    raise exception 'Only the circle owner or an app administrator can transfer ownership.' using errcode='42501';
  end if;
  if not exists(select 1 from public.circle_members where circle_id=target_circle_id and user_id=new_owner_user_id) then
    raise exception 'That person is not a member of this circle.';
  end if;
  if new_owner_user_id=circle_owner then
    raise exception 'That person already owns this circle.';
  end if;

  update public.circles set created_by=new_owner_user_id where id=target_circle_id;
  update public.circle_members set can_approve_rewards=true where circle_id=target_circle_id and user_id=new_owner_user_id;
end; $$;
revoke all on function public.transfer_circle_ownership(bigint,uuid) from public;
grant execute on function public.transfer_circle_ownership(bigint,uuid) to authenticated;

create or replace function public.set_circle_challenge_stake(
  target_challenge_id bigint,
  target_reward_id bigint,
  split_method text
) returns void language plpgsql security definer set search_path=public as $$
declare challenge public.circle_weekly_challenges;
begin
  select * into challenge from public.circle_weekly_challenges where id=target_challenge_id for update;
  if not found then raise exception 'Challenge not found.'; end if;
  if not exists(select 1 from public.circles where id=challenge.circle_id and created_by=auth.uid()) then
    raise exception 'Only the circle owner can set a stake.' using errcode='42501';
  end if;
  if challenge.locked_at is not null or challenge.closed_at is not null then
    raise exception 'This challenge is already in progress and is locked.' using errcode='55000';
  end if;
  if split_method not in ('equal','ranked') then raise exception 'Invalid split method.'; end if;
  if not exists(select 1 from public.rewards where id=target_reward_id and status='active' and circle_id=challenge.circle_id) then
    raise exception 'Choose an approved item that belongs to this circle.';
  end if;

  update public.circle_weekly_challenges set
    stake_reward_id=target_reward_id,
    stake_split_method=split_method,
    reward_type='points',
    reward_points=0,
    reward_label=null,
    updated_at=now()
  where id=target_challenge_id;

  delete from public.circle_challenge_stake_acceptances where challenge_id=target_challenge_id;
end; $$;
revoke all on function public.set_circle_challenge_stake(bigint,bigint,text) from public;
grant execute on function public.set_circle_challenge_stake(bigint,bigint,text) to authenticated;

create or replace function public.accept_challenge_stake(target_challenge_id bigint)
returns void language plpgsql security definer set search_path=public as $$
declare challenge public.circle_weekly_challenges;
begin
  select * into challenge from public.circle_weekly_challenges where id=target_challenge_id;
  if not found then raise exception 'Challenge not found.'; end if;
  if challenge.stake_reward_id is null then raise exception 'This challenge has no stake to accept.'; end if;
  if not exists(select 1 from public.circle_members where circle_id=challenge.circle_id and user_id=auth.uid()) then
    raise exception 'You are not a member of this circle.' using errcode='42501';
  end if;
  insert into public.circle_challenge_stake_acceptances(challenge_id,user_id) values(target_challenge_id,auth.uid())
  on conflict do nothing;
end; $$;
revoke all on function public.accept_challenge_stake(bigint) from public;
grant execute on function public.accept_challenge_stake(bigint) to authenticated;

create or replace function public.search_players_to_invite(search_query text, exclude_circle_id bigint)
returns table(id uuid,name text,icon text)
language sql security definer stable set search_path=public as $$
  select p.id,p.name::text,p.icon::text
  from profiles p
  where p.id<>auth.uid()
    and p.account_deleted_at is null
    and coalesce(p.hidden_from_others,false)=false
    and coalesce(p.is_approved,true)=true
    and coalesce(p.is_blocked,false)=false
    and not exists(select 1 from circle_members where circle_id=exclude_circle_id and user_id=p.id)
    and not exists(select 1 from circle_member_blocks where circle_id=exclude_circle_id and user_id=p.id)
    and nullif(trim(search_query),'') is not null
    and length(trim(search_query))>=2
    and p.name ilike '%'||trim(search_query)||'%'
  order by p.name
  limit 20;
$$;
revoke all on function public.search_players_to_invite(text,bigint) from public;
grant execute on function public.search_players_to_invite(text,bigint) to authenticated;

-- ---------- rewards RPCs: circle_id instead of team_id ----------
drop function if exists public.propose_reward(bigint,text,text,text,bigint,int);
create function public.propose_reward(
  target_circle_id bigint,reward_name text,reward_description text,reward_image_url text,
  reward_points_cost bigint,reward_stock_quantity int
) returns bigint language plpgsql security definer set search_path=public as $$
declare new_id bigint;
begin
  if not (is_admin(auth.uid()) or is_reward_steward(auth.uid())) then raise exception 'Reward managers only.' using errcode='42501'; end if;
  if not (exists(select 1 from circle_members where circle_id=target_circle_id and user_id=auth.uid()) or is_admin(auth.uid())) then
    raise exception 'You are not a member of this circle.' using errcode='42501';
  end if;
  insert into rewards(name,description,image_url,points_cost,stock_quantity,circle_id,status,created_by)
  values(reward_name,reward_description,reward_image_url,reward_points_cost,reward_stock_quantity,target_circle_id,'pending',auth.uid())
  returning id into new_id;
  return new_id;
end; $$;
revoke all on function public.propose_reward(bigint,text,text,text,bigint,int) from public;
grant execute on function public.propose_reward(bigint,text,text,text,bigint,int) to authenticated;

create or replace function public.review_reward_proposal(target_reward_id bigint, decision_in text)
returns void language plpgsql security definer set search_path=public as $$
declare rw rewards; approver_count int; required int; approve_count int; reject_count int;
begin
  if decision_in not in ('approve','reject') then raise exception 'Invalid decision'; end if;
  select * into rw from rewards where id=target_reward_id for update;
  if not found then raise exception 'Reward not found'; end if;
  if not is_circle_reward_approver(rw.circle_id,auth.uid()) then raise exception 'Only a reward approver of this circle can review it.' using errcode='42501'; end if;
  if rw.status<>'pending' then raise exception 'This item has already been reviewed.'; end if;

  insert into reward_approvals(reward_id,approver_id,decision) values(target_reward_id,auth.uid(),decision_in)
  on conflict(reward_id,approver_id) do update set decision=excluded.decision,created_at=now();

  select count(*) into approver_count from circle_members where circle_id=rw.circle_id and can_approve_rewards=true;
  required:=floor(approver_count::numeric/2)+1;
  select count(*) into approve_count from reward_approvals where reward_id=target_reward_id and decision='approve';
  select count(*) into reject_count from reward_approvals where reward_id=target_reward_id and decision='reject';

  if approve_count>=required then
    update rewards set status='active',updated_at=now() where id=target_reward_id;
  elsif reject_count>=required then
    update rewards set status='rejected',updated_at=now() where id=target_reward_id;
  end if;
end; $$;
revoke all on function public.review_reward_proposal(bigint,text) from public;
grant execute on function public.review_reward_proposal(bigint,text) to authenticated;

-- OUT columns rename team_id/team_name -> circle_id/circle_name, which
-- create-or-replace rejects ("cannot change return type"); drop first.
drop function if exists public.get_pending_reward_proposals();
create function public.get_pending_reward_proposals()
returns table(id bigint,circle_id bigint,circle_name text,name text,description text,image_url text,points_cost bigint,stock_quantity int,created_by uuid,creator_name text,creator_icon text,approve_count int,reject_count int,required_count int)
language sql security definer stable set search_path=public as $$
  select rw.id,rw.circle_id,c.name::text,rw.name::text,rw.description::text,rw.image_url::text,rw.points_cost,rw.stock_quantity,
    rw.created_by,creator.name::text,creator.icon::text,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='reject'),
    (floor((select count(*)::int from circle_members m where m.circle_id=rw.circle_id and m.can_approve_rewards=true)::numeric/2)+1)::int
  from rewards rw
  join circles c on c.id=rw.circle_id
  join profiles creator on creator.id=rw.created_by
  where rw.status='pending' and (exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid()) or is_admin(auth.uid()))
  order by rw.created_at desc;
$$;
revoke all on function public.get_pending_reward_proposals() from public;
grant execute on function public.get_pending_reward_proposals() to authenticated;

drop function if exists public.list_my_available_rewards();
create function public.list_my_available_rewards()
returns table(id bigint,circle_id bigint,circle_name text,name text,description text,image_url text,points_cost bigint,stock_quantity int)
language sql security definer stable set search_path=public as $$
  select rw.id,rw.circle_id,c.name::text,rw.name::text,rw.description::text,rw.image_url::text,rw.points_cost,rw.stock_quantity
  from rewards rw
  join circles c on c.id=rw.circle_id
  where rw.status='active' and exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid())
  order by rw.points_cost;
$$;
revoke all on function public.list_my_available_rewards() from public;
grant execute on function public.list_my_available_rewards() to authenticated;

create or replace function public.redeem_reward(target_reward_id bigint, note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare rw rewards; p player_progress; red_id bigint;
begin
  select * into rw from rewards where id=target_reward_id and status='active' for update;
  if not found then raise exception 'Reward unavailable'; end if;
  if not exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid()) then
    raise exception 'This item is not available to you.' using errcode='42501';
  end if;
  if rw.stock_quantity is not null and rw.stock_quantity<=0 then raise exception 'Out of stock'; end if;
  perform ensure_player_progress(auth.uid());
  select * into p from player_progress where player_id=auth.uid() for update;
  if p.available_points<rw.points_cost then raise exception 'Not enough points'; end if;
  update player_progress set available_points=available_points-rw.points_cost,updated_at=now() where player_id=auth.uid();
  if rw.stock_quantity is not null then update rewards set stock_quantity=stock_quantity-1,updated_at=now() where id=rw.id; end if;
  insert into reward_redemptions(player_id,reward_id,points_cost,status,player_note)
    values(auth.uid(),rw.id,rw.points_cost,case when rw.requires_approval then 'requested' else 'approved' end,note) returning id into red_id;
  insert into points_transactions(player_id,points,reason_code,reward_id,metadata,created_by)
    values(auth.uid(),-rw.points_cost,'REWARD_REDEEMED',rw.id,jsonb_build_object('redemption_id',red_id,'reward_name',rw.name),auth.uid());
  return jsonb_build_object('redemption_id',red_id,'balance',p.available_points-rw.points_cost);
end; $$;
grant execute on function public.redeem_reward(bigint,text) to authenticated;

create or replace function public.delete_reward(target_reward_id bigint)
returns void language plpgsql security definer set search_path=public as $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id;
  if not found then raise exception 'Reward not found'; end if;
  if not is_circle_reward_approver(rw.circle_id,auth.uid()) then
    raise exception 'Only a reward approver of this circle can delete this item.' using errcode='42501';
  end if;
  if exists(select 1 from reward_redemptions where reward_id=target_reward_id) then
    raise exception 'This item has redemption history and can''t be deleted — deactivate it instead.';
  end if;
  delete from rewards where id=target_reward_id;
end; $$;
revoke all on function public.delete_reward(bigint) from public;
grant execute on function public.delete_reward(bigint) to authenticated;

-- ============================================================
-- 5. Reattach triggers on game_stats (old ones already dropped in
--    section 3, before their now-renamed underlying functions).
-- ============================================================
create trigger validate_circle_challenge_attempt_trigger
before insert on public.game_stats
for each row execute function public.validate_circle_challenge_attempt();

create trigger award_completed_circle_challenge_trigger
after insert on public.game_stats
for each row execute function public.award_completed_circle_challenge();

create trigger game_stats_notify_circle_daily_challenge
after insert on public.game_stats
for each row execute function public.notify_circle_daily_challenge_completed();

notify pgrst,'reload schema';
commit;
