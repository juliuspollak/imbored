-- Ship the two functions the last three migrations forgot.
--
-- 202608181500 taught the SCORE to account for work the puzzle did not require,
-- and 202608181600 let every puzzle record it. But the two functions that have
-- to agree with them were only ever changed in supabase/schemas:
--
--   refresh_game_time_benchmark   builds the reference the score is measured
--                                 against. Without the same inefficiency term,
--                                 log_mean is measured on times that exclude
--                                 rework while scores include it, so every
--                                 round with any rework scores systematically
--                                 low - exactly the complaint this work began
--                                 with, reintroduced from the other end.
--   circle_challenge_member_totals  scores circle challenges. Its last shipped
--                                 version predates round_inefficiency entirely,
--                                 so circles would ignore rework while the
--                                 personal challenge counted it.
--
-- Also drops the two-argument round_inefficiency created by 202608181500.
-- 202608181600 added a four-argument version with defaults rather than
-- replacing it, so both existed and any two-argument call was ambiguous.

drop function if exists public.round_inefficiency(integer,integer);

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
  matched_config_rows integer:=0;
  use_current_config boolean:=false;
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
  -- The spread must be the WITHIN-weekday spread. Pooling ln(value) raw across
  -- weekdays folded the Mon->Sun ramp into it: hive's between-day spread alone
  -- is 0.50 and the pooled figure was 0.61, so the real within-day spread was
  -- about 0.35 and every score was divided by a number ~1.7x too large. That
  -- squashed the whole game toward 100 -- the fastest Tuesday hive round on
  -- record scored 114, barely above typical, which reads as a punishment for
  -- a good round.
  --
  -- Centring each round on its own weekday's mean before measuring removes the
  -- ramp and leaves the spread of actual play. Days with a single round are
  -- excluded, since their residual is 0 by construction. Using stddev_samp on
  -- residuals divides by n-1 rather than n-k, which understates the spread by
  -- under 2% at these sample sizes -- small enough to leave alone.
  -- Gridly's difficulty is admin-tunable per weekday (grid size, checkpoints,
  -- walls, black holes, tunnels), so an admin raising Sunday's difficulty makes
  -- every earlier Sunday round incomparable. Left alone, the 90-day window
  -- keeps scoring players against the easier board for three months.
  --
  -- generator_config is stored on every round, so prefer rounds played on the
  -- configuration currently in force for each weekday. Fall back to the whole
  -- window when that leaves too little to measure, since a wrong-but-stable
  -- reference beats one built from three rounds. Games that record no config
  -- (the quiz games) match everything and are unaffected.
  select count(*)
  into matched_config_rows
  from public.game_stats stat
  join (
    select distinct on (recent.day_index) recent.day_index, recent.generator_config
    from public.game_stats recent
    where recent.game=target_game
      and recent.mode=target_mode
      and recent.completed_at>=now()-interval '90 days'
      and recent.generator_config is not null
    order by recent.day_index, recent.completed_at desc, recent.id desc
  ) current_config on current_config.day_index=stat.day_index
  where stat.game=target_game
    and stat.mode=target_mode
    and stat.completed_at>=now()-interval '90 days'
    and stat.seconds between 5 and 3600
    and stat.generator_config=current_config.generator_config;

  use_current_config:=matched_config_rows>=8;

  with current_config as (
    select distinct on (recent.day_index) recent.day_index, recent.generator_config
    from public.game_stats recent
    where recent.game=target_game
      and recent.mode=target_mode
      and recent.completed_at>=now()-interval '90 days'
      and recent.generator_config is not null
    order by recent.day_index, recent.completed_at desc, recent.id desc
  ), sample as (
    select stat.day_index, public.effective_round_seconds(
      stat.seconds,stat.hints,stat.mistakes,
      coalesce(nullif(benchmark.effective_seconds,0),100),
      stat.correct_count,stat.total_count,
      public.round_inefficiency(stat.zip_backtracked_cells,stat.zip_required_moves,stat.wasted_moves,stat.expected_moves)
    ) as value
    from public.game_stats stat
    left join current_config on current_config.day_index=stat.day_index
    where stat.game=target_game
      and stat.mode=target_mode
      and stat.completed_at>=now()-interval '90 days'
      and stat.seconds between 5 and 3600
      and (
        not use_current_config
        or stat.generator_config=current_config.generator_config
      )
  ), centred as (
    select
      sample.day_index,
      ln(sample.value) as log_value,
      ln(sample.value)-avg(ln(sample.value)) over (partition by sample.day_index) as residual,
      count(*) over (partition by sample.day_index) as day_rows
    from sample
    where sample.value is not null
  )
  select
    avg(centred.log_value) filter (where centred.day_index=target_day_index),
    count(*) filter (where centred.day_index=target_day_index),
    avg(centred.log_value),
    stddev_samp(centred.residual) filter (where centred.day_rows>=2)
  into spread_day_mean,spread_day_count,spread_mean,spread_sd
  from centred;


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

