-- v187: Rewards v2 — two roles (member / organiser), voting open to every
-- circle member instead of a flagged approver subset, organiser can publish
-- a normal idea instantly and only routes expensive/unusual ones to a vote,
-- three reward types (one-time / limited / reusable) with a real
-- one-active-use-at-a-time rule, and player-initiated cancellation requests
-- the organiser approves or declines.
--
-- Deliberately NOT touched (become dead code once the frontend stops
-- calling them, left in place rather than dropped): price_reward_proposal,
-- get_pending_reward_proposals, review_reward_proposal,
-- set_circle_reward_approver, is_circle_reward_approver. The
-- circle_members.can_approve_rewards column also stays in the schema,
-- just unused by rewards going forward.

begin;

alter table public.rewards
  add column if not exists reward_type text not null default 'reusable',
  add column if not exists is_physical boolean not null default true,
  add column if not exists taken_at timestamptz;

alter table public.rewards drop constraint if exists rewards_reward_type_check;
alter table public.rewards add constraint rewards_reward_type_check
  check (reward_type in ('one_time','limited','reusable'));

alter table public.reward_redemptions
  add column if not exists cancellation_requested_at timestamptz;

-- ---------- organiser = circle creator (plus admin, same escape hatch
-- every other circle RPC already uses) ----------
create or replace function public.is_circle_organiser(target_circle_id bigint, uid uuid)
returns boolean
language sql stable security definer set search_path=public as $$
  select public.is_admin(uid) or exists(
    select 1 from circles where id=target_circle_id and created_by=uid
  );
$$;
revoke all on function public.is_circle_organiser(bigint,uuid) from public;
grant execute on function public.is_circle_organiser(bigint,uuid) to authenticated;

create or replace function public.am_i_a_circle_organiser()
returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from circles where created_by=auth.uid());
$$;
revoke all on function public.am_i_a_circle_organiser() from public;
grant execute on function public.am_i_a_circle_organiser() to authenticated;

-- ---------- propose_reward: idea only, never a price. Signature changed
-- (reward_type/is_physical replace the old price/stock params a member
-- was never supposed to set), so drop first. ----------
drop function if exists public.propose_reward(bigint,text,text,text,bigint,int);
create or replace function public.propose_reward(
  target_circle_id bigint,
  reward_name text,
  reward_description text,
  reward_image_url text,
  reward_type text default 'reusable',
  reward_is_physical boolean default true
) returns bigint
language plpgsql security definer set search_path=public as $$
declare new_id bigint;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not (exists(select 1 from circle_members where circle_id=target_circle_id and user_id=auth.uid()) or is_admin(auth.uid())) then
    raise exception 'You are not a member of this circle.' using errcode='42501';
  end if;
  if reward_type not in ('one_time','limited','reusable') then
    raise exception 'Unknown reward type.' using errcode='22023';
  end if;
  if nullif(btrim(reward_name),'') is null then
    raise exception 'Give it a name.' using errcode='22023';
  end if;

  insert into rewards(name,description,image_url,circle_id,status,created_by,reward_type,is_physical)
  values(reward_name,reward_description,reward_image_url,target_circle_id,'suggested',auth.uid(),reward_type,coalesce(reward_is_physical,true))
  returning id into new_id;
  return new_id;
end; $$;
revoke all on function public.propose_reward(bigint,text,text,text,text,boolean) from public;
grant execute on function public.propose_reward(bigint,text,text,text,text,boolean) to authenticated;

-- ---------- organiser decisions on a new idea ----------
create or replace function public.organiser_make_reward_available(
  target_reward_id bigint,
  price_points_cost bigint,
  stock_quantity_in int default null
) returns void
language plpgsql security definer set search_path=public as $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id for update;
  if not found then raise exception 'Reward not found.'; end if;
  if not public.is_circle_organiser(rw.circle_id,auth.uid()) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if rw.status not in ('suggested','pending') then
    raise exception 'This idea has already been decided.';
  end if;
  if coalesce(price_points_cost,0)<=0 then raise exception 'Enter a points cost.'; end if;
  if rw.reward_type='limited' and coalesce(stock_quantity_in,0)<=0 then
    raise exception 'Enter how many are available.';
  end if;

  update rewards set
    points_cost=price_points_cost,
    stock_quantity=case when rw.reward_type='limited' then stock_quantity_in else null end,
    status='active',
    updated_at=now()
  where id=target_reward_id;
