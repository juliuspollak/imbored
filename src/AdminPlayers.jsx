import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, EyeOff, Lock, Crown, CheckCircle2, Clock3, ShieldBan, RotateCcw, UserX, X } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const GREEN = "#22C55E";

function fmtLastSeen(iso) {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 45000) return "Online now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Admin-only: every profile that exists, regardless of whether they've
// played anything yet — unlike the Stats page, which only lists players
// who show up in game_stats.
export default function AdminPlayers({ onBack }) {
  const { profile: myProfile, setUserHidden, adminAccountAction } = useAuth();
  const isAdmin = !!myProfile?.is_admin;

  const [players, setPlayers] = useState([]);
  const [lastSeen, setLastSeen] = useState({}); // user_id -> iso timestamp
  const [loading, setLoading] = useState(true);
  const [actionTarget, setActionTarget] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabaseReady || !isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: profilesData }, { data: presenceData }] = await Promise.all([
      supabase.from("profiles").select("id, name, icon, mood, is_private, is_admin, hidden_from_others, is_approved, approved_at, is_blocked, blocked_reason, account_deleted_at").order("name", { ascending: true }),
      supabase.from("presence").select("user_id, last_seen"),
    ]);
    setPlayers(profilesData || []);
    setLastSeen(Object.fromEntries((presenceData || []).map((p) => [p.user_id, p.last_seen])));
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleApproval(userId, approve) {
    const { error } = await supabase.rpc("set_user_approval", { target_user_id: userId, approved: approve });
    if (!error) refresh();
  }

  async function handleToggleHidden(userId, currentlyHidden) {
    await setUserHidden(userId, !currentlyHidden);
    refresh();
  }

  async function handleAccountAction(action, player) {
    setActionBusy(true); setActionError(null);
    const { error } = await adminAccountAction(action, player.id, actionTarget?.reason || "");
    setActionBusy(false);
    if (error) setActionError(error.message || "Account action failed.");
    else { setActionTarget(null); refresh(); }
  }


  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex justify-center p-4 pt-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onBack}
            className="nav-btn flex items-center justify-center rounded-full"
            style={{ "--nav-glow": "rgba(47,111,237,0.3)", "--nav-border": "rgba(47,111,237,0.4)", color: INK, background: "rgba(16,24,40,0.05)", width: 34, height: 34 }}
            aria-label="Back to home"
          >
            <ArrowLeft size={16} />
          </button>
          <h1 style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK }} className="text-2xl">
            Players
          </h1>
        </div>
        <p style={{ color: INK, opacity: 0.45 }} className="text-xs mb-6 ml-9">
          every signed-up player, whether they've played anything yet or not
        </p>

        {!supabaseReady ? (
          <div className="text-xs rounded-lg p-3" style={{ background: "rgba(217,105,92,0.1)", color: "#B5433A" }}>
            Supabase isn't configured yet.
          </div>
        ) : !isAdmin ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Admin only.</p>
        ) : loading ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Loading…</p>
        ) : players.length === 0 ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">No players yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {players.map((p) => {
              const seenIso = lastSeen[p.id];
              const isOnlineNow = seenIso && Date.now() - new Date(seenIso).getTime() < 45000;
              return (
                <div
                  key={p.id}
                  className="rounded-xl p-3 flex items-center gap-3"
                  style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)", opacity: p.hidden_from_others || p.account_deleted_at ? 0.5 : 1 }}
                >
                  <span style={{ fontSize: 18 }}>{p.icon || "🙂"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span style={{ color: INK, fontWeight: 600 }} className="text-sm truncate">{p.name}</span>
                      {p.is_admin && <Crown size={11} style={{ color: "#D9AE58", flexShrink: 0 }} />}
                      {p.account_deleted_at ? (
                        <span className="text-[9px] font-bold rounded-full px-1.5 py-0.5" style={{background:"rgba(16,24,40,.08)"}}>DELETED</span>
                      ) : (
                        <>
                          {p.is_blocked && <span className="text-[9px] font-bold rounded-full px-1.5 py-0.5" style={{background:"rgba(181,67,58,.1)",color:"#B5433A"}}>BLOCKED</span>}
                          {p.is_private && <Lock size={11} style={{ color: INK, opacity: 0.35, flexShrink: 0 }} />}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {isOnlineNow && <span style={{ width: 5, height: 5, borderRadius: "50%", background: GREEN, display: "inline-block" }} />}
                      <span style={{ color: isOnlineNow ? GREEN : INK, opacity: isOnlineNow ? 1 : 0.4 }} className="text-[11px]">
                        {fmtLastSeen(seenIso)}
                      </span>
                      {p.account_deleted_at ? (
                        <span className="text-[10px] font-medium" style={{color:INK, opacity:.55}}>· Historical player account</span>
                      ) : (
                        <>
                          {p.is_approved === false && <span className="text-[10px] font-semibold" style={{color:"#B7791F"}}>· Awaiting approval</span>}
                          {p.mood && <span style={{ color: INK, opacity: 0.35 }} className="text-[11px]">· {p.mood}</span>}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!p.account_deleted_at && !p.is_admin && (p.is_approved === false ? (
                      <button onClick={() => handleApproval(p.id, true)} className="flex items-center gap-1 rounded-full px-2.5 py-1.5" style={{ background: "rgba(22,163,74,.1)", color: "#15803D" }}>
                        <CheckCircle2 size={12}/><span className="text-[10px] font-semibold">Approve</span>
                      </button>
                    ) : (
                      <button onClick={() => handleApproval(p.id, false)} disabled={p.id === myProfile.id} className="flex items-center gap-1 rounded-full px-2 py-1.5" style={{ background: "rgba(16,24,40,.05)", color: INK, opacity: .45 }}>
                        <Clock3 size={12}/><span className="text-[10px] font-medium">Approved</span>
                      </button>
                    ))}
                    {!p.is_admin && !p.account_deleted_at && <button
                      onClick={() => p.is_blocked ? handleAccountAction("unblock", p) : setActionTarget({ type:"block", player:p, reason:"" })}
                      disabled={p.id === myProfile.id || actionBusy}
                      className="flex items-center gap-1 rounded-full px-2 py-1"
                      style={{background:p.is_blocked?"rgba(22,163,74,.1)":"rgba(181,67,58,.08)",color:p.is_blocked?"#15803D":"#B5433A"}}
                    >{p.is_blocked?<RotateCcw size={12}/>:<ShieldBan size={12}/>}<span className="text-[10px] font-medium">{p.is_blocked?"Unblock":"Block"}</span></button>}
                    {!p.is_admin && !p.account_deleted_at && <button
                      onClick={() => setActionTarget({ type:"delete", player:p, reason:"" })}
                      disabled={p.id === myProfile.id || actionBusy}
                      className="flex items-center justify-center rounded-full p-1.5"
                      style={{background:"rgba(181,67,58,.08)",color:"#B5433A"}}
                      aria-label={`Delete ${p.name}'s account`}
                    ><UserX size={12}/></button>}
                    {!p.account_deleted_at && <button
                      onClick={() => handleToggleHidden(p.id, p.hidden_from_others)}
                      disabled={p.id === myProfile.id}
                      className="flex items-center gap-1 rounded-full px-2 py-1 flex-shrink-0"
                      style={{
                        background: p.hidden_from_others ? "rgba(181,67,58,0.1)" : "rgba(16,24,40,0.05)",
                        color: p.hidden_from_others ? "#B5433A" : INK,
                        opacity: p.id === myProfile.id ? 0.25 : p.hidden_from_others ? 1 : 0.45,
                      }}
                    >
                      <EyeOff size={12} />
                      <span className="text-[10px] font-medium">{p.hidden_from_others ? "Hidden" : "Hide"}</span>
                    </button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}


        {actionTarget && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(16,24,40,.45)"}}>
          <div className="w-full max-w-sm rounded-2xl p-5" style={{background:"#fff",boxShadow:"0 20px 50px rgba(16,24,40,.2)"}}>
            <div className="flex items-start gap-3"><div className="text-2xl">{actionTarget.player.icon || "🙂"}</div><div className="flex-1"><h2 className="font-bold" style={{color:INK}}>{actionTarget.type === "block" ? `Block ${actionTarget.player.name}?` : `Delete ${actionTarget.player.name}'s account?`}</h2><p className="text-xs mt-1" style={{color:"rgba(27,33,41,.58)"}}>{actionTarget.type === "block" ? "They will be unable to sign in or use the app until restored." : "Their Auth login and linked identities will be deleted. Their historical profile, scores and messages stay visible. Team membership is removed and owned teams are transferred."}</p></div><button onClick={()=>setActionTarget(null)}><X size={16}/></button></div>
            {actionTarget.type === "block" && <textarea value={actionTarget.reason} onChange={e=>setActionTarget({...actionTarget,reason:e.target.value})} placeholder="Reason shown to the player (optional)" className="w-full rounded-xl border px-3 py-2 text-sm mt-4" rows={2}/>} 
            {actionError && <p className="text-xs mt-3" style={{color:"#B5433A"}}>{actionError}</p>}
            <div className="flex gap-2 mt-4"><button onClick={()=>setActionTarget(null)} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{background:"rgba(16,24,40,.06)",color:INK}}>Cancel</button><button disabled={actionBusy} onClick={()=>handleAccountAction(actionTarget.type,actionTarget.player)} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{background:"#B5433A",color:"#fff"}}>{actionBusy?"Working…":actionTarget.type === "block"?"Block user":"Delete account"}</button></div>
          </div>
        </div>}

        <p style={{ color: INK, opacity: 0.35 }} className="text-[11px] text-center mt-6">
          Hidden players are invisible to everyone but themselves and admins — enforced by the database, not just the UI.
        </p>
      </div>
    </div>
  );
}
