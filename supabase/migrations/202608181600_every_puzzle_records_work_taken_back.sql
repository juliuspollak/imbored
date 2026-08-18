-- Give Hive, Twist and Sudoku a signal beyond the clock.
--
-- 202608181500 let Gridly be scored on route planning, because Gridly alone
-- recorded backtracked cells. The other three puzzles recorded nothing but
-- time, mistakes and hints - and across 93 real rounds Hive and MiniSudoku had
-- ZERO mistakes in 29 rounds between them. Their score was 100% pace, not by
-- choice but because nothing else was ever measured.
--
-- All three already track an undo stack; none of it reached the database. An
-- undo is exactly the signal Gridly gets from backtracking: work placed and
-- then taken back. wasted_moves counts them, expected_moves is how many cells
-- the puzzle actually required, and round_inefficiency() prefers this pair over
-- Gridly's columns so every puzzle now feeds the same channel.
--
-- Expected moves per game:
--     hive        one bee per row      (board size)
--     twist       cells - givens
--     sudoku      cells - givens
--
-- Nothing changes for rounds already saved: both columns are null, the ratio is
-- 0, and those rounds score exactly as they do today.

alter table public.game_stats
  add column if not exists wasted_moves integer,
  add column if not exists expected_moves integer;

comment on column public.game_stats.wasted_moves is
  'Work placed and then taken back - undos, or Gridly backtracked cells.';
comment on column public.game_stats.expected_moves is
  'How many placements the puzzle required, the denominator for wasted_moves.';

-- Prefer the generic pair; fall back to Gridly''s columns for rounds saved
-- before they existed.
create or replace function public.round_inefficiency(
  backtracked_cells integer,
  required_moves integer,
  wasted_moves integer default null,
  expected_moves integer default null
) returns numeric
    language sql immutable
    as $$
  with pair as (
    select
      coalesce(wasted_moves,backtracked_cells) as wasted,
      coalesce(expected_moves,required_moves) as required
  )
  select case
    when coalesce(pair.required,0) <= 0 then 0::numeric
    else least(4, greatest(0,coalesce(pair.wasted,0))::numeric/pair.required)
  end
  from pair
$$;

-- The personal challenge is scored in the browser, so the two new columns have
-- to travel with the rows it scores. Changing the return type needs a drop.
drop function if exists public.get_personal_challenge_standings(date,date);

create function public.get_personal_challenge_standings(start_date_in date, end_date_in date) RETURNS TABLE(result_user_id uuid, game text, challenge_date date, seconds integer, mistakes integer, hints integer, correct_count integer, total_count integer, zip_backtracked_cells integer, zip_required_moves integer, wasted_moves integer, expected_moves integer, completed_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    gs.user_id,
    gs.game,
    gs.challenge_date,
    gs.seconds,
    gs.mistakes,
    gs.hints,
    -- The browser scores the personal challenge itself, so it needs the same
    -- accuracy inputs circle_challenge_daily_score() gets on the server.
    gs.correct_count,
    gs.total_count,
    gs.zip_backtracked_cells,
    gs.zip_required_moves,
    gs.wasted_moves,
    gs.expected_moves,
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
