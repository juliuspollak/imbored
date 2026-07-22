import { useState, useEffect, useCallback } from "react";
import { Home, EyeOff, Lock, Crown } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";

// Admin-only: every profile that exists, regardless of whether they've
// played anything yet — unlike the Stats page, which only lists players
// who show up in game_stats.
export default function AdminPlayers({ onBack }) {
  const { profile: myProfile, setUserHidden } = useAuth();
  const isAdmin = !!myProfile?.is_admin;

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabaseReady || !isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, name, icon, mood, is_private, is_admin, hidden_from_others")
      .order("name", { ascending: true });
    setPlayers(data || []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleToggleHidden(userId, currentlyHidden) {
    await setUserHidden(userId, !currentlyHidden);
    refresh();
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex justify-center p-4 pt-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onBack}
            className="nav-btn flex items-center gap-1.5 rounded-full pl-2 pr-3 py-1.5"
            style={{ "--nav-glow": "rgba(47,111,237,0.3)", "--nav-border": "rgba(47,111,237,0.4)", color: INK, background: "rgba(16,24,40,0.05)" }}
          >
            <Home size={15} />
            <span className="text-xs font-medium">Home</span>
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
            {players.map((p) => (
              <div
                key={p.id}
                className="rounded-xl p-3 flex items-center gap-3"
                style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)", opacity: p.hidden_from_others ? 0.5 : 1 }}
              >
                <span style={{ fontSize: 18 }}>{p.icon || "🙂"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span style={{ color: INK, fontWeight: 600 }} className="text-sm truncate">{p.name}</span>
                    {p.is_admin && <Crown size={11} style={{ color: "#D9AE58", flexShrink: 0 }} />}
                    {p.is_private && <Lock size={11} style={{ color: INK, opacity: 0.35, flexShrink: 0 }} />}
                  </div>
                  {p.mood && <div style={{ color: INK, opacity: 0.45 }} className="text-xs truncate">{p.mood}</div>}
                </div>
                <button
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
                </button>
              </div>
            ))}
          </div>
        )}

        <p style={{ color: INK, opacity: 0.35 }} className="text-[11px] text-center mt-6">
          Hidden players are invisible to everyone but themselves and admins — enforced by the database, not just the UI.
        </p>
      </div>
    </div>
  );
}
