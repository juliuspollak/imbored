-- Hard-mode card spin speed, tunable from Admin -> Games.
--
-- The speed was a CSS constant, so changing it meant a code edit and a deploy
-- to answer a question only playtesting can answer. It sits beside the other
-- per-game difficulty dials instead.
--
-- Seconds for one full turn, so a smaller number spins faster. 0 turns the
-- spin off and leaves hard mode with its fixed per-card angles, which is what
-- it did before spinning existed — that is the off switch, not a broken value.

alter table public.game_config
  add column if not exists rush_spin_seconds integer default 14 not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='game_config_rush_spin_seconds_check'
  ) then
    alter table public.game_config
      add constraint game_config_rush_spin_seconds_check
      check (rush_spin_seconds >= 0 and rush_spin_seconds <= 120);
  end if;
end;
$$;
