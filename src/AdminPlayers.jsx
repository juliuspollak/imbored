import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, Crown, Lock, EyeOff, ShieldBan, UserX, Ellipsis, RotateCcw, Gift, X } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import Page from "./components/Page.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

// How long someone has been waiting on a decision. Undecided approvals are
// easy to leave sitting, so the wait is spelled out rather than implied.
function fmtWaiting(iso) {
  if (!iso) return "Waiting for approval";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "Waiting for approval · today";
  if (days === 1) return "Waiting for approval · 1 day";
  return `Waiting for approval · ${days} days`;
}

function fmtLastSeen(iso) {
  if (!iso) return "Never seen";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 45000) return "Online now";
  const mins = Math.round(ms / 60000);
  if (mins < 2) return "A minute ago";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function AdminPlayers({ onBack }) {
  const { profile, setUserHidden, adminAccountAction } = useAuth();
  const isAdmin = !!profile?.is_admin;
  const [players, setPlayers] = useState([]);
  const [lastSeen, setLastSeen] = useState({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [actionTarget, setActionTarget] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabaseReady || !isAdmin) return;
    setLoading(true);
    const [{ data: playersData }, { data: presenceData }] = await Promise.all([
      supabase.from("profiles").select("*").order("name"),
      supabase.rpc("get_last_seen_times"),
    ]);
    setPlayers(playersData || []);
    setLastSeen(Object.fromEntries((presenceData || []).map((item) => [item.user_id, item.last_seen_at])));
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleApproval(playerId, approve) {
    setApprovingId(playerId);
    const { data, error } = await supabase.rpc("decide_player_approval", { target_user_id: playerId, approve });
    setApprovingId(null);
    if (error) { setNotice(approve ? (error.message || "Approval failed.") : (error.message || "Could not require approval.")); return; }
    if (!approve) {
      setNotice("This player now needs approval again before they can play.");
    } else {
      setNotice(data?.emailSent ? "Player approved. The approval notification was emailed." : `Player approved, but the email was not sent${data?.emailError ? `: ${data.emailError}` : "."}`);
    }
    refresh();
  }
  async function handleToggleHidden(player) { await setUserHidden(player.id, !player.hidden_from_others); setExpandedId(null); refresh(); }
  async function handleToggleRewardSteward(player) { setNotice(""); const { error } = await supabase.rpc("set_user_reward_steward", { target_user_id: player.id, steward: !player.is_reward_steward }); setExpandedId(null); if (error) setNotice(error.message || "Could not update."); refresh(); }

  async function handleAccountAction(action, player) {
    setActionBusy(true); setActionError(null);
    const { error } = await adminAccountAction(action, player.id, actionTarget?.reason || "");
    setActionBusy(false);
    if (error) setActionError(error.message || "Account action failed.");
    else { setPlayers((c) => action === "delete" ? c.filter((i) => i.id !== player.id) : c); setActionTarget(null); setExpandedId(null); refresh(); }
  }

  // A player stays highlighted here until the decision is actually made:
  // approved, or declined by blocking them. Blocked players used to stay in
  // this list forever — is_approved is still false after a block — so
  // declining someone left them flagged with no way to settle it.
  const pending = players.filter((p) => (
    !p.account_deleted_at && !p.is_admin && !p.is_blocked && p.is_approved === false
  ));
  // Everyone not deleted and not awaiting a decision, so a declined player
  // stays reachable in the list below (shown as Blocked) and can be restored.
  const pendingIds = new Set(pending.map((p) => p.id));
  const active = players.filter((p) => !p.account_deleted_at && !pendingIds.has(p.id));
  const history = players.filter((p) => p.account_deleted_at);

  function PlayerCard({ player, approval = false, compact = false, last = false }) {
    const seenIso = lastSeen[player.id];
    const online = seenIso && Date.now() - new Date(seenIso).getTime() < 45000;
    const expanded = expandedId === player.id;
    const activityLabel = fmtLastSeen(seenIso);
    const showStatus = !compact || approval || activityLabel !== "Never seen" || player.is_blocked || player.hidden_from_others;
    return (
      <Card style={{
        padding: "var(--space-3)",
        borderColor: approval ? "var(--color-warning-border)" : undefined,
        border: compact ? "none" : undefined,
        borderBottom: compact && !last ? "1px solid var(--color-border)" : undefined,
        borderRadius: compact ? 0 : undefined,
        boxShadow: compact ? "none" : undefined,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div style={{ width: 42, height: 42, borderRadius: "var(--radius-md)", background: approval ? "var(--color-warning-bg)" : "var(--color-info-bg)", fontSize: 20, display: "grid", placeItems: "center", flexShrink: 0 }}>{player.icon || "🙂"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: "var(--text-body-size)", color: "var(--color-text-primary)" }} className="truncate">{player.name}</span>
              {player.is_admin && <Crown size={11} style={{ color: "var(--color-warning-gold)" }} />}
              {player.is_reward_steward && <Gift size={11} style={{ color: "var(--color-primary)" }} />}
              {player.is_private && <Lock size={10} style={{ opacity: .35 }} />}
            </div>
            <div style={{ display: showStatus ? "block" : "none", fontSize: 11, fontWeight: approval ? 600 : undefined, color: approval ? "var(--color-warning-text)" : online ? "var(--color-success-text)" : "var(--color-text-secondary)" }}>
              {approval ? fmtWaiting(player.created_at) : fmtLastSeen(seenIso)}
              {player.is_blocked ? " · Blocked" : ""}{player.hidden_from_others ? " · Hidden" : ""}
            </div>
          </div>
          {approval && (
            <>
              <Button size="sm" variant="ghost" loading={approvingId === player.id} before={<CheckCircle2 size={13} />} onClick={() => handleApproval(player.id, true)} style={{ color: "var(--color-success-text)" }}>
                {approvingId === player.id ? "Approving…" : "Approve"}
              </Button>
              {/* Without this, the only way to settle an approval was Block
                  buried in the overflow menu, so undecided players piled up. */}
              <Button size="sm" variant="ghost" before={<ShieldBan size={13} />} onClick={() => setActionTarget({ type: "block", intent: "decline", player, reason: "" })} style={{ color: "var(--color-danger-text)" }}>
                Decline
              </Button>
            </>
          )}
          {!player.is_admin && (
            <button onClick={() => setExpandedId(expanded ? null : player.id)} aria-label={`More actions for ${player.name}`} aria-expanded={expanded} style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", background: compact && !expanded ? "transparent" : "var(--color-surface-elevated)", color: "var(--color-icon-subtle)", border: "none", cursor: "pointer", display: "grid", placeItems: "center" }}>
              <Ellipsis size={16} />
            </button>
          )}
        </div>
        {expanded && !player.is_admin && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
            {!approval && <Button size="sm" variant="ghost" onClick={() => handleApproval(player.id, false)}>Require approval</Button>}
            <Button size="sm" variant="ghost" before={player.is_blocked ? <RotateCcw size={11} /> : <ShieldBan size={11} />} onClick={() => player.is_blocked ? handleAccountAction("unblock", player) : setActionTarget({ type: "block", player, reason: "" })} style={{ color: player.is_blocked ? "var(--color-success-text)" : "var(--color-danger-text)" }}>{player.is_blocked ? "Unblock" : "Block"}</Button>
            <Button size="sm" variant="ghost" before={<EyeOff size={11} />} onClick={() => handleToggleHidden(player)}>{player.hidden_from_others ? "Show" : "Hide"}</Button>
            <Button size="sm" variant="ghost" before={<Gift size={11} />} onClick={() => handleToggleRewardSteward(player)} style={{ color: player.is_reward_steward ? "var(--color-primary)" : undefined }}>{player.is_reward_steward ? "Remove steward" : "Make steward"}</Button>
            <Button size="sm" variant="ghost" before={<UserX size={11} />} onClick={() => setActionTarget({ type: "delete", player, reason: "" })} style={{ color: "var(--color-danger-text)" }}>Delete</Button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}>
        <BackButton onClick={onBack} />
        <div><h1 style={{ fontSize: "var(--text-page-title-size)", fontWeight: 700, color: "var(--color-text-primary)" }}>Players</h1><p style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>Approvals first, account controls when needed</p></div>
      </div>
      {notice && <div style={{ marginBottom: "var(--space-4)" }}><StatusBanner variant="info" dismissible onDismiss={() => setNotice("")}>{notice}</StatusBanner></div>}

      {!supabaseReady ? <p style={{ color: "var(--color-text-secondary)" }}>Supabase isn't configured.</p>
        : !isAdmin ? <p style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-text-secondary)" }}>Admin only.</p>
        : loading ? <p style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--color-text-secondary)" }}>Loading…</p>
        : <>
          {pending.length > 0 && <section style={{ marginBottom: "var(--space-6)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)", padding: "0 var(--space-1)" }}>
              <h2 style={{ fontSize: "var(--text-caption-size)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--color-warning-text)", margin: 0 }}>Needs approval</h2>
              <span style={{ borderRadius: "var(--radius-full)", padding: "2px 8px", fontSize: 10, fontWeight: 700, background: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}>{pending.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>{pending.map((p) => <PlayerCard key={p.id} player={p} approval />)}</div>
          </section>}
          <section>
            <h2 style={{ fontSize: "var(--text-caption-size)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--color-text-secondary)", marginBottom: "var(--space-2)", padding: "0 var(--space-1)" }}>Players · {active.length}</h2>
            <Card style={{ padding: 0, overflow: "hidden" }}>{active.map((p, index) => <PlayerCard key={p.id} player={p} compact last={index === active.length - 1} />)}</Card>
          </section>
          {history.length > 0 && <section style={{ marginTop: "var(--space-6)" }}>
            <h2 style={{ fontSize: "var(--text-caption-size)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--color-text-secondary)", marginBottom: "var(--space-2)", padding: "0 var(--space-1)" }}>Account history · {history.length}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {history.map((p) => <Card key={p.id} style={{ padding: "var(--space-3)", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span style={{ fontSize: 18, opacity: .6 }}>{p.icon || "🙂"}</span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-primary)", opacity: .65 }} className="truncate">{p.name}</div><div style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>Legacy deleted profile</div></div>
                {p.auth_deleted_at ? <span style={{ fontSize: 10, fontWeight: 600, color: "var(--color-success-text)" }}>Login removed</span> : <Button size="sm" variant="ghost" onClick={() => setActionTarget({ type: "delete", player: p, reason: "" })} style={{ color: "var(--color-danger-text)" }}>Delete permanently</Button>}
              </Card>)}
            </div>
          </section>}
        </>}

      {actionTarget && <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: "var(--space-4)", background: "var(--color-overlay)" }}>
        <Card style={{ maxWidth: 400, width: "100%", padding: "var(--space-5)" }}>
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
            <div style={{ fontSize: 24 }}>{actionTarget.player.icon || "🙂"}</div>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
                {actionTarget.intent === "decline" ? `Decline ${actionTarget.player.name}?` : actionTarget.type === "block" ? `Block ${actionTarget.player.name}?` : actionTarget.player.account_deleted_at ? `Permanently delete ${actionTarget.player.name}?` : `Delete ${actionTarget.player.name}'s account?`}
              </h2>
              <p style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>
                {actionTarget.intent === "decline" ? "They move out of Needs approval and into the player list as blocked. You can restore them there at any time." : actionTarget.type === "block" ? "They won't be able to use the app until restored." : "The login, linked identities, profile and associated player data will be permanently deleted."}
              </p>
            </div>
            <button onClick={() => setActionTarget(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-secondary)" }}><X size={16} /></button>
          </div>
          {actionTarget.type === "block" && <textarea value={actionTarget.reason} onChange={(e) => setActionTarget({ ...actionTarget, reason: e.target.value })} placeholder="Reason shown to the player (optional)" rows={2} style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "var(--space-2)", fontSize: "var(--text-body-size)", marginTop: "var(--space-4)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", resize: "vertical", boxSizing: "border-box" }} />}
          {actionError && <p style={{ fontSize: "var(--text-caption-size)", marginTop: "var(--space-3)", color: "var(--color-danger-text)" }}>{actionError}</p>}
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
            <Button variant="ghost" fullWidth onClick={() => setActionTarget(null)}>Cancel</Button>
            <Button variant="danger" fullWidth loading={actionBusy} onClick={() => handleAccountAction(actionTarget.type, actionTarget.player)}>{actionBusy ? "Working…" : actionTarget.intent === "decline" ? "Decline" : actionTarget.type === "block" ? "Block" : "Delete permanently"}</Button>
          </div>
        </Card>
      </div>}
    </Page>
  );
}
