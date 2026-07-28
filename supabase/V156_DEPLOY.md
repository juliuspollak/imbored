# Deploy v156

Run `migration_v156_animal_rush_leave_hotfix.sql` once in the Supabase SQL
Editor after v155.

This is required if Animal Rush displays:

> Unable to leave game — function public.is_user_hidden(uuid) does not exist

The migration creates the missing hidden-player helper used by the v155 live
room trigger. It is safe to run even if v153 had already created the helper.
After the query succeeds, the player can retry **Leave game** immediately; no
web deployment or browser refresh is required for the database error itself.
