-- v200: The animal_rush_archive_attempt trigger (v151/v154) fires on every
-- attempt insert and also records colour_mode into animal_rush_attempt_history.
-- v189 added 'mixed' to the rooms table constraint, and v194 added it to the
-- set_colour_mode RPC, but the history table check constraint was never
-- updated. A room with colour_mode = 'mixed' would cause every tap to fail
-- with a constraint-violation error because the trigger's insert into
-- animal_rush_attempt_history violated the check(colour_mode in
-- ('uniform','individual')) constraint.

do $$
begin
  if exists(
    select 1 from pg_constraint
    where conname='animal_rush_attempt_history_colour_mode_check'
      and conrelid='public.animal_rush_attempt_history'::regclass
  ) then
    alter table public.animal_rush_attempt_history
      drop constraint animal_rush_attempt_history_colour_mode_check;
  end if;
end;
$$;

alter table public.animal_rush_attempt_history
  add constraint animal_rush_attempt_history_colour_mode_check
  check(colour_mode is null or colour_mode in ('uniform','individual','mixed'));

notify pgrst,'reload schema';