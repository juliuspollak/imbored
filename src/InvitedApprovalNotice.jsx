import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Mail, UserCheck } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";

const INK = "#1B2129";
const ACCENT = "#2F6FED";

export default function InvitedApprovalNotice() {
  const [players, setPlayers] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!supabaseReady) return;
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) {
      setPlayers([]);
      return;
    }
    const { data, error } = await supabase.rpc("get_my_pending_invited_players");
    if (error) {
      // The notice remains hidden until migration v112 is deployed.
      setPlayers([]);
      return;
    }
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
    setBusyId(player.user_id);
    setMessage("");
    const { error } = await supabase.rpc("approve_invited_player", {
      target_user_id: player.user_id,
    });
    setBusyId(null);
    if (error) {
      setMessage(error.message || "Approval failed.");
      return;
    }
    setMessage(`${player.player_name || "Player"} is approved and can start playing.`);
    setPlayers((current) => current.filter((item) => item.user_id !== player.user_id));
  }

  if (!players.length && !message) return null;

  return (
    <aside
      className="fixed left-1/2 z-[80] w-[calc(100%-24px)] max-w-sm -translate-x-1/2 rounded-3xl p-3"
      style={{
        bottom: "max(12px, env(safe-area-inset-bottom))",
        color: INK,
        border: "1px solid rgba(255,255,255,.82)",
        background: "linear-gradient(145deg,rgba(255,255,255,.88),rgba(235,242,253,.76))",
        boxShadow: "0 18px 45px rgba(30,47,78,.20), inset 0 1px 0 rgba(255,255,255,.96)",
        WebkitBackdropFilter: "blur(24px) saturate(155%)",
        backdropFilter: "blur(24px) saturate(155%)",
      }}
      aria-live="polite"
    >
      {message && !players.length ? (
        <div className="flex items-center gap-2.5 px-1 py-1 text-xs font-semibold">
          <CheckCircle2 size={17} style={{ color: "#15803D" }} />
          <span className="flex-1">{message}</span>
          <button type="button" onClick={() => setMessage("")} className="text-[11px] opacity-45">Dismiss</button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-1 pb-2">
            <span className="grid h-9 w-9 place-items-center rounded-2xl" style={{ background: "rgba(47,111,237,.10)", color: ACCENT }}>
              <Mail size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold">Your invited player is ready</span>
              <span className="block text-[10px] opacity-50">Approve the account so they can start playing.</span>
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {players.map((player) => (
              <div key={player.user_id} className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5" style={{ background: "rgba(255,255,255,.58)", border: "1px solid rgba(16,24,40,.07)" }}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg" style={{ background: "#fff" }}>{player.player_icon || "🙂"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{player.player_name || "New player"}</span>
                  <span className="block truncate text-[10px] opacity-45">{player.invited_email}</span>
                </span>
                <button
                  type="button"
                  disabled={busyId === player.user_id}
                  onClick={() => approve(player)}
                  className="gloss-button rounded-full px-3 py-2 text-[11px] font-semibold disabled:opacity-50"
                  style={{ background: "rgba(22,163,74,.12)", color: "#15803D" }}
                >
                  <UserCheck size={13} />
                  {busyId === player.user_id ? "Approving…" : "Approve"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
