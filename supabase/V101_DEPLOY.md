# v101 backend deployment

The frontend can deploy from `main`, but these Supabase-managed changes must
also be applied in the Supabase project.

1. Run `migration_v101_social_unlock_and_chat_cleanup.sql` in SQL Editor.
2. Deploy the `admin-user-action` Edge Function from
   `supabase/functions/admin-user-action/index.ts`.
3. In Authentication → Email Templates → Magic Link, replace the body with
   `supabase/email_template.html`. A suitable shared subject is
   `Your I’mBoredToday access code`.

The approval branch compares its redirect with the project's configured Auth
Site URL. Set the Edge Function secret `APP_URL` to that exact production
origin (without a trailing slash) so approval emails always select the correct
branch.

Example:

```sh
supabase secrets set APP_URL=https://your-production-origin.example
supabase functions deploy admin-user-action
```

If the Players screen reports `Invalid action` while approving someone, the
Supabase project is still running the pre-v101 function. Deploying the function
above activates the `approve` action and its Supabase-template email. The
frontend can fall back to database approval so the player is not blocked, but
that compatibility path cannot send an Auth email.
