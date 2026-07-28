import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award, Crown, Flame, Gamepad2, Medal, Sparkles, Trophy, Users,
} from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { isCommunityVisibleProfile } from "./lib/profileVisibility.js";

const BG = "#F1F3F7", PANEL = "#FFFFFF", INK = "#1B2129", ACCENT = "#2F6FED";
const GAME_LABELS = {
  queens: "Queens", tango: "Tango", zip: "Zip",
  minisudoku: "Sudoku", geo: "Geo", zoom: "Zoom", animalrush: "Animal Rush",
};

function rankStyle(rank) {
  if (rank === 1) return { color: "#8A6414", background: "linear-gradient(145deg,#FFF9E8,#FFE9A8)", icon: Trophy };
  if (rank === 2) return { color: "#5E6B78", background: "linear-gradient(145deg,#F8FAFC,#E2E8F0)", icon: Medal };
  if (rank === 3) return { color: "#9A5B34", background: "linear-gradient(145deg,#FFF7F2,#F5D8C7)", icon: Medal };
  return { color: "#68717C", background: "rgba(16,24,40,.055)", icon: Award };
}

export default function Stats({ onBack }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [progress, setProgress] = useState({});
  const [loading, setLoading] = useState(true);
  const [progressError, setProgressError] = useState("");
  const [summaryError, setSummaryError] = useState("");

  const refresh = useCallback(async () => {
    if (!supabaseReady) { setLoading(false); return; }
    setLoading(true);
    const [statsResult, liveResult, profilesResult, progressResult] = await Promise.all([
      // Server-side aggregates exclude unrewarded rapid Practice replays.
      // Individual attempts, times, mistakes and hints never leave the RPC.
      supabase.rpc("get_public_player_game_summary"),
      supabase.from("animal_rush_match_results").select("user_id"),
      supabase.from("profiles").select("id, name, icon, mood, hidden_from_others, show_stats_to_others, account_deleted_at").is("account_deleted_at", null).eq("hidden_from_others", false),
      supabase.rpc("get_public_player_progress"),
    ]);
    const liveCounts = (liveResult.data || []).reduce((counts, item) => {
      counts[item.user_id] = (counts[item.user_id] || 0) + 1;
      return counts;
    }, {});
    const summaries = new Map((statsResult.data || []).map((item) => [item.player_id, item]));
    Object.entries(liveCounts).forEach(([playerId, games]) => {
      const current = summaries.get(playerId);
      summaries.set(playerId, {
        player_id: playerId,
        games_played: Number(current?.games_played || 0) + games,
        challenge_games: Number(current?.challenge_games || 0),
        practice_games: Number(current?.practice_games || 0),
        favourite_game: current?.favourite_game || "animalrush",
      });
    });
    setRows([...summaries.values()]);
    setProfiles(Object.fromEntries(
      (profilesResult.data || [])
        .filter(isCommunityVisibleProfile)
        .map((item) => [item.id, item]),
    ));
    setProgress(Object.fromEntries((progressResult.data || []).map((item) => [item.player_id, item])));
    setProgressError(progressResult.error?.message || "");
    setSummaryError(statsResult.error?.message || "");
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const players = useMemo(() => {
    const activity = {};
    rows.forEach((row) => {
      activity[row.player_id] = {
        games: Number(row.games_played || 0),
        challenge: Number(row.challenge_games || 0),
        practice: Number(row.practice_games || 0),
        favourite: row.favourite_game || null,
      };
    });

    return Object.values(profiles).map((profile) => {
      const stats = activity[profile.id] || { games: 0, challenge: 0, practice: 0, favourite: null };
      return {
        userId: profile.id,
        profile,
        progress: progress[profile.id],
        ...stats,
      };
    }).sort((a, b) =>
      Number(b.progress?.lifetime_points || -1) - Number(a.progress?.lifetime_points || -1)
      || b.games - a.games
      || a.profile.name.localeCompare(b.profile.name)
    );
  }, [profiles, progress, rows]);

  const visibleScores = players.filter((player) => player.progress?.lifetime_points != null);
  const leader = visibleScores[0];
  const totalGames = players.reduce((sum, player) => sum + player.games, 0);
  const averageLevel = visibleScores.length
    ? Math.round(visibleScores.reduce((sum, player) => sum + Number(player.progress.current_level || 1), 0) / visibleScores.length)
    : 0;

  return <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex justify-center p-4 pt-10">
    <style>{`
      @media (hover:hover) and (pointer:fine) {
        .player-standing:hover { transform: translateY(-1px); box-shadow: 0 9px 24px rgba(20,35,60,.09) !important; }
      }
      @media (prefers-reduced-motion:reduce) {
        .player-standing { transition:none !important; }
      }
    `}</style>
    <div className="w-full max-w-md">
      <header className="flex items-center gap-3 mb-5">
        <BackButton onClick={onBack}/>
        <div className="flex-1">
          <h1 className="text-2xl" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK }}>Player Stats</h1>
          <p className="text-[10px] mt-0.5" style={{ color: INK, opacity: .46 }}>Community standings at a glance</p>
        </div>
      </header>

      {!supabaseReady ? <div className="text-xs rounded-xl p-3" style={{ background: "rgba(181,67,58,.1)", color: "#B5433A" }}>Supabase isn't configured yet.</div> : <>
        <section className="rounded-3xl p-4 mb-4 overflow-hidden relative" style={{ background: "linear-gradient(145deg,#17233E 0%,#29467F 100%)", color: "white", boxShadow: "0 14px 34px rgba(31,52,102,.18)" }}>
          <div className="absolute rounded-full" style={{ width: 190, height: 190, right: -72, top: -105, background: "rgba(255,255,255,.07)" }}/>
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{ opacity: .62 }}>Community standings</div>
              <div className="text-xl font-bold mt-1">{players.length} player{players.length === 1 ? "" : "s"}</div>
              <div className="text-[10px] mt-1" style={{ opacity: .66 }}>Ranked by lifetime points</div>
            </div>
            <div className="grid place-items-center rounded-2xl" style={{ width: 48, height: 48, background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.14)" }}><Trophy size={22}/></div>
          </div>
          <div className="relative grid grid-cols-3 gap-2 mt-4">
            <div className="rounded-2xl px-3 py-2.5" style={{ background: "rgba(255,255,255,.09)" }}>
              <div className="text-base font-bold">{totalGames.toLocaleString()}</div>
              <div className="text-[9px]" style={{ opacity: .62 }}>Scored games</div>
            </div>
            <div className="rounded-2xl px-3 py-2.5" style={{ background: "rgba(255,255,255,.09)" }}>
              <div className="text-base font-bold">{averageLevel || "—"}</div>
              <div className="text-[9px]" style={{ opacity: .62 }}>Average level</div>
            </div>
            <div className="rounded-2xl px-3 py-2.5 min-w-0" style={{ background: "rgba(255,255,255,.09)" }}>
              <div className="text-base font-bold truncate">{leader?.profile.icon || "—"} {leader?.profile.name || ""}</div>
              <div className="text-[9px]" style={{ opacity: .62 }}>Points leader</div>
            </div>
          </div>
        </section>

        {progressError && <div className="rounded-2xl px-3 py-2.5 mb-3 text-[10px] leading-relaxed" role="alert" style={{ background: "rgba(229,72,77,.08)", color: "#A62F34", border: "1px solid rgba(229,72,77,.16)" }}><strong>Player totals could not be loaded.</strong> Apply the latest Player Stats database migration, then refresh this page.</div>}
        {summaryError && <div className="rounded-2xl px-3 py-2.5 mb-3 text-[10px] leading-relaxed" role="alert" style={{ background:"rgba(229,72,77,.08)",color:"#A62F34",border:"1px solid rgba(229,72,77,.16)" }}><strong>Scored-game totals could not be loaded.</strong> Apply the latest points-economy migration, then refresh this page.</div>}

        {loading ? <p style={{ color: INK, opacity: .4 }} className="text-sm text-center py-10">Loading standings…</p> : players.length === 0 ? <div className="rounded-2xl text-center py-10 px-4" style={{ background: PANEL, border: "1px solid rgba(16,24,40,.08)" }}><Sparkles size={24} style={{ color: ACCENT, margin: "0 auto 8px" }}/><div className="text-sm font-semibold" style={{ color: INK }}>No player activity yet</div></div> : <>
          <div className="flex items-end justify-between mb-2 px-1">
            <div>
              <div className="text-sm font-bold" style={{ color: INK }}>Leaderboard</div>
              <div className="text-[9px]" style={{ color: INK, opacity: .42 }}>Current lifetime standings</div>
            </div>
            <div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: INK, opacity: .4 }}>Points</div>
          </div>

          <div className="flex flex-col gap-2">
            {players.map((player, index) => {
              const rank = index + 1;
              const rankData = rankStyle(rank);
              const RankIcon = rankData.icon;
              const playerProgress = player.progress;
              const hasPublicProgress = playerProgress?.lifetime_points != null;
              return <article
                key={player.userId}
                className="player-standing rounded-2xl p-3 transition-all"
                style={{
                  background: PANEL,
                  border: player.userId === user?.id ? "1px solid rgba(47,111,237,.38)" : "1px solid rgba(16,24,40,.08)",
                  boxShadow: rank <= 3 ? "0 5px 16px rgba(20,35,60,.055)" : "none",
                }}
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid place-items-center rounded-xl shrink-0" style={{ width: 34, height: 34, color: rankData.color, background: rankData.background }}>
                    <RankIcon size={16}/>
                  </span>
                  <span className="text-xl shrink-0">{player.profile.icon || "🙂"}</span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="block text-xs font-bold truncate" style={{ color: INK }}>{player.profile.name}</span>
                      {player.userId === user?.id && <span className="rounded-full px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "rgba(47,111,237,.09)", color: ACCENT }}>YOU</span>}
                    </span>
                    <span className="flex items-center gap-1.5 mt-1">
                      <span className="rounded-full px-1.5 py-0.5 text-[8px] font-bold" style={{ color: "#6D3FD1", background: "rgba(124,58,237,.08)" }}>
                        {hasPublicProgress ? `Level ${playerProgress.current_level}` : "Private"}
                      </span>
                      {player.favourite && <span className="text-[9px] truncate" style={{ color: INK, opacity: .45 }}>Likes {GAME_LABELS[player.favourite] || player.favourite}</span>}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-base font-extrabold tabular-nums" style={{ color: hasPublicProgress ? INK : "#9AA1AB" }}>{hasPublicProgress ? Number(playerProgress.lifetime_points).toLocaleString() : "—"}</span>
                    <span className="block text-[8px] uppercase tracking-wide" style={{ color: INK, opacity: .38 }}>total points</span>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5 mt-2.5 pt-2.5" style={{ borderTop: "1px solid rgba(16,24,40,.055)" }}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="grid place-items-center rounded-lg shrink-0" style={{ width: 24, height: 24, color: ACCENT, background: "rgba(47,111,237,.07)" }}><Gamepad2 size={11}/></span>
                    <span><span className="block text-[10px] font-bold" style={{ color: INK }}>{player.games}</span><span className="block text-[8px]" style={{ color: INK, opacity: .4 }}>scored</span></span>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="grid place-items-center rounded-lg shrink-0" style={{ width: 24, height: 24, color: "#E86A33", background: "rgba(234,88,12,.07)" }}><Flame size={11}/></span>
                    <span><span className="block text-[10px] font-bold" style={{ color: INK }}>{hasPublicProgress ? playerProgress.current_streak || 0 : "—"}</span><span className="block text-[8px]" style={{ color: INK, opacity: .4 }}>day streak</span></span>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="grid place-items-center rounded-lg shrink-0" style={{ width: 24, height: 24, color: "#12946A", background: "rgba(18,148,106,.07)" }}><Crown size={11}/></span>
                    <span><span className="block text-[10px] font-bold" style={{ color: INK }}>{player.challenge}</span><span className="block text-[8px]" style={{ color: INK, opacity: .4 }}>challenges</span></span>
                  </div>
                </div>
              </article>;
            })}
          </div>

          <div className="flex items-start gap-2 rounded-2xl px-3 py-2.5 mt-3" style={{ background: "rgba(47,111,237,.06)", color: INK }}>
            <Users size={13} className="shrink-0 mt-0.5" style={{ color: ACCENT }}/>
            <p className="text-[9px] leading-relaxed" style={{ opacity: .52 }}>Standings use lifetime points. Scored games include every Challenge and only Practice completions that earned points, so rapid unrewarded replays do not inflate the count. Available wallet points remain private.</p>
          </div>
        </>}
      </>}
    </div>
  </div>;
}
