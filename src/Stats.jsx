import { useState, useEffect, useCallback } from "react";
import { Crown, Moon, Waypoints, Grid3x3, Home, EyeOff, ChevronDown, ChevronUp, Clock, TriangleAlert, Lightbulb } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";

const GAME_ICONS = { queens: Crown, tango: Moon, zip: Waypoints, minisudoku: Grid3x3, geo: Globe2 };
const GAME_LABELS = { queens: "Queens", tango: "Tango", zip: "Zip", minisudoku: "Sudoku", geo: "Geo" };
const GAME_COLORS = { queens: "#2F6FED", tango: "#4A6FA5", zip: "#12946A", minisudoku: "#0E7490", geo: "#DB2777" };

function statDate(row) {
  return row.challenge_date || row.completed_at?.slice(0, 10) || "Unknown date";
}

function formatDate(value) {
  if (value === "Unknown date") return value;
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function formatSeconds(value) {
  const seconds = Number(value) || 0;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

export default function Stats({ onBack }) {
  const { profile: myProfile, setUserHidden } = useAuth();
  const isAdmin = !!myProfile?.is_admin;

  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("challenge");
  const [expandedUserId, setExpandedUserId] = useState(null);

  const refresh = useCallback(() => {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    Promise.all([
      supabase.from("game_stats").select("user_id, game, mode, challenge_date, completed_at, seconds, mistakes, hints"),
      supabase.from("profiles").select("id, name, icon, mood, hidden_from_others, show_stats_to_others"),
    ]).then(([{ data: statsData }, { data: profilesData }]) => {
      setRows(statsData || []);
      setProfiles(Object.fromEntries((profilesData || []).map((p) => [p.id, p])));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleToggleHidden(userId, currentlyHidden) {
    await setUserHidden(userId, !currentlyHidden);
    refresh();
  }

  const modeRows = rows.filter((r) => r.mode === mode);
  const totalsByGame = { queens: 0, tango: 0, zip: 0, minisudoku: 0, geo: 0 };
  const byUser = {};
  modeRows.forEach((r) => {
    totalsByGame[r.game] = (totalsByGame[r.game] || 0) + 1;
    byUser[r.user_id] ||= { queens: 0, tango: 0, zip: 0, minisudoku: 0, geo: 0, total: 0, rows: [] };
    byUser[r.user_id][r.game] = (byUser[r.user_id][r.game] || 0) + 1;
    byUser[r.user_id].total += 1;
    byUser[r.user_id].rows.push(r);
  });
  const players = Object.entries(byUser)
    .map(([userId, counts]) => ({ userId, profile: profiles[userId], ...counts }))
    .filter((p) => p.profile)
    .sort((a, b) => b.total - a.total);

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex justify-center p-4 pt-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="nav-btn flex items-center gap-1.5 rounded-full pl-2 pr-3 py-1.5" style={{ "--nav-glow": "rgba(47,111,237,0.3)", "--nav-border": "rgba(47,111,237,0.4)", color: INK, background: "rgba(16,24,40,0.05)" }}>
            <Home size={15} /><span className="text-xs font-medium">Home</span>
          </button>
          <h1 style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK }} className="text-2xl">Stats</h1>
        </div>

        {!supabaseReady ? (
          <div className="text-xs rounded-lg p-3" style={{ background: "rgba(217,105,92,0.1)", color: "#B5433A" }}>Supabase isn't configured yet.</div>
        ) : (
          <>
            <div className="flex justify-center mb-6">
              <div className="inline-flex rounded-full p-1" style={{ background: "rgba(16,24,40,0.06)" }}>
                {["challenge", "practice"].map((m) => (
                  <button key={m} onClick={() => { setMode(m); setExpandedUserId(null); }} className="rounded-full px-4 py-1.5 text-xs font-semibold capitalize" style={{ background: mode === m ? PANEL : "transparent", color: mode === m ? INK : "rgba(27,33,41,0.5)", boxShadow: mode === m ? "0 2px 8px rgba(16,24,40,0.10)" : "none" }}>{m}</button>
                ))}
              </div>
            </div>

            {loading ? <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Loading…</p> : modeRows.length === 0 ? (
              <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">No {mode} games played yet.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
                  {["queens", "tango", "zip", "minisudoku", "geo"].map((g) => { const Icon = GAME_ICONS[g]; return (
                    <div key={g} className="rounded-xl p-3 text-center" style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)" }}><Icon size={16} style={{ color: GAME_COLORS[g], margin: "0 auto 4px" }} /><div style={{ color: INK, fontWeight: 700 }} className="text-lg">{totalsByGame[g]}</div><div style={{ color: INK, opacity: 0.45 }} className="text-[10px]">{GAME_LABELS[g]}</div></div>
                  ); })}
                  <div className="rounded-xl p-3 text-center flex flex-col items-center justify-center" style={{ background: ACCENT }}><div style={{ color: "#FFFFFF", fontWeight: 700 }} className="text-lg">{modeRows.length}</div><div style={{ color: "#FFFFFF", opacity: 0.8 }} className="text-[10px]">Total</div></div>
                </div>

                <p style={{ color: INK, opacity: 0.5 }} className="text-xs font-semibold uppercase tracking-wide mb-2">{players.length} player{players.length === 1 ? "" : "s"}</p>
                <div className="flex flex-col gap-2">
                  {players.map((p) => {
                    const expanded = expandedUserId === p.userId;
                    const daily = Object.entries(p.rows.reduce((acc, row) => { const date = statDate(row); (acc[date] ||= []).push(row); return acc; }, {})).sort(([a], [b]) => b.localeCompare(a));
                    return (
                      <div key={p.userId} className="rounded-xl overflow-hidden" style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)", opacity: p.profile.hidden_from_others ? 0.55 : 1 }}>
                        <div className="p-3 flex items-center gap-3">
                          <button className="flex flex-1 items-center gap-3 text-left min-w-0" onClick={() => setExpandedUserId(expanded ? null : p.userId)} aria-expanded={expanded}>
                            <span style={{ fontSize: 18 }}>{p.profile.icon || "🙂"}</span>
                            <div className="flex-1 min-w-0"><div style={{ color: INK, fontWeight: 600 }} className="text-sm truncate">{p.profile.name}{p.profile.mood && <span style={{ fontWeight: 400, opacity: 0.5 }} className="text-xs"> · {p.profile.mood}</span>}</div><div className="flex gap-2 mt-0.5 flex-wrap">{["queens", "tango", "zip", "minisudoku", "geo"].map((g) => p[g] > 0 ? <span key={g} style={{ color: GAME_COLORS[g] }} className="text-[10px] font-medium">{GAME_LABELS[g]} ×{p[g]}</span> : null)}</div></div>
                            <div style={{ color: INK, opacity: 0.4 }} className="text-xs font-semibold">{p.total}</div>
                            {expanded ? <ChevronUp size={15} style={{ color: INK, opacity: 0.45 }} /> : <ChevronDown size={15} style={{ color: INK, opacity: 0.45 }} />}
                          </button>
                          {isAdmin && <button onClick={() => handleToggleHidden(p.userId, p.profile.hidden_from_others)} className="flex items-center gap-1 rounded-full px-2 py-1" style={{ background: p.profile.hidden_from_others ? "rgba(181,67,58,0.1)" : "rgba(16,24,40,0.05)", color: p.profile.hidden_from_others ? "#B5433A" : INK, opacity: p.profile.hidden_from_others ? 1 : 0.45 }}><EyeOff size={12} /><span className="text-[10px] font-medium">{p.profile.hidden_from_others ? "Hidden" : "Hide"}</span></button>}
                        </div>
                        {expanded && (
                          <div className="px-3 pb-3 pt-1" style={{ borderTop: "1px solid rgba(16,24,40,0.07)" }}>
                            {daily.map(([date, dayRows]) => (
                              <div key={date} className="py-2.5" style={{ borderBottom: "1px solid rgba(16,24,40,0.06)" }}>
                                <div className="flex justify-between items-center mb-1.5"><span style={{ color: INK }} className="text-xs font-semibold">{formatDate(date)}</span><span style={{ color: INK, opacity: 0.45 }} className="text-[10px]">{dayRows.length} game{dayRows.length === 1 ? "" : "s"}</span></div>
                                <div className="flex flex-col gap-1.5">{dayRows.sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || "")).map((row, index) => { const Icon = GAME_ICONS[row.game] || Grid3x3; return (
                                  <div key={`${date}-${row.game}-${index}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: "rgba(16,24,40,0.035)" }}><Icon size={13} style={{ color: GAME_COLORS[row.game] || ACCENT }} /><span style={{ color: INK }} className="text-[11px] font-medium flex-1">{GAME_LABELS[row.game] || row.game}</span><span className="flex items-center gap-1 text-[10px]" style={{ color: INK, opacity: 0.55 }}><Clock size={10} />{formatSeconds(row.seconds)}</span><span className="flex items-center gap-1 text-[10px]" style={{ color: INK, opacity: 0.55 }}><TriangleAlert size={10} />{row.mistakes || 0}</span><span className="flex items-center gap-1 text-[10px]" style={{ color: INK, opacity: 0.55 }}><Lightbulb size={10} />{row.hints || 0}</span></div>
                                ); })}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
