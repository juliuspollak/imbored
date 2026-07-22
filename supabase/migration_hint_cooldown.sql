-- Run this in Supabase SQL Editor.
-- Effective cooldown in seconds for a given day = hint_cooldown_base +
-- hint_cooldown_per_day * day_index (0=Mon..6=Sun) — so it can ramp up as
-- difficulty increases through the week, or stay flat if per_day is 0.

alter table game_config add column hint_cooldown_base int not null default 0;
alter table game_config add column hint_cooldown_per_day int not null default 0;
