-- Phase: post-game difficulty feedback
-- Run this in Supabase SQL Editor.

alter table game_stats add column difficulty_rating int; -- 0-100, null until rated
