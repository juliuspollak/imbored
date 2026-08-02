-- v209: Use one player-facing Practice reward rule.
--
-- The points economy previously combined a per-game rewarded-completion limit
-- with a total daily Practice-points cap. Keep the existing column for RPC and
-- historical migration compatibility, but set it to the database-supported
-- maximum. The daily points cap (maximum 200) is therefore always reached
-- first and is the sole effective Practice limit.

begin;

update public.reward_rules
set practice_daily_limit=1000
where practice_daily_limit<>1000;

-- Prevent future rule rows or unrelated admin updates from restoring the old
-- per-game mechanic.
create or replace function public.normalise_reward_rules_practice_limit()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.practice_daily_limit:=1000;
  return new;
end;
$$;

drop trigger if exists reward_rules_normalise_practice_limit
  on public.reward_rules;

create trigger reward_rules_normalise_practice_limit
before insert or update of practice_daily_limit
on public.reward_rules
for each row
execute function public.normalise_reward_rules_practice_limit();

notify pgrst,'reload schema';

commit;
