-- v182: Merge "wishes" into "rewards" — one pipeline instead of two.
-- Any circle member can propose an item; if they can't set a price
-- (not a reward manager), it lands as 'suggested' until an approver
-- prices it, then enters the normal majority-vote flow.
-- Run after v181.

begin;

alter table public.rewards alter column points_cost drop not null;
alter table public.rewards drop constraint if exists rewards_points_cost_check;
alter table public.rewards add constraint rewards_points_cost_check check (points_cost is null or points_cost>0);

alter table public.rewards drop constraint if exists rewards_status_check;
alter table public.rewards add constraint rewards_status_check check (status in ('suggested','pending','active','rejected'));

drop table if exists public.reward_wishes cascade;

drop function if exists public.propose_reward(bigint,text,text,text,bigint,int);
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

create or replace function public.price_reward_proposal(target_reward_id bigint, price_points_cost bigint)
returns void language plpgsql security definer set search_path=public as $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id for update;
  if not found then raise exception 'Reward not found'; end if;
  if not is_circle_reward_approver(rw.circle_id,auth.uid()) then
    raise exception 'Only a reward approver of this circle can price it.' using errcode='42501';
  end if;
  if rw.status<>'suggested' then raise exception 'This item has already been priced.'; end if;
  if coalesce(price_points_cost,0)<=0 then raise exception 'Enter a points cost.'; end if;

  update rewards set points_cost=price_points_cost,status='pending',updated_at=now() where id=target_reward_id;
end; $$;
revoke all on function public.price_reward_proposal(bigint,bigint) from public;
grant execute on function public.price_reward_proposal(bigint,bigint) to authenticated;

-- get_pending_reward_proposals now also surfaces 'suggested' (unpriced)
-- items so approvers can price them from the same list. Adding the status
-- column changes the return row type, which create-or-replace rejects.
drop function if exists public.get_pending_reward_proposals();
create function public.get_pending_reward_proposals()
returns table(id bigint,circle_id bigint,circle_name text,name text,description text,image_url text,points_cost bigint,stock_quantity int,status text,created_by uuid,creator_name text,creator_icon text,approve_count int,reject_count int,required_count int)
language sql security definer stable set search_path=public as $$
  select rw.id,rw.circle_id,c.name::text,rw.name::text,rw.description::text,rw.image_url::text,rw.points_cost,rw.stock_quantity,rw.status,
    rw.created_by,creator.name::text,creator.icon::text,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='reject'),
    (floor((select count(*)::int from circle_members m where m.circle_id=rw.circle_id and m.can_approve_rewards=true)::numeric/2)+1)::int
  from rewards rw
  join circles c on c.id=rw.circle_id
  join profiles creator on creator.id=rw.created_by
  where rw.status in ('suggested','pending') and (exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid()) or is_admin(auth.uid()))
  order by rw.created_at desc;
$$;
revoke all on function public.get_pending_reward_proposals() from public;
grant execute on function public.get_pending_reward_proposals() to authenticated;

notify pgrst,'reload schema';
commit;
