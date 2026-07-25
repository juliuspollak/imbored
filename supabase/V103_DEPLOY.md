# v103 team moderation deployment

Run `migration_v103_team_moderation.sql` in the Supabase SQL Editor.

This adds reversible team blocks, owner/app-admin member moderation, protected
team deletion, admin roster visibility and server-side enforcement across join
requests, approvals and invitations.

No Edge Function deployment or new secret is required.
