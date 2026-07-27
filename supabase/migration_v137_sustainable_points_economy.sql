-- v137: Sustainable points economy
--
-- The original economy paid about 100 points for every eligible completion.
-- Fast Practice puzzles could therefore create tens of thousands of points in
-- days, while Player Stats counted every saved Practice replay even after the
-- daily reward limit had been reached.
--
-- New steady-state targets:
--   * Challenge: 2-15 gameplay points per completion
--   * Practice:  50% of Challenge, first 3 completions per Sydney day
--   * Gameplay:  maximum 40 points per Sydney day across every mode/game
--   * Streak:    +20 only on complete 7-day Challenge milestones
--   * Team prize: maximum 50 points
--
-- At the absolute gameplay maximum this is about 1,280 points per month,
-- including four weekly streak bonuses, instead of tens of thousands.

begin;

-- Record denomination changes separately from schema migrations so rerunning
-- this SQL in the Supabase editor cannot divide balances a second time.
create table if not exists public.points_economy_versions (
  version text primary key,
  applied_at timestamptz not null default now()
);

revoke all on public.points_economy_versions from public;

alter table public.reward_rules
  add column if not exists daily_points_cap integer not null default 40;

alter table public.reward_rules
  drop constraint if exists reward_rules_daily_points_cap_range;
alter table public.reward_rules
  add constraint reward_rules_daily_points_cap_range
  check (daily_points_cap between 10 and 200);

-- The earlier admin trigger allowed up to 1,000 rewarded Practice games per
-- day. The global cap now provides the final guard, but this narrower bound
-- also prevents accidental configuration from making the Practice limit
-- meaningless.
create or replace function public.normalise_reward_rules_practice_limit()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.practice_daily_limit:=least(
    greatest(coalesce(new.practice_daily_limit,3),1),
    10
  );
  return new;
end;
$$;

drop trigger if exists reward_rules_normalise_practice_limit
  on public.reward_rules;
create trigger reward_rules_normalise_practice_limit
before insert or update of practice_daily_limit
on public.reward_rules
for each row execute function public.normalise_reward_rules_practice_limit();

-- One-time 10:1 denomination change. Relative balances, transfers, redemptions
-- and reward prices are preserved; only the display/earning scale changes.
do $$
declare
  apply_rebase boolean := false;
begin
  insert into public.points_economy_versions(version)
  values ('v137-10-to-1')
  on conflict(version) do nothing
  returning true into apply_rebase;

  if coalesce(apply_rebase,false) then
    update public.points_transactions
    set
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'economy_rebased',true,
        'pre_v137_points',points,
        'rebased_points',
          case
            when points=0 then 0
            else sign(points)::integer
              * greatest(1,round(abs(points)::numeric/10)::integer)
          end
      ),
      points=case
        when points=0 then 0
        else sign(points)::integer
          * greatest(1,round(abs(points)::numeric/10)::integer)
      end;

    update public.player_progress
    set
      available_points=round(available_points::numeric/10)::bigint,
      lifetime_points=round(lifetime_points::numeric/10)::bigint,
      updated_at=now();

    update public.player_progress
    set current_level=public.points_level(lifetime_points);

    update public.rewards
    set
      points_cost=greatest(1,round(points_cost::numeric/10)::bigint),
      updated_at=now();

    update public.reward_wishes
    set points_cost=greatest(1,round(points_cost::numeric/10)::bigint)
    where points_cost is not null;

    update public.reward_redemptions
    set points_cost=greatest(1,round(points_cost::numeric/10)::bigint);

    update public.team_weekly_challenges
    set reward_points=least(
      50,
      greatest(0,round(reward_points::numeric/10)::integer)
    );

    update public.team_challenge_reward_awards
    set points=least(
      50,
      greatest(0,round(points::numeric/10)::integer)
    );
  end if;
end;
$$;

-- Defaults deliberately use small whole numbers so an award is legible rather
-- than looking like a financial balance with artificial zeroes.
update public.reward_rules
set
  base_points=6,
  hint_penalty=2,
  mistake_penalty=1,
  fast_time_bonus=2,
  average_time_bonus=1,
  challenge_bonus=0,
  streak_daily_bonus=0,
  streak_weekly_bonus=20,
  practice_points_percent=50,
  day_points_step=1,
  minimum_points=2,
  maximum_points=15,
  practice_daily_limit=3,
  streak_protection_cost=20,
  daily_points_cap=40,
  updated_at=now()
where is_active=true;

-- User-created team prizes remain meaningful but cannot overwhelm ordinary
-- play, even when a player belongs to several challenges.
update public.team_weekly_challenges
set reward_points=least(reward_points,50)
where reward_points>50;

