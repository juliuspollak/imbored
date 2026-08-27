import { useState, useEffect } from "react";
import { Mail, ArrowRight, Fingerprint } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabaseReady } from "./lib/supabase.js";
import { useI18n } from "./lib/i18n.jsx";
import Page from "./components/Page.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import TextInput from "./components/TextInput.jsx";

const EMAIL_OTP_LENGTH = 8;
const passkeySupported = typeof window !== "undefined" && !!window.PublicKeyCredential;

function getAuthErrorMessage(error) {
  if (!error) return "Unable to send the sign-in code.";
  if (typeof error === "string") return error;
  const directMessage = error.message || error.error_description || error.description || error.msg;
  if (directMessage && directMessage !== "{}" && directMessage !== "[object Object]") return directMessage;
  const status = error.status || error.statusCode || error.context?.status;
  const name = error.name || error.constructor?.name;
  if (name === "AuthRetryableFetchError" || Number(status) >= 500) return "The sign-in service could not send the email (server error). Please try again shortly.";
  if (name === "AuthApiError" && status) return `The sign-in request failed (${status}).`;
  try { const s = JSON.stringify(error); if (s && s !== "{}") return s; } catch { /* */ }
  return "Unable to send the sign-in code. Please try again.";
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8 3.1l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.1 8 3.1l5.7-5.7C34.6 7 29.6 5 24 5c-7.7 0-14.4 4.4-17.7 10.7z" />
      <path fill="#4CAF50" d="M24 43c5.5 0 10.4-1.9 14-5.1l-6.5-5.4c-2 1.4-4.6 2.3-7.5 2.3-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 38.6 16.3 43 24 43z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.5 5.4C40.9 36 44 30.5 44 24c0-1.3-.1-2.7-.4-3.5z" />
    </svg>
  );
}

function AppleIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.79 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.1ZM12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25Z"/></svg>;
}

