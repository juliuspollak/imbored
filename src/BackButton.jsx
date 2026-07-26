import { ArrowLeft } from "lucide-react";

/** The shared back navigation control used by page headers. */
export default function BackButton({ onClick, ariaLabel = "Back to home", className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`nav-btn flex shrink-0 items-center justify-center rounded-full ${className}`}
      style={{ background: "rgba(16,24,40,.05)", color: "#1B2129", width: 34, height: 34 }}
      aria-label={ariaLabel}
    >
      <ArrowLeft size={16} />
    </button>
  );
}
