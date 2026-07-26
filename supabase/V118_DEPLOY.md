# V118 team challenge weekly rollover

Run `migration_v118_team_challenge_weekly_rollover.sql` once in the Supabase
SQL Editor after V117.

When the first team member opens the challenge screen in a new app week, the
latest team challenge setup is copied into that week with fresh challenge IDs,
empty progress and no winner. The previous week’s results and winner remain
unchanged.

The operation is idempotent and concurrency-safe when multiple team members
open the app at the same time.
