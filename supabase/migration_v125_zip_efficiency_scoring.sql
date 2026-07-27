-- v125: retain ZIP exploration quality separately from generic mistakes.
-- ZIP sends only a small, capped penalty unit count through `mistakes` so
-- existing reward and challenge scoring remains compatible.

alter table public.game_stats
  add column if not exists zip_backtracked_cells integer;
alter table public.game_stats
  add column if not exists zip_required_moves integer;

alter table public.game_stats
  drop constraint if exists game_stats_zip_backtracked_cells_nonnegative;
alter table public.game_stats
  add constraint game_stats_zip_backtracked_cells_nonnegative
  check(zip_backtracked_cells is null or zip_backtracked_cells>=0);

alter table public.game_stats
  drop constraint if exists game_stats_zip_required_moves_positive;
alter table public.game_stats
  add constraint game_stats_zip_required_moves_positive
  check(zip_required_moves is null or zip_required_moves>0);

-- Extend the privacy-safe personal leaderboard projection with ZIP quality.
drop function if exists public.get_personal_challenge_standings(date,date);
create function public.get_personal_challenge_standings(
  start_date_in date,
  end_date_in date
)
returns table(
  result_user_id uuid,
  game text,
  challenge_date date,
  seconds integer,
  mistakes integer,
  hints integer,
  zip_backtracked_cells integer,
  zip_required_moves integer,
  completed_at timestamptz
)
language sql
security definer
stable
set search_path=public
as $$
  select
    gs.user_id,
    gs.game,
    gs.challenge_date,
    gs.seconds,
    gs.mistakes,
    gs.hints,
    gs.zip_backtracked_cells,
    gs.zip_required_moves,
    gs.completed_at
  from public.game_stats gs
  join public.profiles profile on profile.id=gs.user_id
  where public.is_approved_user(auth.uid())
    and gs.mode='challenge'
    and gs.team_challenge_id is null
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

revoke all on function public.get_personal_challenge_standings(date,date)
  from public;
grant execute on function public.get_personal_challenge_standings(date,date)
  to authenticated;

notify pgrst,'reload schema';
