import { Swords, Coffee } from "lucide-react";

const PANEL = "#FFFFFF";
const INK = "#1B2129";

// Floating switch shown while playing. The label describes the destination
// so a Practice screen offers “Challenge”, and vice versa.
export default function ModePill({ mode, onSwitch }) {
  const targetIsChallenge = mode !== "challenge";
  return (
    <button
      onClick={onSwitch}
      className="nav-btn flex items-center gap-1.5 rounded-full pl-2.5 pr-3 py-1.5"
      style={{
        "--nav-glow": targetIsChallenge ? "rgba(217,174,88,0.35)" : "rgba(18,148,106,0.35)",
        "--nav-border": targetIsChallenge ? "rgba(217,174,88,0.4)" : "rgba(18,148,106,0.4)",
        position: "fixed",
        top: 16,
        right: "max(16px, calc((100vw - var(--game-nav-width, 512px)) / 2))",
        zIndex: 50,
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(16,24,40,0.12)",
        color: INK,
      }}
    >
      {targetIsChallenge ? <Swords size={13} style={{ color: "#D9AE58" }} /> : <Coffee size={13} style={{ color: "#12946A" }} />}
      <span className="text-xs font-semibold">{targetIsChallenge ? "Challenge" : "Practice"}</span>
    </button>
  );
}
