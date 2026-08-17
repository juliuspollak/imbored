-- Score each weekday against its own middle again.
--
-- 202608181000 measured the reference for the new scoring pooled across every
-- weekday -- correct for the SPREAD, which needs more samples than one weekday
-- can supply, but wrong for the MIDDLE. Pooling the middle threw away the
-- designed Mon->Sun difficulty ramp, so a player at Sunday pace was judged
-- against a reference that included easy Mondays.
--
-- On the live benchmark table that ramp is large - Sunday takes 1.9x to 3.2x
-- Monday, depending on the game - and the resulting bias was worse than the
-- cross-game gap this scoring was built to remove. Scores for players at each
-- weekday's own typical pace, who should all score 100:
--
--                    Mon  Tue  Thu  Sat  Sun   gap
--     hive           103  139  114   82   61    78
--     minisudoku     127  129  103   77   63    66
--     binary         122  115  115   83   65    57
--
-- Now each weekday uses its own mean once it has at least 5 rounds to measure,
-- and otherwise takes the pooled mean shifted onto this weekday by the designed
-- ramp (shifting a log-mean by ln(weight) is exactly scaling the time by that
-- weight). The spread stays pooled. Worst weekday gap: 78 points -> 0.

create or replace function public.refresh_game_time_benchmark(target_game text, target_day_index integer, target_mode text) RETURNS public.game_time_benchmarks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  eligible_players integer:=0;
  qualifying_samples integer:=0;
  community_median numeric;
  pooled_players integer:=0;
  pooled_samples integer:=0;
  pooled_median numeric;
  day_weight numeric:=1;
  spread_mean numeric;
  spread_sd numeric;
  spread_day_mean numeric;
  spread_day_count integer:=0;
  benchmark public.game_time_benchmarks;
