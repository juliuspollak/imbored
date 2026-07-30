-- v191: delete_reward refuses a reward with redemption history, which is
-- the right default (it protects real point ledgers) but leaves no way to
-- clear test/junk rewards created during setup. Add an explicit force
-- option: it deletes the reward's reward_redemptions rows first (removing
-- the "this player claimed this" records) then the reward itself. The
-- actual points ledger — points_transactions — is untouched: its
-- reward_id column is `on delete set null`, so balances and history stay
-- correct; only the redemption/reward objects go away.

begin;

drop function if exists public.delete_reward(bigint);
create or replace function public.delete_reward(target_reward_id bigint, force boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id;
  if not found then raise exception 'Reward not found'; end if;
  if not public.is_circle_organiser(rw.circle_id,auth.uid()) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if exists(select 1 from reward_redemptions where reward_id=target_reward_id) then
    if not force then
      raise exception 'This item has redemption history and can''t be deleted — deactivate it instead.';
    end if;
    delete from reward_redemptions where reward_id=target_reward_id;
  end if;
  delete from rewards where id=target_reward_id;
end; $$;
revoke all on function public.delete_reward(bigint,boolean) from public;
grant execute on function public.delete_reward(bigint,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
