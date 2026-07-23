-- Run this in Supabase SQL Editor.
--
-- game_config previously had a SELECT policy and an UPDATE policy for
-- admins, but no INSERT policy. AdminGames.jsx saves settings (including
-- the hint-cooldown seconds) via upsert(), which needs INSERT privileges
-- whenever a row doesn't already exist for that game_id — and since the
-- client didn't check the returned error, that failure was invisible: the
-- admin UI looked like it saved, but nothing was actually written.
--
-- Safe to re-run.

drop policy if exists "admins can insert game config" on game_config;
create policy "admins can insert game config" on game_config for insert
  with check (is_admin(auth.uid()));
