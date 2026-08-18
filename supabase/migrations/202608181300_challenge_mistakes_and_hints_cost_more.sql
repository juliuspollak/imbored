-- Make a hint and a mistake cost real points in a challenge round.
--
-- Across 93 real rounds, 66% had no mistakes and no hints at all - and Hive and
-- MiniSudoku had none in 29 rounds between them, so their score was decided by
-- the clock alone. Speed was not weighted too heavily so much as it was the only
-- thing being measured.
--
-- Raising the cost is the one lever available without recording something new,
-- because mistakes and hints are the only non-speed signal these games already
-- capture. At the old 10% a four-mistake Binary round lost 14 points against a
-- clean one of the same length; at 25% it loses 36.
--
-- scored_game_seconds() is untouched at 0.20/0.10: it prices the same events for
-- the points economy, and moving it would shift every balance.

create or replace function public.effective_round_seconds(
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer,
  benchmark_seconds numeric,
  correct_answers integer default null,
  total_answers integer default null
) returns numeric
    language sql immutable
    as $$
  with share as (
    select case
      when coalesce(total_answers,0) <= 0 then 1::numeric
      else least(1,greatest(0,coalesce(correct_answers,0))::numeric/total_answers)
    end as accuracy
  )
  select case when share.accuracy <= 0 then null else
    greatest(1,
      greatest(0,coalesce(elapsed_seconds,0))
      -- A hint and a mistake cost more in a CHALLENGE round than they do in
      -- the points economy (scored_game_seconds, still 0.20/0.10). Two thirds
      -- of real rounds have neither, so for those games the clock was the only
      -- thing being measured; this is the one non-speed signal already recorded.
      + greatest(0,coalesce(hint_count,0))*coalesce(benchmark_seconds,100)*0.35
      -- An ungraded puzzle has no accuracy to divide by, so its slips are
      -- charged as time. A graded round is not charged here as well: its
      -- mistakes ARE the wrong answers already priced into the divisor.
      + case when coalesce(total_answers,0) > 0 then 0
             else greatest(0,coalesce(mistake_count,0))*coalesce(benchmark_seconds,100)*0.25 end
    ) / (share.accuracy * share.accuracy)
  end
  from share
$$;
