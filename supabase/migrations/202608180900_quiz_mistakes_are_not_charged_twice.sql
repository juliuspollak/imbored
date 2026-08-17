-- Stop billing a quiz game's mistakes twice.
--
-- A quiz game's "mistakes" ARE its wrong answers. scored_game_seconds() charges
-- each one 10% of the benchmark as penalty time, and the accuracy share then
-- multiplies the whole score down for those very same answers -- one set of
-- errors, two penalties. A real Geo round (17s, 1 wrong, 4 of 5 correct, 15s
-- benchmark) was charged 1.5 penalty seconds and then multiplied by 0.8.
--
-- Where a result grades itself (total_count is set), accuracy is now the entire
-- penalty and the clock measures pace only. Games that report no answer count
-- keep charging mistakes as time, which remains their only penalty and is
-- therefore not double.
--
-- The 45-point completion floor from 202608160926 is unchanged, and accuracy
-- still applies after it: finishing a round badly must not pay the same as
-- finishing it well.

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
  graded as (
    select coalesce(total_answers,0) > 0 as by_answers
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
        elapsed_seconds,
        hint_count,
        -- Already paid for through the accuracy share on a graded round.
        case when graded.by_answers then 0 else mistake_count end,
        typical.seconds
      ))
    )::integer)) as score
    from typical,graded
  )
  select round(speed.score*accuracy.share)::integer
  from speed,accuracy
$$;
