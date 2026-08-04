import { useState } from "react";
import { Ban, Flag, MoreVertical, X } from "lucide-react";
import { supabase } from "./lib/supabase.js";
import Button from "./components/Button.jsx";

// App Store guideline 1.2 requires an app with user-generated content to offer
// both a report mechanism and a way to block another user. Reporting also
// blocks server-side, so the reporter is out of the conversation immediately
// rather than waiting for a moderator.
const REPORT_REASONS = [
  ["harassment", "Harassment or bullying"],
  ["abuse", "Abusive or hateful language"],
  ["sexual", "Sexual or inappropriate content"],
  ["spam", "Spam or scam"],
  ["other", "Something else"],
];

export default function ChatSafetyMenu({ peerId, peerName, onBlocked }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // null | "report" | "block"
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    if (reportError) { setError(reportError.message || "Your report could not be sent."); return; }
    close();
    onBlocked?.({ reported: true });
  }

  async function submitBlock() {
    setBusy(true);
    setError("");
    const { error: blockError } = await supabase.rpc("block_player", { target_user_id: peerId });
    setBusy(false);
    if (blockError) { setError(blockError.message || "This player could not be blocked."); return; }
    close();
    onBlocked?.({ reported: false });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Safety options for ${peerName || "this player"}`}
        style={{ display: "grid", placeItems: "center", width: 34, height: 34, flexShrink: 0, borderRadius: "50%", border: "none", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}
      >
        <MoreVertical size={18} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Safety options"
          onClick={(event) => { if (event.target === event.currentTarget) close(); }}
          style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,.45)" }}
        >
          <div style={{ width: "100%", maxWidth: 460, maxHeight: "85vh", overflowY: "auto", borderRadius: "var(--radius-lg) var(--radius-lg) 0 0", padding: "var(--space-4)", paddingBottom: "max(var(--space-4), env(safe-area-inset-bottom))", background: "var(--color-surface)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
              <strong style={{ flex: 1, fontSize: "var(--text-body-size)" }}>
                {mode === "report" ? "Report this player" : mode === "block" ? `Block ${peerName || "this player"}?` : peerName || "Player"}
              </strong>
              <button type="button" onClick={close} aria-label="Close" style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: "50%", border: "none", background: "var(--color-surface-elevated)", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                <X size={16} />
              </button>
            </div>

            {error && <div role="alert" style={{ marginBottom: "var(--space-3)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-caption-size)", background: "var(--color-danger-bg)", color: "var(--color-danger-text)" }}>{error}</div>}

            {mode === null && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <Button variant="ghost" fullWidth before={<Flag size={15} />} onClick={() => setMode("report")}>Report this player</Button>
                <Button variant="ghost" fullWidth before={<Ban size={15} />} onClick={() => setMode("block")}>Block this player</Button>
                <p style={{ margin: "var(--space-2) 0 0", fontSize: 11, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
                  Reports go to the app moderators and are reviewed within 24 hours. Reporting someone also blocks them straight away.
                </p>
              </div>
            )}

            {mode === "report" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {REPORT_REASONS.map(([id, label]) => (
                  <label key={id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-body-secondary-size)", cursor: "pointer", background: reason === id ? "var(--color-primary-subtle)" : "var(--color-surface-elevated)", border: `1px solid ${reason === id ? "var(--color-primary-subtle-border)" : "transparent"}` }}>
                    <input type="radio" name="report-reason" checked={reason === id} onChange={() => setReason(id)} />
                    {label}
                  </label>
                ))}
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value.slice(0, 1000))}
                  placeholder="Anything else the moderators should know? (optional)"
                  rows={3}
                  style={{ marginTop: "var(--space-1)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2) var(--space-3)", fontFamily: "inherit", fontSize: "var(--text-body-secondary-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", resize: "vertical" }}
                />
                <Button variant="primary" fullWidth loading={busy} onClick={submitReport}>Send report and block</Button>
                <Button variant="ghost" fullWidth onClick={() => setMode(null)}>Back</Button>
              </div>
            )}

            {mode === "block" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <p style={{ margin: 0, fontSize: "var(--text-body-secondary-size)", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
                  You will not see each other&rsquo;s messages any more, and neither of you can start a new conversation. You can undo this in Profile settings.
                </p>
                <Button variant="primary" fullWidth loading={busy} onClick={submitBlock}>Block {peerName || "this player"}</Button>
                <Button variant="ghost" fullWidth onClick={() => setMode(null)}>Cancel</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