end; $$;
revoke all on function public.organiser_make_reward_available(bigint,bigint,int) from public;
grant execute on function public.organiser_make_reward_available(bigint,bigint,int) to authenticated;

create or replace function public.organiser_start_vote(
  target_reward_id bigint,
  price_points_cost bigint
) returns void
language plpgsql security definer set search_path=public as $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id for update;
  if not found then raise exception 'Reward not found.'; end if;
  if not public.is_circle_organiser(rw.circle_id,auth.uid()) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if rw.status<>'suggested' then raise exception 'This idea has already been decided.'; end if;
  if coalesce(price_points_cost,0)<=0 then raise exception 'Enter a points cost.'; end if;

  update rewards set points_cost=price_points_cost,status='pending',updated_at=now() where id=target_reward_id;
end; $$;
revoke all on function public.organiser_start_vote(bigint,bigint) from public;
grant execute on function public.organiser_start_vote(bigint,bigint) to authenticated;

create or replace function public.organiser_decline_idea(target_reward_id bigint)
returns void
language plpgsql security definer set search_path=public as $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id for update;
  if not found then raise exception 'Reward not found.'; end if;
  if not public.is_circle_organiser(rw.circle_id,auth.uid()) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if rw.status not in ('suggested','pending') then
    raise exception 'This idea has already been decided.';
  end if;
  update rewards set status='rejected',updated_at=now() where id=target_reward_id;
end; $$;
revoke all on function public.organiser_decline_idea(bigint) from public;
grant execute on function public.organiser_decline_idea(bigint) to authenticated;

-- ---------- voting: any circle member, changeable, majority of the whole
-- circle (not a flagged approver subset) ----------
create or replace function public.vote_on_reward(target_reward_id bigint, approve boolean)
returns void
language plpgsql security definer set search_path=public as $$
declare rw rewards; member_count int; approve_count int; required_count int;
begin
  select * into rw from rewards where id=target_reward_id for update;
  if not found then raise exception 'Reward not found.'; end if;
  if rw.status<>'pending' then raise exception 'This idea is not open for voting.'; end if;
  if not exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid()) then
    raise exception 'You are not a member of this circle.' using errcode='42501';
  end if;

  insert into reward_approvals(reward_id,approver_id,decision)
  values(target_reward_id,auth.uid(),case when approve then 'approve' else 'reject' end)
  on conflict(reward_id,approver_id) do update set decision=excluded.decision;

  select count(*) into member_count from circle_members where circle_id=rw.circle_id;
  select count(*) into approve_count from reward_approvals where reward_id=target_reward_id and decision='approve';
  required_count:=floor(member_count::numeric/2)+1;

  if approve_count>=required_count then
    update rewards set status='active',updated_at=now() where id=target_reward_id;
  end if;
end; $$;
revoke all on function public.vote_on_reward(bigint,boolean) from public;
grant execute on function public.vote_on_reward(bigint,boolean) to authenticated;

-- ---------- redeem_reward: same balance/membership checks as before, plus
-- the one-active-use-at-a-time rule for one-time and reusable rewards
-- (limited rewards keep using stock_quantity, which already allows several
-- concurrent in-progress claims up to the stock count) ----------
create or replace function public.redeem_reward(target_reward_id bigint, note text default null)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare rw rewards; p player_progress; red_id bigint;
begin
  select * into rw from rewards where id=target_reward_id and status='active' and taken_at is null for update;
  if not found then raise exception 'Reward unavailable'; end if;
  if not exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid()) then
    raise exception 'This reward is not available to you.' using errcode='42501';
  end if;
  if rw.stock_quantity is not null and rw.stock_quantity<=0 then raise exception 'Out of stock'; end if;
  if rw.reward_type in ('one_time','reusable') and exists(
    select 1 from reward_redemptions where reward_id=rw.id and status in ('requested','approved')
  ) then
    raise exception 'Someone else already has this in progress.';
  end if;
  perform ensure_player_progress(auth.uid());
  select * into p from player_progress where player_id=auth.uid() for update;
  if p.available_points<rw.points_cost then raise exception 'Not enough points'; end if;
  update player_progress set available_points=available_points-rw.points_cost,updated_at=now() where player_id=auth.uid();
  if rw.stock_quantity is not null then update rewards set stock_quantity=stock_quantity-1,updated_at=now() where id=rw.id; end if;
  insert into reward_redemptions(player_id,reward_id,points_cost,status,player_note)
    values(auth.uid(),rw.id,rw.points_cost,'requested',note) returning id into red_id;
  insert into points_transactions(player_id,points,reason_code,reward_id,metadata,created_by)
    values(auth.uid(),-rw.points_cost,'REWARD_REDEEMED',rw.id,jsonb_build_object('redemption_id',red_id,'reward_name',rw.name),auth.uid());
  return jsonb_build_object('redemption_id',red_id,'balance',p.available_points-rw.points_cost);
