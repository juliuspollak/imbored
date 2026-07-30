/**
 * Shared Card component.
 * variant: "default" (white card with border + shadow), "interactive" (adds hover/press).
 */
export default function Card({ variant = "default", children, style: externalStyle, onClick, ...rest }) {
  const isInteractive = variant === "interactive";
  const baseStyle = {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-4)",
    boxShadow: "var(--shadow-card)",
    transition: isInteractive ? "transform var(--transition-fast), box-shadow var(--transition-fast)" : undefined,
    cursor: isInteractive && onClick ? "pointer" : undefined,
  };

  return (
    <div
      className="design-card"
      style={{ ...baseStyle, ...externalStyle }}
      onClick={onClick}
      {...rest}
    >
      {children}
    </div>
  );
}