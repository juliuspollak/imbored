-- Replace unreliable practice limit constraint v128
--
-- A few databases continue to reject valid values after the named CHECK is
-- recreated. Remove that constraint and enforce the same 1..50 range with a
-- small normalising trigger instead.

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
    50
  );
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

-- Normalise existing data once as well.
update public.reward_rules
set practice_daily_limit=least(
  greatest(coalesce(practice_daily_limit,5),1),
  50
);
