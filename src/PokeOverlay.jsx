import { useEffect, useRef } from "react";

const AUTO_DISMISS_MS = 3200;

export default function PokeOverlay({ poke, onDismiss }) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!poke) return undefined;
    const timer = window.setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [poke]);

  if (!poke) return null;

  return (
    <div className="poke-notification-layer">
      <style>{`
        @keyframes pokeSlideIn {
          from { transform: translate3d(0, -12px, 0) scale(.96); opacity: 0; }
          to { transform: translate3d(0, 0, 0) scale(1); opacity: 1; }
        }
        .poke-notification-layer {
          position: fixed;
          z-index: 200;
          top: max(16px, env(safe-area-inset-top));
          right: max(16px, env(safe-area-inset-right));
          width: min(340px, calc(100vw - 32px));
          pointer-events: none;
        }
        .poke-notification {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 12px 12px 12px 14px;
          color: #1B2129;
          background: rgba(255, 255, 255, .96);
          border: 1px solid rgba(255, 255, 255, .9);
          border-radius: 16px;
          box-shadow: 0 12px 32px rgba(16, 24, 40, .18);
          backdrop-filter: blur(12px);
          animation: pokeSlideIn .25s cubic-bezier(.2, .8, .2, 1);
          pointer-events: auto;
        }
        .poke-notification__icon {
          display: grid;
          place-items: center;
          flex: 0 0 34px;
          width: 34px;
          height: 34px;
          border-radius: 11px;
          background: #fff3cf;
          font-size: 18px;
        }
        .poke-notification__message {
          flex: 1;
          min-width: 0;
          font-size: 14px;
          font-weight: 650;
          line-height: 1.35;
        }
        .poke-notification__dismiss {
          flex: 0 0 auto;
          width: 32px;
          height: 32px;
          padding: 0;
          border: 0;
          border-radius: 10px;
          color: #667085;
          background: transparent;
          font: 700 20px/1 system-ui, sans-serif;
          cursor: pointer;
        }
        .poke-notification__dismiss:hover,
        .poke-notification__dismiss:focus-visible {
          color: #1B2129;
          background: rgba(16, 24, 40, .07);
          outline: none;
        }
        @media (max-width: 520px) {
          .poke-notification-layer {
            top: max(10px, env(safe-area-inset-top));
            right: 10px;
            width: calc(100vw - 20px);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .poke-notification { animation: none; }
        }
      `}</style>
      <div className="poke-notification" role="status" aria-live="polite" aria-atomic="true">
        <span className="poke-notification__icon" aria-hidden="true">👋</span>
        <span className="poke-notification__message">{poke.message}</span>
        <button
          type="button"
          className="poke-notification__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss poke"
        >
          ×
        </button>
      </div>
    </div>
  );
}
