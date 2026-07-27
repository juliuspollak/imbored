# Animal Rush v137 deployment

Animal Rush requires its server-owned live-room tables and functions before the
home tile can be used.

1. Open Supabase Dashboard → SQL Editor.
2. Run `migration_v137_animal_rush_live_game.sql` once.
3. Deploy the web application.
4. Open Animal Rush on two phones, create a room on one and join with the code
   on the other.

The migration adds both live tables to the existing `supabase_realtime`
publication. It is safe to run once; normal app users cannot directly update
room, player or attempt state.
