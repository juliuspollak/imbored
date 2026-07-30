import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, Crown, Flame, Gamepad2, Medal, Sparkles, Trophy, Users } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { isCommunityVisibleProfile } from "./lib/profileVisibility.js";
import Page from "./components/Page.jsx";
import PageHeader from "./components/PageHeader.jsx";
import Card from "./components/Card.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

const GAME_LABELS = {
  queens: "Queens", tango: "Tango", zip: "Zip",
  minisudoku: "Sudoku", geo: "Geo", zoom: "Zoom", animalrush: "Animal Rush",
};

function rankStyle(rank) {
  if (rank === 1) return { bg: "linear-gradient(145deg,#FFF9E8,#FFE9A8)", color: "#8A6414", Icon: Trophy };
  if (rank === 2) return { bg: "linear-gradient(145deg,#F8FAFC,#E2E8F0)", color: "#5E6B78", Icon: Medal };
  if (rank === 3) return { bg: "linear-gradient(145deg,#FFF7F2,#F5D8C7)", color: "#9A5B34", Icon: Medal };
  return { bg: "rgba(16,24,40,.055)", color: "#68717C", Icon: Award };
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
      supabase.rpc("get_public_player_game_summary"),
      supabase.from("animal_rush_match_results").select("user_id"),
      supabase.from("profiles").select("id, name, icon, mood, hidden_from_others, show_stats_to_others, account_deleted_at").is("account_deleted_at", null).eq("hidden_from_others", false),
      supabase.rpc("get_public_player_progress"),
    ]);
    const liveCounts = (liveResult.data || []).reduce((counts, item) => { counts[item.user_id] = (counts[item.user_id] || 0) + 1; return counts; }, {});
    const summaries = new Map((statsResult.data || []).map((item) => [item.player_id, item]));
    Object.entries(liveCounts).forEach(([playerId, games]) => {
      const current = summaries.get(playerId);
      summaries.set(playerId, { player_id: playerId, games_played: Number(current?.games_played || 0) + games, challenge_games: Number(current?.challenge_games || 0), practice_games: Number(current?.practice_games || 0), favourite_game: current?.favourite_game || "animalrush" });
    });
    setRows([...summaries.values()]);
    setProfiles(Object.fromEntries((profilesResult.data || []).filter(isCommunityVisibleProfile).map((item) => [item.id, item])));
    setProgress(Object.fromEntries((progressResult.data || []).map((item) => [item.player_id, item])));
    setProgressError(progressResult.error?.message || "");
    setSummaryError(statsResult.error?.message || "");
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const players = useMemo(() => {
    const activity = {};
    rows.forEach((row) => { activity[row.player_id] = { games: Number(row.games_played || 0), challenge: Number(row.challenge_games || 0), practice: Number(row.practice_games || 0), favourite: row.favourite_game || null }; });
    return Object.values(profiles).map((profile) => {
      const stats = activity[profile.id] || { games: 0, challenge: 0, practice: 0, favourite: null };
      return { userId: profile.id, profile, progress: progress[profile.id], ...stats };
    }).sort((a, b) => Number(b.progress?.lifetime_points || -1) - Number(a.progress?.lifetime_points || -1) || b.games - a.games || a.profile.name.localeCompare(b.profile.name));
  }, [profiles, progress, rows]);

  const visibleScores = players.filter((p) => p.progress?.lifetime_points != null);
  const leader = visibleScores[0];
  const totalGames = players.reduce((s, p) => s + p.games, 0);
  const averageLevel = visibleScores.length ? Math.round(visibleScores.reduce((s, p) => s + Number(p.progress.current_level || 1), 0) / visibleScores.length) : 0;

  return (
    <Page>
      <style>{`
        @media (hover:hover) and (pointer:fine) { .player-standing:hover { transform: translateY(-1px); box-shadow: 0 9px 24px rgba(20,35,60,.09); } }
        @media (prefers-reduced-motion:reduce) { .player-standing { transition: none !important; } }
      `}</style>
      <PageHeader title="Player Stats" subtitle="Community standings at a glance" onBack={onBack} />

      {!supabaseReady ? <StatusBanner variant="error">Supabase isn't configured yet.</StatusBanner> : <>
        {/* Hero stats card */}
        <section style={{ borderRadius: "var(--radius-xl)", padding: "var(--space-4)", marginBottom: "var(--space-4)", overflow: "hidden", position: "relative", background: "linear-gradient(145deg,#17233E 0%,#29467F 100%)", color: "#fff", boxShadow: "0 14px 34px rgba(31,52,102,.18)" }}>
          <div style={{ position: "absolute", width: 190, height: 190, right: -72, top: -105, background: "rgba(255,255,255,.07)", borderRadius: "50%" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-4)" }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".16em", opacity: .62 }}>Community standings</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "var(--space-1)" }}>{players.length} player{players.length === 1 ? "" : "s"}</div>
              <div style={{ fontSize: 10, marginTop: "var(--space-1)", opacity: .66 }}>Ranked by lifetime points</div>
            </div>
            <div style={{ display: "grid", placeItems: "center", width: 48, height: 48, borderRadius: "var(--radius-lg)", background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.14)" }}><Trophy size={22} /></div>
          </div>
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
            {[{ value: totalGames.toLocaleString(), label: "Scored games" }, { value: averageLevel || "—", label: "Average level" }, { value: leader ? `${leader.profile.icon || ""} ${leader.profile.name}` : "—", label: "Points leader" }].map((stat) => (
              <div key={stat.label} style={{ borderRadius: "var(--radius-lg)", padding: "10px var(--space-3)", background: "rgba(255,255,255,.09)" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 700 }} className="truncate">{stat.value}</div>
                <div style={{ fontSize: 9, opacity: .62 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {progressError && <div style={{ marginBottom: "var(--space-3)" }}><StatusBanner variant="error"><strong>Player totals could not be loaded.</strong> Apply the latest Player Stats database migration, then refresh.</StatusBanner></div>}
        {summaryError && <div style={{ marginBottom: "var(--space-3)" }}><StatusBanner variant="error"><strong>Scored-game totals could not be loaded.</strong> Apply the latest points-economy migration, then refresh.</StatusBanner></div>}

        {loading ? <p style={{ textAlign: "center", padding: "var(--space-8) 0", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>Loading standings…</p> : players.length === 0 ? (
          <Card style={{ textAlign: "center", padding: "var(--space-8)" }}>
            <Sparkles size={24} style={{ color: "var(--color-primary)", margin: "0 auto 8px" }} />
            <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>No player activity yet</div>
          </Card>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", marginBottom: "var(--space-2)", padding: "0 var(--space-1)" }}>
              <div>
                <div style={{ fontSize: "var(--text-body-size)", fontWeight: 700, color: "var(--color-text-primary)" }}>Leaderboard</div>
                <div style={{ fontSize: 9, color: "var(--color-text-secondary)" }}>Current lifetime standings</div>
              </div>
              <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--color-text-secondary)" }}>Points</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {players.map((player, index) => {
                const rank = index + 1;
                const rd = rankStyle(rank);
                const Icon = rd.Icon;
                const pp = player.progress;
                const hasPP = pp?.lifetime_points != null;
                return (
                  <article key={player.userId} className="player-standing" style={{ borderRadius: "var(--radius-lg)", padding: "var(--space-3)", background: "var(--color-surface)", border: player.userId === user?.id ? "1px solid var(--color-primary-subtle-border)" : "1px solid var(--color-border)", boxShadow: rank <= 3 ? "0 5px 16px rgba(20,35,60,.055)" : "none", transition: "transform var(--transition-fast), box-shadow var(--transition-fast)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", color: rd.color, background: rd.bg, flexShrink: 0 }}><Icon size={16} /></span>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{player.profile.icon || "🙂"}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: "var(--text-caption-size)", fontWeight: 700, color: "var(--color-text-primary)" }} className="truncate">{player.profile.name}</span>
                          {player.userId === user?.id && <span style={{ borderRadius: "var(--radius-full)", padding: "2px 6px", fontSize: 8, fontWeight: 700, background: "var(--color-info-bg)", color: "var(--color-primary)" }}>YOU</span>}
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "var(--space-1)" }}>
                          <span style={{ borderRadius: "var(--radius-full)", padding: "2px 6px", fontSize: 8, fontWeight: 700, color: "#6D3FD1", background: "rgba(124,58,237,.08)" }}>{hasPP ? `Level ${pp.current_level}` : "Private"}</span>
                          {player.favourite && <span style={{ fontSize: 9, color: "var(--color-text-secondary)" }} className="truncate">Likes {GAME_LABELS[player.favourite] || player.favourite}</span>}
                        </span>
                      </span>
                      <span style={{ textAlign: "right", flexShrink: 0 }}>
                        <span style={{ display: "block", fontSize: "1.1rem", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: hasPP ? "var(--color-text-primary)" : "#9AA1AB" }}>{hasPP ? Number(pp.lifetime_points).toLocaleString() : "—"}</span>
                        <span style={{ display: "block", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--color-text-secondary)" }}>total points</span>
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: "var(--space-2)", paddingTop: "var(--space-2)", borderTop: "1px solid var(--color-border)" }}>
                      {[{ icon: Gamepad2, value: player.games, label: "scored", color: "var(--color-primary)" }, { icon: Flame, value: hasPP ? (pp.current_streak || 0) : "—", label: "day streak", color: "#E86A33" }, { icon: Crown, value: player.challenge, label: "challenges", color: "#12946A" }].map((s) => (
                        <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          <span style={{ width: 24, height: 24, borderRadius: "var(--radius-sm)", display: "grid", placeItems: "center", color: s.color, background: `${s.color}12`, flexShrink: 0 }}><s.icon size={11} /></span>
                          <span><span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--color-text-primary)" }}>{s.value}</span><span style={{ display: "block", fontSize: 8, color: "var(--color-text-secondary)" }}>{s.label}</span></span>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", borderRadius: "var(--radius-lg)", padding: "var(--space-3)", marginTop: "var(--space-3)", background: "var(--color-info-bg)", color: "var(--color-text-primary)" }}>
              <Users size={13} style={{ color: "var(--color-primary)", flexShrink: 0, marginTop: 2 }} />
              <p style={{ fontSize: 9, lineHeight: 1.4, opacity: .6 }}>Standings use lifetime points. Scored games include every Challenge and only Practice completions that earned points, so rapid unrewarded replays do not inflate the count. Available wallet points remain private.</p>
            </div>
          </>
        )}
      </>}
    </Page>
  );
}