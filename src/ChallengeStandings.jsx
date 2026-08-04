import { useMemo, useState } from "react";
import { ChevronDown, LockKeyhole, Trophy } from "lucide-react";
import { MISSED_ROUND_PENALTY, buildChallengeStandings, fromServerStandings } from "./lib/challengeStandingsScoring.js";

function toBenchmarkMap(benchmarks) {
  return Object.fromEntries(benchmarks.map((item) => [`${item.game}:${item.day_index}`, Number(item.effective_seconds) || 100]));
}

function toSlots({ isCircle, rounds, games }) {
  return isCircle
    ? rounds.map((round) => ({ game: round.game, date: round.date }))
    : games.map((game) => ({ game: game.id }));
}

export default function ChallengeStandings({ rows = [], roster = [], games = [], rounds = [], benchmarks = [], serverStandings = null, previousRows = [], previousRounds = [], isCircle = false, userId, loading = false, defaultOpen = true, embedded = false, closed = false, winnerId = null }) {
  const [open, setOpen] = useState(defaultOpen);
  const [expandedPlayerId, setExpandedPlayerId] = useState(null);

  const standings = useMemo(() => {
    // The database ranks circle challenges so the standings agree with the
    // winner it pays. Score locally only when that RPC is unavailable.
    if (isCircle && serverStandings?.length) return fromServerStandings(serverStandings, userId);
    const slots = toSlots({ isCircle, rounds, games });
    if (slots.length === 0) return [];
    return buildChallengeStandings({
      rows,
      roster,
      slots,
      benchmarkMap: toBenchmarkMap(benchmarks),
      userId,
      missedPenalty: isCircle ? MISSED_ROUND_PENALTY : 0,
    });
  }, [rows, roster, games, rounds, benchmarks, serverStandings, isCircle, userId]);

  const previousStandings = useMemo(() => {
    const slots = toSlots({ isCircle, rounds: previousRounds, games });
    if (slots.length === 0) return [];
    return buildChallengeStandings({
      rows: previousRows,
      roster,
      slots,
      benchmarkMap: toBenchmarkMap(benchmarks),
      userId,
      missedPenalty: isCircle ? MISSED_ROUND_PENALTY : 0,
    });
  }, [previousRows, previousRounds, roster, benchmarks, games, isCircle, userId]);

  if (!standings.length) {
    return loading ? <div role="status" style={{ textAlign: "center", padding: "var(--space-4)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-secondary-size)" }}>Loading standings…</div> : null;
  }

  const previousRankMap = Object.fromEntries(previousStandings.filter((s) => s.rank != null).map((s) => [s.userId, s.rank]));

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
          <span style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>Top {standings.length}</span>
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
      {standings.map((player) => {
        const rank = player.rank;
        const previousRank = previousRankMap[player.userId] ?? rank;
        const delta = rank == null || previousRank == null ? 0 : previousRank - rank;
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
                {isLeader || isWinner ? <Trophy size={19} style={{ color: "var(--color-warning-gold)", display: "inline" }} /> : rank}
              </span>
              <span aria-hidden="true" style={{ width: 36, height: 36, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: "50%", background: "var(--color-avatar-bg)", border: "2px solid var(--color-avatar-border)", fontSize: 20 }}>{player.icon || "🙂"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-primary)", fontSize: "var(--text-body-size)", fontWeight: 600 }}>{player.name}{player.isCurrentUser ? " (you)" : ""}</span>
                <span style={{ display: "block", marginTop: 2, color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>
                  {`${player.played}/${player.total} played`}
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
                {player.detailHidden ? (
                  <p style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, margin: 0, minHeight: 36, color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>
                    <LockKeyhole size={13} /> {player.name} keeps their per-round results private.
                  </p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-2)" }}>
                    {player.dailyResults.map((res, di) => {
                      if (!res) return <span key={di} style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-surface)", color: "var(--color-text-muted)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>Missed</span>;
                      if (res.is_private) return <span key={di} style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-surface)", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}><LockKeyhole size={13} /> Private</span>;
                      const score = player.dailyScores[di];
                      return (
                        <span key={di} style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 8px", border: `1px solid ${score >= 50 ? "var(--color-primary-subtle-border)" : "var(--color-danger-text)"}`, borderRadius: "var(--radius-sm)", background: score >= 50 ? "var(--color-primary-subtle)" : "var(--color-danger-bg)", color: score >= 50 ? "var(--color-primary)" : "var(--color-danger-text)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>
                          {res.game} {score}pt
                        </span>
                      );
                    })}
                  </div>
                )}
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
