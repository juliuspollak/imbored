-- v179: Merge guardian circles into teams — one group concept instead of
-- two. Circles' one real idea (a reward-approver role with majority-vote
-- quorum on items) moves onto team_members; the parallel guardian_circles*
-- system is deleted. Test data only, so this wipes existing reward items
-- rather than trying to carefully migrate them onto a team.
-- Run after v178.

begin;

-- ---------- Clean slate for reward items (test data) ----------
truncate table reward_redemptions, reward_approvals, rewards cascade;

-- ---------- Drop the parallel circles system ----------
drop function if exists public.get_my_circles();
drop function if exists public.get_circle_roster(bigint);
drop function if exists public.get_circle_pending_invitations(bigint);
drop function if exists public.create_guardian_circle(text);
drop function if exists public.invite_to_circle(bigint,uuid);
drop function if exists public.decide_circle_invitation(bigint,boolean);
drop function if exists public.cancel_circle_invitation(bigint);
drop function if exists public.delete_guardian_circle(bigint);
drop function if exists public.search_invitable_players(text,bigint);
drop function if exists public.search_circle_members(bigint,text);
drop function if exists public.set_circle_approver(bigint,uuid,boolean);
drop table if exists public.guardian_circle_invitations cascade;
drop table if exists public.guardian_circle_members cascade;
drop table if exists public.guardian_circles cascade;
-- is_circle_member/is_circle_approver are dropped further down, right
-- before rewards.circle_id — see that section for why the ordering matters.

-- ---------- teams: no more global unique name ----------
alter table public.teams drop constraint if exists teams_name_key;

-- ---------- team_members: reward-approver role ----------
alter table public.team_members add column if not exists can_approve_rewards boolean not null default false;
update public.team_members m set can_approve_rewards=true
from public.teams t where t.id=m.team_id and t.created_by=m.user_id;

create or replace function public.is_team_reward_approver(target_team_id bigint, uid uuid)
returns boolean language sql stable set search_path=public as $$
  select public.is_admin(uid) or exists(
    select 1 from team_members where team_id=target_team_id and user_id=uid and can_approve_rewards=true
  );
$$;
grant execute on function public.is_team_reward_approver(bigint,uuid) to authenticated;

