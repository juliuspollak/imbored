import { Clock3, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { useI18n } from "./lib/i18n.jsx";
import Page from "./components/Page.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";

export default function PendingApproval() {
  const { t } = useI18n();
  const { profile, signOut, refreshProfile } = useAuth();
  return (
    <Page style={{ alignItems: "center", justifyContent: "center" }}>
      <Card style={{ textAlign: "center", padding: "var(--space-6)" }}>
        <div style={{ margin: "0 auto var(--space-4)", width: 64, height: 64, borderRadius: "var(--radius-lg)", background: "var(--color-info-bg)", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Clock3 size={30} />
        </div>
        <div style={{ fontSize: "var(--text-caption-size)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px", marginBottom: "var(--space-2)", color: "var(--color-primary)" }}>{t("pending.label")}</div>
        <h1 style={{ fontSize: "var(--text-page-title-size)", fontWeight: 700, marginBottom: "var(--space-3)", color: "var(--color-text-primary)" }}>{t("pending.title", { name: profile?.name || t("common.player") })}</h1>
        <p style={{ fontSize: "var(--text-body-size)", lineHeight: 1.5, marginBottom: "var(--space-5)", color: "var(--color-text-secondary)" }}>{t("pending.body")}</p>
        <div style={{ borderRadius: "var(--radius-lg)", padding: "var(--space-3)", marginBottom: "var(--space-5)", display: "flex", alignItems: "flex-start", gap: "var(--space-3)", textAlign: "left", background: "var(--color-info-bg)" }}>
          <ShieldCheck size={18} style={{ color: "var(--color-primary)", marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: "var(--text-caption-size)", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>{t("pending.auto")}</div>
        </div>
        <Button variant="primary" fullWidth onClick={refreshProfile} style={{ marginBottom: "var(--space-2)" }}>{t("pending.check")}</Button>
        <Button variant="ghost" fullWidth before={<LogOut size={15} />} onClick={signOut}>{t("common.signOut")}</Button>
      </Card>
    </Page>
  );
}