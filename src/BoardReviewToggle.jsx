import { Eye } from "lucide-react";
import { useI18n } from "./lib/i18n.jsx";
import "./board-review-toggle.css";

/**
 * Floating toggle pill for Solve / Review mode.
 * Uses CSS classes from board-review-toggle.css for the visual pill,
 * but uses design tokens for text color.
 */
export default function BoardReviewToggle({ reviewing, onToggle, disabled = false }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="brt-button"
      aria-pressed={reviewing}
      aria-label={reviewing ? t("common.solve", "Solve") : t("common.review", "Review")}
      style={{
        color: reviewing ? "var(--color-text-primary)" : "var(--color-text-secondary)",
      }}
    >
      <Eye size={14} />
      <span>{reviewing ? t("common.solve", "Solve") : t("common.review", "Review")}</span>
    </button>
  );
}