export default function Login() {
  const { t } = useI18n();
  const { signInWithEmail, verifyCode, signInWithGoogle, signInWithApple, signInWithPasskey } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function handlePasskey() { setError(null); setPasskeyBusy(true); const { error } = await signInWithPasskey(); setPasskeyBusy(false); if (error && error.name !== "NotAllowedError") setError(error.message); }
  async function handleGoogle() { setError(null); const { error } = await signInWithGoogle(); if (error) setError(error.message); }
  async function handleApple() { setError(null); const { error } = await signInWithApple(); if (error && error.name !== "NotAllowedError") setError(error.message); }

  async function handleSendCode(e) {
    e?.preventDefault?.();
    if (!email || sending || cooldown > 0) return;
    const cleanEmail = email.trim().toLowerCase(); if (!cleanEmail) return;
    setSending(true); setError(null); setEmail(cleanEmail);
    try {
      const result = await signInWithEmail(cleanEmail); const authError = result?.error;
      if (authError) { setError(getAuthErrorMessage(authError)); return; }
      setSent(true); setCooldown(30);
    } catch (err) { setError(getAuthErrorMessage(err)); }
    finally { setSending(false); }
  }

  async function handleVerify(e) { e?.preventDefault?.(); await verifyEnteredCode(code); }

  async function verifyEnteredCode(value) {
    const cleanCode = value.replace(/\D/g, "");
    if (verifying) return;
    if (cleanCode.length !== EMAIL_OTP_LENGTH) { setError(t("auth.invalidCodeLength")); return; }
    setVerifying(true); setError(null);
    const { error } = await verifyCode(email, cleanCode);
    setVerifying(false); if (error) setError(t("auth.invalidCode"));
  }

  useEffect(() => {
    if (!sent || code.length !== EMAIL_OTP_LENGTH) return;
    const timer = window.setTimeout(() => verifyEnteredCode(code), 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, sent]);

  return (
    <Page style={{ alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: "var(--space-6)", textAlign: "center" }}>
        <div style={{ marginBottom: "var(--space-6)" }}>
          <h1 style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: "var(--color-text-primary)", fontSize: "2rem", margin: 0 }}>
            I'mBoredToday
          </h1>
          <p style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>
            {t("auth.tagline")}
          </p>
        </div>

        {!supabaseReady && (
          <div style={{ fontSize: "var(--text-caption-size)", borderRadius: "var(--radius-sm)", padding: "var(--space-3)", marginBottom: "var(--space-4)", background: "var(--color-danger-bg)", color: "var(--color-danger-text)" }}>
            Supabase isn't configured yet — add your project URL and key to <code>.env</code> to enable accounts.
          </div>
        )}

        {!sent ? (
          <>
            {passkeySupported && (
              <>
                <Button variant="primary" fullWidth loading={passkeyBusy} before={<Fingerprint size={16} />} onClick={handlePasskey} disabled={!supabaseReady} style={{ marginBottom: "var(--space-3)" }}>
                  {passkeyBusy ? t("auth.waiting") : t("auth.passkey")}
                </Button>
                <p style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>{t("auth.passkeyHint")}</p>
              </>
            )}
            <Button fullWidth before={<AppleIcon />} onClick={handleApple} disabled={!supabaseReady} style={{ marginBottom: "var(--space-3)", background:"#000", color:"#fff", border:"1px solid #000" }}>
              Continue with Apple
            </Button>
            <Button variant="ghost" fullWidth before={<GoogleIcon />} onClick={handleGoogle} disabled={!supabaseReady} style={{ marginBottom: "var(--space-4)", border: "1px solid var(--color-border)" }}>
              {t("auth.google")}
            </Button>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
              <div style={{ height: 1, background: "var(--color-border)", flex: 1 }} />
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{t("auth.or")}</span>
              <div style={{ height: 1, background: "var(--color-border)", flex: 1 }} />
            </div>
            <form onSubmit={handleSendCode}>
              <label style={{ fontSize: "var(--text-caption-size)", fontWeight: 500, color: "var(--color-text-secondary)", display: "block", marginBottom: 6, textAlign: "left" }}>{t("auth.email")}</label>
              <TextInput type="email" required disabled={!supabaseReady} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ marginBottom: "var(--space-3)" }} />
              {error && <p style={{ fontSize: "var(--text-caption-size)", marginBottom: "var(--space-3)", color: "var(--color-danger-text)" }}>{error}</p>}
              <Button variant="primary" fullWidth type="submit" loading={sending} disabled={!supabaseReady} after={<ArrowRight size={15} />}>
                {sending ? t("auth.sending") : t("auth.sendCode")}
              </Button>
              <p style={{ fontSize: 11, color: "var(--color-text-secondary)", textAlign: "center", marginTop: "var(--space-3)" }}>{t("auth.noPassword")}</p>
            </form>
          </>
        ) : (
          <form onSubmit={handleVerify}>
            <div style={{ textAlign: "center", marginBottom: "var(--space-4)" }}>
              <Mail size={24} style={{ color: "var(--color-primary)", margin: "0 auto 8px" }} />
              <p style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-primary)" }}>{t("auth.codeSent", { email })}</p>
            </div>
            <TextInput
              required autoFocus type="text" name="one-time-code" inputMode="numeric"
              value={code} onChange={(e) => { setError(null); setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, EMAIL_OTP_LENGTH)); }}
              placeholder={t("auth.codeLabel")} autoComplete="one-time-code" pattern="[0-9]*"
              enterKeyHint="done" aria-label={t("auth.codeLabel")} maxLength={EMAIL_OTP_LENGTH}
              style={{ textAlign: "center", letterSpacing: "0.2em", marginBottom: "var(--space-3)" }}
            />
            {error && <p style={{ fontSize: "var(--text-caption-size)", textAlign: "center", marginBottom: "var(--space-3)", color: "var(--color-danger-text)" }}>{error}</p>}
            <Button variant="primary" fullWidth type="submit" loading={verifying}>{verifying ? t("auth.checking") : t("auth.verify")}</Button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--space-3)" }}>
              <button type="button" onClick={() => { setSent(false); setCode(""); setError(null); }} style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", background: "transparent", border: "none", cursor: "pointer" }}>{t("auth.changeEmail")}</button>
              <button type="button" onClick={handleSendCode} disabled={cooldown > 0} style={{ fontSize: "var(--text-caption-size)", fontWeight: 500, color: cooldown > 0 ? "var(--color-text-secondary)" : "var(--color-primary)", background: "transparent", border: "none", cursor: cooldown > 0 ? "default" : "pointer" }}>{cooldown > 0 ? t("auth.resendIn", { seconds: cooldown }) : t("auth.resend")}</button>
            </div>
          </form>
        )}
      </Card>
    </Page>
  );
}
