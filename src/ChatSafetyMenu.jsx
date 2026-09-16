import { useRef, useState } from "react";
import { Ban, Flag, MoreVertical, X } from "lucide-react";
import { supabase } from "./lib/supabase.js";
import { useI18n } from "./lib/i18n.jsx";
import { completeSafetyAction } from "./lib/safetyActions.js";
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

export default function ChatSafetyMenu({ peerId, peerName, messageId = null, onBlocked }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // null | "report" | "block"
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const displayName = peerName || t("safety.player");

  function close() {
    if (pending.current) return;
    setOpen(false);
    setMode(null);
    setDetails("");
    setError("");
  }

  async function submit(reported) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await completeSafetyAction(() => reported
        ? supabase.rpc("report_content", {
          target_user_id: peerId,
          target_message_id: messageId,
          report_reason: reason,
          report_details: details.trim() || null,
        })
        : supabase.rpc("block_player", { target_user_id: peerId }), () => {
          window.dispatchEvent(new CustomEvent("player-blocked", { detail: { playerId: peerId, reported } }));
          pending.current = false;
          close();
          onBlocked?.({ reported });
        });
    } catch (failure) {
      setError(failure?.message || t(reported ? "safety.reportFailed" : "safety.blockFailed"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("safety.options", { name: displayName })}
        style={{ display: "grid", placeItems: "center", width: 44, height: 44, flexShrink: 0, borderRadius: "50%", border: "none", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}
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
              <button type="button" disabled={busy} onClick={close} aria-label={t("safety.close")} style={{ display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: "50%", border: "none", background: "var(--color-surface-elevated)", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                <X size={16} />
              </button>
            </div>

            {error && <div role="alert" style={{ marginBottom: "var(--space-3)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-caption-size)", background: "var(--color-danger-bg)", color: "var(--color-danger-text)" }}>{error}</div>}

            {mode === null && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <Button variant="ghost" fullWidth before={<Flag size={15} />} onClick={() => setMode("report")}>{messageId ? "Report message & block" : "Report & Block"}</Button>
                <Button variant="ghost" fullWidth before={<Ban size={15} />} onClick={() => setMode("block")}>{t("safety.block")}</Button>
                <p style={{ margin: "var(--space-2) 0 0", fontSize: 11, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
                  {t("safety.note")}
                </p>
              </div>
            )}

            {mode === "report" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {REPORT_REASONS.map(([id, labelKey]) => (
                  <label key={id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minHeight: 44, borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-body-secondary-size)", cursor: "pointer", background: reason === id ? "var(--color-primary-subtle)" : "var(--color-surface-elevated)", border: `1px solid ${reason === id ? "var(--color-primary-subtle-border)" : "transparent"}` }}>
                    <input type="radio" name="report-reason" disabled={busy} checked={reason === id} onChange={() => setReason(id)} />
                    {t(labelKey)}
                  </label>
                ))}
                <textarea
                  disabled={busy}
                  value={details}
                  onChange={(event) => setDetails(event.target.value.slice(0, 1000))}
                  placeholder={t("safety.detailsPlaceholder")}
                  rows={3}
                  style={{ marginTop: "var(--space-1)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2) var(--space-3)", fontFamily: "inherit", fontSize: "var(--text-body-secondary-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", resize: "vertical" }}
                />
                <Button variant="primary" fullWidth loading={busy} onClick={() => submit(true)}>{"Report & Block"}</Button>
                <Button variant="ghost" fullWidth disabled={busy} onClick={() => setMode(null)}>{t("safety.back")}</Button>
              </div>
            )}

            {mode === "block" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <p style={{ margin: 0, fontSize: "var(--text-body-secondary-size)", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
                  {t("safety.blockExplain")}
                </p>
                <Button variant="primary" fullWidth loading={busy} onClick={() => submit(false)}>{t("safety.confirmBlock", { name: displayName })}</Button>
                <Button variant="ghost" fullWidth disabled={busy} onClick={() => setMode(null)}>{t("safety.cancel")}</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
