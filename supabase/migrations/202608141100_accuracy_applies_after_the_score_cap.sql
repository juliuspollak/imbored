-- Accuracy has to be applied after the 20..150 clamp, not inside it.
--
-- The previous version scaled the raw speed figure by accuracy and then
-- clamped. A fast round stayed above 150 even after the accuracy penalty, so
-- the cap swallowed it whole: one wrong answer out of nine still displayed a
-- full 150. Clamping the speed part first and scaling afterwards puts the
-- accuracy share on the number the player actually sees — 8 of 9 correct tops
-- out at 133, and only a flawless round can reach 150.
--
-- A round answered entirely wrong now scores 0 rather than the 20 floor. That
-- matches a missed round on score alone, but rounds played is the next
-- tiebreaker in get_circle_challenge_standings(), so turning up and failing
-- still ranks above not turning up.

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
    select greatest(20,least(150,round(
      100*typical.seconds/greatest(1,public.scored_game_seconds(
        elapsed_seconds,hint_count,mistake_count,typical.seconds
      ))
    )::integer)) as score
    from typical
  )
  select round(speed.score*accuracy.share)::integer
  from speed,accuracy
$$;
