-- v209: Use one player-facing Practice reward rule.
--
-- Keep the per-game rewarded-round limit so playing one game never prevents a
-- player's first rewarded round in another. Retain daily_points_cap for RPC
-- and historical migration compatibility, but make it non-binding.

begin;

alter table public.reward_rules
  drop constraint if exists reward_rules_daily_points_cap_range;

update public.reward_rules
set daily_points_cap=1000000;

-- Prevent future rule rows or unrelated admin updates from restoring the old
-- global mechanic.
create or replace function public.normalise_reward_rules_daily_points_cap()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.daily_points_cap:=1000000;
  return new;
end;
$$;

drop trigger if exists reward_rules_normalise_daily_points_cap
  on public.reward_rules;

create trigger reward_rules_normalise_daily_points_cap
before insert or update of daily_points_cap
on public.reward_rules
for each row
execute function public.normalise_reward_rules_daily_points_cap();

notify pgrst,'reload schema';

commit;
