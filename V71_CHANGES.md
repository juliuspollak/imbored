# Version 71

- Fixed the login screen displaying `{}` for Supabase Auth retryable/HTTP 500 failures.
- Added defensive handling for errors thrown directly by `signInWithOtp`.
- Added a clear user-facing message for AuthRetryableFetchError and server-side failures.
- Normalised email addresses before requesting an OTP.
