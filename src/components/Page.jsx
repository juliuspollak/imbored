/**
 * Shared Page shell.
 * Provides consistent page background, max-width, horizontal padding,
 * and safe-area handling. `contentMaxWidth` describes the usable content
 * width; Page adds its own horizontal padding outside that measurement.
 */
export default function Page({
  children,
  style: externalStyle,
  maxWidth = "var(--page-max-width)",
  contentMaxWidth,
  ...rest
}) {
  const shellMaxWidth = contentMaxWidth
    ? `calc(${contentMaxWidth} + var(--page-padding-x) + var(--page-padding-x))`
    : maxWidth;

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
          maxWidth: shellMaxWidth,
          padding: "0 var(--page-padding-x)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
