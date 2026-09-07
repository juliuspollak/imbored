export const APP_REVIEW_EMAIL = "review@imbored.au";

// This limits the app's review UI, not the public Supabase Auth API.
// Supabase validates the password and issues the ordinary user session.
export async function signInReviewAccount(client, email, password) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (normalizedEmail !== APP_REVIEW_EMAIL) {
    return { error: new Error("App Review access is only available for the dedicated review account.") };
  }
  if (typeof password !== "string" || !password.length) {
    return { error: new Error("Enter the App Review password.") };
  }
  if (!client) return { error: new Error("Supabase isn't configured yet") };
  try {
    const result = await client.auth.signInWithPassword({ email: normalizedEmail, password });
    if (result.error) {
      return { error: new Error("Unable to sign in. Check the review credentials and account status, then try again.") };
    }
    return result;
  } catch {
    return { error: new Error("Unable to reach the sign-in service. Please try again shortly.") };
  }
}