create or replace function public.set_team_reward_approver(target_team_id bigint, target_user_id uuid, approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare team_owner uuid;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  select created_by into team_owner from public.teams where id=target_team_id for update;
  if not found then raise exception 'Team not found.'; end if;
  if auth.uid()<>team_owner and not public.is_admin(auth.uid()) then
    raise exception 'Only the team owner or an app administrator can manage reward approvers.' using errcode='42501';
  end if;
  update public.team_members set can_approve_rewards=approve where team_id=target_team_id and user_id=target_user_id;
  if not found then raise exception 'That person is not a member of this team.'; end if;
end; $$;
revoke all on function public.set_team_reward_approver(bigint,uuid,boolean) from public;
grant execute on function public.set_team_reward_approver(bigint,uuid,boolean) to authenticated;

-- ---------- get_my_team_rosters: surface can_approve_rewards ----------
drop function if exists public.get_my_team_rosters();
create function public.get_my_team_rosters()
returns table(
  team_id bigint,
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
    membership.team_id,
    membership.user_id,
    profile.name::text,
    profile.icon::text,
    profile.mood::text,
    (team.created_by=membership.user_id),
    profile.show_stats_to_others,
    membership.can_approve_rewards
  from public.team_members membership
  join public.teams team on team.id=membership.team_id
  join public.profiles profile on profile.id=membership.user_id
  where (
    public.is_admin(auth.uid())
    or exists(
      select 1
      from public.team_members mine
      where mine.team_id=membership.team_id
        and mine.user_id=auth.uid()
    )
  )
    and coalesce(profile.hidden_from_others,false)=false
    and profile.account_deleted_at is null
  order by
    membership.team_id,
    (team.created_by=membership.user_id) desc,
    profile.name;
$$;
revoke all on function public.get_my_team_rosters() from public;
grant execute on function public.get_my_team_rosters() to authenticated;

-- ---------- rewards: team-scoped instead of circle-scoped ----------
-- Drop everything that still depends on rewards.circle_id (policies on
-- both rewards and reward_approvals reference it) before dropping the
-- column itself, or Postgres refuses with "other objects depend on it".
drop policy if exists "circle members and admins view rewards" on public.rewards;
drop policy if exists "circle approvers update rewards" on public.rewards;
drop policy if exists "circle members can view approvals" on public.reward_approvals;
drop function if exists public.is_circle_member(bigint,uuid);
drop function if exists public.is_circle_approver(bigint,uuid);

alter table public.rewards drop column if exists circle_id;
alter table public.rewards add column team_id bigint references public.teams(id);
alter table public.rewards alter column team_id set not null;

create policy "team members and admins view rewards" on public.rewards
  for select using (is_admin(auth.uid()) or exists(select 1 from team_members where team_id=rewards.team_id and user_id=auth.uid()));
create policy "team reward approvers update rewards" on public.rewards
  for update using (is_team_reward_approver(team_id,auth.uid())) with check (is_team_reward_approver(team_id,auth.uid()));

create policy "team members can view approvals" on public.reward_approvals
  for select using (
    is_admin(auth.uid())
    or exists(select 1 from rewards rw join team_members tm on tm.team_id=rw.team_id where rw.id=reward_approvals.reward_id and tm.user_id=auth.uid())
  );

create or replace function public.get_my_reward_teams()
returns table(team_id bigint,team_name text,can_approve boolean,member_count int,approver_count int)
language sql security definer stable set search_path=public as $$
  select t.id,t.name::text,
    coalesce(tm.can_approve_rewards,is_admin(auth.uid())),
    (select count(*)::int from team_members m where m.team_id=t.id),
    (select count(*)::int from team_members m where m.team_id=t.id and m.can_approve_rewards=true)
  from teams t
  left join team_members tm on tm.team_id=t.id and tm.user_id=auth.uid()
  where tm.user_id is not null or is_admin(auth.uid())
  order by t.name;
$$;
revoke all on function public.get_my_reward_teams() from public;
grant execute on function public.get_my_reward_teams() to authenticated;

create or replace function public.propose_reward(
  target_team_id bigint,reward_name text,reward_description text,reward_image_url text,
  reward_points_cost bigint,reward_stock_quantity int
) returns bigint language plpgsql security definer set search_path=public as $$
declare new_id bigint;
begin
  if not (is_admin(auth.uid()) or is_reward_steward(auth.uid())) then raise exception 'Reward managers only.' using errcode='42501'; end if;
  if not (exists(select 1 from team_members where team_id=target_team_id and user_id=auth.uid()) or is_admin(auth.uid())) then
    raise exception 'You are not a member of this team.' using errcode='42501';
  end if;
  insert into rewards(name,description,image_url,points_cost,stock_quantity,team_id,status,created_by)
  values(reward_name,reward_description,reward_image_url,reward_points_cost,reward_stock_quantity,target_team_id,'pending',auth.uid())
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
  if not is_team_reward_approver(rw.team_id,auth.uid()) then raise exception 'Only a reward approver of this team can review it.' using errcode='42501'; end if;
  if rw.status<>'pending' then raise exception 'This item has already been reviewed.'; end if;

  insert into reward_approvals(reward_id,approver_id,decision) values(target_reward_id,auth.uid(),decision_in)
  on conflict(reward_id,approver_id) do update set decision=excluded.decision,created_at=now();

  select count(*) into approver_count from team_members where team_id=rw.team_id and can_approve_rewards=true;
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

create or replace function public.get_pending_reward_proposals()
returns table(id bigint,team_id bigint,team_name text,name text,description text,image_url text,points_cost bigint,stock_quantity int,created_by uuid,creator_name text,creator_icon text,approve_count int,reject_count int,required_count int)
language sql security definer stable set search_path=public as $$
  select rw.id,rw.team_id,t.name::text,rw.name::text,rw.description::text,rw.image_url::text,rw.points_cost,rw.stock_quantity,
    rw.created_by,creator.name::text,creator.icon::text,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='reject'),
    (floor((select count(*)::int from team_members m where m.team_id=rw.team_id and m.can_approve_rewards=true)::numeric/2)+1)::int
  from rewards rw
  join teams t on t.id=rw.team_id
  join profiles creator on creator.id=rw.created_by
  where rw.status='pending' and (exists(select 1 from team_members where team_id=rw.team_id and user_id=auth.uid()) or is_admin(auth.uid()))
  order by rw.created_at desc;
$$;
revoke all on function public.get_pending_reward_proposals() from public;
grant execute on function public.get_pending_reward_proposals() to authenticated;

create or replace function public.list_my_available_rewards()
returns table(id bigint,team_id bigint,team_name text,name text,description text,image_url text,points_cost bigint,stock_quantity int)
language sql security definer stable set search_path=public as $$
  select rw.id,rw.team_id,t.name::text,rw.name::text,rw.description::text,rw.image_url::text,rw.points_cost,rw.stock_quantity
  from rewards rw
  join teams t on t.id=rw.team_id
  where rw.status='active' and exists(select 1 from team_members where team_id=rw.team_id and user_id=auth.uid())
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
  if not exists(select 1 from team_members where team_id=rw.team_id and user_id=auth.uid()) then
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
  if not is_team_reward_approver(rw.team_id,auth.uid()) then
    raise exception 'Only a reward approver of this team can delete this item.' using errcode='42501';
  end if;
  if exists(select 1 from reward_redemptions where reward_id=target_reward_id) then
    raise exception 'This item has redemption history and can''t be deleted — deactivate it instead.';
  end if;
  delete from rewards where id=target_reward_id;
end; $$;
revoke all on function public.delete_reward(bigint) from public;
grant execute on function public.delete_reward(bigint) to authenticated;

-- ---------- Server-side search for inviting (replaces full-list fetches) ----------
create or replace function public.search_players_to_invite(search_query text, exclude_team_id bigint)
returns table(id uuid,name text,icon text)
language sql security definer stable set search_path=public as $$
  select p.id,p.name::text,p.icon::text
  from profiles p
  where p.id<>auth.uid()
    and p.account_deleted_at is null
    and coalesce(p.hidden_from_others,false)=false
    and coalesce(p.is_approved,true)=true
    and coalesce(p.is_blocked,false)=false
    and not exists(select 1 from team_members where team_id=exclude_team_id and user_id=p.id)
    and not exists(select 1 from team_member_blocks where team_id=exclude_team_id and user_id=p.id)
    and nullif(trim(search_query),'') is not null
    and length(trim(search_query))>=2
    and p.name ilike '%'||trim(search_query)||'%'
  order by p.name
  limit 20;
$$;
revoke all on function public.search_players_to_invite(text,bigint) from public;
grant execute on function public.search_players_to_invite(text,bigint) to authenticated;

-- ---------- challenge stakes: item must belong to the same team ----------
create or replace function public.set_team_challenge_stake(
  target_challenge_id bigint,
  target_reward_id bigint,
  split_method text
) returns void language plpgsql security definer set search_path=public as $$
declare challenge public.team_weekly_challenges;
begin
  select * into challenge from public.team_weekly_challenges where id=target_challenge_id for update;
  if not found then raise exception 'Challenge not found.'; end if;
  if not exists(select 1 from public.teams where id=challenge.team_id and created_by=auth.uid()) then
    raise exception 'Only the team owner can set a stake.' using errcode='42501';
  end if;
  if challenge.locked_at is not null or challenge.closed_at is not null then
    raise exception 'This challenge is already in progress and is locked.' using errcode='55000';
  end if;
  if split_method not in ('equal','ranked') then raise exception 'Invalid split method.'; end if;
  if not exists(select 1 from public.rewards where id=target_reward_id and status='active' and team_id=challenge.team_id) then
    raise exception 'Choose an approved item that belongs to this team.';
  end if;

  update public.team_weekly_challenges set
    stake_reward_id=target_reward_id,
    stake_split_method=split_method,
    reward_type='points',
    reward_points=0,
    reward_label=null,
    updated_at=now()
  where id=target_challenge_id;

  delete from public.team_challenge_stake_acceptances where challenge_id=target_challenge_id;
end; $$;
revoke all on function public.set_team_challenge_stake(bigint,bigint,text) from public;
grant execute on function public.set_team_challenge_stake(bigint,bigint,text) to authenticated;

notify pgrst,'reload schema';
commit;
