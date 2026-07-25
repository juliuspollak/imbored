# v109 email invitations and release notes

1. Run `migration_v109_email_invitations.sql` in Supabase SQL Editor.
2. Deploy `send-app-invite` with gateway JWT verification disabled:
   `supabase functions deploy send-app-invite --no-verify-jwt`
3. Create and publish a Resend template with:
   - alias: `imbored-app-invite`
   - string variables: `INVITER_NAME` and `APP_URL`
4. Add `RESEND_APP_INVITE_TEMPLATE_ID=imbored-app-invite` to Supabase secrets.
5. The function also reuses `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and `APP_URL`.

Pushing the corrected `CHANGELOG.json` triggers the existing GitHub workflow
and restores the newer What’s New entries.
