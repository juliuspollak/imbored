# Challenge game availability v164 deployment

Run `migration_v164_challenge_game_availability.sql` once in the Supabase SQL
Editor before using the new **Challenges** control in Admin Games.

The migration:

- adds `game_config.challenge_enabled`;
- enables it for the six existing puzzle Challenge games;
- keeps Animal Rush disabled because it is a live-only game; and
- prevents new or edited team challenges from saving a disabled game.

Existing team challenges are preserved.
