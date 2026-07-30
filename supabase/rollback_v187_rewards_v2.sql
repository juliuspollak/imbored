-- ROLLBACK for migration_v187_rewards_v2.sql and migration_v188_organiser_
-- badge_and_concurrency.sql. This is NOT part of the normal vNNN sequence -
-- it's an emergency script, kept separate on purpose so it's never
-- accidentally run as "the next migration."
--
-- Only run this if Rewards v2 needs to come off entirely. It restores the
-- pre-v187 function bodies (propose_reward, redeem_reward,
-- review_redemption, dispute_redemption, list_my_available_rewards,
-- get_my_reward_proposals) and drops the v187/v188 additions.
--
-- IMPORTANT: this script deliberately does NOT drop the new columns
-- (rewards.reward_type/is_physical/taken_at, reward_redemptions.
-- cancellation_requested_at) or touch any rows. If players have already
-- used the new flow (voted, added an idea, requested a cancellation),
-- that data stays in place but becomes inert once the old functions are
-- back - safer than destroying it. A commented-out section at the bottom
-- drops those columns too, for a true clean revert, but only run that if
-- you are certain no real usage happened under v2.

begin;

-- ---------- restore old propose_reward (member could set a price; v182) ----------
drop function if exists public.propose_reward(bigint,text,text,text,text,boolean);
create function public.propose_reward(
  target_circle_id bigint,reward_name text,reward_description text,reward_image_url text,
  reward_points_cost bigint,reward_stock_quantity int
) returns bigint language plpgsql security definer set search_path=public as $$
declare new_id bigint; can_price boolean;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not (exists(select 1 from circle_members where circle_id=target_circle_id and user_id=auth.uid()) or is_admin(auth.uid())) then
    raise exception 'You are not a member of this circle.' using errcode='42501';
  end if;

  can_price:=is_admin(auth.uid()) or is_reward_steward(auth.uid());
  if not can_price and reward_points_cost is not null then
    raise exception 'Only a reward steward can set a price — suggest the item without one.' using errcode='42501';
  end if;

  insert into rewards(name,description,image_url,points_cost,stock_quantity,circle_id,status,created_by)
  values(
    reward_name,reward_description,reward_image_url,reward_points_cost,reward_stock_quantity,target_circle_id,
    case when reward_points_cost is null then 'suggested' else 'pending' end,
    auth.uid()
  )
  returning id into new_id;
  return new_id;
end; $$;
revoke all on function public.propose_reward(bigint,text,text,text,bigint,int) from public;
grant execute on function public.propose_reward(bigint,text,text,text,bigint,int) to authenticated;

-- ---------- restore old redeem_reward (v181: no one-active-use gate,
-- requires_approval decides requested vs approved) ----------
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

-- ---------- restore old review_redemption (v167: reward-manager only,
-- no organiser widening, no one-time delisting) ----------
create or replace function public.review_redemption(target_id bigint, new_status text, admin_note_in text default null)
returns void language plpgsql security definer set search_path=public as $$
declare red reward_redemptions;
begin
  if not is_reward_manager(auth.uid()) then raise exception 'Reward managers only'; end if;
  if new_status not in ('approved','declined','fulfilled') then raise exception 'Invalid status'; end if;
  select * into red from reward_redemptions where id=target_id for update;
  if not found then raise exception 'Redemption not found'; end if;
  if red.status not in ('requested','approved','disputed') then
    raise exception 'This request is already %', red.status;
  end if;
  if new_status='declined' and red.status not in ('declined','cancelled') then
    update player_progress set available_points=available_points+red.points_cost,updated_at=now() where player_id=red.player_id;
    insert into points_transactions(player_id,points,reason_code,reward_id,metadata,created_by)
      values(red.player_id,red.points_cost,'REWARD_REFUND',red.reward_id,jsonb_build_object('redemption_id',red.id),auth.uid());
    update rewards set stock_quantity=stock_quantity+1 where id=red.reward_id and stock_quantity is not null;
  end if;
  update reward_redemptions set status=new_status,admin_note=admin_note_in,reviewed_by=auth.uid(),reviewed_at=now(),
    fulfilled_at=case when new_status='fulfilled' then now() else fulfilled_at end,
    dispute_reason=case when new_status='fulfilled' then null else dispute_reason end,
    disputed_at=case when new_status='fulfilled' then null else disputed_at end
    where id=target_id;
