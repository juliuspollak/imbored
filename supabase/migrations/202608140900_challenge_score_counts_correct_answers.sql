-- Challenge rounds were scored on speed alone. In a quiz game that made
-- failing the best strategy: a wrong answer ends the round early, and the
-- round score is 100*benchmark/scored_seconds capped at 150, so a fast wipeout
-- pinned the cap while a careful correct run scored lower. A whole week of
-- perfect 150s could be earned without answering a single question right.
--
-- The round score is now scaled by the share of answers that were correct.
-- Games that record no per-answer breakdown (correct_count/total_count null)
-- keep the old pure-speed behaviour, so nothing regresses for them.

drop function if exists public.circle_challenge_daily_score(text,date,integer,integer,integer);

create function public.circle_challenge_daily_score(
  target_game text,
  target_challenge_date date,
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer,
  correct_answers integer default null,
  total_answers integer default null
) returns integer
    language sql stable security definer
    set search_path to 'public'
    as $$
  with typical as (
    select public.challenge_benchmark_seconds(target_game,target_challenge_date) as seconds
  ),
  accuracy as (
    select case
      when coalesce(total_answers,0) <= 0 then 1::numeric
      else least(1,greatest(0,coalesce(correct_answers,0))::numeric/total_answers)
    end as share
  )
  select greatest(20,least(150,round(
    100*typical.seconds*accuracy.share/greatest(1,public.scored_game_seconds(
      elapsed_seconds,hint_count,mistake_count,typical.seconds
    ))
  )::integer))
  from typical,accuracy
$$;

-- Matches the previous ACL: only the security-definer callers reach it.
revoke all on function public.circle_challenge_daily_score(text,date,integer,integer,integer,integer,integer) from public;

create or replace function public.circle_challenge_member_totals(target_challenge_id bigint)
returns table(member_id uuid, challenge_score integer, rounds_played integer, rounds_total integer, total_hints integer, total_mistakes integer, adjusted_seconds bigint, finished_at timestamp with time zone, last_stat_id bigint, round_scores jsonb)
    language sql stable security definer
    set search_path to 'public'
    as $$
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
          result.total_count
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

-- The personal challenge is scored in the browser, so the same accuracy inputs
-- have to travel with the rows it scores.
drop function if exists public.get_personal_challenge_standings(date,date);

create function public.get_personal_challenge_standings(start_date_in date, end_date_in date)
returns table(result_user_id uuid, game text, challenge_date date, seconds integer, mistakes integer, hints integer, correct_count integer, total_count integer, zip_backtracked_cells integer, zip_required_moves integer, completed_at timestamp with time zone)
    language sql stable security definer
    set search_path to 'public'
    as $$
  select
    gs.user_id,
    gs.game,
    gs.challenge_date,
    gs.seconds,
    gs.mistakes,
    gs.hints,
    gs.correct_count,
    gs.total_count,
    gs.zip_backtracked_cells,
    gs.zip_required_moves,
    gs.completed_at
  from public.game_stats gs
  join public.profiles profile on profile.id=gs.user_id
  where public.is_approved_user(auth.uid())
    and gs.mode='challenge'
    and gs.circle_challenge_id is null
    and gs.challenge_date between start_date_in and end_date_in
    and (
      gs.user_id=auth.uid()
      or (
        coalesce(profile.show_stats_to_others,false)=true
        and coalesce(profile.hidden_from_others,false)=false
        and public.can_view_user(gs.user_id)
      )
    )
  order by gs.challenge_date,gs.completed_at,gs.id
$$;
