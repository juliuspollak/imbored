import { Home } from "lucide-react";

/** Shared Home control for every game and game-mode screen. */
export default function GameHomeButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="gloss-button nav-btn flex shrink-0 items-center justify-center rounded-full"
      style={{
        "--nav-glow":"rgba(47,111,237,0.35)",
        "--nav-border":"rgba(47,111,237,0.4)",
        position:"fixed",
        top:"max(16px, env(safe-area-inset-top))",
        left:"max(16px, calc((100vw - var(--game-nav-width, 512px)) / 2))",
        zIndex:50,
        width:36,
        height:36,
        minHeight:36,
        padding:0,
        color:"#1B2129",
        background:"rgba(255,255,255,0.9)",
        backdropFilter:"blur(6px)",
        WebkitBackdropFilter:"blur(6px)",
        border:"1px solid rgba(16,24,40,0.12)",
        touchAction:"manipulation",
        WebkitTapHighlightColor:"transparent",
      }}
      aria-label="Home"
      title="Home"
    >
      <Home size={17} />
    </button>
  );
}
