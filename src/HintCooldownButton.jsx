export default function HintCooldownButton({ cooldown, label = "Hint", onClick, disabled = false }) {
  const cooling = !!cooldown?.locked;
  const unavailable = disabled || cooling;
  const progress = cooling ? Math.max(0, Math.min(1, cooldown?.progress ?? 0)) : disabled ? 0 : 1;
  const percent = Math.round(progress * 100);
  const accessibleLabel = cooling
    ? `${label} available in ${cooldown.remaining} second${cooldown.remaining === 1 ? "" : "s"}`
    : label;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={unavailable}
      aria-label={accessibleLabel}
      aria-disabled={unavailable}
      data-disabled-by-game={disabled ? "true" : "false"}
      className={`hint-liquid-button gloss-button flex-1 rounded-lg py-2 text-xs font-semibold${cooling ? " is-filling" : ""}`}
      style={{ "--hint-fill": `${percent}%` }}
    >
      <span className="hint-liquid-fill" aria-hidden="true">
        <span className="hint-liquid-wave" />
      </span>
      <span className="hint-liquid-label">{label}</span>
      <style>{`
        .hint-liquid-button {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          cursor: pointer;
          color: var(--color-text-primary);
          background: rgba(16,24,40,.06);
          transition: transform .16s ease, box-shadow .2s ease, border-color .2s ease;
        }
        .hint-liquid-button:disabled,
        .game-toolbar .hint-liquid-button:disabled {
          cursor: default;
          opacity: 1 !important;
          filter: none !important;
          color: var(--color-text-primary) !important;
          background: var(--color-border) !important;
        }
        .hint-liquid-fill {
          position: absolute;
          z-index: -1;
          inset: 0 auto 0 0;
          width: var(--hint-fill);
          overflow: hidden;
          background: linear-gradient(90deg, #78A7FF 0%, #4D83ED 62%, var(--color-primary) 100%);
          box-shadow: inset -5px 0 12px rgba(255,255,255,.32);
          transition: width 1s linear;
        }
        .hint-liquid-wave {
          position: absolute;
          top: -35%;
          right: -9px;
          width: 18px;
          height: 170%;
          border-radius: 45%;
          background: rgba(255,255,255,.30);
          animation: hint-liquid-wave 1.7s ease-in-out infinite;
        }
        .hint-liquid-label {
          position: relative;
          z-index: 1;
          text-shadow: 0 1px 0 rgba(255,255,255,.48);
        }
        .hint-liquid-button:not(.is-filling):not(:disabled) {
          color: #fff;
          box-shadow: 0 6px 16px rgba(47,111,237,.22), inset 0 1px 0 rgba(255,255,255,.35);
        }
        @keyframes hint-liquid-wave {
          0%, 100% { transform: translateX(-1px) rotate(0deg) scaleY(1); }
          50% { transform: translateX(3px) rotate(8deg) scaleY(1.08); }
        }
        [data-theme="dark"] .hint-liquid-button,
        [data-theme="dark"] .hint-liquid-button:disabled {
          color: var(--color-text-primary) !important;
          background: rgba(255,255,255,.07) !important;
          border-color: var(--color-border) !important;
        }
        [data-theme="dark"] .game-toolbar .hint-liquid-button[data-disabled-by-game="true"] {
          color: var(--color-disabled-text) !important;
          background: rgba(255,255,255,.035) !important;
          border-color: var(--color-border) !important;
          box-shadow: none !important;
        }
        [data-theme="dark"] .game-toolbar .hint-liquid-button[data-disabled-by-game="true"] .hint-liquid-fill { display: none; }
        [data-theme="dark"] .hint-liquid-label { text-shadow: 0 1px 1px rgba(0,0,0,.32); }
        [data-theme="dark"] .hint-liquid-button:not(.is-filling):not(:disabled) { color: #fff; }
        @media (prefers-reduced-motion: reduce) {
          .hint-liquid-fill { transition: none; }
          .hint-liquid-wave { animation: none; }
        }
      `}</style>
    </button>
  );
}
