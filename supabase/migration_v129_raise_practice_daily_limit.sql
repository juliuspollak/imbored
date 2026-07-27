-- Raise configurable practice daily limit v129
--
-- V128 correctly replaced the unreliable CHECK constraint, but its trigger
-- still capped every saved value at 50. That made the Admin screen report a
-- successful save and then display 50 again. Permit a practical admin range
-- of 1..1000 instead.

alter table public.reward_rules
  drop constraint if exists reward_rules_practice_daily_limit_range;

create or replace function public.normalise_reward_rules_practice_limit()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.practice_daily_limit := least(
    greatest(coalesce(new.practice_daily_limit,5),1),
    1000
  );
  return new;
end;
$$;

-- Recreate defensively in case V128 was only partially applied.
drop trigger if exists reward_rules_normalise_practice_limit
  on public.reward_rules;

create trigger reward_rules_normalise_practice_limit
before insert or update of practice_daily_limit
on public.reward_rules
for each row
execute function public.normalise_reward_rules_practice_limit();
