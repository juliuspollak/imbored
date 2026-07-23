-- Run this in Supabase SQL Editor.
insert into game_config (game_id, visible, available, sort_order, hint_cooldown_base, hint_cooldown_per_day)
values ('geo', true, true, 8, 0, 0)
on conflict (game_id) do nothing;
