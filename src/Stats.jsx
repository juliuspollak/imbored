import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award, ChevronDown, Clock, Crown, EyeOff, Flame, Globe2, Grid3x3,
  Lightbulb, Medal, Moon, Sparkles, Target, TriangleAlert, Trophy, Waypoints, ZoomIn,
} from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";

const BG = "#F1F3F7", PANEL = "#FFFFFF", INK = "#1B2129", ACCENT = "#2F6FED";
const GAMES = ["queens", "tango", "zip", "minisudoku", "geo", "zoom"];
const GAME_ICONS = { queens: Crown, tango: Moon, zip: Waypoints, minisudoku: Grid3x3, geo: Globe2, zoom: ZoomIn };
const GAME_LABELS = { queens: "Queens", tango: "Tango", zip: "Zip", minisudoku: "Sudoku", geo: "Geo", zoom: "Zoom" };
const GAME_COLORS = { queens: "#2F6FED", tango: "#4A6FA5", zip: "#12946A", minisudoku: "#0E7490", geo: "#DB2777", zoom: "#7C3AED" };

function statDate(row) { return row.challenge_date || row.completed_at?.slice(0, 10) || "Unknown date"; }
function formatDate(value) {
  if (value === "Unknown date") return value;
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
function formatSeconds(value) {
  const seconds = Number(value) || 0;
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
function rankStyle(rank) {
  if (rank === 1) return { color: "#8A6414", background: "#FFF5D6", icon: Trophy };
  if (rank === 2) return { color: "#5E6B78", background: "#EEF2F6", icon: Medal };
  if (rank === 3) return { color: "#9A5B34", background: "#FBECE2", icon: Medal };
  return { color: "#68717C", background: "rgba(16,24,40,.055)", icon: Award };
}

export default function Stats({ onBack }) {
  const { user, profile: myProfile, setUserHidden } = useAuth();
  const isAdmin = !!myProfile?.is_admin;
  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [progress, setProgress] = useState({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("challenge");
  const [expandedUserId, setExpandedUserId] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabaseReady) { setLoading(false); return; }
    setLoading(true);
    const [statsResult, profilesResult, progressResult] = await Promise.all([
      supabase.from("game_stats").select("user_id, game, mode, challenge_date, completed_at, seconds, mistakes, hints, zip_backtracked_cells, zip_required_moves"),
      supabase.from("profiles").select("id, name, icon, mood, hidden_from_others, show_stats_to_others"),
      supabase.rpc("get_public_player_progress"),
    ]);
    setRows(statsResult.data || []);
    setProfiles(Object.fromEntries((profilesResult.data || []).map((item) => [item.id, item])));
    setProgress(Object.fromEntries((progressResult.data || []).map((item) => [item.player_id, item])));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleToggleHidden(userId, currentlyHidden) {
    await setUserHidden(userId, !currentlyHidden);
    refresh();
  }

  const { players, totalsByGame, modeRows } = useMemo(() => {
    const filtered = rows.filter((row) => row.mode === mode);
    const totals = Object.fromEntries(GAMES.map((game) => [game, 0]));
    const byUser = {};
    filtered.forEach((row) => {
      totals[row.game] = (totals[row.game] || 0) + 1;
      byUser[row.user_id] ||= { total: 0, rows: [], ...Object.fromEntries(GAMES.map((game) => [game, 0])) };
      byUser[row.user_id][row.game] = (byUser[row.user_id][row.game] || 0) + 1;
      byUser[row.user_id].total += 1;
      byUser[row.user_id].rows.push(row);
    });
    const list = Object.entries(byUser).map(([userId, counts]) => ({
      userId, profile: profiles[userId], progress: progress[userId], ...counts,
    })).filter((item) => item.profile).sort((a, b) =>
      Number(b.progress?.lifetime_points || 0) - Number(a.progress?.lifetime_points || 0) || b.total - a.total
    );
    return { players: list, totalsByGame: totals, modeRows: filtered };
  }, [mode, profiles, progress, rows]);

  const leader = players[0];

  return <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex justify-center p-4 pt-10">
    <div className="w-full max-w-md">
      <header className="flex items-center gap-3 mb-5">
        <BackButton onClick={onBack}/>
        <div className="flex-1">
          <h1 className="text-2xl" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK }}>Player Stats</h1>
          <p className="text-[10px] mt-0.5" style={{ color: INK, opacity: .46 }}>Compare scores, levels and game activity</p>
        </div>
      </header>

      {!supabaseReady ? <div className="text-xs rounded-xl p-3" style={{ background: "rgba(181,67,58,.1)", color: "#B5433A" }}>Supabase isn't configured yet.</div> : <>
        <section className="rounded-3xl p-4 mb-3 overflow-hidden relative" style={{ background: "linear-gradient(145deg,#17233E 0%,#29467F 100%)", color: "white", boxShadow: "0 14px 34px rgba(31,52,102,.18)" }}>
          <div className="absolute rounded-full" style={{ width: 180, height: 180, right: -70, top: -90, background: "rgba(255,255,255,.07)" }}/>
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{ opacity: .62 }}>Community leaderboard</div>
              <div className="text-xl font-bold mt-1">{players.length} player{players.length === 1 ? "" : "s"}</div>
              <div className="text-[10px] mt-1" style={{ opacity: .66 }}>Ranked by lifetime score</div>
            </div>
            <div className="grid place-items-center rounded-2xl" style={{ width: 48, height: 48, background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.14)" }}><Trophy size={22}/></div>
          </div>
          <div className="relative grid grid-cols-2 gap-2 mt-4">
            <div className="rounded-2xl px-3 py-2.5" style={{ background: "rgba(255,255,255,.09)" }}><div className="text-lg font-bold">{modeRows.length.toLocaleString()}</div><div className="text-[9px]" style={{ opacity: .62 }}>{mode === "challenge" ? "Challenge" : "Practice"} games</div></div>
            <div className="rounded-2xl px-3 py-2.5" style={{ background: "rgba(255,255,255,.09)" }}><div className="text-lg font-bold truncate">{leader ? `${leader.profile.icon || "🙂"} ${leader.profile.name}` : "—"}</div><div className="text-[9px]" style={{ opacity: .62 }}>Current score leader</div></div>
          </div>
        </section>

        <div className="game-mode-switch mb-3" style={{ width: "100%" }}>
          {["challenge", "practice"].map((item) => <button key={item} onClick={() => { setMode(item); setExpandedUserId(null); }} className={`gloss-button ${mode === item ? "is-active" : ""}`} style={{ flex: 1 }}>{item}</button>)}
        </div>

        {loading ? <p style={{ color: INK, opacity: .4 }} className="text-sm text-center py-10">Loading player stats…</p> : modeRows.length === 0 ? <div className="rounded-2xl text-center py-10 px-4" style={{ background: PANEL, border: "1px solid rgba(16,24,40,.08)" }}><Sparkles size={24} style={{ color: ACCENT, margin: "0 auto 8px" }}/><div className="text-sm font-semibold" style={{ color: INK }}>No {mode} games yet</div><div className="text-[10px] mt-1" style={{ color: INK, opacity: .45 }}>Completed games will appear here.</div></div> : <>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {GAMES.map((game) => { const Icon = GAME_ICONS[game]; return <div key={game} className="rounded-2xl px-2 py-3 text-center" style={{ background: PANEL, border: "1px solid rgba(16,24,40,.08)" }}><Icon size={16} style={{ color: GAME_COLORS[game], margin: "0 auto 5px" }}/><div className="text-base font-bold" style={{ color: INK }}>{totalsByGame[game]}</div><div className="text-[9px]" style={{ color: INK, opacity: .43 }}>{GAME_LABELS[game]}</div></div>; })}
          </div>

          <div className="flex items-end justify-between mb-2 px-1"><div><div className="text-sm font-bold" style={{ color: INK }}>Leaderboard</div><div className="text-[9px]" style={{ color: INK, opacity: .42 }}>Tap a player to see game history</div></div><div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: INK, opacity: .4 }}>Lifetime score</div></div>
          <div className="flex flex-col gap-2">
            {players.map((player, index) => {
              const expanded = expandedUserId === player.userId;
              const rank = index + 1;
              const rankData = rankStyle(rank);
              const RankIcon = rankData.icon;
              const playerProgress = player.progress;
              const daily = Object.entries(player.rows.reduce((acc, row) => { const date = statDate(row); (acc[date] ||= []).push(row); return acc; }, {})).sort(([a], [b]) => b.localeCompare(a));
              return <article key={player.userId} className="rounded-2xl overflow-hidden" style={{ background: PANEL, border: player.userId === user?.id ? "1px solid rgba(47,111,237,.32)" : "1px solid rgba(16,24,40,.08)", boxShadow: rank <= 3 ? "0 5px 16px rgba(20,35,60,.055)" : "none", opacity: player.profile.hidden_from_others ? .58 : 1 }}>
                <div className="p-3 flex items-center gap-2.5">
                  <button type="button" className="flex flex-1 items-center gap-2.5 text-left min-w-0" onClick={() => setExpandedUserId(expanded ? null : player.userId)} aria-expanded={expanded}>
                    <span className="grid place-items-center rounded-xl shrink-0" style={{ width: 32, height: 32, color: rankData.color, background: rankData.background }}><RankIcon size={15}/></span>
                    <span className="text-xl shrink-0">{player.profile.icon || "🙂"}</span>
                    <span className="flex-1 min-w-0"><span className="flex items-center gap-1.5"><span className="block text-xs font-bold truncate" style={{ color: INK }}>{player.profile.name}</span>{player.userId === user?.id && <span className="rounded-full px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "rgba(47,111,237,.09)", color: ACCENT }}>YOU</span>}</span><span className="flex items-center gap-2 mt-1 text-[9px]" style={{ color: INK, opacity: .48 }}><span className="flex items-center gap-1"><Target size={10}/>{player.total} games</span>{playerProgress && <span className="flex items-center gap-1"><Flame size={10}/>{playerProgress.current_streak || 0} streak</span>}</span></span>
                    <span className="text-right shrink-0"><span className="block text-sm font-bold" style={{ color: INK }}>{playerProgress ? Number(playerProgress.lifetime_points).toLocaleString() : "—"}</span><span className="block text-[9px] mt-0.5" style={{ color: ACCENT, fontWeight: 700 }}>{playerProgress ? `Level ${playerProgress.current_level}` : "Score private"}</span></span>
                    <ChevronDown size={14} style={{ color: INK, opacity: .3, transform: expanded ? "rotate(180deg)" : "none", transition: "transform .15s" }}/>
                  </button>
                  {isAdmin && <button onClick={() => handleToggleHidden(player.userId, player.profile.hidden_from_others)} className="rounded-full grid place-items-center shrink-0" style={{ width: 28, height: 28, background: player.profile.hidden_from_others ? "rgba(181,67,58,.1)" : "rgba(16,24,40,.05)", color: player.profile.hidden_from_others ? "#B5433A" : INK, opacity: player.profile.hidden_from_others ? 1 : .42 }} aria-label={player.profile.hidden_from_others ? "Show player" : "Hide player"}><EyeOff size={12}/></button>}
                </div>
                {expanded && <div className="px-3 pb-3" style={{ borderTop: "1px solid rgba(16,24,40,.06)" }}>
                  {playerProgress && <div className="grid grid-cols-3 gap-1.5 py-3"><div className="rounded-xl p-2 text-center" style={{ background: "rgba(47,111,237,.06)" }}><div className="text-xs font-bold" style={{ color: INK }}>{Number(playerProgress.lifetime_points).toLocaleString()}</div><div className="text-[8px] mt-0.5" style={{ color: INK, opacity: .42 }}>Score</div></div><div className="rounded-xl p-2 text-center" style={{ background: "rgba(124,58,237,.06)" }}><div className="text-xs font-bold" style={{ color: INK }}>Level {playerProgress.current_level}</div><div className="text-[8px] mt-0.5" style={{ color: INK, opacity: .42 }}>Progress</div></div><div className="rounded-xl p-2 text-center" style={{ background: "rgba(234,88,12,.06)" }}><div className="text-xs font-bold" style={{ color: INK }}>{playerProgress.longest_streak || 0}</div><div className="text-[8px] mt-0.5" style={{ color: INK, opacity: .42 }}>Best streak</div></div></div>}
                  <div className="flex flex-wrap gap-1.5 pb-2">{GAMES.filter((game) => player[game] > 0).map((game) => <span key={game} className="rounded-full px-2 py-1 text-[9px] font-semibold" style={{ color: GAME_COLORS[game], background: `${GAME_COLORS[game]}10` }}>{GAME_LABELS[game]} ×{player[game]}</span>)}</div>
                  {daily.map(([date, dayRows]) => <div key={date} className="py-2.5" style={{ borderTop: "1px solid rgba(16,24,40,.055)" }}><div className="flex justify-between mb-1.5"><span className="text-[10px] font-semibold" style={{ color: INK }}>{formatDate(date)}</span><span className="text-[9px]" style={{ color: INK, opacity: .4 }}>{dayRows.length} game{dayRows.length === 1 ? "" : "s"}</span></div><div className="flex flex-col gap-1.5">{dayRows.sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || "")).map((row, rowIndex) => { const Icon = GAME_ICONS[row.game] || Grid3x3; return <div key={`${date}-${row.game}-${rowIndex}`} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: "rgba(16,24,40,.035)" }}><Icon size={12} style={{ color: GAME_COLORS[row.game] || ACCENT }}/><span className="text-[10px] font-semibold flex-1" style={{ color: INK }}>{GAME_LABELS[row.game] || row.game}</span><span className="flex items-center gap-1 text-[9px]" style={{ color: INK, opacity: .5 }}><Clock size={9}/>{formatSeconds(row.seconds)}</span><span className="flex items-center gap-1 text-[9px]" style={{ color: INK, opacity: .5 }}><TriangleAlert size={9}/>{row.mistakes || 0}</span><span className="flex items-center gap-1 text-[9px]" style={{ color: INK, opacity: .5 }}><Lightbulb size={9}/>{row.hints || 0}</span></div>; })}</div></div>)}
                </div>}
              </article>;
            })}
          </div>
          <div className="flex items-start gap-2 rounded-2xl px-3 py-2.5 mt-3" style={{ background: "rgba(47,111,237,.06)", color: INK }}><Sparkles size={13} className="shrink-0 mt-0.5" style={{ color: ACCENT }}/><p className="text-[9px] leading-relaxed" style={{ opacity: .52 }}>Score means lifetime points earned. Available points are private and may be lower after rewards or transfers. Players control whether others can see their stats.</p></div>
        </>}
      </>}
    </div>
  </div>;
}
