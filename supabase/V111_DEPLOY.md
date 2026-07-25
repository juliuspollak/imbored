# V111 deployment

Run `migration_v111_points_integrity_and_zoom.sql` once in the Supabase SQL Editor.

## What this fixes

**A real points exploit.** Any team owner (not just admins) could set a
weekly team challenge's `reward_points` up to 100,000, and completing that
challenge paid it straight into `player_progress.available_points` /
`lifetime_points` — the same balance used to redeem real rewards — with no
relation to the normal 20-250-per-game scoring. This migration caps that
reward to 500 (same order of magnitude as a single game's max score, with
headroom for a "finish everything" bonus) and enforces the cap in three
independent places: the table's CHECK constraint, the `set_team_weekly_challenge`
RPC, and the `award_completed_team_challenge` trigger itself. If you already
have team challenges configured with a reward above 500, this migration
clamps them down automatically — no manual cleanup needed.

**The normal per-game economy is hardened the same way.** `reward_rules`
previously had no upper bound at all, so a typo in the admin Rewards screen
(an extra zero on `base_points` or `maximum_points`) would have applied to
every game, for every player, immediately. All of its tunable fields now
have CHECK constraints, and `award_game_points` also clamps its own output
to an absolute ceiling that doesn't come from `reward_rules` at all — so a
bad config can bend the *shape* of scoring but can never blow through the
ceiling. `admin_adjust_points` gets the same treatment (±5,000 per
adjustment, with a friendly error instead of a raw constraint failure).

None of this changes anything about how points are earned for normal play —
defaults are untouched and every existing bound was already well inside the
new limits.

## What this adds

The **Zoom** game — `game_config` gets a row for it (visible, playable,
sort order 9), and `set_team_weekly_challenge` accepts `'zoom'` as a valid
game for weekly team challenges alongside the existing five.

## Safe to re-run

Every statement is idempotent (`drop ... if exists` before each
`add constraint` / `create or replace function`, `on conflict do nothing`
for the `game_config` insert), so re-running this migration is harmless.
