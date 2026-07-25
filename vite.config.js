# v70 changes

- Feedback edits now retry without `updated_at` when an older PostgREST schema cache has not refreshed yet.
- Added an idempotent v70 Supabase migration that creates the missing feedback and hint-cooldown columns, restores the author edit policy, and reloads the API schema cache.
- Admins can again see the online-player bubble and poke visible players; admin mode can also include accounts hidden from ordinary players.
- Added a dedicated Admin bubble and moved Players, Games, and Rewards into it instead of mixing admin tools into the user menu.

## Deployment requirement

Run `supabase/migration_v70_feedback_hints_admin.sql` once in the Supabase SQL Editor before or alongside deploying this build.
