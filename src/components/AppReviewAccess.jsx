import { useRef, useState } from "react";
import { useAuth } from "../lib/AuthContext.jsx";
import { supabaseReady } from "../lib/supabase.js";
import Button from "./Button.jsx";
import TextInput from "./TextInput.jsx";

export default function AppReviewAccess({ onBack }) {
  const { signInWithAppReview } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithAppReview(email, password);
      if (result?.error) setError(result.error.message);
      // AuthProvider's normal auth-state listener handles successful sign-in.
    } catch {
      setError("Unable to sign in. Please try again shortly.");
    } finally {
      setPassword("");
      pending.current = false;
      setBusy(false);
    }
  }

  const labelStyle = { display: "block", textAlign: "left", marginBottom: 6, fontSize: "var(--text-caption-size)" };
  return (
    <form onSubmit={handleSubmit} aria-labelledby="app-review-title" aria-busy={busy}>
      <h2 id="app-review-title" style={{ fontSize: "var(--text-body-size)" }}>App Review access</h2>
      <p style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>For the dedicated App Store review account.</p>
      <label htmlFor="app-review-email" style={labelStyle}>Email</label>
      <TextInput id="app-review-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus disabled={busy || !supabaseReady} value={email} onChange={(event) => setEmail(event.target.value)} style={{ marginBottom: "var(--space-3)" }} />
      <label htmlFor="app-review-password" style={labelStyle}>Password</label>
      <TextInput id="app-review-password" name="password" type="password" autoComplete="current-password" required disabled={busy || !supabaseReady} value={password} onChange={(event) => setPassword(event.target.value)} style={{ marginBottom: "var(--space-3)" }} />
      {error && <p role="alert" style={{ fontSize: "var(--text-caption-size)", color: "var(--color-danger-text)" }}>{error}</p>}
      <Button type="submit" variant="primary" fullWidth loading={busy} disabled={busy || !supabaseReady}>{busy ? "Signing in…" : "Sign in"}</Button>
      <Button type="button" variant="ghost" fullWidth disabled={busy} onClick={onBack} style={{ marginTop: "var(--space-3)" }}>Back to normal sign-in</Button>
    </form>
  );
}
