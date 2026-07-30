import { forwardRef } from "react";

/**
 * Shared Button component.
 *
 * Variants:
 *   primary   – main action (blue fill)
 *   secondary – subdued action (light bg + blue border)
 *   ghost     – transparent with subtle hover
 *   danger    – destructive (red)
 *   icon      – 40×40px square with border (for overflow menus etc.)
 *
 * Props:
 *   variant, size ("sm"|"md"|"lg"), fullWidth, loading, disabled,
 *   before/after icon slots, plus all native <button> attrs.
 */
const Button = forwardRef(function Button(
  {
    variant = "primary",
    size = "md",
    fullWidth = false,
    loading = false,
    disabled = false,
    children,
    before,
    after,
    onClick,
    type = "button",
    style: externalStyle,
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading;
  const heights = { sm: "var(--control-height-sm)", md: "var(--control-height-md)", lg: "var(--control-height-lg)" };

  const baseStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    height: heights[size],
    padding: variant === "icon" ? "0" : size === "sm" ? "0 12px" : size === "lg" ? "0 20px" : "0 16px",
    fontSize: "var(--text-button-size)",
    fontWeight: "var(--text-button-weight)",
    fontFamily: "inherit",
    lineHeight: 1,
    whiteSpace: "nowrap",
    borderRadius: "var(--radius-md)",
    border: "none",
    cursor: isDisabled ? "not-allowed" : "pointer",
    opacity: isDisabled ? 0.5 : 1,
    transition: "transform var(--transition-fast), box-shadow var(--transition-fast), background var(--transition-fast)",
    width: fullWidth ? "100%" : undefined,
    position: "relative",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
  };

  const variantStyles = {
    primary: {
      background: isDisabled ? "var(--color-disabled-bg)" : "var(--color-primary)",
      color: isDisabled ? "var(--color-disabled-text)" : "var(--color-primary-text)",
      boxShadow: isDisabled ? "none" : "var(--shadow-primary)",
    },
    secondary: {
      background: isDisabled ? "var(--color-disabled-bg)" : "var(--color-primary-subtle)",
      color: isDisabled ? "var(--color-disabled-text)" : "var(--color-primary)",
      border: isDisabled ? "none" : "1px solid var(--color-primary-subtle-border)",
    },
    ghost: {
      background: "transparent",
      color: isDisabled ? "var(--color-disabled-text)" : "var(--color-text-primary)",
    },
    danger: {
      background: isDisabled ? "var(--color-disabled-bg)" : "var(--color-danger-solid)",
      color: isDisabled ? "var(--color-disabled-text)" : "#FFFFFF",
    },
    icon: {
      width: "40px",
      height: "40px",
      minWidth: "40px",
      background: isDisabled ? "var(--color-disabled-bg)" : "var(--color-surface)",
      color: "var(--color-icon-subtle)",
      border: `1px solid ${isDisabled ? "var(--color-border)" : "var(--color-border-strong)"}`,
    },
  };

  const mergedStyle = { ...baseStyle, ...variantStyles[variant], ...externalStyle };

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      className="design-btn"
      style={mergedStyle}
      {...rest}
    >
      {loading && (
        <span
          style={{
            display: "inline-block",
            width: 16,
            height: 16,
            border: "2px solid rgba(255,255,255,0.3)",
            borderTopColor: "#fff",
            borderRadius: "50%",
            animation: "ds-spin 0.6s linear infinite",
            marginRight: children ? 4 : 0,
          }}
        />
      )}
      {!loading && before && <span className="design-btn-before">{before}</span>}
      {variant === "icon" ? children : <span>{children}</span>}
      {!loading && after && <span className="design-btn-after">{after}</span>}
      <style>{`@keyframes ds-spin { to { transform: rotate(360deg); } }
        .design-btn:active:not(:disabled) { transform: scale(0.96); }
        .design-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
        @media (hover: hover) and (pointer: fine) {
          .design-btn:not(:disabled):hover {
            background: ${
              variant === "primary" ? "var(--color-primary-hover)" :
              variant === "danger" ? "#C94A4A" :
              variant === "ghost" ? "rgba(16,24,40,0.04)" :
              variant === "icon" ? "var(--color-surface-elevated)" :
              "var(--color-primary-subtle)"
            } !important;
            ${variant === "icon" ? "border-color: #50617D !important;" : ""}
          }
        }
        [data-theme="dark"] .design-btn:not(:disabled):hover {
          background: ${
            variant === "primary" ? "var(--color-primary-hover)" :
            variant === "danger" ? "#C94A4A" :
            variant === "ghost" ? "rgba(255,255,255,0.04)" :
            variant === "icon" ? "#24304A" :
            "var(--color-primary-subtle)"
          } !important;
          ${variant === "icon" ? "border-color: #50617D !important;" : ""}
          ${variant === "ghost" ? "color: var(--color-text-primary) !important;" : ""}
        }
      `}</style>
    </button>
  );
});

export default Button;