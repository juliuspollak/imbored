import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, CheckCircle2, Crown, Ellipsis, EyeOff, Lock,
  RotateCcw, ShieldBan, UserX, X,
} from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const GREEN = "#22C55E";

function fmtLastSeen(iso) {
  if (!iso) return "Never active";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 45000) return "Online";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AdminPlayers({ onBack }) {
  const { profile: myProfile, setUserHidden, adminAccountAction } = useAuth();
  const isAdmin = !!myProfile?.is_admin;
  const [players, setPlayers] = useState([]);
  const [lastSeen, setLastSeen] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [actionTarget, setActionTarget] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabaseReady || !isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let profilesResult = await supabase
      .from("profiles")
      .select("id,name,icon,is_private,is_admin,hidden_from_others,is_approved,is_blocked,account_deleted_at,auth_deleted_at")
      .order("name");
    // Compatibility while v99 is being applied.
    if (profilesResult.error?.code === "42703") {
      profilesResult = await supabase
        .from("profiles")
        .select("id,name,icon,is_private,is_admin,hidden_from_others,is_approved,is_blocked,account_deleted_at")
        .order("name");
    }
    const presenceResult = await supabase.from("presence").select("user_id,last_seen");
    setPlayers((profilesResult.data || []).map((player) => ({ auth_deleted_at: null, ...player })));
    setLastSeen(Object.fromEntries((presenceResult.data || []).map((row) => [row.user_id, row.last_seen])));
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleApproval(userId, approved) {
    const { error } = await supabase.rpc("set_user_approval", { target_user_id: userId, approved });
    if (!error) refresh();
  }

  async function handleToggleHidden(player) {
    await setUserHidden(player.id, !player.hidden_from_others);
    setExpandedId(null);
    refresh();
  }

  async function handleAccountAction(action, player) {
    setActionBusy(true);
    setActionError(null);
    const { error } = await adminAccountAction(action, player.id, actionTarget?.reason || "");
    setActionBusy(false);
    if (error) setActionError(error.message || "Account action failed.");
    else {
      setPlayers((current) => current.map((item) => (
        action === "delete" && item.id === player.id
          ? { ...item, account_deleted_at: item.account_deleted_at || new Date().toISOString(), auth_deleted_at: new Date().toISOString() }
          : item
      )));
      setActionTarget(null);
      setExpandedId(null);
      refresh();
    }
  }

  const pending = players.filter((p) => !p.account_deleted_at && !p.is_admin && p.is_approved === false);
  const active = players.filter((p) => !p.account_deleted_at && (p.is_admin || p.is_approved !== false));
  const history = players.filter((p) => p.account_deleted_at);

  function PlayerCard({ player, approval = false }) {
    const seenIso = lastSeen[player.id];
    const online = seenIso && Date.now() - new Date(seenIso).getTime() < 45000;
    const expanded = expandedId === player.id;
    return (
      <div className="rounded-2xl p-3" style={{ background: PANEL, border: approval ? "1px solid rgba(217,174,88,.30)" : "1px solid rgba(16,24,40,.08)", boxShadow: approval ? "0 8px 22px rgba(158,116,14,.08)" : "none" }}>
        <div className="flex items-center gap-3">
          <div className="grid place-items-center rounded-xl text-xl" style={{ width: 42, height: 42, background: approval ? "#FFF8E7" : "rgba(47,111,237,.07)" }}>{player.icon || "🙂"}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm truncate" style={{ color: INK }}>{player.name}</span>
              {player.is_admin && <Crown size={11} style={{ color: "#D9AE58" }} />}
              {player.is_private && <Lock size={10} style={{ opacity: .35 }} />}
            </div>
            <div className="text-[11px]" style={{ color: online ? GREEN : "rgba(27,33,41,.42)" }}>
              {approval ? "Waiting for approval" : fmtLastSeen(seenIso)}
              {player.is_blocked ? " · Blocked" : ""}
              {player.hidden_from_others ? " · Hidden" : ""}
            </div>
          </div>
          {approval && (
            <button onClick={() => handleApproval(player.id, true)} className="rounded-full px-3 py-2 text-xs font-semibold flex items-center gap-1" style={{ background: "rgba(22,163,74,.1)", color: "#15803D" }}>
              <CheckCircle2 size={13}/>Approve
            </button>
          )}
          {!player.is_admin && <button onClick={() => setExpandedId(expanded ? null : player.id)} className="grid place-items-center rounded-full" style={{ width: 32, height: 32, background: "rgba(16,24,40,.045)" }} aria-label={`More actions for ${player.name}`}>
            <Ellipsis size={16}/>
          </button>}
        </div>
        {expanded && !player.is_admin && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3" style={{ borderTop: "1px solid rgba(16,24,40,.07)" }}>
            {!approval && <button onClick={() => handleApproval(player.id, false)} className="rounded-full px-3 py-1.5 text-[11px] font-medium" style={{ background: "rgba(16,24,40,.05)" }}>Require approval</button>}
            <button onClick={() => player.is_blocked ? handleAccountAction("unblock", player) : setActionTarget({ type: "block", player, reason: "" })} className="rounded-full px-3 py-1.5 text-[11px] font-medium flex items-center gap-1" style={{ background: player.is_blocked ? "rgba(22,163,74,.1)" : "rgba(181,67,58,.08)", color: player.is_blocked ? "#15803D" : "#B5433A" }}>
              {player.is_blocked ? <RotateCcw size={11}/> : <ShieldBan size={11}/>}
              {player.is_blocked ? "Unblock" : "Block"}
            </button>
            <button onClick={() => handleToggleHidden(player)} className="rounded-full px-3 py-1.5 text-[11px] font-medium flex items-center gap-1" style={{ background: "rgba(16,24,40,.05)" }}><EyeOff size={11}/>{player.hidden_from_others ? "Show" : "Hide"}</button>
            <button onClick={() => setActionTarget({ type: "delete", player, reason: "" })} className="rounded-full px-3 py-1.5 text-[11px] font-medium flex items-center gap-1" style={{ background: "rgba(181,67,58,.08)", color: "#B5433A" }}><UserX size={11}/>Delete</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter',sans-serif" }} className="flex justify-center p-4 pt-10">
      <div className="w-full max-w-md">
        <header className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="grid place-items-center rounded-full" style={{ width: 36, height: 36, background: "rgba(16,24,40,.05)" }} aria-label="Back"><ArrowLeft size={17}/></button>
          <div><h1 className="text-2xl font-bold" style={{ fontFamily: "'Fredoka',sans-serif" }}>Players</h1><p className="text-xs opacity-45">Approvals first, account controls when needed</p></div>
        </header>

        {!supabaseReady ? <p className="text-sm">Supabase isn’t configured.</p>
          : !isAdmin ? <p className="text-sm text-center opacity-45 py-10">Admin only.</p>
          : loading ? <p className="text-sm text-center opacity-45 py-10">Loading…</p>
          : <>
            {pending.length > 0 && <section className="mb-6"><div className="flex items-center justify-between mb-2 px-1"><h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9A6B12" }}>Needs approval</h2><span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "#FFF0C2", color: "#8A5C00" }}>{pending.length}</span></div><div className="space-y-2">{pending.map((p) => <PlayerCard key={p.id} player={p} approval/>)}</div></section>}
            <section><h2 className="text-xs font-bold uppercase tracking-wide opacity-40 mb-2 px-1">Players · {active.length}</h2><div className="space-y-2">{active.map((p) => <PlayerCard key={p.id} player={p}/>)}</div></section>
            {history.length > 0 && <section className="mt-7"><h2 className="text-xs font-bold uppercase tracking-wide opacity-35 mb-2 px-1">Account history · {history.length}</h2><div className="space-y-2">{history.map((p) => <div key={p.id} className="rounded-2xl px-3 py-2.5 flex items-center gap-3" style={{ background: "rgba(255,255,255,.55)", border: "1px solid rgba(16,24,40,.06)" }}><span className="text-lg opacity-60">{p.icon || "🙂"}</span><div className="flex-1 min-w-0"><div className="text-xs font-semibold truncate opacity-65">{p.name}</div><div className="text-[10px] opacity-35">Historical scores retained</div></div>{p.auth_deleted_at ? <span className="text-[10px] font-semibold" style={{ color: "#15803D" }}>Login removed</span> : <button onClick={() => setActionTarget({ type: "delete", player: p, reason: "" })} className="rounded-full px-3 py-1.5 text-[10px] font-semibold" style={{ background: "rgba(181,67,58,.08)", color: "#B5433A" }}>Finish login removal</button>}</div>)}</div></section>}
          </>}

        {actionTarget && <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(16,24,40,.45)" }}><div className="w-full max-w-sm rounded-3xl p-5" style={{ background: "#fff", boxShadow: "0 24px 60px rgba(16,24,40,.22)" }}><div className="flex gap-3 items-start"><div className="text-2xl">{actionTarget.player.icon || "🙂"}</div><div className="flex-1"><h2 className="font-bold">{actionTarget.type === "block" ? `Block ${actionTarget.player.name}?` : actionTarget.player.account_deleted_at ? `Remove ${actionTarget.player.name}’s login?` : `Delete ${actionTarget.player.name}’s account?`}</h2><p className="text-xs opacity-55 mt-1">{actionTarget.type === "block" ? "They won’t be able to use the app until restored." : "The login and linked identities will be removed. Historical scores remain."}</p></div><button onClick={() => setActionTarget(null)}><X size={16}/></button></div>{actionTarget.type === "block" && <textarea value={actionTarget.reason} onChange={(e) => setActionTarget({ ...actionTarget, reason: e.target.value })} placeholder="Reason shown to the player (optional)" className="w-full rounded-xl border px-3 py-2 text-sm mt-4" rows={2}/>} {actionError && <p className="text-xs mt-3" style={{ color: "#B5433A" }}>{actionError}</p>}<div className="flex gap-2 mt-4"><button onClick={() => setActionTarget(null)} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{ background: "rgba(16,24,40,.06)" }}>Cancel</button><button disabled={actionBusy} onClick={() => handleAccountAction(actionTarget.type, actionTarget.player)} className="flex-1 rounded-full py-2.5 text-xs font-semibold text-white" style={{ background: "#B5433A" }}>{actionBusy ? "Working…" : actionTarget.type === "block" ? "Block" : "Remove login"}</button></div></div></div>}
      </div>
    </div>
  );
}
