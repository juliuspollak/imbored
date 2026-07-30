import { ArrowLeft } from "lucide-react";

/**
 * Shared back navigation control.
 * Uses global design tokens for automatic light/dark theming.
 */
export default function BackButton({ onClick, ariaLabel = "Back to home", className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`design-back-btn flex shrink-0 items-center justify-center rounded-full ${className}`}
      style={{
        background: "var(--color-surface)",
        color: "var(--color-icon-primary)",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-control)",
        width: 44,
        height: 44,
        cursor: "pointer",
        transition: "transform var(--transition-fast)",
      }}
      aria-label={ariaLabel}
    >
      <ArrowLeft size={20} />
    </button>
  );
}