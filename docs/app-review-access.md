# App Review access

The sign-in screen has a discreet **App Review access** button. It opens a separate email/password form with a back button. Only `review@imbored.au` (case-insensitive, ignoring surrounding whitespace) is accepted. Other addresses never call password auth. Supabase validates the entered password using `signInWithPassword`; the app does not create users, persist passwords, grant privileges, or bypass OTP. Password state is cleared after every attempt and discarded on leaving the form.

## Existing authentication and account state

`src/lib/supabase.js` creates one Supabase client using the public frontend configuration, persistent sessions, automatic token refresh, PKCE, and experimental passkey support. `AuthContext` initializes the session with `getSession` and listens to `onAuthStateChange`; it loads the user's profile and refreshes account state through realtime updates and visibility changes.

- Email uses `signInWithOtp`, with `shouldCreateUser: true`, followed by `verifyOtp` with type `email`. The sign-in screen requires **8 digits**, unchanged. The repository does not contain the hosted project's OTP-length setting, so server-side length has not been independently verified.
- Apple and Google use the shared OAuth helper. Web redirects to the provider; native uses Capacitor Browser and the existing deep-link callback to exchange the PKCE code.
- Passkeys use `signInWithPasskey`; registration requires a signed-in account.
- The review method returns the normal Supabase result. The shared auth listener handles its session; there is no custom redirect or review-only app.
- `App.jsx` routes logged-out users to Login, missing profiles to ProfileSetup, deleted profiles to sign-out handling, and blocked profiles to BlockedAccount. ProfileSetup saves through `save_my_profile`.
- Automatic approval is already defined in `202609071200_auto_approve_normal_accounts.sql` and the schema snapshot. New profiles are approved without admin status. Existing protected profile fields, RLS, hidden/private state, moderation and account deletion are unchanged.

Password sign-in was not previously used in application source. Hosted Auth configuration and deployment of the existing automatic-approval migration were not verified or changed.

## Manual Supabase setup (owner action, not performed by this change)

1. Open the correct Supabase project dashboard. Under **Authentication → Sign In / Providers → Email**, verify that **Enable Email provider** is on. Email OTP and email/password share this provider, so a functioning email OTP flow normally already has it enabled. No separate frontend password feature switch is needed. Keep existing confirmation, signup, OTP length, rate-limit and attack-protection settings unchanged. Do not disable email confirmation globally.
2. Open **Authentication → Users**, search for `review@imbored.au`, and verify whether it already exists. If it is absent, choose **Add user → Create new user** (not Invite user), enter that email and a strong unique password generated privately, enable **Auto Confirm User** for this account only, and create it. Do not enter privileged user metadata. Supabase stores the password hash; do not edit Auth tables with SQL.
3. If the address already exists, do not delete/recreate it or overwrite an unknown owner's account. Verify ownership and account state first. Use Supabase's supported password reset flow to set a strong fixed password privately if necessary; confirm the account before review. Do not unblock or restore a moderated/deleted account merely to make review login work.
4. Sign in through App Review access in the intended build. If there is no profile, complete normal onboarding. Confirm the reviewer can reach and use the normal app without approval. Check that the existing automatic-approval migration is already applied using the dashboard's read-only migration history/schema inspection. If it is not, stop and arrange the normal reviewed release process separately; do not manually alter production or run `supabase db push` for this task.
5. Sign out and sign in again with the same password to confirm it is reusable and requires no email code. Complete this validation before submitting the build. No real account login was performed during implementation.

Do not put the password in source, migrations, Vite configuration, environment files, logs, screenshots, tickets or this document. Provide it privately to Apple in App Store Connect. No service-role key is needed by the frontend.

Supabase documentation: [Password-based Auth](https://supabase.com/docs/guides/auth/passwords), [Users](https://supabase.com/docs/guides/auth/users), [General configuration](https://supabase.com/docs/guides/auth/general-configuration).

## App Store Connect

- **User name:** `review@imbored.au`
- **Password:** the actual fixed password you privately set on that Supabase Auth account; it is not an OTP.
- **Review Notes** (after completing the checks above):

> Use the App Review access option on the sign-in screen with the credentials provided in App Review Information. This account does not require an email verification code or manual approval. If prompted, complete the standard profile setup to enter the app.

## Security and verification limits

The email allowlist limits this app UI, not direct requests to the public Supabase Auth API. Supabase's Email provider supports password authentication for other accounts that have a password; this change introduces no server-side allowlist. Do not treat the discreet button or public review email as a security boundary. Password validation, existing rate limits, sessions and RLS remain authoritative. The review account has ordinary user permissions, including normal account deletion, and no moderation exemption.

Automated tests exercise the review auth helper with generated test credentials and mock Supabase responses. Source regression checks cover form wiring, provider paths, the eight-digit OTP, shared session/onboarding routing, and protected account gates. Existing automatic-approval tests also run. These do not replace a browser/device and hosted-account acceptance check.
