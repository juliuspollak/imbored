# v109 email invitations and release notes

1. Run `migration_v109_email_invitations.sql` in Supabase SQL Editor.
2. Deploy `send-app-invite` with gateway JWT verification disabled:
   `supabase functions deploy send-app-invite --no-verify-jwt`
3. The function reuses `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and `APP_URL`.

Pushing the corrected `CHANGELOG.json` triggers the existing GitHub workflow
and restores the newer What’s New entries. No new secret is required.
