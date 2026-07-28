# Animal Rush v151 deployment

Run `migration_v151_animal_rush_synchronised_difficulty.sql` in Supabase SQL
Editor before deploying the v151 web application.

This migration adds:

- Easy, Standard and Hard room modes.
- Server-owned roll, shuffle and card-opening timestamps.
- A phone readiness heartbeat and measured clock quality.
- Persistent per-mode attempt history for later difficulty comparisons.

The migration replaces the existing start, advance and rematch functions. It is
safe to run once after the v137 and v149 Animal Rush migrations.
