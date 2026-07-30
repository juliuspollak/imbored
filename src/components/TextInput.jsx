import { forwardRef } from "react";

/**
 * Shared TextInput component.
 * Props: all native <input> attrs, plus error (boolean/string).
 */
const TextInput = forwardRef(function TextInput({ error, style: externalStyle, ...rest }, ref) {
  const baseStyle = {
    width: "100%",
    height: "var(--control-height-lg)",
    padding: "0 var(--space-4)",
    fontSize: "var(--text-input-size)",
    fontFamily: "inherit",
    color: "var(--color-text-primary)",
    background: "var(--color-surface-input)",
    border: `1px solid ${error ? "var(--color-danger-text)" : "var(--color-border-strong)"}`,
    borderRadius: "var(--radius-md)",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color var(--transition-fast), box-shadow var(--transition-fast)",
  };

  const mergedStyle = { ...baseStyle, ...externalStyle };

  return (
    <input
      ref={ref}
      className="design-input"
      style={mergedStyle}
      {...rest}
    />
  );
});

export default TextInput;