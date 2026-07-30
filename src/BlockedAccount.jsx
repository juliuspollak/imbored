import { ShieldX } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { useI18n } from "./lib/i18n.jsx";
import Page from "./components/Page.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";

export default function BlockedAccount() {
  const { t } = useI18n();
  const { profile, signOut } = useAuth();
  return (
    <Page style={{ alignItems: "center", justifyContent: "center" }}>
      <Card style={{ textAlign: "center", padding: "var(--space-6)" }}>
        <div style={{ margin: "0 auto var(--space-4)", width: 64, height: 64, borderRadius: "50%", background: "var(--color-danger-bg)", color: "var(--color-danger-text)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ShieldX size={30} />
        </div>
        <h1 style={{ fontSize: "var(--text-page-title-size)", fontWeight: 700, marginBottom: "var(--space-2)", color: "var(--color-text-primary)" }}>{t("blocked.title")}</h1>
        <p style={{ fontSize: "var(--text-body-size)", marginBottom: "var(--space-2)", color: "var(--color-text-secondary)" }}>{t("blocked.body")}</p>
        {profile?.blocked_reason && (
          <p style={{ fontSize: "var(--text-caption-size)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", marginBottom: "var(--space-5)", background: "var(--color-danger-bg)", color: "var(--color-danger-text)" }}>
            {profile.blocked_reason}
          </p>
        )}
        <Button variant="primary" fullWidth onClick={signOut}>{t("common.signOut")}</Button>
      </Card>
    </Page>
  );
}