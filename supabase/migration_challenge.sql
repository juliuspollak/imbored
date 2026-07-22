-- Phase: Challenge mode (deterministic daily puzzle, once per day, history view)
-- Run this in Supabase SQL Editor. Adds columns only, doesn't touch existing rows.

alter table game_stats add column mode text not null default 'practice'; -- 'practice' | 'challenge'
alter table game_stats add column challenge_date date; -- the calendar date, only set for mode='challenge'

-- One challenge attempt per (player, game, calendar day) — the actual
-- enforcement of "once per day", not just a UI suggestion.
create unique index game_stats_one_challenge_per_day
  on game_stats (user_id, game, challenge_date)
  where mode = 'challenge';
