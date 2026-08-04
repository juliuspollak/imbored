import { useState } from "react";
import { Ban, Flag, MoreVertical, X } from "lucide-react";
import { supabase } from "./lib/supabase.js";
import { useI18n } from "./lib/i18n.jsx";
import Button from "./components/Button.jsx";

// App Store guideline 1.2 requires an app with user-generated content to offer
// both a report mechanism and a way to block another user. Reporting also
// blocks server-side, so the reporter is out of the conversation immediately
// rather than waiting for a moderator.
const REPORT_REASONS = [
  ["harassment", "safety.reasonHarassment"],
  ["abuse", "safety.reasonAbuse"],
  ["sexual", "safety.reasonSexual"],
  ["spam", "safety.reasonSpam"],
  ["other", "safety.reasonOther"],
];

export default function ChatSafetyMenu({ peerId, peerName, onBlocked }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // null | "report" | "block"
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const displayName = peerName || t("safety.player");

  function close() {
    setOpen(false);
    setMode(null);
    setDetails("");
    setError("");
  }

  async function submitReport() {
    setBusy(true);
    setError("");
    const { error: reportError } = await supabase.rpc("report_content", {
      target_user_id: peerId,
      target_message_id: null,
      report_reason: reason,
      report_details: details.trim() || null,
    });
    setBusy(false);
    if (reportError) { setError(reportError.message || t("safety.reportFailed")); return; }
    close();
    onBlocked?.({ reported: true });
  }

  async function submitBlock() {
    setBusy(true);
    setError("");
    const { error: blockError } = await supabase.rpc("block_player", { target_user_id: peerId });
    setBusy(false);
    if (blockError) { setError(blockError.message || t("safety.blockFailed")); return; }
    close();
    onBlocked?.({ reported: false });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("safety.options", { name: displayName })}
        style={{ display: "grid", placeItems: "center", width: 34, height: 34, flexShrink: 0, borderRadius: "50%", border: "none", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}
      >
        <MoreVertical size={18} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("account.safetyTitle")}
          onClick={(event) => { if (event.target === event.currentTarget) close(); }}
          style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,.45)" }}
        >
          <div style={{ width: "100%", maxWidth: 460, maxHeight: "85vh", overflowY: "auto", borderRadius: "var(--radius-lg) var(--radius-lg) 0 0", padding: "var(--space-4)", paddingBottom: "max(var(--space-4), var(--safe-bottom))", background: "var(--color-surface)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
              <strong style={{ flex: 1, fontSize: "var(--text-body-size)" }}>
                {mode === "report"
                  ? t("safety.reportTitle")
                  : mode === "block"
                    ? t("safety.blockTitle", { name: displayName })
                    : peerName || t("common.player")}
              </strong>
              <button type="button" onClick={close} aria-label={t("safety.close")} style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: "50%", border: "none", background: "var(--color-surface-elevated)", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                <X size={16} />
              </button>
            </div>

            {error && <div role="alert" style={{ marginBottom: "var(--space-3)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-caption-size)", background: "var(--color-danger-bg)", color: "var(--color-danger-text)" }}>{error}</div>}

            {mode === null && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <Button variant="ghost" fullWidth before={<Flag size={15} />} onClick={() => setMode("report")}>{t("safety.report")}</Button>
                <Button variant="ghost" fullWidth before={<Ban size={15} />} onClick={() => setMode("block")}>{t("safety.block")}</Button>
                <p style={{ margin: "var(--space-2) 0 0", fontSize: 11, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
                  {t("safety.note")}
                </p>
              </div>
            )}

            {mode === "report" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {REPORT_REASONS.map(([id, labelKey]) => (
                  <label key={id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-body-secondary-size)", cursor: "pointer", background: reason === id ? "var(--color-primary-subtle)" : "var(--color-surface-elevated)", border: `1px solid ${reason === id ? "var(--color-primary-subtle-border)" : "transparent"}` }}>
                    <input type="radio" name="report-reason" checked={reason === id} onChange={() => setReason(id)} />
                    {t(labelKey)}
                  </label>
                ))}
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value.slice(0, 1000))}
                  placeholder={t("safety.detailsPlaceholder")}
                  rows={3}
                  style={{ marginTop: "var(--space-1)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2) var(--space-3)", fontFamily: "inherit", fontSize: "var(--text-body-secondary-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", resize: "vertical" }}
                />
                <Button variant="primary" fullWidth loading={busy} onClick={submitReport}>{t("safety.sendReport")}</Button>
                <Button variant="ghost" fullWidth onClick={() => setMode(null)}>{t("safety.back")}</Button>
              </div>
            )}

            {mode === "block" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <p style={{ margin: 0, fontSize: "var(--text-body-secondary-size)", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
                  {t("safety.blockExplain")}
                </p>
                <Button variant="primary" fullWidth loading={busy} onClick={submitBlock}>{t("safety.confirmBlock", { name: displayName })}</Button>
                <Button variant="ghost" fullWidth onClick={() => setMode(null)}>{t("safety.cancel")}</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
