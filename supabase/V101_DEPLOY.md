# v101 backend deployment

The frontend can deploy from `main`, but these Supabase-managed changes must
also be applied in the Supabase project.

1. Run `migration_v101_social_unlock_and_chat_cleanup.sql` in SQL Editor.
2. Deploy the `admin-user-action` Edge Function from
   `supabase/functions/admin-user-action/index.ts`.
3. In Authentication → Email Templates → Magic Link, replace the body with
   `supabase/email_template.html`. A suitable shared subject is
   `Your I’mBoredToday access code`.

Approval notifications are transactional Resend emails, not Supabase Auth
emails. This prevents approval from generating a login code the player did not
request. Configure these Edge Function secrets:

- `RESEND_API_KEY` — the existing Resend API key.
- `APP_URL` — the production origin used by the email button.
- `RESEND_FROM_EMAIL` — optional verified sender; defaults to
  `I’mBoredToday <notifications@imbored.au>`.

Example:

```sh
supabase secrets set \
  RESEND_API_KEY=your-resend-api-key \
  APP_URL=https://imbored.au \
  RESEND_FROM_EMAIL="I’mBoredToday <notifications@imbored.au>"
supabase functions deploy admin-user-action --no-verify-jwt
```

The project uses Supabase's asymmetric ES256 JWT signing keys. Gateway-level
JWT verification is therefore disabled for this function in `config.toml`.
`admin-user-action` is not public in practice: its handler independently
validates the bearer token with Supabase Auth and then requires an active admin
profile before any action can run.

If the function reports `Invalid JWT`, redeploy it with the command above. A
deployment without `--no-verify-jwt` can reject the ES256 token before the
function's own authentication code executes.

If the Players screen reports `Invalid action` while approving someone, the
Supabase project is still running the pre-v101 function. Deploying the function
above activates the `approve` action and its Resend notification email. The
frontend can fall back to database approval so the player is not blocked, but
that compatibility path cannot send an approval email.