alter table public.team_weekly_challenges
  drop constraint if exists team_weekly_challenges_reward_points_check;
alter table public.team_weekly_challenges
  add constraint team_weekly_challenges_reward_points_check
  check (reward_points between 0 and 50);

-- The configured maximum in the UI is also 50. Keep a friendly server error
-- instead of exposing the table-constraint message when an old client submits
-- a larger prize.
create or replace function public.enforce_team_challenge_reward_cap()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if coalesce(new.reward_points,0) not between 0 and 50 then
    raise exception 'A team challenge winner''s prize must be between 0 and 50 points.';
  end if;
  return new;
end;
$$;

drop trigger if exists team_challenge_reward_cap_trigger
  on public.team_weekly_challenges;
create trigger team_challenge_reward_cap_trigger
before insert or update of reward_points
on public.team_weekly_challenges
for each row execute function public.enforce_team_challenge_reward_cap();

-- One atomic award path. A zero-point ledger entry is intentionally created
-- when a cap is reached: the result remains auditable and retrying the RPC
-- cannot award it later.
create or replace function public.award_game_points(target_stat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  s public.game_stats;
  p public.player_progress;
  r public.reward_rules;
  benchmark public.game_time_benchmarks;
  benchmark_seconds numeric;
  zoom_correct integer;
  zoom_total integer;
  effective_base_points integer;
  day_number integer;
  day_bonus integer := 0;
  mode_percent integer := 100;
  unscaled_game_points integer;
  scaled_game_points integer;
  mode_adjustment integer := 0;
  mode_minimum integer;
  mode_maximum integer;
  capped_game_points integer;
  daily_game_points integer;
  points_total integer;
  limit_adjustment integer := 0;
  daily_cap_adjustment integer := 0;
  time_points integer := 0;
  hint_points integer := 0;
  mistake_points integer := 0;
  streak_points integer := 0;
  old_level integer;
  new_level integer;
  award_date date := (now() at time zone 'Australia/Sydney')::date;
  challenge_date date;
  practice_count integer := 0;
  challenge_games_on_date integer := 0;
  daily_earned integer := 0;
  daily_remaining integer := 0;
  practice_limit_reached boolean := false;
  daily_cap_reached boolean := false;
  breakdown jsonb;
begin
  select * into s
  from public.game_stats
  where id=target_stat_id;

  if not found or s.user_id<>auth.uid() then
    raise exception 'Game result not found';
  end if;

  select * into r
  from public.reward_rules
  where is_active=true
  order by id desc
  limit 1;

  if not found then
    raise exception 'No active reward rules';
  end if;

  perform public.ensure_player_progress(s.user_id);

  select * into p
  from public.player_progress
  where player_id=s.user_id
  for update;

  if exists(
    select 1
    from public.points_transactions
    where game_stat_id=s.id
      and reason_code='GAME_COMPLETED'
  ) then
    return jsonb_build_object(
      'already_awarded',true,
      'points_awarded',0,
      'balance',p.available_points,
      'streak',p.challenge_current_streak,
      'level',p.current_level
    );
  end if;

  if s.mode='practice' then
    select count(*) into practice_count
    from public.points_transactions pt
    join public.game_stats gs on gs.id=pt.game_stat_id
    where pt.player_id=s.user_id
      and pt.reason_code='GAME_COMPLETED'
      and gs.mode='practice'
      and (pt.created_at at time zone 'Australia/Sydney')::date=award_date;

    practice_limit_reached:=practice_count>=r.practice_daily_limit;
  end if;

  benchmark:=public.refresh_game_time_benchmark(
    s.game,
    s.day_index,
    s.mode
  );
  benchmark_seconds:=benchmark.effective_seconds;

  zoom_total:=greatest(coalesce(s.total_count,9),1);
  zoom_correct:=least(
    zoom_total,
    greatest(coalesce(s.correct_count,zoom_total-s.mistakes),0)
  );

  effective_base_points:=r.base_points;
  if s.game='zoom' then
    effective_base_points:=round(
      r.base_points*zoom_correct::numeric/zoom_total
    );
  end if;

  -- day_index is zero-based: Monday 0 through Sunday 6.
  day_number:=greatest(0,least(coalesce(s.day_index,0),6));
  day_bonus:=day_number*r.day_points_step;

  if s.game='zoom' and zoom_correct<zoom_total then
    time_points:=0;
  elsif benchmark_seconds is not null
    and s.seconds<=benchmark_seconds*0.8 then
    time_points:=r.fast_time_bonus;
  elsif benchmark_seconds is not null
    and s.seconds<=benchmark_seconds then
    time_points:=r.average_time_bonus;
  elsif benchmark_seconds is not null
    and s.seconds>benchmark_seconds*1.5 then
    time_points:=-r.fast_time_bonus;
  elsif benchmark_seconds is not null
    and s.seconds>benchmark_seconds*1.2 then
    time_points:=-r.average_time_bonus;
  end if;

  if s.hints>0 then
    hint_points:=-(s.hints*r.hint_penalty);
  end if;
  if s.mistakes>0 then
    mistake_points:=-(s.mistakes*r.mistake_penalty);
  end if;

  unscaled_game_points:=
    effective_base_points
    + day_bonus
    + time_points
    + hint_points
    + mistake_points;

  mode_percent:=case
    when s.mode='practice' then r.practice_points_percent
    else 100
  end;

  scaled_game_points:=round(
    unscaled_game_points*mode_percent::numeric/100
  );
  mode_adjustment:=scaled_game_points-unscaled_game_points;

  mode_minimum:=case
    when s.mode='practice'
      then ceil(r.minimum_points*mode_percent::numeric/100)::integer
    else r.minimum_points
  end;
  mode_maximum:=case
    when s.mode='practice'
      then floor(r.maximum_points*mode_percent::numeric/100)::integer
    else r.maximum_points
  end;

  capped_game_points:=greatest(
    mode_minimum,
    least(mode_maximum,scaled_game_points)
  );
  capped_game_points:=greatest(0,least(50,capped_game_points));
  limit_adjustment:=capped_game_points-scaled_game_points;

  if practice_limit_reached then
    capped_game_points:=0;
  end if;

  -- Only gameplay earnings consume the daily allowance. Winner prizes,
  -- transfers, refunds and the weekly streak milestone remain separate.
  select coalesce(sum(
    case
      when pt.metadata ? 'daily_game_points' then
        greatest(coalesce((pt.metadata->>'daily_game_points')::integer,0),0)
      else greatest(
        pt.points
          - coalesce((pt.metadata->>'weekly_streak')::integer,0),
        0
      )
    end
  ),0)::integer
  into daily_earned
  from public.points_transactions pt
  where pt.player_id=s.user_id
    and pt.reason_code='GAME_COMPLETED'
    and (pt.created_at at time zone 'Australia/Sydney')::date=award_date;

  daily_remaining:=greatest(r.daily_points_cap-daily_earned,0);
  daily_game_points:=least(capped_game_points,daily_remaining);
  daily_cap_adjustment:=daily_game_points-capped_game_points;
  daily_cap_reached:=daily_remaining=0
    or (capped_game_points>daily_game_points);

  -- Challenge streak state is advanced by the insert trigger before this RPC.
  -- Only the first Challenge result on milestone days 7, 14, 21, ... pays.
  challenge_date:=coalesce(
    s.challenge_date,
    (s.completed_at at time zone 'Australia/Sydney')::date
  );

  if s.mode='challenge'
    and p.challenge_current_streak>0
    and p.challenge_current_streak%7=0 then
    select count(*) into challenge_games_on_date
    from public.game_stats gs
    where gs.user_id=s.user_id
      and gs.mode='challenge'
      and coalesce(
        gs.challenge_date,
        (gs.completed_at at time zone 'Australia/Sydney')::date
      )=challenge_date;

    if challenge_games_on_date=1 then
      streak_points:=r.streak_weekly_bonus;
    end if;
  end if;

  points_total:=greatest(
    0,
    least(100,daily_game_points+streak_points)
  );

  breakdown:=jsonb_build_object(
    'base',effective_base_points,
    'configured_base',r.base_points,
    'day_index',day_number,
    'day_bonus',day_bonus,
    'time',time_points,
    'correct_count',case when s.game='zoom' then zoom_correct else null end,
    'total_count',case when s.game='zoom' then zoom_total else null end,
    'rounds_nailed',case when s.game='zoom' then s.rounds_nailed else null end,
    'hints',hint_points,
    'mistakes',mistake_points,
    'weekly_streak',streak_points,
    'mode',s.mode,
    'mode_multiplier_percent',mode_percent,
    'mode_adjustment',mode_adjustment,
    'limit_adjustment',limit_adjustment,
    'uncapped_game_points',capped_game_points,
    'daily_game_points',daily_game_points,
    'daily_earned_before',daily_earned,
    'daily_points_cap',r.daily_points_cap,
    'daily_cap_adjustment',daily_cap_adjustment,
    'practice_reward_number',
      case when s.mode='practice' then practice_count+1 else null end,
    'practice_daily_limit',r.practice_daily_limit,
    'practice_limit_reached',practice_limit_reached,
    'benchmark_seconds',benchmark_seconds,
    'total',points_total
  );

  old_level:=p.current_level;
  new_level:=public.points_level(p.lifetime_points+points_total);

  insert into public.points_transactions(
    player_id,
    points,
    reason_code,
    game_stat_id,
    metadata,
    created_by
  )
  values(
    s.user_id,
    points_total,
    'GAME_COMPLETED',
    s.id,
    breakdown || jsonb_build_object(
      'benchmark_provisional_seconds',benchmark.provisional_seconds,
      'benchmark_observed_median_seconds',benchmark.observed_median_seconds,
      'benchmark_clean_sample_count',benchmark.clean_sample_count,
      'benchmark_prior_weight',20,
      'rule_id',r.id,
      'economy_version','v137'
    ),
    s.user_id
  );

  update public.player_progress
  set
    available_points=available_points+points_total,
    lifetime_points=lifetime_points+points_total,
    current_level=new_level,
    updated_at=now()
  where player_id=s.user_id
  returning * into p;

  return jsonb_build_object(
    'points_awarded',points_total,
    'balance',p.available_points,
    'streak',p.challenge_current_streak,
    'level',p.current_level,
    'level_up',new_level>old_level,
    'breakdown',breakdown,
    'weekly_streak_bonus',streak_points,
    'practice_limit_reached',practice_limit_reached,
    'daily_points_cap_reached',daily_cap_reached,
    'daily_points_earned',daily_earned+daily_game_points,
    'daily_points_cap',r.daily_points_cap,
    'time_benchmark_seconds',benchmark_seconds,
    'time_clean_sample_count',benchmark.clean_sample_count
  );
end;
$$;

revoke all on function public.award_game_points(bigint) from public;
grant execute on function public.award_game_points(bigint) to authenticated;

-- A missed Challenge day should sting, not erase more than a full day of
-- earning. Ten points is one quarter of the daily gameplay allowance.
create or replace function public.apply_challenge_streak_break(
  target_player_id uuid,
  missed_date date
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.player_progress;
  penalty integer := 0;
begin
  perform public.ensure_player_progress(target_player_id);

  select * into p
  from public.player_progress
  where player_id=target_player_id
  for update;

  if p.challenge_current_streak<=0
    or p.challenge_penalty_for_date is not distinct from missed_date then
    return 0;
  end if;

  penalty:=least(10,greatest(0,p.available_points)::integer);

  update public.player_progress
  set
    available_points=available_points-penalty,
    challenge_current_streak=0,
    challenge_penalty_for_date=missed_date,
    updated_at=now()
  where player_id=target_player_id;

  if penalty>0 then
    insert into public.points_transactions(
      player_id,points,reason_code,metadata,created_by
    )
    values(
      target_player_id,
      -penalty,
      'CHALLENGE_STREAK_BROKEN',
      jsonb_build_object(
        'missed_date',missed_date,
        'penalty',penalty,
        'economy_version','v137'
      ),
      target_player_id
    );
  end if;

  return penalty;
end;
$$;

revoke all on function public.apply_challenge_streak_break(uuid,date)
  from public;

create or replace function public.get_challenge_streak_status()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  uid uuid := auth.uid();
  today_date date := (now() at time zone 'Australia/Sydney')::date;
  p public.player_progress;
  penalty integer := 0;
  played_today boolean := false;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode='42501';
  end if;

  perform public.ensure_player_progress(uid);

  select * into p
  from public.player_progress
  where player_id=uid
  for update;

  if p.challenge_last_completed_date is not null
    and p.challenge_last_completed_date<today_date-1
    and p.challenge_current_streak>0 then
    penalty:=public.apply_challenge_streak_break(uid,today_date-1);
    select * into p
    from public.player_progress
    where player_id=uid;
  end if;

  select exists(
    select 1
    from public.game_stats gs
    where gs.user_id=uid
      and gs.mode='challenge'
      and coalesce(
        gs.challenge_date,
        (gs.completed_at at time zone 'Australia/Sydney')::date
      )=today_date
  ) into played_today;

  return jsonb_build_object(
    'streak',p.challenge_current_streak,
    'longest_streak',p.challenge_longest_streak,
    'last_completed_date',p.challenge_last_completed_date,
    'played_today',played_today,
    'penalty_points',penalty,
    'at_risk',p.challenge_current_streak>0 and not played_today,
    'miss_penalty',10,
    'balance',p.available_points
  );
end;
$$;

revoke all on function public.get_challenge_streak_status() from public;
grant execute on function public.get_challenge_streak_status()
  to authenticated;

-- Leaderboard-safe aggregate. Repeated Practice completions that earned
-- nothing are intentionally excluded so "games" cannot be farmed by replaying
-- a five-second puzzle. Challenge completions always count.
create or replace function public.get_public_player_game_summary()
returns table(
  player_id uuid,
  games_played bigint,
  challenge_games bigint,
  practice_games bigint,
  favourite_game text
)
language sql
stable
security definer
set search_path=public
as $$
  with eligible_games as (
    select
      gs.user_id,
      gs.game,
      gs.mode,
      gs.id
    from public.game_stats gs
    join public.profiles profile on profile.id=gs.user_id
    left join public.points_transactions transaction
      on transaction.game_stat_id=gs.id
     and transaction.reason_code='GAME_COMPLETED'
    where auth.uid() is not null
      and public.can_view_user(gs.user_id)
      and coalesce(
        profile.account_deleted_at,
        'infinity'::timestamptz
      )='infinity'::timestamptz
      and coalesce(profile.is_blocked,false)=false
      and (
        gs.mode='challenge'
        or coalesce(transaction.points,0)>0
      )
  ),
  totals as (
    select
      user_id,
      count(*)::bigint as games_played,
      count(*) filter(where mode='challenge')::bigint as challenge_games,
      count(*) filter(where mode='practice')::bigint as practice_games
    from eligible_games
    group by user_id
  ),
  favourites as (
    select user_id,game
    from (
      select
        user_id,
        game,
        row_number() over(
          partition by user_id
          order by count(*) desc,game
        ) as position
      from eligible_games
      group by user_id,game
    ) ranked
    where position=1
  )
  select
    totals.user_id,
    totals.games_played,
    totals.challenge_games,
    totals.practice_games,
    favourites.game
  from totals
  left join favourites on favourites.user_id=totals.user_id;
$$;

revoke all on function public.get_public_player_game_summary() from public;
grant execute on function public.get_public_player_game_summary()
  to authenticated;

-- Public standings use the Challenge streak, matching the streak badge and
-- the rule that Practice does not maintain a streak.
create or replace function public.get_public_player_progress()
returns table(
  player_id uuid,
  lifetime_points bigint,
  current_level integer,
  current_streak integer,
  longest_streak integer
)
language sql
stable
security definer
set search_path=public
as $$
  select
    progress.player_id,
    progress.lifetime_points,
    progress.current_level,
    progress.challenge_current_streak,
    progress.challenge_longest_streak
  from public.player_progress progress
  join public.profiles profile on profile.id=progress.player_id
  where auth.uid() is not null
    and public.can_view_user(progress.player_id)
    and coalesce(
      profile.account_deleted_at,
      'infinity'::timestamptz
    )='infinity'::timestamptz
    and coalesce(profile.is_blocked,false)=false;
$$;

revoke all on function public.get_public_player_progress() from public;
grant execute on function public.get_public_player_progress()
  to authenticated;

-- Keep the admin audit literal: zero-point Practice completions are recorded
-- for idempotency, but they were not rewarded and must not increase the
-- "rewarded today" count.
create or replace function public.get_my_practice_reward_usage()
returns jsonb
language sql
security definer
set search_path=public
stable
as $$
  with active_rule as (
    select practice_daily_limit
    from public.reward_rules
    where is_active=true
    order by id desc
    limit 1
  ),
  rewarded as (
    select
      gs.game,
      count(*)::integer as rewarded_count,
      min(pt.created_at) as first_awarded_at,
      max(pt.created_at) as last_awarded_at
    from public.points_transactions pt
    join public.game_stats gs on gs.id=pt.game_stat_id
    where pt.player_id=auth.uid()
      and pt.reason_code='GAME_COMPLETED'
      and pt.points>0
      and gs.mode='practice'
      and (pt.created_at at time zone 'Australia/Sydney')::date
        =(now() at time zone 'Australia/Sydney')::date
    group by gs.game
  )
  select jsonb_build_object(
    'date',(now() at time zone 'Australia/Sydney')::date,
    'rewarded_count',coalesce(
      (select sum(rewarded_count) from rewarded),
      0
    ),
    'daily_limit',coalesce(
      (select practice_daily_limit from active_rule),
      0
    ),
    'by_game',coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'game',game,
            'rewarded_count',rewarded_count,
            'first_awarded_at',first_awarded_at,
            'last_awarded_at',last_awarded_at
          )
          order by rewarded_count desc,game
        )
        from rewarded
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_my_practice_reward_usage() from public;
grant execute on function public.get_my_practice_reward_usage()
  to authenticated;

notify pgrst,'reload schema';

commit;
