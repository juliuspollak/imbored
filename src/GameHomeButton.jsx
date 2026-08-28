import { Home } from "lucide-react";

/** Shared Home control for every game and game-mode screen. */
export default function GameHomeButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="nav-btn flex shrink-0 items-center justify-center rounded-full"
      style={{
        position: "fixed",
        top: "max(var(--global-player-bubble-offset), env(safe-area-inset-top))",
        left: "max(16px, calc((100vw - var(--game-nav-width, 512px)) / 2))",
        zIndex: 250,
        width: "var(--control-height-md)",
        height: "var(--control-height-md)",
        minHeight: "var(--control-height-md)",
        padding: 0,
        color: "var(--color-icon-primary)",
        background: "var(--color-surface)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        border: "1px solid var(--color-border)",
        borderRadius: "50%",
        boxShadow: "var(--shadow-control)",
        cursor: "pointer",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        fontFamily: "inherit",
        transition: "transform var(--transition-fast)",
      }}
      aria-label="Home"
      title="Home"
    >
      <Home size={17} />
      <style>{`.nav-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }`}</style>
    </button>
  );
}
