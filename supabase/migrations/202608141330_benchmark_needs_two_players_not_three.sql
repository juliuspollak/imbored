-- A measured benchmark now needs two qualifying players, not three.
--
-- effective_seconds falls back to the hand-seeded provisional_seconds until
-- enough players have clean samples. At three players -- each needing two
-- hint-free, mistake-free results within 90 days -- a small circle never
-- qualified, so the seeded guesses (Gridly 260s, Binary 210s, Zoom 150s) stayed
-- in force permanently while real rounds were finishing in 11-47 seconds.
--
-- Every round then cleared the cap (which binds at two thirds of benchmark),
-- every player scored a flat 150 per round, and the challenge was decided
-- entirely by the tiebreakers rather than by the scores.
--
-- This does not fix benchmarks that are simply wrong -- it lets real play
-- replace them instead of leaving a guess in charge forever.

create or replace function public.refresh_game_time_benchmark(target_game text, target_day_index integer, target_mode text) RETURNS public.game_time_benchmarks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  eligible_players integer:=0;
  qualifying_samples integer:=0;
  community_median numeric;
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

  -- Two players, not three. A circle of four never crossed a three-player bar
  -- -- each needs two hint-free, mistake-free samples in 90 days -- so the
  -- seeded provisional time stayed in force forever. Against a guess that far
  -- from real play every round pins the 150 cap, the standings all read the
  -- same, and the winner falls to the tiebreakers.

  update public.game_time_benchmarks current_benchmark
  set observed_median_seconds=case when eligible_players>=2 then community_median else null end,
      clean_sample_count=case when eligible_players>=2 then qualifying_samples else 0 end,
      effective_seconds=case
        when eligible_players>=2 and community_median is not null then round(community_median)
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
