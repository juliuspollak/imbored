import { useState, useEffect } from "react";
import { Mail, ArrowRight, Fingerprint } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabaseReady } from "./lib/supabase.js";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";

const passkeySupported = typeof window !== "undefined" && !!window.PublicKeyCredential;

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

export default function Login() {
  const { signInWithEmail, verifyCode, signInWithGoogle, signInWithPasskey } = useAuth();
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

  async function handlePasskey() {
    setError(null);
    setPasskeyBusy(true);
    const { error } = await signInWithPasskey();
    setPasskeyBusy(false);
    // A cancelled prompt or "no passkey on this device" isn't really an
    // error worth alarming someone with — just let them fall through to
    // the other sign-in options below.
    if (error && error.name !== "NotAllowedError") setError(error.message);
  }

  async function handleGoogle() {
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) setError(error.message);
  }

  async function handleSendCode(e) {
    e.preventDefault();
    if (!email || sending || cooldown > 0) return;
    setSending(true);
    setError(null);
    const { error } = await signInWithEmail(email);
    setSending(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
      setCooldown(30); // a shared inbox rate limit means one person spamming "resend" can lock everyone out
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    if (!code || verifying) return;
    setVerifying(true);
    setError(null);
    const { error } = await verifyCode(email, code.trim());
    setVerifying(false);
    if (error) setError("That code didn't work — check it and try again, or resend below.");
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex items-center justify-center p-4">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;1,600&family=Inter:wght@400;500;600;700&display=swap');`}</style>
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
      >
        <div className="text-center mb-6">
          <h1 style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontWeight: 600, color: INK }} className="text-3xl">
            Puzzle Games
          </h1>
          <p style={{ color: INK, opacity: 0.5 }} className="text-xs mt-1">
            sign in to track your stats and play with friends
          </p>
        </div>

        {!supabaseReady && (
          <div className="text-xs rounded-lg p-3 mb-4" style={{ background: "rgba(217,105,92,0.1)", color: "#B5433A" }}>
            Supabase isn't configured yet — add your project URL and key to <code>.env</code> to enable accounts.
          </div>
        )}

        {!sent ? (
          <>
            {passkeySupported && (
              <>
                <button
                  onClick={handlePasskey}
                  disabled={!supabaseReady || passkeyBusy}
                  className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold mb-3"
                  style={{ background: ACCENT, color: "#FFFFFF", opacity: passkeyBusy ? 0.7 : 1 }}
                >
                  <Fingerprint size={16} />
                  {passkeyBusy ? "Waiting…" : "Sign in with a passkey"}
                </button>
                <p style={{ color: INK, opacity: 0.4 }} className="text-[11px] text-center mb-4">
                  Only works if you've registered one on this device before — otherwise use an option below.
                </p>
              </>
            )}
            <button
              onClick={handleGoogle}
              disabled={!supabaseReady}
              className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold mb-4"
              style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK, background: "#FFFFFF" }}
            >
              <GoogleIcon />
              Continue with Google
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div style={{ height: 1, background: "rgba(16,24,40,0.12)" }} className="flex-1" />
              <span style={{ color: INK, opacity: 0.4 }} className="text-[11px]">or</span>
              <div style={{ height: 1, background: "rgba(16,24,40,0.12)" }} className="flex-1" />
            </div>
            <form onSubmit={handleSendCode}>
            <label style={{ color: INK, opacity: 0.6 }} className="text-xs font-medium block mb-1.5">
              Email address
            </label>
            <input
              type="email"
              required
              disabled={!supabaseReady}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg px-3 py-2.5 text-sm mb-3 outline-none"
              style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
            />
            {error && <p className="text-xs mb-3" style={{ color: "#B5433A" }}>{error}</p>}
            <button
              type="submit"
              disabled={!supabaseReady || sending}
              className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold"
              style={{ background: ACCENT, color: "#FFFFFF", opacity: sending ? 0.7 : 1 }}
            >
              {sending ? "Sending…" : "Send sign-in code"}
              {!sending && <ArrowRight size={15} />}
            </button>
            <p style={{ color: INK, opacity: 0.4 }} className="text-[11px] text-center mt-3">
              No password — we'll email you a 6-digit code instead.
            </p>
            </form>
          </>
        ) : (
          <form onSubmit={handleVerify}>
            <div className="text-center mb-4">
              <Mail size={24} style={{ color: ACCENT, margin: "0 auto 8px" }} />
              <p style={{ color: INK }} className="text-xs">
                Enter the 6-digit code sent to <strong>{email}</strong>
              </p>
            </div>
            <input
              required
              autoFocus
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              maxLength={6}
              className="w-full rounded-lg px-3 py-2.5 text-center text-lg tracking-[0.3em] mb-3 outline-none"
              style={{ border: "1px solid rgba(16,24,40,0.14)", color: INK }}
            />
            {error && <p className="text-xs mb-3 text-center" style={{ color: "#B5433A" }}>{error}</p>}
            <button
              type="submit"
              disabled={verifying}
              className="w-full rounded-lg py-2.5 text-sm font-semibold"
              style={{ background: ACCENT, color: "#FFFFFF", opacity: verifying ? 0.7 : 1 }}
            >
              {verifying ? "Checking…" : "Continue"}
            </button>
            <div className="flex justify-between mt-3">
              <button type="button" onClick={() => { setSent(false); setCode(""); setError(null); }} style={{ color: INK, opacity: 0.5 }} className="text-xs">
                Use a different email
              </button>
              <button
                type="button"
                onClick={handleSendCode}
                disabled={cooldown > 0}
                style={{ color: cooldown > 0 ? "rgba(27,33,41,0.35)" : ACCENT }}
                className="text-xs font-medium"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