end; $$;
grant execute on function public.redeem_reward(bigint,text) to authenticated;

-- ---------- review_redemption: widened to also allow the owning circle's
-- organiser (not just a global reward manager), plus a one-time reward is
-- permanently delisted the moment it's actually given ----------
create or replace function public.review_redemption(target_id bigint, new_status text, admin_note_in text default null)
returns void
language plpgsql security definer set search_path=public as $$
declare red reward_redemptions; rw rewards;
begin
  select * into red from reward_redemptions where id=target_id for update;
  if not found then raise exception 'Redemption not found'; end if;
  select * into rw from rewards where id=red.reward_id;
  if not (public.is_reward_manager(auth.uid()) or public.is_circle_organiser(rw.circle_id,auth.uid())) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if new_status not in ('approved','declined','fulfilled') then raise exception 'Invalid status'; end if;
  if red.status not in ('requested','approved','disputed') then
    raise exception 'This request is already %', red.status;
  end if;
  if new_status='declined' and red.status not in ('declined','cancelled') then
    update player_progress set available_points=available_points+red.points_cost,updated_at=now() where player_id=red.player_id;
    insert into points_transactions(player_id,points,reason_code,reward_id,metadata,created_by)
      values(red.player_id,red.points_cost,'REWARD_REFUND',red.reward_id,jsonb_build_object('redemption_id',red.id),auth.uid());
    update rewards set stock_quantity=stock_quantity+1 where id=red.reward_id and stock_quantity is not null;
  end if;
  if new_status='fulfilled' and rw.reward_type='one_time' then
    update rewards set taken_at=now() where id=rw.id;
  end if;
  update reward_redemptions set status=new_status,admin_note=admin_note_in,reviewed_by=auth.uid(),reviewed_at=now(),
    fulfilled_at=case when new_status='fulfilled' then now() else fulfilled_at end,
    dispute_reason=case when new_status='fulfilled' then null else dispute_reason end,
    disputed_at=case when new_status='fulfilled' then null else disputed_at end,
    cancellation_requested_at=case when new_status='fulfilled' then null else cancellation_requested_at end
    where id=target_id;
end; $$;
grant execute on function public.review_redemption(bigint,text,text) to authenticated;

-- ---------- player-initiated cancellation: request, then the organiser
-- approves (refund, same as decline) or keeps it (back to "in progress") ----------
create or replace function public.request_cancel_redemption(target_id bigint)
returns void
language plpgsql security definer set search_path=public as $$
declare red reward_redemptions;
begin
  select * into red from reward_redemptions where id=target_id and player_id=auth.uid() for update;
  if not found then raise exception 'Redemption not found'; end if;
  if red.status<>'requested' then
    raise exception 'This can no longer be cancelled directly — it''s already %.', red.status;
  end if;
  update reward_redemptions set cancellation_requested_at=now() where id=target_id;
end; $$;
revoke all on function public.request_cancel_redemption(bigint) from public;
grant execute on function public.request_cancel_redemption(bigint) to authenticated;

