-- v190: The old delete_reward(bigint) (from v178) still checks
-- is_circle_approver, which v179 dropped when circles replaced teams — every
-- call has raised "function does not exist" since, so there has been no
-- working way for an organiser to remove a reward item. Repoint it at
-- is_circle_organiser (the v187 role check every other reward RPC uses), and
-- add a catalog listing so the organiser can see and remove active items
-- from OrganiserRewards.jsx (redemption requests only get listed there
-- today, not the reward items themselves).

begin;

create or replace function public.delete_reward(target_reward_id bigint)
returns void language plpgsql security definer set search_path=public as $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id;
  if not found then raise exception 'Reward not found'; end if;
  if not public.is_circle_organiser(rw.circle_id,auth.uid()) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if exists(select 1 from reward_redemptions where reward_id=target_reward_id) then
    raise exception 'This item has redemption history and can''t be deleted — deactivate it instead.';
  end if;
  delete from rewards where id=target_reward_id;
end; $$;
revoke all on function public.delete_reward(bigint) from public;
grant execute on function public.delete_reward(bigint) to authenticated;

create or replace function public.get_organiser_reward_catalog()
returns table(
  id bigint, circle_id bigint, circle_name text, name text, reward_type text,
  points_cost bigint, stock_quantity int, created_at timestamptz
)
language sql security definer stable set search_path=public as $$
  select rw.id, rw.circle_id, c.name::text, rw.name::text, rw.reward_type,
    rw.points_cost, rw.stock_quantity, rw.created_at
  from rewards rw
  join circles c on c.id=rw.circle_id
  where rw.status='active'
    and public.is_circle_organiser(rw.circle_id,auth.uid())
  order by rw.created_at desc;
$$;
revoke all on function public.get_organiser_reward_catalog() from public;
grant execute on function public.get_organiser_reward_catalog() to authenticated;

notify pgrst,'reload schema';
commit;
