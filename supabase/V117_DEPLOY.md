# V117 challenge lifecycle and winner notifications

Run `migration_v117_challenge_lifecycle_notifications.sql` once in the Supabase
SQL Editor after V116.

This migration:

- exposes authoritative per-challenge member completion and winner state;
- distinguishes a player finishing from the whole challenge finishing;
- sends the winner their own challenge-result message;
- backfills the missing winner message for already-awarded challenges; and
- leaves the winner-only prize and adjusted-time ranking rules unchanged.

No frontend environment variable or Cloudflare setting changes are required.
Cloudflare will deploy the frontend automatically from `main`.
