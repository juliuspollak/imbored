import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Mail, UserCheck } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import Button from "./components/Button.jsx";

export default function InvitedApprovalNotice() {
  const [players, setPlayers] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!supabaseReady) return;
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) { setPlayers([]); return; }
    const { data, error } = await supabase.rpc("get_my_pending_invited_players");
    if (error) { setPlayers([]); return; }
    setPlayers(data || []);
  }, []);

  useEffect(() => {
    refresh();
    if (!supabaseReady) return undefined;
    const channel = supabase
      .channel("inviter-account-approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh]);

  async function approve(player) {
    if (busyId) return;
    setBusyId(player.user_id); setMessage("");
    const { error } = await supabase.rpc("approve_invited_player", { target_user_id: player.user_id });
    setBusyId(null);
    if (error) { setMessage(error.message || "Approval failed."); return; }
    setMessage(`${player.player_name || "Player"} is approved and can start playing.`);
    setPlayers((c) => c.filter((i) => i.user_id !== player.user_id));
  }

  if (!players.length && !message) return null;

  return (
    <aside
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 80,
        width: "calc(100% - 24px)",
        maxWidth: "400px",
        bottom: "max(12px, env(safe-area-inset-bottom))",
        color: "var(--color-text-primary)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-xl)",
        padding: "var(--space-3)",
        background: "var(--color-surface)",
        boxShadow: "var(--shadow-modal)",
        WebkitBackdropFilter: "blur(24px) saturate(155%)",
        backdropFilter: "blur(24px) saturate(155%)",
      }}
      aria-live="polite"
    >
      {message && !players.length ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "var(--space-1)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>
          <CheckCircle2 size={17} style={{ color: "var(--color-success-text)" }} />
          <span style={{ flex: 1 }}>{message}</span>
          <button type="button" onClick={() => setMessage("")} style={{ fontSize: 11, color: "var(--color-text-secondary)", background: "transparent", border: "none", cursor: "pointer" }}>Dismiss</button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "0 var(--space-1)", paddingBottom: "var(--space-2)" }}>
            <span style={{ width: 36, height: 36, borderRadius: "var(--radius-lg)", background: "var(--color-info-bg)", color: "var(--color-primary)", display: "grid", placeItems: "center" }}><Mail size={16} /></span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontSize: "var(--text-caption-size)", fontWeight: 700 }}>Your invited player is ready</span>
              <span style={{ display: "block", fontSize: 10, color: "var(--color-text-secondary)" }}>Approve the account so they can start playing.</span>
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {players.map((player) => (
              <div key={player.user_id} style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: "var(--radius-lg)", padding: "var(--space-2) var(--space-3)", background: "var(--color-surface-elevated)", border: "1px solid var(--color-border)" }}>
                <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--color-surface)", fontSize: 18, display: "grid", placeItems: "center", flexShrink: 0 }}>{player.player_icon || "🙂"}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-primary)" }} className="truncate">{player.player_name || "New player"}</span>
                  <span style={{ display: "block", fontSize: 10, color: "var(--color-text-secondary)" }} className="truncate">{player.invited_email}</span>
                </span>
                <Button size="sm" variant="secondary" loading={busyId === player.user_id} before={<UserCheck size={13} />} onClick={() => approve(player)} style={{ color: "var(--color-success-text)", background: "var(--color-success-bg)", border: "none" }}>
                  {busyId === player.user_id ? "Approving…" : "Approve"}
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}