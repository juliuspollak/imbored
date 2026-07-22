import { Swords, Coffee } from "lucide-react";

const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";

// Floating badge shown while actually playing a puzzle (both the
// challenge-mode play screen and practice mode) — shows which mode you're
// in and lets you switch without backing all the way out to Home first.
export default function ModePill({ mode, onSwitch }) {
  const isChallenge = mode === "challenge";
  return (
    <button
      onClick={onSwitch}
      className="nav-btn flex items-center gap-1.5 rounded-full pl-2.5 pr-3 py-1.5"
      style={{
        "--nav-glow": isChallenge ? "rgba(217,174,88,0.35)" : "rgba(18,148,106,0.35)",
        "--nav-border": isChallenge ? "rgba(217,174,88,0.4)" : "rgba(18,148,106,0.4)",
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 50,
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(16,24,40,0.12)",
        color: INK,
      }}
    >
      {isChallenge ? <Swords size={13} style={{ color: "#D9AE58" }} /> : <Coffee size={13} style={{ color: "#12946A" }} />}
      <span className="text-xs font-semibold">{isChallenge ? "Challenge" : "Practice"}</span>
    </button>
  );
}