create or replace function public.resolve_cancellation(target_id bigint, approve boolean)
returns void
language plpgsql security definer set search_path=public as $$
declare red reward_redemptions; rw rewards;
begin
  select * into red from reward_redemptions where id=target_id for update;
  if not found then raise exception 'Redemption not found'; end if;
  select * into rw from rewards where id=red.reward_id;
  if not (public.is_reward_manager(auth.uid()) or public.is_circle_organiser(rw.circle_id,auth.uid())) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if red.cancellation_requested_at is null then raise exception 'No cancellation was requested.'; end if;
  if red.status<>'requested' then raise exception 'This request is already %', red.status; end if;

  if approve then
    update player_progress set available_points=available_points+red.points_cost,updated_at=now() where player_id=red.player_id;
    insert into points_transactions(player_id,points,reason_code,reward_id,metadata,created_by)
      values(red.player_id,red.points_cost,'REWARD_REFUND',red.reward_id,jsonb_build_object('redemption_id',red.id),auth.uid());
    update rewards set stock_quantity=stock_quantity+1 where id=red.reward_id and stock_quantity is not null;
    update reward_redemptions set status='cancelled',reviewed_by=auth.uid(),reviewed_at=now() where id=target_id;
  else
    update reward_redemptions set cancellation_requested_at=null where id=target_id;
  end if;
end; $$;
revoke all on function public.resolve_cancellation(bigint,boolean) from public;
grant execute on function public.resolve_cancellation(bigint,boolean) to authenticated;

-- ---------- dispute_redemption: dropped the 48-hour reporting window ----------
create or replace function public.dispute_redemption(target_id bigint, reason text)
returns void
language plpgsql security definer set search_path=public as $$
declare red reward_redemptions;
begin
  select * into red from reward_redemptions where id=target_id and player_id=auth.uid() for update;
  if not found then raise exception 'Redemption not found'; end if;
  if red.status<>'fulfilled' then raise exception 'Only a completed reward can be flagged.'; end if;
  if nullif(trim(reason),'') is null then raise exception 'A reason is required'; end if;
  update reward_redemptions set status='disputed',dispute_reason=reason,disputed_at=now() where id=target_id;
end; $$;
grant execute on function public.dispute_redemption(bigint,text) to authenticated;

-- ---------- reads: available catalogue, my proposals (all statuses),
-- organiser's three tabs. Column shapes changed, so drop first. ----------
drop function if exists public.list_my_available_rewards();
create function public.list_my_available_rewards()
returns table(id bigint,circle_id bigint,circle_name text,name text,description text,image_url text,points_cost bigint,stock_quantity int,reward_type text,is_physical boolean)
language sql security definer stable set search_path=public as $$
  select rw.id,rw.circle_id,c.name::text,rw.name::text,rw.description::text,rw.image_url::text,rw.points_cost,rw.stock_quantity,rw.reward_type,rw.is_physical
  from rewards rw
  join circles c on c.id=rw.circle_id
  where rw.status='active' and rw.taken_at is null
    and (rw.stock_quantity is null or rw.stock_quantity>0)
    and exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid())
  order by rw.points_cost;
$$;
revoke all on function public.list_my_available_rewards() from public;
grant execute on function public.list_my_available_rewards() to authenticated;

drop function if exists public.get_my_reward_proposals();
create function public.get_my_reward_proposals()
returns table(
  id bigint, circle_id bigint, circle_name text, name text, description text,
  image_url text, reward_type text, is_physical boolean, points_cost bigint, status text,
  approve_count int, required_count int, created_at timestamptz
)
language sql security definer stable set search_path=public as $$
  select rw.id, rw.circle_id, c.name::text, rw.name::text, rw.description::text,
    rw.image_url::text, rw.reward_type, rw.is_physical, rw.points_cost, rw.status,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (floor((select count(*)::int from circle_members m where m.circle_id=rw.circle_id)::numeric/2)+1)::int,
    rw.created_at
  from rewards rw
  join circles c on c.id=rw.circle_id
  where rw.created_by=auth.uid()
  order by rw.created_at desc;
$$;
revoke all on function public.get_my_reward_proposals() from public;
grant execute on function public.get_my_reward_proposals() to authenticated;