create or replace function public.circle_challenge_member_totals(target_challenge_id bigint) RETURNS TABLE(member_id uuid, challenge_score integer, rounds_played integer, rounds_total integer, total_hints integer, total_mistakes integer, adjusted_seconds bigint, finished_at timestamp with time zone, last_stat_id bigint, round_scores jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with challenge as (
    select item.id,item.circle_id
    from public.circle_weekly_challenges item
    where item.id=target_challenge_id
  ),
  member_rounds as (
    select
      member.user_id,
      round_item.challenge_date,
      round_item.game,
      round_item.round_number,
      result.id as stat_id,
      result.seconds,
      result.hints,
      result.mistakes,
      result.completed_at,
      case
        when result.id is null then null
        else public.circle_challenge_daily_score(
          round_item.game,
          round_item.challenge_date,
          result.seconds,
          result.hints,
          result.mistakes,
          result.correct_count,
          result.total_count,
          public.round_inefficiency(result.zip_backtracked_cells,result.zip_required_moves,result.wasted_moves,result.expected_moves)
        )
      end as round_score
    from challenge
    join public.circle_members member
      on member.circle_id=challenge.circle_id
    join public.circle_challenge_rounds round_item
      on round_item.challenge_id=challenge.id
    left join lateral (
      select stat.*
      from public.game_stats stat
      where stat.circle_challenge_id=challenge.id
        and stat.user_id=member.user_id
        and stat.mode='challenge'
        and stat.challenge_date=round_item.challenge_date
        and stat.game=round_item.game
      order by stat.completed_at,stat.id
      limit 1
    ) result on true
  )
  select
    member_rounds.user_id,
    -- A missed round scores nothing. The standing is a sum, so a player who
    -- played every round already outranks one who skipped some; -100 punished
    -- on top of that, making a missed round worse than never entering.
    sum(coalesce(member_rounds.round_score,0))::integer,
    count(member_rounds.stat_id)::integer,
    count(*)::integer,
    sum(greatest(coalesce(member_rounds.hints,0),0))::integer,
    sum(greatest(coalesce(member_rounds.mistakes,0),0))::integer,
    sum(
      case
        when member_rounds.stat_id is null then 0
        else public.scored_game_seconds(
          member_rounds.seconds,
          member_rounds.hints,
          member_rounds.mistakes,
          public.challenge_benchmark_seconds(member_rounds.game,member_rounds.challenge_date)
        )
      end
    )::bigint,
    max(member_rounds.completed_at),
    max(member_rounds.stat_id),
    jsonb_agg(
      jsonb_build_object(
        'challenge_date',member_rounds.challenge_date,
        'game',member_rounds.game,
        'score',member_rounds.round_score
      )
      order by member_rounds.round_number,member_rounds.challenge_date
    )
  from member_rounds
  group by member_rounds.user_id
$$;
