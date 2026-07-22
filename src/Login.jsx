import { useState } from "react";
import { Mail, ArrowRight } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabaseReady } from "./lib/supabase.js";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";

export default function Login() {
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || sending) return;
    setSending(true);
    setError(null);
    const { error } = await signInWithEmail(email);
    setSending(false);
    if (error) setError(error.message);
    else setSent(true);
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

        {sent ? (
          <div className="text-center py-4">
            <Mail size={28} style={{ color: ACCENT, margin: "0 auto 12px" }} />
            <p style={{ color: INK }} className="text-sm font-medium">Check your email</p>
            <p style={{ color: INK, opacity: 0.5 }} className="text-xs mt-1">
              We sent a sign-in link to {email}. Open it on this device to continue.
            </p>
            <button
              onClick={() => setSent(false)}
              style={{ color: ACCENT }}
              className="text-xs mt-4 font-medium"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
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
              {sending ? "Sending…" : "Send sign-in link"}
              {!sending && <ArrowRight size={15} />}
            </button>
            <p style={{ color: INK, opacity: 0.4 }} className="text-[11px] text-center mt-3">
              No password — we'll email you a one-tap link instead.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
