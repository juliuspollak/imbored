-- Fix practice daily limit constraint v127
--
-- Some databases retained an older constraint with the same name and a
-- narrower limit. Recreate it explicitly so the Rewards Admin value of 50
-- is accepted consistently.

alter table public.reward_rules
  drop constraint if exists reward_rules_practice_daily_limit_range;

update public.reward_rules
set practice_daily_limit=least(greatest(practice_daily_limit,1),50)
where practice_daily_limit<1
   or practice_daily_limit>50;

alter table public.reward_rules
  add constraint reward_rules_practice_daily_limit_range
  check (practice_daily_limit between 1 and 50);
