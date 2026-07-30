import { Swords, Coffee } from "lucide-react";
import { useI18n } from "./lib/i18n.jsx";

export default function ModePill({ mode, onSwitch }) {
  const { t } = useI18n();
  const targetIsChallenge = mode !== "challenge";
  return (
    <button
      onClick={onSwitch}
      style={{
        position: "fixed",
        top: 16,
        right: "max(16px, calc((100vw - var(--game-nav-width, 512px)) / 2))",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: 6,
        borderRadius: "var(--radius-full)",
        padding: "6px 12px 6px 10px",
        background: "var(--color-surface)",
        backdropFilter: "blur(6px)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text-primary)",
        boxShadow: "var(--shadow-control)",
        fontFamily: "inherit",
        fontSize: "var(--text-caption-size)",
        fontWeight: 600,
        cursor: "pointer",
        transition: "transform var(--transition-fast)",
      }}
    >
      {targetIsChallenge ? <Swords size={13} style={{ color: "var(--color-warning-gold)" }} /> : <Coffee size={13} style={{ color: "var(--color-success-text)" }} />}
      <span className="text-xs font-semibold">{targetIsChallenge ? t("common.challenge") : t("common.practice")}</span>
    </button>
  );
}