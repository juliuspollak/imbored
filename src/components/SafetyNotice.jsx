import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n.jsx";
import StatusBanner from "./StatusBanner.jsx";
import Button from "./Button.jsx";

// Lives above individual screens so closing a blocked conversation cannot
// unmount its confirmation. No timer: the user can read it at their own pace.
export default function SafetyNotice() {
  const { t } = useI18n();
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    const blocked = event => setNotice(event.detail?.reported ? "safety.reportedSuccess" : "safety.blockedSuccess");
    const openSafety = () => setNotice(null);
    window.addEventListener("player-blocked", blocked);
    window.addEventListener("open-account-safety", openSafety);
    return () => {
      window.removeEventListener("player-blocked", blocked);
      window.removeEventListener("open-account-safety", openSafety);
    };
  }, []);
  if (!notice) return null;
  return <aside aria-label={t("account.safetyTitle")} style={{ position: "fixed", bottom: "max(16px, env(safe-area-inset-bottom))", left: 16, right: 16, maxWidth: 460, margin: "0 auto", zIndex: 120 }}>
    <StatusBanner variant="success">
      <div role="status" aria-live="polite" aria-atomic="true">
        <strong>{t(notice)}</strong><div>{t("safety.manageHint")}</div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        <Button variant="secondary" style={{ minHeight: 44 }} onClick={() => window.dispatchEvent(new Event("open-account-safety"))}>{t("account.blockedPlayers")}</Button>
        <Button variant="ghost" style={{ minHeight: 44 }} onClick={() => setNotice(null)}>{t("safety.close")}</Button>
      </div>
    </StatusBanner>
  </aside>;
}
