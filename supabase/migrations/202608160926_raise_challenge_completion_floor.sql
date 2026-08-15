-- A player who genuinely finishes a difficult challenge should still make
-- meaningful leaderboard progress. The old 20-point speed floor was only 13%
-- of the 150-point maximum, so a slow Sunday solve could feel almost worthless.
--
-- Raise the speed floor to 45 (30% of the maximum). Accuracy remains applied
-- afterwards: a perfect but very slow solve gets 45, 50% accuracy gets about
-- 23, and a zero-correct result still gets 0. Strong players retain up to a
-- 105-point advantage per round.

create or replace function public.circle_challenge_daily_score(
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
  ),
  speed as (
    select greatest(45,least(150,round(
      100*typical.seconds/greatest(1,public.scored_game_seconds(
        elapsed_seconds,hint_count,mistake_count,typical.seconds
      ))
    )::integer)) as score
    from typical
  )
  select round(speed.score*accuracy.share)::integer
  from speed,accuracy
$$;
