-- Give a challenge round something other than the clock to be judged on.
--
-- Across 93 real rounds, 66% had no mistakes and no hints, so for those the
-- score was decided by pace alone. Gridly already records what the player
-- actually did - zip_backtracked_cells against zip_required_moves - and has
-- never used it. Backtracking measures route planning directly: 0 means the
-- path was worked out, 119 on a 48-move board means it was brute-forced.
--
-- Observed spread, all on 48-move boards:
--
--      9 checkpoints: typical 15 backtracks, worst 119   (17 rounds)
--     13 checkpoints: typical 10, worst 50               (19 rounds)
--     16 checkpoints: typical  5, worst 16               ( 4 rounds)
--
-- A looser board leaves more room to go wrong, so an absolute threshold would
-- be wrong on every board but one. The ratio feeds effective seconds instead,
-- and 202608181400 pins the reference to the configuration in force, so each
-- board's own typical backtracking becomes its baseline with no per-difficulty
-- tuning.
--
-- It is applied as a MULTIPLIER, not a surcharge scaled by benchmark_seconds.
-- That column is a median of raw seconds and can sit at half the typical
-- EFFECTIVE time - for Gridly, 6 against 21 - which quietly halved the intended
-- weight when this was first written. The multiplier does not depend on the
-- benchmark at all.
--
-- At 2.5, on a 12-second Gridly round:
--
--     0 backtracks 132   typical (15) 100   heavy (50) 61   flailing (119) 22
--
-- and a slow clean solve now beats a fast scrappy one, 104 to 83. That is the
-- point: the clock stops being the only thing measured.
--
-- The input is a general inefficiency ratio rather than Gridly's two columns,
-- so undo and reset counts from the other puzzles can use the same channel once
-- they are recorded. Games supplying nothing pass 0 and are unaffected.

create or replace function public.effective_round_seconds(
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer,
  benchmark_seconds numeric,
  correct_answers integer default null,
  total_answers integer default null,
  inefficiency numeric default 0
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
      -- A hint and a mistake cost more in a CHALLENGE round than they do in the
      -- points economy (scored_game_seconds, still 0.20/0.10).
      + greatest(0,coalesce(hint_count,0))*coalesce(benchmark_seconds,100)*0.35
      -- An ungraded puzzle has no accuracy to divide by, so its slips are
      -- charged as time. A graded round is not charged here as well: its
      -- mistakes ARE the wrong answers already priced into the divisor.
      + case when coalesce(total_answers,0) > 0 then 0
             else greatest(0,coalesce(mistake_count,0))*coalesce(benchmark_seconds,100)*0.25 end
    )
    -- Work the puzzle did not require - backtracking today, undo and reset
    -- counts once the other games record them. A multiplier, not a surcharge
    -- scaled by benchmark_seconds: that column is a median of raw seconds and
    -- can sit at half the typical EFFECTIVE time, which quietly halved the
    -- intended weight. This form does not depend on the benchmark at all.
    * (1 + greatest(0,coalesce(inefficiency,0))*2.5)
    / (share.accuracy * share.accuracy)
  end
  from share
$$;

-- Backtracked cells over required moves. Null-safe and clamped, so a game that
-- records neither contributes nothing.
create or replace function public.round_inefficiency(
  backtracked_cells integer,
  required_moves integer
) returns numeric
    language sql immutable
    as $$
  select case
    when coalesce(required_moves,0) <= 0 then 0::numeric
    else least(4, greatest(0,coalesce(backtracked_cells,0))::numeric/required_moves)
  end
$$;

create or replace function public.circle_challenge_daily_score(
  target_game text,
  target_challenge_date date,
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer,
  correct_answers integer default null,
  total_answers integer default null,
  inefficiency numeric default 0
) returns integer
    language sql stable security definer
    set search_path to 'public'
    as $$
  with profile as (
    select * from public.challenge_benchmark_profile(target_game,target_challenge_date)
  ),
  effective as (
    select
      profile.seconds,
      profile.log_mean,
      profile.log_sd,
      public.effective_round_seconds(
        elapsed_seconds,hint_count,mistake_count,profile.seconds,
        correct_answers,total_answers,inefficiency
      ) as value
    from profile
  )
  select case
    when effective.value is null then 0
    when effective.log_mean is not null and coalesce(effective.log_sd,0) > 0.01 then
      greatest(20,least(150,round(
        100 + 25*((effective.log_mean - ln(effective.value))/effective.log_sd)
      )::integer))
    else
      greatest(45,least(150,round(
        100*effective.seconds/effective.value
      )::integer))
  end
  from effective
$$;
