import { useMemo, useState } from "react";
import { ChevronDown, LockKeyhole, Trophy } from "lucide-react";

const HINT_PENALTY_SECONDS = 30;
const MISTAKE_PENALTY_SECONDS = 15;
const MIN_DAILY_SCORE = 20;
const MAX_DAILY_SCORE = 150;

function isoDayIndex(dateString) {
  return (new Date(`${dateString}T12:00:00`).getDay() || 7) - 1;
}

function dailyChallengeScore(result, benchmark) {
  const adjusted = Math.max(1, (Number(result.seconds) || 0) + (Number(result.hints) || 0) * HINT_PENALTY_SECONDS + (Number(result.mistakes) || 0) * MISTAKE_PENALTY_SECONDS);
  const score = Math.round((100 * Math.max(1, Number(benchmark) || 100)) / adjusted);
  return { adjusted, score: Math.max(MIN_DAILY_SCORE, Math.min(MAX_DAILY_SCORE, score)) };
}

function pooledChallengeScore(results, benchmarkMap) {
  const played = results.filter(Boolean);
  if (played.length === 0) return 0;
  return played.reduce((total, result) => total + dailyChallengeScore(result, benchmarkMap[`${result.game}:${isoDayIndex(result.challenge_date)}`]).score, 0);
}

export default function ChallengeStandings({ rows = [], roster = [], games = [], rounds = [], benchmarks = [], previousRows = [], previousRounds = [], isCircle = false, userId, loading = false, defaultOpen = true, embedded = false, closed = false, winnerId = null }) {
  const [open, setOpen] = useState(defaultOpen);
  const [expandedPlayerId, setExpandedPlayerId] = useState(null);

  const standings = useMemo(() => {
    const rowsByPlayer = rows.reduce((grouped, row) => { (grouped[row.user_id] ||= []).push(row); return grouped; }, {});
    if (isCircle && rounds.length > 0) {
      const benchmarkMap = Object.fromEntries(benchmarks.map((item) => [`${item.game}:${item.day_index}`, Number(item.effective_seconds) || 100]));
      return roster.map((member) => {
        const privateStats = member.id !== userId && member.show_stats_to_others === false;
        const memberRows = (rowsByPlayer[member.id] || []).slice().sort((a,b) => String(a.completed_at || "").localeCompare(String(b.completed_at || "")));
        const dailyResults = rounds.map((round) => {
          const result = memberRows.find((row) => row.challenge_date === round.date && row.game === round.game);
          if (!result) return null;
          return privateStats ? { ...result, seconds: 0, hints: 0, mistakes: 0, zip_required_moves: 0, zip_backtracked_cells: 0, is_private: true } : result;
        });
        const played = dailyResults.filter(Boolean);
        const score = pooledChallengeScore(dailyResults, benchmarkMap);
        const missed = rounds.length - played.length;
        return { userId: member.id, name: member.member_name || member.name, icon: member.member_icon || member.icon, score, dailyResults, played: played.length, missed, isCurrentUser: member.id === userId, isPrivate: privateStats };
      }).sort((a,b) => b.score - a.score);
    }
    if (!isCircle && games.length > 0) {
      const benchmarkMap = Object.fromEntries(benchmarks.map((item) => [`${item.game}:${item.day_index}`, Number(item.effective_seconds) || 100]));
      return roster.map((member) => {
        const privateStats = member.id !== userId && member.show_stats_to_others === false;
        const memberRows = (rowsByPlayer[member.id] || []).slice().sort((a, b) => String(a.completed_at || "").localeCompare(String(b.completed_at || "")));
        const dailyResults = games.map((game) => {
          const result = memberRows.find((row) => row.game === game.id);
          if (!result) return null;
          return privateStats ? { ...result, seconds: 0, hints: 0, mistakes: 0, zip_required_moves: 0, zip_backtracked_cells: 0, is_private: true } : result;
        });
        const played = dailyResults.filter(Boolean);
        return {
          userId: member.id,
          name: member.member_name || member.name,
          icon: member.member_icon || member.icon,
          score: pooledChallengeScore(dailyResults, benchmarkMap),
          dailyResults,
          played: played.length,
          missed: games.length - played.length,
          isCurrentUser: member.id === userId,
          isPrivate: privateStats,
        };
      }).sort((a, b) => b.score - a.score);
    }
    return [];
  }, [rows, roster, games, rounds, benchmarks, isCircle, userId]);

  const previousStandings = useMemo(() => {
    if (isCircle && previousRounds.length === 0) return [];
    if (!isCircle && games.length === 0) return [];
    const previousRowsByPlayer = previousRows.reduce((g, r) => { (g[r.user_id] ||= []).push(r); return g; }, {});
    const benchmarkMap = Object.fromEntries(benchmarks.map((i) => [`${i.game}:${i.day_index}`, Number(i.effective_seconds) || 100]));
    return roster.map((m) => {
      const results = isCircle
        ? previousRounds.map((round) => previousRowsByPlayer[m.id]?.find((row) => row.challenge_date === round.date && row.game === round.game) || null)
        : games.map((game) => previousRowsByPlayer[m.id]?.find((row) => row.game === game.id) || null);
      return { userId: m.id, score: pooledChallengeScore(results, benchmarkMap) };
    }).sort((a,b) => b.score - a.score);
  }, [previousRows, previousRounds, roster, benchmarks, games, isCircle]);

  if (!standings.length) {
    return loading ? <div role="status" style={{ textAlign: "center", padding: "var(--space-4)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-secondary-size)" }}>Loading standings…</div> : null;
  }

  const previousRankMap = Object.fromEntries(previousStandings.map((s, i) => [s.userId, i + 1]));

  if (embedded) {
    return (
      <section style={{ marginTop: "var(--space-3)", overflow: "hidden", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-surface)" }}>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls="challenge-standings-list"
          className="challenge-standings-toggle"
          style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%", minHeight: "var(--control-height-md)", padding: "var(--space-2) var(--space-3)", background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-primary)", fontFamily: "inherit", textAlign: "left" }}
        >
          <Trophy size={17} style={{ color: "var(--color-warning-gold)" }} />
          <span style={{ flex: 1, fontSize: "var(--text-body-size)", fontWeight: 700 }}>Standings</span>
          <span style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>{standings.length} players</span>
          <ChevronDown size={17} style={{ color: "var(--color-icon-subtle)", transform: open ? "rotate(180deg)" : "none", transition: "transform var(--transition-fast)" }} />
        </button>
        {open && (
          <div id="challenge-standings-list" style={{ padding: "0 var(--space-3) var(--space-3)" }}>
            <StandingsList standings={standings} expandedPlayerId={expandedPlayerId} setExpandedPlayerId={setExpandedPlayerId} previousRankMap={previousRankMap} closed={closed} winnerId={winnerId} />
          </div>
        )}
        <StandingsStyles />
      </section>
    );
  }

  return (
    <>
      <StandingsList standings={standings} expandedPlayerId={expandedPlayerId} setExpandedPlayerId={setExpandedPlayerId} previousRankMap={previousRankMap} closed={closed} winnerId={winnerId} />
      <StandingsStyles />
    </>
  );
}

