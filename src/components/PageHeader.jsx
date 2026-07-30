import { ArrowLeft } from "lucide-react";

/**
 * Shared page header.
 * Props:
 *   title, subtitle, onBack (if provided, renders back button),
 *   action (ReactNode, e.g. <Button>New circle</Button>),
 *   backAriaLabel (optional)
 */
export default function PageHeader({ title, subtitle, onBack, action, backAriaLabel = "Back" }) {
  return (
    <header
      className="design-page-header"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-3)",
        padding: "var(--space-5) 0 var(--space-4)",
      }}
    >
      <div className="design-page-header-main" style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backAriaLabel}
            className="design-back-btn"
            style={{
              width: "var(--control-height-md)",
              height: "var(--control-height-md)",
              borderRadius: "50%",
              background: "var(--color-surface)",
              color: "var(--color-icon-primary)",
              border: "none",
              boxShadow: "var(--shadow-control)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              transition: "transform var(--transition-fast)",
            }}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              fontSize: "var(--text-page-title-size)",
              fontWeight: "var(--text-page-title-weight)",
              lineHeight: "var(--text-page-title-line)",
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              style={{
                fontSize: "var(--text-page-subtitle-size)",
                fontWeight: "var(--text-page-subtitle-weight)",
                color: "var(--color-text-muted)",
                margin: "2px 0 0 0",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && <div className="design-page-header-action" style={{ flexShrink: 0 }}>{action}</div>}
      <style>{`
        @media (max-width: 600px) {
          .design-page-header {
            padding-right: var(--global-header-safe-right) !important;
          }
        }
        .design-back-btn:active { transform: scale(0.97); }
        .design-back-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
        [data-theme="dark"] .design-back-btn { border: 1px solid var(--color-border); box-shadow: var(--shadow-control); }
      `}</style>
    </header>
  );
}
