import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { useI18n } from "./lib/i18n.jsx";

// The per-result breakdown on the solved panel answers "why did I get this
// score?". This answers "how does scoring work at all?" — reachable before you
// have finished anything, and the permanent home for the fact that hints and
// mistakes cost time rather than points.
//
// Figures come from the live reward_rules row so this cannot drift from the
// database the way hardcoded copy would.
export default function ScoringGuide({ rules }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const base = Number(rules?.base_points) || 6;
  const practicePercent = Number(rules?.practice_points_percent) || 50;
  const practiceLimit = Number(rules?.practice_daily_limit) || 3;
  const streakBonus = Number(rules?.streak_weekly_bonus) || 20;

  const sections = [
    ["guide.scale", t("guide.scaleDetail")],
    ["guide.finishing", t("guide.finishingDetail", { base })],
    ["guide.accuracy", t("guide.accuracyDetail")],
    ["guide.weekday", t("guide.weekdayDetail")],
    ["guide.speed", t("guide.speedDetail")],
    ["guide.hints", t("guide.hintsDetail")],
    ["guide.practice", t("guide.practiceDetail", { percent: practicePercent, limit: practiceLimit })],
    ["guide.streak", t("guide.streakDetail", { bonus: streakBonus })],
  ];

  return (
    <div style={{ borderRadius: "var(--radius-lg)", marginBottom: "var(--space-3)", overflow: "hidden", background: "var(--color-info-bg)" }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="scoring-guide-detail"
        style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%", padding: "var(--space-3)", border: "none", background: "transparent", color: "var(--color-text-primary)", font: "inherit", textAlign: "left", cursor: "pointer" }}
      >
        <Info size={14} style={{ color: "var(--color-primary)", flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: "var(--text-caption-size)", fontWeight: 700 }}>{t("guide.title")}</span>
        <ChevronDown size={14} style={{ color: "var(--color-text-secondary)", transform: open ? "rotate(180deg)" : "none", transition: "transform var(--transition-fast)" }} />
      </button>

      {open && (
        <div id="scoring-guide-detail" style={{ padding: "0 var(--space-3) var(--space-3)" }}>
          {sections.map(([headingKey, detail]) => (
            <div key={headingKey} style={{ marginBottom: "var(--space-3)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-primary)" }}>{t(headingKey)}</div>
              <div style={{ fontSize: 11, lineHeight: 1.5, marginTop: 2, color: "var(--color-text-secondary)" }}>{detail}</div>
            </div>
          ))}
          <div style={{ paddingTop: "var(--space-2)", borderTop: "1px solid var(--color-border)", fontSize: 10, lineHeight: 1.5, color: "var(--color-text-muted)" }}>
            {t("guide.footer")}
          </div>
        </div>
      )}
    </div>
  );
}
