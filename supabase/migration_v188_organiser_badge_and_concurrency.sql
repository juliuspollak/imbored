-- v188: two follow-ups from a code review of v187.
--
-- 1. Organiser attention badge. v187 shipped tab-level counts inside
--    OrganiserRewards.jsx (client-computed from already-fetched rows), but
--    nothing exposed a total for the account-menu badge, and the existing
--    open-reward-requests badge hook only counts for global admins/reward
--    stewards - a circle organiser who is neither gets no signal at all
--    that a cancellation request or a new idea is waiting on them. This is
--    a usability gap, not a deferrable polish item.
--
-- 2. Closes a same-user double-claim gap: redeem_reward already prevented
--    two DIFFERENT people from holding a one-time/reusable reward at once
--    (locks the rewards row, checks for any other in-progress redemption),
--    but a limited reward had no such guard - nothing stopped the same
--    user from claiming two units of a 3-unit reward via a double-tap or a
--    slow-network retry. Added a per-user-per-reward check that applies to
--    every reward_type.

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
  -- Same-user guard, independent of type: stops a double-tap or a retried
  -- request from reserving points twice for the same reward.
  if exists(
    select 1 from reward_redemptions
    where reward_id=rw.id and player_id=auth.uid() and status in ('requested','approved')
  ) then
    raise exception 'You already have this in progress.';
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

-- ---------- organiser attention badge: new ideas awaiting a decision,
-- plus active rewards with a cancellation request waiting on them.
-- (A vote that reaches majority auto-publishes with no organiser step, so
-- it deliberately isn't counted here - there's nothing left to act on.) ----------
create or replace function public.get_organiser_attention_count()
returns int
language sql stable security definer set search_path=public as $$
  select
    (select count(*)::int from rewards rw
       where rw.status='suggested' and public.is_circle_organiser(rw.circle_id,auth.uid()))
    +
    (select count(*)::int from reward_redemptions red
       join rewards rw on rw.id=red.reward_id
       where red.cancellation_requested_at is not null
         and red.status='requested'
         and public.is_circle_organiser(rw.circle_id,auth.uid()));
$$;
revoke all on function public.get_organiser_attention_count() from public;
grant execute on function public.get_organiser_attention_count() to authenticated;

notify pgrst,'reload schema';