create or replace function public.get_organiser_new_ideas()
returns table(
  id bigint, circle_id bigint, circle_name text, name text, description text,
  image_url text, reward_type text, is_physical boolean, status text,
  points_cost bigint, created_by uuid, creator_name text, creator_icon text,
  approve_count int, required_count int, created_at timestamptz
)
language sql security definer stable set search_path=public as $$
  select rw.id, rw.circle_id, c.name::text, rw.name::text, rw.description::text,
    rw.image_url::text, rw.reward_type, rw.is_physical, rw.status, rw.points_cost,
    rw.created_by, creator.name::text, creator.icon::text,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (floor((select count(*)::int from circle_members m where m.circle_id=rw.circle_id)::numeric/2)+1)::int,
    rw.created_at
  from rewards rw
  join circles c on c.id=rw.circle_id
  join profiles creator on creator.id=rw.created_by
  where rw.status in ('suggested','pending')
    and public.is_circle_organiser(rw.circle_id,auth.uid())
  order by rw.created_at desc;
$$;
revoke all on function public.get_organiser_new_ideas() from public;
grant execute on function public.get_organiser_new_ideas() to authenticated;

create or replace function public.get_organiser_active_rewards()
returns table(
  id bigint, reward_id bigint, reward_name text, circle_id bigint, circle_name text,
  player_id uuid, player_name text, player_icon text, points_cost bigint,
  status text, cancellation_requested_at timestamptz, requested_at timestamptz
)
language sql security definer stable set search_path=public as $$
  select red.id, rw.id, rw.name::text, rw.circle_id, c.name::text,
    red.player_id, player.name::text, player.icon::text, red.points_cost,
    red.status, red.cancellation_requested_at, red.requested_at
  from reward_redemptions red
  join rewards rw on rw.id=red.reward_id
  join circles c on c.id=rw.circle_id
  join profiles player on player.id=red.player_id
  where red.status in ('requested','approved')
    and public.is_circle_organiser(rw.circle_id,auth.uid())
  order by red.cancellation_requested_at desc nulls last, red.requested_at desc;
$$;
revoke all on function public.get_organiser_active_rewards() from public;
grant execute on function public.get_organiser_active_rewards() to authenticated;

create or replace function public.get_organiser_finished()
returns table(
  id bigint, reward_id bigint, reward_name text, circle_id bigint, circle_name text,
  player_id uuid, player_name text, player_icon text, points_cost bigint,
  status text, dispute_reason text, fulfilled_at timestamptz, reviewed_at timestamptz
)
language sql security definer stable set search_path=public as $$
  select red.id, rw.id, rw.name::text, rw.circle_id, c.name::text,
    red.player_id, player.name::text, player.icon::text, red.points_cost,
    red.status, red.dispute_reason, red.fulfilled_at, red.reviewed_at
  from reward_redemptions red
  join rewards rw on rw.id=red.reward_id
  join circles c on c.id=rw.circle_id
  join profiles player on player.id=red.player_id
  where red.status in ('fulfilled','declined','cancelled','disputed')
    and public.is_circle_organiser(rw.circle_id,auth.uid())
  order by coalesce(red.fulfilled_at,red.reviewed_at) desc;
$$;
revoke all on function public.get_organiser_finished() from public;
grant execute on function public.get_organiser_finished() to authenticated;

-- ---------- everything currently open for a vote, in any circle the
-- caller belongs to, plus their own current vote (so the UI can show
-- "you voted yes" and let them change it) ----------
create or replace function public.get_circle_ideas_to_vote_on()
returns table(
  id bigint, circle_id bigint, circle_name text, name text, description text,
  image_url text, points_cost bigint, created_by uuid, creator_name text, creator_icon text,
  approve_count int, required_count int, my_vote text, created_at timestamptz
)
language sql security definer stable set search_path=public as $$
  select rw.id, rw.circle_id, c.name::text, rw.name::text, rw.description::text,
    rw.image_url::text, rw.points_cost, rw.created_by, creator.name::text, creator.icon::text,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (floor((select count(*)::int from circle_members m where m.circle_id=rw.circle_id)::numeric/2)+1)::int,
    (select ra.decision from reward_approvals ra where ra.reward_id=rw.id and ra.approver_id=auth.uid()),
    rw.created_at
  from rewards rw
  join circles c on c.id=rw.circle_id
  join profiles creator on creator.id=rw.created_by
  where rw.status='pending'
    and exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid())
  order by rw.created_at desc;
$$;
revoke all on function public.get_circle_ideas_to_vote_on() from public;
grant execute on function public.get_circle_ideas_to_vote_on() to authenticated;

notify pgrst,'reload schema';
commit;
