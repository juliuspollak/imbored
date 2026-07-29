-- v170: Guardian circles — group-approved reward items, isolated per family.
-- Run after v169.

begin;

-- ---------- Core tables ----------
create table if not exists public.guardian_circles (
  id bigint generated always as identity primary key,
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.guardian_circle_members (
  circle_id bigint not null references public.guardian_circles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  can_approve boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create table if not exists public.guardian_circle_invitations (
  id bigint generated always as identity primary key,
  circle_id bigint not null references public.guardian_circles(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists guardian_circle_invitations_one_pending_idx
  on public.guardian_circle_invitations(circle_id,invited_user_id)
  where status='pending';

-- ---------- Helpers ----------
create or replace function public.is_circle_member(target_circle_id bigint, uid uuid)
returns boolean language sql stable set search_path=public as $$
  select exists(select 1 from guardian_circle_members where circle_id=target_circle_id and user_id=uid);
$$;
grant execute on function public.is_circle_member(bigint,uuid) to authenticated;

create or replace function public.is_circle_approver(target_circle_id bigint, uid uuid)
returns boolean language sql stable set search_path=public as $$
  select public.is_admin(uid) or exists(
    select 1 from guardian_circle_members where circle_id=target_circle_id and user_id=uid and can_approve=true
  );
$$;
grant execute on function public.is_circle_approver(bigint,uuid) to authenticated;

-- ---------- RLS ----------
alter table public.guardian_circles enable row level security;
alter table public.guardian_circle_members enable row level security;
alter table public.guardian_circle_invitations enable row level security;

drop policy if exists "circle members can view their circles" on public.guardian_circles;
create policy "circle members can view their circles" on public.guardian_circles
  for select using (is_admin(auth.uid()) or is_circle_member(id,auth.uid()));

drop policy if exists "circle members can view membership" on public.guardian_circle_members;
create policy "circle members can view membership" on public.guardian_circle_members
  for select using (is_admin(auth.uid()) or is_circle_member(circle_id,auth.uid()));

drop policy if exists "invitation participants can view" on public.guardian_circle_invitations;
create policy "invitation participants can view" on public.guardian_circle_invitations
  for select using (
    invited_user_id=auth.uid() or invited_by=auth.uid() or is_circle_member(circle_id,auth.uid())
  );

-- ---------- Circle management RPCs ----------
create or replace function public.create_guardian_circle(circle_name text)
returns bigint language plpgsql security definer set search_path=public as $$
declare new_id bigint;
begin
  if nullif(trim(circle_name),'') is null then raise exception 'Name is required'; end if;
  insert into guardian_circles(name,created_by) values(trim(circle_name),auth.uid()) returning id into new_id;
  insert into guardian_circle_members(circle_id,user_id,can_approve) values(new_id,auth.uid(),true);
  return new_id;
end; $$;
revoke all on function public.create_guardian_circle(text) from public;
grant execute on function public.create_guardian_circle(text) to authenticated;

create or replace function public.set_circle_approver(target_circle_id bigint, target_user_id uuid, approve boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_circle_approver(target_circle_id,auth.uid()) then raise exception 'Only an approver of this circle can do that.' using errcode='42501'; end if;
  update guardian_circle_members set can_approve=approve where circle_id=target_circle_id and user_id=target_user_id;
  if not found then raise exception 'That person is not a member of this circle.'; end if;
end; $$;
revoke all on function public.set_circle_approver(bigint,uuid,boolean) from public;
grant execute on function public.set_circle_approver(bigint,uuid,boolean) to authenticated;

create or replace function public.invite_to_circle(target_circle_id bigint, target_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_circle_approver(target_circle_id,auth.uid()) then raise exception 'Only an approver of this circle can invite.' using errcode='42501'; end if;
  if is_circle_member(target_circle_id,target_user_id) then raise exception 'That person is already in this circle.'; end if;
  insert into guardian_circle_invitations(circle_id,invited_user_id,invited_by)
  values(target_circle_id,target_user_id,auth.uid())
  on conflict(circle_id,invited_user_id) where status='pending'
  do update set invited_by=excluded.invited_by,created_at=now();
end; $$;
revoke all on function public.invite_to_circle(bigint,uuid) from public;
grant execute on function public.invite_to_circle(bigint,uuid) to authenticated;

create or replace function public.get_my_pending_circle_invitations()
returns table(invitation_id bigint,circle_id bigint,circle_name text,invited_by uuid,inviter_name text,inviter_icon text,created_at timestamptz)
language sql security definer stable set search_path=public as $$
  select i.id,c.id,c.name::text,i.invited_by,p.name::text,p.icon::text,i.created_at
  from guardian_circle_invitations i
  join guardian_circles c on c.id=i.circle_id
  join profiles p on p.id=i.invited_by
  where i.invited_user_id=auth.uid() and i.status='pending'
  order by i.created_at desc;
$$;
revoke all on function public.get_my_pending_circle_invitations() from public;
grant execute on function public.get_my_pending_circle_invitations() to authenticated;

create or replace function public.decide_circle_invitation(target_invitation_id bigint, accept_invitation boolean)
returns void language plpgsql security definer set search_path=public as $$
declare item guardian_circle_invitations;
begin
  select * into item from guardian_circle_invitations
  where id=target_invitation_id and invited_user_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'Invitation is no longer available.'; end if;
  if accept_invitation then
    insert into guardian_circle_members(circle_id,user_id,can_approve) values(item.circle_id,auth.uid(),false)
    on conflict do nothing;
  end if;
  update guardian_circle_invitations set status=case when accept_invitation then 'accepted' else 'declined' end,decided_at=now() where id=item.id;
end; $$;
revoke all on function public.decide_circle_invitation(bigint,boolean) from public;
grant execute on function public.decide_circle_invitation(bigint,boolean) to authenticated;

create or replace function public.get_my_circles()
returns table(circle_id bigint,circle_name text,can_approve boolean,member_count int,approver_count int)
language sql security definer stable set search_path=public as $$
  select c.id,c.name::text,gcm.can_approve,
    (select count(*)::int from guardian_circle_members m where m.circle_id=c.id),
    (select count(*)::int from guardian_circle_members m where m.circle_id=c.id and m.can_approve=true)
  from guardian_circles c
  join guardian_circle_members gcm on gcm.circle_id=c.id and gcm.user_id=auth.uid()
  order by c.name;
$$;
revoke all on function public.get_my_circles() from public;
grant execute on function public.get_my_circles() to authenticated;

create or replace function public.get_circle_roster(target_circle_id bigint)
returns table(user_id uuid,name text,icon text,can_approve boolean)
language sql security definer stable set search_path=public as $$
  select p.id,p.name::text,p.icon::text,gcm.can_approve
  from guardian_circle_members gcm
  join profiles p on p.id=gcm.user_id
  where gcm.circle_id=target_circle_id and is_circle_member(target_circle_id,auth.uid())
  order by gcm.can_approve desc,p.name;
$$;
revoke all on function public.get_circle_roster(bigint) from public;
grant execute on function public.get_circle_roster(bigint) to authenticated;

create or replace function public.get_pending_reward_proposals()
returns table(id bigint,circle_id bigint,circle_name text,name text,description text,image_url text,points_cost bigint,stock_quantity int,created_by uuid,creator_name text,creator_icon text,approve_count int,reject_count int,required_count int)
language sql security definer stable set search_path=public as $$
  select rw.id,rw.circle_id,gc.name::text,rw.name::text,rw.description::text,rw.image_url::text,rw.points_cost,rw.stock_quantity,
    rw.created_by,creator.name::text,creator.icon::text,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='reject'),
    (floor((select count(*)::int from guardian_circle_members m where m.circle_id=rw.circle_id and m.can_approve=true)::numeric/2)+1)::int
  from rewards rw
  join guardian_circles gc on gc.id=rw.circle_id
  join profiles creator on creator.id=rw.created_by
  where rw.status='pending' and is_circle_member(rw.circle_id,auth.uid())
  order by rw.created_at desc;
$$;
revoke all on function public.get_pending_reward_proposals() from public;
grant execute on function public.get_pending_reward_proposals() to authenticated;

-- ---------- rewards: circle scoping and approval status ----------
alter table public.rewards add column if not exists circle_id bigint references public.guardian_circles(id);
alter table public.rewards add column if not exists status text;
alter table public.rewards drop constraint if exists rewards_status_check;
alter table public.rewards add constraint rewards_status_check check (status in ('pending','active','rejected'));

create table if not exists public.reward_approvals (
  id bigint generated always as identity primary key,
  reward_id bigint not null references public.rewards(id) on delete cascade,
  approver_id uuid not null references public.profiles(id) on delete cascade,
  decision text not null check (decision in ('approve','reject')),
  created_at timestamptz not null default now(),
  unique(reward_id,approver_id)
);
alter table public.reward_approvals enable row level security;
drop policy if exists "circle members can view approvals" on public.reward_approvals;
create policy "circle members can view approvals" on public.reward_approvals
  for select using (
    is_admin(auth.uid())
    or exists(select 1 from rewards rw where rw.id=reward_approvals.reward_id and is_circle_member(rw.circle_id,auth.uid()))
  );

-- ---------- Backfill: one Default circle owns every current reward ----------
do $$
declare default_circle_id bigint; owner_id uuid;
begin
  select id into owner_id from public.profiles where is_admin=true order by created_at limit 1;
  insert into public.guardian_circles(name,created_by) values('Default',owner_id) returning id into default_circle_id;

  insert into public.guardian_circle_members(circle_id,user_id,can_approve)
  select default_circle_id,id,true from public.profiles where is_admin=true or is_reward_steward=true
  on conflict do nothing;

  insert into public.guardian_circle_members(circle_id,user_id,can_approve)
  select default_circle_id,id,false from public.profiles
  where coalesce(is_admin,false)=false and coalesce(is_reward_steward,false)=false
  on conflict do nothing;

  update public.rewards set circle_id=default_circle_id where circle_id is null;
  update public.rewards set status=case when is_active then 'active' else 'rejected' end where status is null;
end $$;

alter table public.rewards alter column circle_id set not null;
alter table public.rewards alter column status set not null;
alter table public.rewards alter column status set default 'pending';

-- ---------- rewards RLS: circle-scoped instead of the old is_active/is_admin split ----------
drop policy if exists "active rewards readable" on public.rewards;
drop policy if exists "reward managers manage rewards" on public.rewards;

create policy "circle members and admins view rewards" on public.rewards
  for select using (is_admin(auth.uid()) or is_circle_member(circle_id,auth.uid()));
create policy "circle approvers update rewards" on public.rewards
  for update using (is_circle_approver(circle_id,auth.uid())) with check (is_circle_approver(circle_id,auth.uid()));

create or replace function public.propose_reward(
  target_circle_id bigint,reward_name text,reward_description text,reward_image_url text,
  reward_points_cost bigint,reward_stock_quantity int
) returns bigint language plpgsql security definer set search_path=public as $$
declare new_id bigint;
begin
  if not (is_admin(auth.uid()) or is_reward_steward(auth.uid())) then raise exception 'Reward managers only.' using errcode='42501'; end if;
  if not is_circle_member(target_circle_id,auth.uid()) then raise exception 'You are not a member of this circle.' using errcode='42501'; end if;
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
  if not is_circle_approver(rw.circle_id,auth.uid()) then raise exception 'Only an approver of this circle can review it.' using errcode='42501'; end if;
  if rw.status<>'pending' then raise exception 'This item has already been reviewed.'; end if;

  insert into reward_approvals(reward_id,approver_id,decision) values(target_reward_id,auth.uid(),decision_in)
  on conflict(reward_id,approver_id) do update set decision=excluded.decision,created_at=now();

  select count(*) into approver_count from guardian_circle_members where circle_id=rw.circle_id and can_approve=true;
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

create or replace function public.list_my_available_rewards()
returns table(id bigint,circle_id bigint,circle_name text,name text,description text,image_url text,points_cost bigint,stock_quantity int)
language sql security definer stable set search_path=public as $$
  select rw.id,rw.circle_id,gc.name::text,rw.name::text,rw.description::text,rw.image_url::text,rw.points_cost,rw.stock_quantity
  from rewards rw
  join guardian_circles gc on gc.id=rw.circle_id
  where rw.status='active' and is_circle_member(rw.circle_id,auth.uid())
  order by rw.points_cost;
$$;
revoke all on function public.list_my_available_rewards() from public;
grant execute on function public.list_my_available_rewards() to authenticated;

-- ---------- redeem_reward: circle membership + status='active' instead of is_active ----------
create or replace function public.redeem_reward(target_reward_id bigint, note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare rw rewards; p player_progress; red_id bigint;
begin
  select * into rw from rewards where id=target_reward_id and status='active' for update;
  if not found then raise exception 'Reward unavailable'; end if;
  if not is_circle_member(rw.circle_id,auth.uid()) then raise exception 'This item is not available to you.' using errcode='42501'; end if;
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

alter table public.rewards drop column if exists is_active;

notify pgrst,'reload schema';
commit;