function StandingsList({ standings, expandedPlayerId, setExpandedPlayerId, previousRankMap, closed, winnerId }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {standings.map((player, index) => {
        const rank = index + 1;
        const previousRank = previousRankMap[player.userId] || rank;
        const delta = previousRank - rank;
        const isLeader = rank === 1 && player.score > 0;
        const expanded = expandedPlayerId === player.userId;
        const isWinner = closed && winnerId === player.userId;

        return (
          <article
            key={player.userId}
            style={{
              overflow: "hidden",
              borderRadius: "var(--radius-md)",
              border: `1px solid ${player.isCurrentUser ? "var(--color-primary-subtle-border)" : isWinner ? "var(--color-warning-border)" : "var(--color-border)"}`,
              background: player.isCurrentUser ? "var(--color-primary-subtle)" : isWinner ? "var(--color-warning-bg)" : "var(--color-surface-elevated)",
            }}
          >
            <button
              type="button"
              onClick={() => setExpandedPlayerId(expanded ? null : player.userId)}
              aria-expanded={expanded}
              aria-controls={`player-results-${player.userId}`}
              className="challenge-player-toggle"
              style={{ width: "100%", minHeight: 64, display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3)", border: 0, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}
            >
              <span style={{ minWidth: 24, flexShrink: 0, textAlign: "center", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)", fontWeight: 700 }}>
                {isLeader ? <Trophy size={19} style={{ color: "var(--color-warning-gold)", display: "inline" }} /> : rank}
              </span>
              <span aria-hidden="true" style={{ width: 36, height: 36, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: "50%", background: "var(--color-avatar-bg)", border: "2px solid var(--color-avatar-border)", fontSize: 20 }}>{player.icon || "🙂"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-primary)", fontSize: "var(--text-body-size)", fontWeight: 600 }}>{player.name}{player.isCurrentUser ? " (you)" : ""}</span>
                <span style={{ display: "block", marginTop: 2, color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>
                  {player.played}/{player.dailyResults.length} played
                  {player.missed > 0 && ` · ${player.missed} missed`}
                  {player.isPrivate && " · Private"}
                  {delta !== 0 && ` · ${delta > 0 ? "↑" : "↓"}${Math.abs(delta)}`}
                </span>
              </span>
              <span style={{ flexShrink: 0, textAlign: "right" }}>
                <span style={{ display: "block", color: isLeader ? "var(--color-warning-text)" : "var(--color-text-primary)", fontSize: 19, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{player.score}</span>
                <span style={{ display: "block", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>points</span>
              </span>
              <ChevronDown size={17} style={{ flexShrink: 0, color: "var(--color-icon-subtle)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform var(--transition-fast)" }} />
            </button>
            {expanded && (
              <div id={`player-results-${player.userId}`} style={{ padding: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-2)" }}>
                  {player.dailyResults.map((res, di) => {
                    if (!res) return <span key={di} style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-surface)", color: "var(--color-text-muted)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>Missed</span>;
                    if (res.is_private) return <span key={di} style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-surface)", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}><LockKeyhole size={13} /> Private</span>;
                    const { score } = dailyChallengeScore(res, 100);
                    return (
                      <span key={di} style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 8px", border: `1px solid ${score >= 50 ? "var(--color-primary-subtle-border)" : "var(--color-danger-text)"}`, borderRadius: "var(--radius-sm)", background: score >= 50 ? "var(--color-primary-subtle)" : "var(--color-danger-bg)", color: score >= 50 ? "var(--color-primary)" : "var(--color-danger-text)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>
                        {res.game} {score}pt
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function StandingsStyles() {
  return (
    <style>{`
      .challenge-standings-toggle:focus-visible,
      .challenge-player-toggle:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: -2px;
      }
      @media (hover: hover) and (pointer: fine) {
        .challenge-standings-toggle:hover,
        .challenge-player-toggle:hover {
          background: var(--color-surface-elevated) !important;
        }
      }
      @media (min-width: 480px) {
        [id^="player-results-"] > div {
          grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .challenge-standings-toggle svg,
        .challenge-player-toggle svg {
          transition: none !important;
        }
      }
    `}</style>
  );
}
