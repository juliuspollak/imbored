/**
 * Shared Page shell.
 * Provides consistent page background, max-width, horizontal padding,
 * and safe-area handling.
 */
export default function Page({ children, style: externalStyle, ...rest }) {
  return (
    <div
      className="design-page"
      style={{
        background: "var(--color-page-bg)",
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        fontFamily: "var(--font-family)",
        ...externalStyle,
      }}
      {...rest}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "var(--page-max-width)",
          padding: "0 var(--page-padding-x)",
        }}
      >
        {children}
      </div>
    </div>
  );
}