end; $$;
grant execute on function public.review_redemption(bigint,text,text) to authenticated;

-- ---------- restore old dispute_redemption (v167: 48-hour window) ----------
create or replace function public.dispute_redemption(target_id bigint, reason text)
returns void language plpgsql security definer set search_path=public as $$
declare red reward_redemptions;
begin
  select * into red from reward_redemptions where id=target_id and player_id=auth.uid() for update;
  if not found then raise exception 'Redemption not found'; end if;
  if red.status<>'fulfilled' then raise exception 'Only a fulfilled request can be disputed'; end if;
  if red.fulfilled_at is null or red.fulfilled_at < now() - interval '48 hours' then
    raise exception 'Disputes must be raised within 48 hours of fulfilment';
  end if;
  if nullif(trim(reason),'') is null then raise exception 'A reason is required'; end if;
  update reward_redemptions set status='disputed',dispute_reason=reason,disputed_at=now() where id=target_id;
end; $$;
grant execute on function public.dispute_redemption(bigint,text) to authenticated;

-- ---------- restore old list_my_available_rewards (v181 shape) ----------
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

-- ---------- restore old get_my_reward_proposals (v186 shape) ----------
drop function if exists public.get_my_reward_proposals();
create function public.get_my_reward_proposals()
returns table(
  id bigint, circle_id bigint, circle_name text, name text, description text,
  image_url text, points_cost bigint, status text,
  approve_count int, reject_count int, required_count int, created_at timestamptz
)
language sql security definer stable set search_path=public as $$
  select rw.id, rw.circle_id, c.name::text, rw.name::text, rw.description::text,
    rw.image_url::text, rw.points_cost, rw.status,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='reject'),
    (floor((select count(*)::int from circle_members m where m.circle_id=rw.circle_id and m.can_approve_rewards=true)::numeric/2)+1)::int,
    rw.created_at
  from rewards rw
  join circles c on c.id=rw.circle_id
  where rw.created_by=auth.uid()
  order by rw.created_at desc;
$$;
revoke all on function public.get_my_reward_proposals() from public;
grant execute on function public.get_my_reward_proposals() to authenticated;

-- ---------- drop the v187/v188 additions ----------
drop function if exists public.is_circle_organiser(bigint,uuid);
drop function if exists public.am_i_a_circle_organiser();
drop function if exists public.organiser_make_reward_available(bigint,bigint,int);
drop function if exists public.organiser_start_vote(bigint,bigint);
drop function if exists public.organiser_decline_idea(bigint);
drop function if exists public.vote_on_reward(bigint,boolean);
drop function if exists public.request_cancel_redemption(bigint);
drop function if exists public.resolve_cancellation(bigint,boolean);
drop function if exists public.get_organiser_new_ideas();
drop function if exists public.get_organiser_active_rewards();
drop function if exists public.get_organiser_finished();
drop function if exists public.get_circle_ideas_to_vote_on();
drop function if exists public.get_organiser_attention_count();

notify pgrst,'reload schema';
commit;

-- ---------- OPTIONAL: true clean revert, only if you're certain no real
-- data was created under v2 (no ideas added, no votes cast, no
-- cancellations requested since v187 was applied). Uncomment and run as
-- its own statement if so - left out of the main transaction above so a
-- partial run can't accidentally drop columns you needed to keep.
--
-- alter table public.rewards drop constraint if exists rewards_reward_type_check;
-- alter table public.rewards drop column if exists reward_type;
-- alter table public.rewards drop column if exists is_physical;
-- alter table public.rewards drop column if exists taken_at;
-- alter table public.reward_redemptions drop column if exists cancellation_requested_at;
-- notify pgrst,'reload schema';
