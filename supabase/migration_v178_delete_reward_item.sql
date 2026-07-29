-- v178: Let a circle approver delete a reward item that has no redemption
-- history (refuse otherwise — deactivate it instead so the ledger stays
-- intact). Run after v177.

begin;

create or replace function public.delete_reward(target_reward_id bigint)
returns void language plpgsql security definer set search_path=public as $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id;
  if not found then raise exception 'Reward not found'; end if;
  if not is_circle_approver(rw.circle_id,auth.uid()) then
    raise exception 'Only an approver of this circle can delete this item.' using errcode='42501';
  end if;
  if exists(select 1 from reward_redemptions where reward_id=target_reward_id) then
    raise exception 'This item has redemption history and can''t be deleted — deactivate it instead.';
  end if;
  delete from rewards where id=target_reward_id;
end; $$;
revoke all on function public.delete_reward(bigint) from public;
grant execute on function public.delete_reward(bigint) to authenticated;

notify pgrst,'reload schema';
commit;
