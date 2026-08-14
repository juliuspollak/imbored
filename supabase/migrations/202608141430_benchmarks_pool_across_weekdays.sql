-- Let a small circle actually earn a measured benchmark. Supersedes
-- 202608141330, which lowered the player bar but did not address the real
-- blocker; applying both in order is fine.
--
-- The sample set is per weekday. A daily challenge offers each weekday once a
-- week, so qualifying on a weekday needed two players with two clean,
-- hint-free, mistake-free results EACH on that same weekday -- a fortnight of
-- flawless play per weekday, per game. Gridly has 15 clean results spread over
-- 7 weekdays, about 2 per day against the 4 required, so no weekday has ever
-- qualified and every game still scores against its original seeded guess.
--
-- Two changes:
--   1. A weekday that cannot qualify alone now falls back to the same
--      calculation pooled across all weekdays, scaled back onto this weekday
--      by its share of the seeded Mon->Sun ramp. That uses every sample the
--      game has rather than a seventh of them, and keeps the difficulty curve.
--   2. effective_seconds is clamped to 5..3600. It has no CHECK of its own and
--      divides into every score, so a thin sample must not round it to zero.

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
      and coalesce(stat.mistakes,0)=0
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
        and coalesce(stat.mistakes,0)=0
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
      updated_at=now()
  where current_benchmark.game=target_game
    and current_benchmark.day_index=target_day_index
    and current_benchmark.mode=target_mode
  returning * into benchmark;

  return benchmark;
end;
$$;
