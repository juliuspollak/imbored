import { CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const VARIANTS = {
  success: { bg: "var(--color-success-bg)", color: "var(--color-success-text)", border: "var(--color-success-border)" },
  error: { bg: "var(--color-danger-bg)", color: "var(--color-danger-text)", border: "var(--color-danger-text)" },
  warning: { bg: "var(--color-warning-bg)", color: "var(--color-warning-text)", border: "var(--color-warning-border)" },
  info: { bg: "var(--color-info-bg)", color: "var(--color-info-text)", border: "var(--color-info-text)" },
};

/**
 * Shared StatusBanner component.
 * variant: "success" | "error" | "warning" | "info"
 * dismissible: show a close button
 * onDismiss: callback when dismissed
 */
export default function StatusBanner({ variant = "info", children, dismissible = false, onDismiss, style: externalStyle }) {
  const colors = VARIANTS[variant] || VARIANTS.info;
  const Icon = ICONS[variant] || ICONS.info;

  return (
    <div
      className="design-status-banner"
      style={{
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3)",
        fontSize: "var(--text-body-secondary-size)",
        background: colors.bg,
        color: colors.color,
        border: `1px solid ${colors.border}`,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        animation: "ds-banner-in var(--transition-normal)",
        ...externalStyle,
      }}
    >
      <Icon size={15} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{children}</span>
      {dismissible && onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            background: "transparent",
            border: "none",
            color: "inherit",
            fontSize: 16,
            cursor: "pointer",
            padding: "0 4px",
            lineHeight: 1,
            opacity: 0.7,
          }}
        >
          ✕
        </button>
      )}
      <style>{`@keyframes ds-banner-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}