begin
  select * into benchmark
  from public.game_time_benchmarks
  where game=target_game
    and day_index=target_day_index
    and mode=target_mode;

  if not found then
    return null;
  end if;

  -- A 90-day community median does not move between one puzzle and the next,
  -- but this used to recompute -- and write -- on every single save and every
  -- share-eligibility check, putting a 90-day scan and a row-level write lock
  -- in the hot path of finishing a game. Recompute at most hourly per
  -- (game, day, mode). To force one, age the row:
  --   update public.game_time_benchmarks set updated_at=now()-interval '1 day';
  if benchmark.updated_at>now()-interval '1 hour' then
    return benchmark;
  end if;

  -- If another session is already refreshing this row, serve the value we
  -- have rather than queueing behind its write. A player's save is never
  -- blocked by someone else's benchmark maintenance.
  if not pg_try_advisory_xact_lock(
    hashtextextended(
      format('benchmark:%s:%s:%s',target_game,target_day_index,target_mode),
      0
    )
  ) then
    return benchmark;
  end if;

  with clean as (
    select stat.user_id,stat.seconds,
      row_number() over(partition by stat.user_id order by stat.completed_at desc,stat.id desc) as recent_rank,
      count(*) over(partition by stat.user_id) as player_sample_count
    from public.game_stats stat
    where stat.game=target_game
      and stat.day_index=target_day_index
      and stat.mode=target_mode
      and stat.completed_at>=now()-interval '90 days'
      and stat.seconds between 5 and 3600
      and coalesce(stat.hints,0)=0
      and (
        -- Quiz games report an answer count, and every question is answered
        -- whatever the result, so a wrong answer costs a tap rather than
        -- minutes. Demanding a flawless round excluded them permanently: Zoom
        -- needs 9-for-9 to qualify, which is rare enough that it had no clean
        -- samples at all and could never leave its seeded guess. A hint still
        -- disqualifies a sample, because a hint genuinely shortens the clock.
        coalesce(stat.total_count,0)>0
        or coalesce(stat.mistakes,0)=0
      )
  ), player_medians as (
    select user_id,
      count(*)::integer as sample_count,
      percentile_cont(0.5) within group(order by seconds) as median_seconds
    from clean
    where player_sample_count>=2 and recent_rank<=5
    group by user_id
  )
  select count(*)::integer,
    coalesce(sum(sample_count),0)::integer,
    percentile_cont(0.5) within group(order by median_seconds)
  into eligible_players,qualifying_samples,community_median
  from player_medians;

  -- The sample set above is per weekday, and that is what actually starved
  -- these benchmarks: a daily challenge offers each weekday once a week, so
  -- qualifying needs two players with two clean results each on the SAME
  -- weekday -- a fortnight of flawless play per weekday, per game. Gridly has
  -- 15 clean results spread over 7 weekdays: about 2 per day, against the 4
  -- required. Lowering the player bar alone would not have helped.
  --
  -- So when a weekday cannot qualify on its own, fall back to the same
  -- calculation pooled across every weekday, then scale the result back onto
  -- this weekday using the seeded Mon->Sun ramp. That uses all 15 samples
  -- instead of 2, and keeps the intended difficulty curve rather than paying
  -- every weekday the same time.
  -- This weekday's share of the game's designed Mon->Sun ramp. Needed whether
  -- or not the pooled branch runs, because the spread section below uses it to
  -- place a weekday that has too little play of its own.
  select case
    when coalesce(avg(other.provisional_seconds),0)>0
      then benchmark.provisional_seconds/avg(other.provisional_seconds)
    else 1
  end
  into day_weight
  from public.game_time_benchmarks other
  where other.game=target_game
    and other.mode=target_mode;

  if eligible_players<2 then
    with clean as (
      select stat.user_id,stat.seconds,
        row_number() over(partition by stat.user_id order by stat.completed_at desc,stat.id desc) as recent_rank,
        count(*) over(partition by stat.user_id) as player_sample_count
      from public.game_stats stat
      where stat.game=target_game
        and stat.mode=target_mode
        and stat.completed_at>=now()-interval '90 days'
        and stat.seconds between 5 and 3600
        and coalesce(stat.hints,0)=0
        and (
          coalesce(stat.total_count,0)>0
          or coalesce(stat.mistakes,0)=0
        )
    ), player_medians as (
      select user_id,
        count(*)::integer as sample_count,
        percentile_cont(0.5) within group(order by seconds) as median_seconds
      from clean
      where player_sample_count>=2 and recent_rank<=10
      group by user_id
    )
    select count(*)::integer,
      coalesce(sum(sample_count),0)::integer,
      percentile_cont(0.5) within group(order by median_seconds)
    into pooled_players,pooled_samples,pooled_median
    from player_medians;

    -- This weekday's share of the game's seeded ramp. Sunday stays harder than
    -- Monday because the provisional values say so, not because of thin data.
    select case
      when coalesce(avg(other.provisional_seconds),0)>0
        then benchmark.provisional_seconds/avg(other.provisional_seconds)
      else 1
    end
    into day_weight
    from public.game_time_benchmarks other
    where other.game=target_game
      and other.mode=target_mode;

    if pooled_players>=2 and pooled_median is not null then
      eligible_players:=pooled_players;
      qualifying_samples:=pooled_samples;
      community_median:=pooled_median*coalesce(day_weight,1);
    end if;
  end if;

  -- The score is now counted in spreads, not ratios, so the benchmark has to
  -- carry the spread as well as the middle. Measured over ln(effective
  -- seconds) -- the clock divided by the share of answers that were right --
  -- and pooled across weekdays, because per-weekday samples are far too thin
  -- to estimate a standard deviation from.
  select
    avg(ln(sample.value)) filter (where sample.day_index=target_day_index),
    count(sample.value) filter (where sample.day_index=target_day_index),
    avg(ln(sample.value)),
    stddev_samp(ln(sample.value))
  into spread_day_mean,spread_day_count,spread_mean,spread_sd
  from (
    select stat.day_index, public.effective_round_seconds(
      stat.seconds,stat.hints,stat.mistakes,
      coalesce(nullif(benchmark.effective_seconds,0),100),
      stat.correct_count,stat.total_count
    ) as value
    from public.game_stats stat
    where stat.game=target_game
      and stat.mode=target_mode
      and stat.completed_at>=now()-interval '90 days'
      and stat.seconds between 5 and 3600
  ) sample;

  -- The spread (log_sd) is pooled across weekdays because a standard deviation
  -- needs more samples than one weekday can supply. The MIDDLE must not be:
  -- pooling it too threw away the Mon->Sun difficulty ramp, so a player at
  -- Sunday pace was measured against a reference that includes easy Mondays.
  -- On the live benchmarks that was worth up to 64 points between two players
  -- of identical standing -- a worse unfairness than the cross-game gap this
  -- scoring was built to remove.
  --
  -- So: use this weekday's own mean once it has enough play to be worth
  -- trusting, and otherwise place the pooled mean onto this weekday using the
  -- designed ramp. Shifting a log-mean by ln(weight) is exactly scaling the
  -- underlying time by that weight.
  if spread_day_count>=5 and spread_day_mean is not null then
    spread_mean:=spread_day_mean;
  elsif spread_mean is not null then
    spread_mean:=spread_mean+ln(greatest(0.05,coalesce(day_weight,1)));
  end if;


  update public.game_time_benchmarks current_benchmark
  set observed_median_seconds=case when eligible_players>=2 then community_median else null end,
      clean_sample_count=case when eligible_players>=2 then qualifying_samples else 0 end,
      -- effective_seconds carries no CHECK of its own, and it is a divisor in
      -- every score. Hold it to the same 5..3600 range provisional_seconds is
      -- constrained to, so a thin or skewed sample cannot round it to zero.
      effective_seconds=case
        when eligible_players>=2 and community_median is not null
          then greatest(5,least(3600,round(community_median)))
        else current_benchmark.provisional_seconds
      end,
      -- Below a usable sample a standard deviation is noise; leave it null
      -- and circle_challenge_daily_score() falls back to the ratio rule.
      log_mean=case when spread_sd is not null and spread_sd>0.01 then spread_mean else null end,
      log_sd=case when spread_sd is not null and spread_sd>0.01 then spread_sd else null end,
      updated_at=now()
  where current_benchmark.game=target_game
    and current_benchmark.day_index=target_day_index
    and current_benchmark.mode=target_mode
  returning * into benchmark;

  return benchmark;
end;
$$;
