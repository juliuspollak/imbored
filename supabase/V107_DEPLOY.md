# v107 owner-only team deletion

Run `migration_v107_owner_only_team_deletion.sql` in the Supabase SQL Editor.

Only the team owner can delete their team. Global app administrators retain
member moderation access but cannot delete a team they do not own.

No Edge Function deployment or new secret is required.
