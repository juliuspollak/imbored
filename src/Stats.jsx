import { useState, useEffect } from "react";
import { ArrowLeft, Crown, Moon, Waypoints, Home } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";

const GAME_ICONS = { queens: Crown, tango: Moon, zip: Waypoints };
const GAME_LABELS = { queens: "Queens", tango: "Tango", zip: "Zip" };
const GAME_COLORS = { queens: "#2F6FED", tango: "#4A6FA5", zip: "#12946A" };

export default function Stats({ onBack }) {
  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    Promise.all([
      supabase.from("game_stats").select("user_id, game"),
      supabase.from("profiles").select("id, name, icon, mood"),
    ]).then(([{ data: statsData }, { data: profilesData }]) => {
      setRows(statsData || []);
      setProfiles(Object.fromEntries((profilesData || []).map((p) => [p.id, p])));
      setLoading(false);
    });
  }, []);

  const totalsByGame = { queens: 0, tango: 0, zip: 0 };
  const byUser = {}; // user_id -> { queens: n, tango: n, zip: n, total: n }
  rows.forEach((r) => {
    totalsByGame[r.game] = (totalsByGame[r.game] || 0) + 1;
    byUser[r.user_id] ||= { queens: 0, tango: 0, zip: 0, total: 0 };
    byUser[r.user_id][r.game] = (byUser[r.user_id][r.game] || 0) + 1;
    byUser[r.user_id].total += 1;
  });
  const players = Object.entries(byUser)
    .map(([userId, counts]) => ({ userId, profile: profiles[userId], ...counts }))
    .sort((a, b) => b.total - a.total);

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex justify-center p-4 pt-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={onBack}
            className="nav-btn flex items-center gap-1.5 rounded-full pl-2 pr-3 py-1.5"
            style={{ "--nav-glow": "rgba(47,111,237,0.3)", "--nav-border": "rgba(47,111,237,0.4)", color: INK, background: "rgba(16,24,40,0.05)" }}
          >
            <Home size={15} />
            <span className="text-xs font-medium">Home</span>
          </button>
          <h1 style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK }} className="text-2xl">
            Stats
          </h1>
        </div>

        {!supabaseReady ? (
          <div className="text-xs rounded-lg p-3" style={{ background: "rgba(217,105,92,0.1)", color: "#B5433A" }}>
            Supabase isn't configured yet.
          </div>
        ) : loading ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">No games played yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-6">
              {["queens", "tango", "zip"].map((g) => {
                const Icon = GAME_ICONS[g];
                return (
                  <div key={g} className="rounded-xl p-3 text-center" style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)" }}>
                    <Icon size={16} style={{ color: GAME_COLORS[g], margin: "0 auto 4px" }} />
                    <div style={{ color: INK, fontWeight: 700 }} className="text-lg">{totalsByGame[g]}</div>
                    <div style={{ color: INK, opacity: 0.45 }} className="text-[10px]">{GAME_LABELS[g]}</div>
                  </div>
                );
              })}
            </div>

            <p style={{ color: INK, opacity: 0.5 }} className="text-xs font-semibold uppercase tracking-wide mb-2">
              {players.length} player{players.length === 1 ? "" : "s"}
            </p>
            <div className="flex flex-col gap-2">
              {players.map((p) => (
                <div key={p.userId} className="rounded-xl p-3 flex items-center gap-3" style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)" }}>
                  <span style={{ fontSize: 18 }}>{p.profile?.icon || "🙂"}</span>
                  <div className="flex-1">
                    <div style={{ color: INK, fontWeight: 600 }} className="text-sm">
                      {p.profile?.name || "Unknown"}
                      {p.profile?.mood && <span style={{ fontWeight: 400, opacity: 0.5 }} className="text-xs"> · {p.profile.mood}</span>}
                    </div>
                    <div className="flex gap-2 mt-0.5">
                      {["queens", "tango", "zip"].map((g) =>
                        p[g] > 0 ? (
                          <span key={g} style={{ color: GAME_COLORS[g] }} className="text-[10px] font-medium">
                            {GAME_LABELS[g]} ×{p[g]}
                          </span>
                        ) : null
                      )}
                    </div>
                  </div>
                  <div style={{ color: INK, opacity: 0.4 }} className="text-xs font-semibold">{p.total}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
