# V118 team challenge schedules and history

Run `migration_v118_team_challenge_weekly_rollover.sql` once in the Supabase
SQL Editor after V117.

This replaces the earlier automatic-rollover draft. Existing challenges are
kept as one-week challenges. New challenges must explicitly choose either:

- **One week only**, or
- **Repeat weekly** for a finite 2–52 week duration.

Each week is stored as a separate occurrence with its own progress and winner.
An occurrence closes after its last selected playing day. A fully completed
entry with the best adjusted time wins; if nobody finishes every configured
game, the occurrence closes without awarding the prize.

Closed occurrences are available through the challenge history RPC and remain
unchanged when later weeks begin.
