import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldOff, Trash2, LifeBuoy } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { useI18n } from "./lib/i18n.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import StatusBanner from "./components/StatusBanner.jsx";
import { completeSafetyAction, withoutBlockedPlayer } from "./lib/safetyActions.js";
import { SUPPORT_EMAIL } from "./lib/supportContact.js";

// Contact address published in-app, which App Store guideline 1.2 requires for
// any app carrying user-generated content.
export { SUPPORT_EMAIL };

export default function AccountSafety() {
  const { signOut } = useAuth();
  const { t } = useI18n();
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const pending = useRef(false);
  const listRequest = useRef(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    const requestId = ++listRequest.current;
    if (!supabaseReady) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { data, error: listError } = await supabase.rpc("get_my_blocked_players");
      if (listError) throw listError;
      if (requestId === listRequest.current) setBlocked(data || []);
    } catch (failure) {
      if (requestId === listRequest.current) setError(failure?.message || t("account.blockedLoadFailed"));
    } finally {
      if (requestId === listRequest.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => { refresh(); return () => { ++listRequest.current; }; }, [refresh]);

  async function unblock(userId) {
    if (pending.current) return;
    pending.current = true;
    ++listRequest.current; // An older list response must not reinsert this row.
    setBusyId(userId);
    setError(""); setSuccess("");
    try {
      await completeSafetyAction(() => supabase.rpc("unblock_player", { target_user_id: userId }), () => {
        ++listRequest.current;
        setLoading(false);
        setBlocked(players => withoutBlockedPlayer(players, userId));
        setSuccess(t("safety.unblockedSuccess"));
        window.dispatchEvent(new CustomEvent("player-unblocked", { detail: { playerId: userId } }));
      });
    } catch (failure) {
      setError(failure?.message || t("account.unblockFailed"));
    } finally {
      pending.current = false;
      setBusyId(null);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setError("");
    // The Edge Function clears app data via delete_my_account() and then removes
    // the Auth user, which the browser cannot do on its own.
    const { error: deleteError } = await supabase.functions.invoke("delete-my-account", { body: {} });
    if (deleteError) {
      setDeleting(false);
      setError(deleteError.message || t("account.deleteFailed"));
      return;
    }
    await signOut();
  }

  return (
    <Card style={{ marginBottom: "var(--space-3)" }}>
      <h2 style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-body-size)", fontWeight: 700, color: "var(--color-text-primary)" }}>{t("account.safetyTitle")}</h2>

      {error && <div role="alert"><StatusBanner variant="error" style={{ marginBottom: "var(--space-3)" }}>{error}</StatusBanner><Button variant="ghost" disabled={busyId !== null} onClick={refresh} style={{ minHeight: 44 }}>{t("safety.retryList")}</Button></div>}
      <div role="status" aria-live="polite" aria-atomic="true">{success && <StatusBanner variant="success" style={{ marginBottom: "var(--space-3)" }}>{success}</StatusBanner>}</div>

      <div style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: "var(--space-2)", fontSize: "var(--text-caption-size)", fontWeight: 700, color: "var(--color-text-primary)" }}>
          <ShieldOff size={14} /> {t("account.blockedPlayers")}
        </div>
        <p style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>{t("safety.blockIndependence")}</p>
        {loading && <p style={{ margin: 0, fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>{t("common.loading")}</p>}
        {!loading && !error && blocked.length === 0 && (
          <p style={{ margin: 0, fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>
            {t("account.noBlocked")}
          </p>
        )}
        {!loading && blocked.map((player) => (
          <div key={player.user_id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) 0", borderBottom: "1px solid var(--color-border)" }}>
            <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 30, height: 30, flexShrink: 0, borderRadius: "50%", background: "var(--color-avatar-bg)", fontSize: 16 }}>{player.icon || "🙂"}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--text-body-secondary-size)" }}>{player.name || t("common.player")}</span>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{t("safety.blockedStatus")}</span>
            <Button variant="ghost" size="sm" style={{ minHeight: 44, minWidth: 44 }} aria-label={t("safety.unblockName", { name: player.name || t("common.player") })} disabled={busyId !== null} loading={busyId === player.user_id} onClick={() => unblock(player.user_id)}>{t("account.unblock")}</Button>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: "var(--space-1)", fontSize: "var(--text-caption-size)", fontWeight: 700, color: "var(--color-text-primary)" }}>
          <LifeBuoy size={14} /> {t("account.reportProblem")}
        </div>
        <p style={{ margin: 0, fontSize: "var(--text-caption-size)", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
          {t("account.reportProblemDetail")}{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--color-primary)" }}>{SUPPORT_EMAIL}</a>.
        </p>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: "var(--space-1)", fontSize: "var(--text-caption-size)", fontWeight: 700, color: "var(--color-danger-text)" }}>
          <Trash2 size={14} /> {t("account.deleteAccount")}
        </div>
        {!confirmingDelete && (
          <>
            <p style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-caption-size)", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
              {t("account.deleteDetail")}
            </p>
            <Button variant="ghost" fullWidth onClick={() => setConfirmingDelete(true)} style={{ color: "var(--color-danger-text)" }}>{t("account.deleteButton")}</Button>
          </>
        )}
        {confirmingDelete && (
          <div style={{ borderRadius: "var(--radius-md)", padding: "var(--space-3)", background: "var(--color-danger-bg)" }}>
            <p style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-body-secondary-size)", lineHeight: 1.5, color: "var(--color-danger-text)" }}>
              {t("account.deleteConfirm")}
            </p>
            <Button variant="primary" fullWidth loading={deleting} onClick={deleteAccount} style={{ marginBottom: "var(--space-2)", background: "var(--color-danger-solid)" }}>{t("account.deleteYes")}</Button>
            <Button variant="ghost" fullWidth disabled={deleting} onClick={() => setConfirmingDelete(false)}>{t("account.deleteNo")}</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
