# Apple authentication and server push setup

These steps are intentionally manual. No Apple credential, Supabase secret, migration, or Edge Function is deployed by the app build.

## Sign in with Apple

The app uses Supabase's existing browser OAuth + PKCE flow and the existing `imbored://auth/callback` URL. This preserves the same verifier storage, cold-launch callback, duplicate protection, and session exchange used by Google.

1. In Apple Developer, enable **Sign in with Apple** on App ID `au.imbored.app`.
2. Create a Services ID for web/OAuth use, enable Sign in with Apple, and associate it with the primary App ID.
3. In that Services ID, add the Supabase Auth callback shown in **Supabase Dashboard → Authentication → Providers → Apple** as the return URL. It normally has the form `https://<project-ref>.supabase.co/auth/v1/callback`; copy the exact dashboard value.
4. Create a Sign in with Apple key and download its `.p8` once. Record its Key ID and Team ID.
5. In **Supabase Dashboard → Authentication → Providers → Apple**, enable Apple and enter the Services ID/client ID and Apple server-side credentials requested there. Never add the `.p8` or generated secret to Vite, this repository, or Xcode resources.
6. In **Authentication → URL Configuration**, retain the web Site URL/allowed web redirects and add `imbored://auth/callback` to Redirect URLs if it is not already present for Google.
7. Confirm the App target retains the Sign in with Apple capability when archiving. Do not change signing profiles unless Apple reports the entitlement is missing.

Apple web login is exposed through the same button. It will work after the Services ID and Supabase provider are configured.

## APNs server push

Migration to review (do not apply yet):

`supabase/migrations/202608271200_server_push_notification_outbox.sql`

After review:

```sh
npx supabase db push
npx supabase secrets set APNS_KEY_ID=YOUR_KEY_ID APNS_TEAM_ID=YOUR_TEAM_ID APNS_BUNDLE_ID=au.imbored.app
npx supabase secrets set APNS_PRIVATE_KEY="$(< /secure/location/AuthKey_XXXXXXXXXX.p8)"
npx supabase secrets set PUSH_WORKER_SECRET="$(openssl rand -hex 32)"
npx supabase functions deploy send-push-notifications --no-verify-jwt
```

Store the generated `PUSH_WORKER_SECRET` in the scheduler configuration too. Invoke the function on a short schedule with `Authorization: Bearer <PUSH_WORKER_SECRET>`. Supabase Cron plus Vault is preferred; do not place this secret in browser code. The standard `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` Edge Function secrets are provided by Supabase.

TestFlight/App Store registrations default to production APNs. A debug build that uses a development provisioning profile must be built with `VITE_APNS_ENVIRONMENT=sandbox`; never set that value for TestFlight.

The `.p8` is server-only and can serve both APNs environments. The sender routes each registration to `api.push.apple.com` or `api.sandbox.push.apple.com`, retires `BadDeviceToken`, `DeviceTokenNotForTopic`, and `Unregistered` devices, and retries only rate limits/server/network failures. Delivery/event uniqueness prevents repeated worker calls from duplicating a device delivery.

Remote events currently cover private chat messages and pokes. Daily Circle reminders remain local-only to avoid local/remote duplicates. The outbox supports Circle and competition events, but those should only be enabled when a server-owned occurrence key and scheduling policy are agreed; do not create them from the browser.
