import { Clock3, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { useI18n } from "./lib/i18n.jsx";

export default function PendingApproval() {
  const { t } = useI18n();
  const { profile, signOut, refreshProfile } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center p-5" style={{ background: "#F1F3F7", fontFamily: "'Inter',sans-serif" }}>
      <div className="w-full max-w-sm rounded-3xl p-6 text-center" style={{ background: "#fff", border: "1px solid rgba(16,24,40,.08)" }}>
        <div className="mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ width: 64, height: 64, background: "rgba(47,111,237,.1)", color: "#2F6FED" }}>
          <Clock3 size={30} />
        </div>
        <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#2F6FED" }}>{t("pending.label")}</div>
        <h1 className="text-2xl font-bold mb-3" style={{ fontFamily: "'Fredoka',sans-serif", color: "#1B2129" }}>{t("pending.title", { name:profile?.name || t("common.player") })}</h1>
        <p className="text-sm leading-6 mb-5" style={{ color: "rgba(27,33,41,.62)" }}>{t("pending.body")}</p>
        <div className="rounded-2xl p-3 mb-5 flex items-start gap-3 text-left" style={{ background: "rgba(47,111,237,.06)" }}>
          <ShieldCheck size={18} style={{ color: "#2F6FED", marginTop: 1, flexShrink: 0 }} />
          <div className="text-xs leading-5" style={{ color: "rgba(27,33,41,.68)" }}>{t("pending.auto")}</div>
        </div>
        <button onClick={refreshProfile} className="w-full rounded-xl py-3 text-sm font-semibold text-white mb-2" style={{ background: "#2F6FED" }}>{t("pending.check")}</button>
        <button onClick={signOut} className="w-full rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2" style={{ background: "rgba(16,24,40,.05)", color: "#1B2129" }}><LogOut size={15}/>{t("common.signOut")}</button>
      </div>
    </div>
  );
}
