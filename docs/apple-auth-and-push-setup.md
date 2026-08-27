# Apple authentication and server push setup

These steps are intentionally manual. No Apple credential, Supabase secret, migration, or Edge Function is deployed by the app build.

## Sign in with Apple

The app uses Supabase's existing browser OAuth + PKCE flow and the existing `imbored://auth/callback` URL. This preserves the same verifier storage, cold-launch callback, duplicate protection, and session exchange used by Google.

1. In Apple Developer, enable **Sign in with Apple** on App ID `au.imbored.app`.
2. Create a Services ID for web/OAuth use, enable Sign in with Apple, and associate it with the primary App ID.
3. In that Services ID, add the Supabase Auth callback shown in **Supabase Dashboard → Authentication → Providers → Apple** as the return URL. It normally has the form `https://<project-ref>.supabase.co/auth/v1/callback`; copy the exact dashboard value.
4. Create a Sign in with Apple key and download its `.p8` once. Record its Key ID and Team ID. Use it securely to generate the Apple OAuth client secret; never put the key itself in this repository or frontend configuration.
5. In **Supabase Dashboard → Authentication → Providers → Apple**, enable Apple and enter the Services ID/client ID and generated Apple OAuth client secret.
6. In **Authentication → URL Configuration**, retain the web Site URL/allowed web redirects and add `imbored://auth/callback` to Redirect URLs if it is not already present for Google.
7. Regenerate the App Store provisioning profile after enabling the capability. Download it, confirm it contains `com.apple.developer.applesignin`, base64-encode it, and replace the GitHub Actions secret `IOS_APP_STORE_PROFILE_BASE64`. The Apple Distribution certificate does not need replacing solely for this capability change.
8. Apple OAuth client secrets have a maximum six-month lifetime. Rotate the generated client secret before expiry in **Supabase Dashboard → Authentication → Providers → Apple**. Keep the `.p8` key securely outside the repository so the next secret can be generated.

Apple web login is exposed through the same button. It will work after the Services ID and Supabase provider are configured.

If a player manually dismisses the native OAuth browser without an Apple/Google callback, the pending PKCE marker expires after ten minutes. Capacitor's `browserFinished` event is intentionally not used to clear it: that event may also arrive when a successful deep link dismisses the browser, which could race the code exchange and erase its verifier protection. The marker contains only a timestamp and does not sign the player out.

## APNs server push

Migration to review (do not apply yet):

`supabase/migrations/202608271200_server_push_notification_outbox.sql`

After review:

```sh
npx supabase db push
./scripts/setup-push-secrets.sh
npx supabase functions deploy send-push-notifications --no-verify-jwt
```

The secrets helper prompts for the APNs Key ID, Team ID, and local `.p8` path. It generates `PUSH_WORKER_SECRET`, formats the private key for the Edge Function, and sends all five push secrets to the currently linked Supabase project through a mode-600 temporary file under `/private/tmp`. The file is deleted automatically, and neither sensitive value is printed or stored in the repository.

Store the generated `PUSH_WORKER_SECRET` in the scheduler configuration too. Invoke the function on a short schedule with `Authorization: Bearer <PUSH_WORKER_SECRET>`. Supabase Cron plus Vault is preferred; do not place this secret in browser code. The standard `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` Edge Function secrets are provided by Supabase.

`--no-verify-jwt` deliberately disables the Supabase gateway JWT check. `PUSH_WORKER_SECRET` is therefore the endpoint authentication boundary: it must be high entropy, stored in Supabase secrets/Vault only, and never reused in frontend configuration.

TestFlight/App Store registrations default to production APNs. A debug build that uses a development provisioning profile must be built with `VITE_APNS_ENVIRONMENT=sandbox`; never set that value for TestFlight.

The `.p8` is server-only and can serve both APNs environments. The sender routes each registration to `api.push.apple.com` or `api.sandbox.push.apple.com`, retires `BadDeviceToken`, `DeviceTokenNotForTopic`, and `Unregistered` devices, and retries only rate limits/server/network failures. Delivery/event uniqueness prevents repeated worker calls from duplicating a device delivery.

Each delivery has a three-minute database lease and a unique claim token. A crashed worker's `sending` delivery becomes claimable after the lease expires; the old worker cannot complete the new claim. Each invocation claims at most ten deliveries and APNs requests time out after 12 seconds, keeping normal sequential processing inside the lease. A warm Edge Function isolate reuses its provider token for 50 minutes. Cold isolates create their own token and connection, so correctness does not depend on isolate lifetime and the private key is never persisted in database tables.

Remote events currently cover private chat messages and pokes. Daily Circle reminders remain local-only to avoid local/remote duplicates. The outbox supports Circle and competition events, but those should only be enabled when a server-owned occurrence key and scheduling policy are agreed; do not create them from the browser.

## Controlled APNs transport smoke test

Do **not** enable Cron until direct APNs delivery has succeeded against one real sandbox device.

1. Build a development-profile iPhone build with `VITE_APNS_ENVIRONMENT=sandbox` and sign in as a dedicated test account.
2. Confirm exactly one active sandbox registration exists for that account. Do not copy its raw token into logs or tickets.
3. Apply the reviewed migration, set secrets, and deploy the worker only after code review.
4. From a second authorised test account, create one normal Chat message to the sandbox account. This creates one auditable event without a broad send.
5. Invoke the worker once manually with its bearer secret.
6. Confirm the phone receives the notification and the structured logs show `apns_delivery_result` with `sent`, without a device token or provider JWT.
7. Inspect the event/delivery status server-side. If direct APNs transport fails, leave Cron disabled and resolve the HTTP/2/runtime issue before any production test.
8. Only after the sandbox test succeeds, repeat with one TestFlight account/production registration, then configure Vault-backed Cron.
