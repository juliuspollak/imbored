import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, LockKeyhole, Trophy } from "lucide-react";
import { MISSED_ROUND_PENALTY, buildChallengeStandings, explainTiebreak, fromServerStandings } from "./lib/challengeStandingsScoring.js";
import { useI18n } from "./lib/i18n.jsx";
import { GAME_NAMES } from "./lib/gameBranding.jsx";

function toBenchmarkMap(benchmarks) {
  return Object.fromEntries(benchmarks.map((item) => [`${item.game}:${item.day_index}`, Number(item.effective_seconds) || 100]));
}

function toSlots({ isCircle, rounds, games }) {
  return isCircle
    ? rounds.map((round) => ({ game: round.game, date: round.date }))
    : games.map((game) => ({ game: game.id }));
}

export default function ChallengeStandings({ rows = [], roster = [], games = [], rounds = [], benchmarks = [], serverStandings = null, previousRows = [], previousRounds = [], isCircle = false, userId, loading = false, defaultOpen = true, embedded = false, closed = false, winnerId = null, refreshing = false, periodLabel = null, periodIndex = 0, periodCount = 1, onPeriodChange = null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [expandedPlayerIds, setExpandedPlayerIds] = useState(() => new Set());

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

  const hasHistory = !!onPeriodChange && periodCount > 1;

  // Without the navigator there is nothing to render for an empty period. With
  // it, the arrows must survive an empty period or you cannot step back out of
  // a week nobody played.
  if (!standings.length && !hasHistory) {
    return loading ? <div role="status" style={{ textAlign: "center", padding: "var(--space-4)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-secondary-size)" }}>{t("standings.loading")}</div> : null;
  }

  const previousRankMap = Object.fromEntries(previousStandings.filter((s) => s.rank != null).map((s) => [s.userId, s.rank]));

  const navigator = hasHistory ? (
    <PeriodNavigator label={periodLabel} index={periodIndex} count={periodCount} onChange={onPeriodChange} refreshing={refreshing} />
  ) : null;

  const body = loading
    ? <div role="status" style={{ textAlign: "center", padding: "var(--space-4)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-secondary-size)" }}>{t("standings.loading")}</div>
    : standings.length
      ? <StandingsList standings={standings} expandedPlayerIds={expandedPlayerIds} setExpandedPlayerIds={setExpandedPlayerIds} previousRankMap={previousRankMap} closed={closed} winnerId={winnerId} />
      : <p style={{ margin: 0, textAlign: "center", padding: "var(--space-4)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-secondary-size)" }}>{t("standings.emptyPeriod")}</p>;

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
          <span style={{ flex: 1, fontSize: "var(--text-body-size)", fontWeight: 700 }}>{t("standings.title")}</span>
          <span style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>{t("standings.top", { count: standings.length })}</span>
          <ChevronDown size={17} style={{ color: "var(--color-icon-subtle)", transform: open ? "rotate(180deg)" : "none", transition: "transform var(--transition-fast)" }} />
        </button>
        {open && (
          <div id="challenge-standings-list" style={{ padding: "0 var(--space-3) var(--space-3)" }}>
            {navigator}
            {body}
          </div>
        )}
        <StandingsStyles />
      </section>
    );
  }

  return (
    <>
      {navigator}
      {body}
      <StandingsStyles />
    </>
  );
}

// Steps through past periods of the same challenge. Index 0 is the live one and
// higher indexes are further back, so "older" moves right and "newer" left.
function PeriodNavigator({ label, index, count, onChange, refreshing = false }) {
  const { t } = useI18n();
  const atOldest = index >= count - 1;
  const atNewest = index <= 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", margin: "var(--space-2) 0 var(--space-3)", padding: 3, border: "1px solid var(--color-border)", borderRadius: "var(--radius-full)", background: "var(--color-surface-elevated)" }}>
      <NavigatorButton
        onClick={() => onChange(index + 1)}
        disabled={atOldest}
        ariaLabel={t("standings.olderPeriod")}
      >
        <ChevronLeft size={17} />
      </NavigatorButton>
      <span aria-live="polite" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center", color: "var(--color-text-primary)", fontSize: "var(--text-body-secondary-size)", fontWeight: 600 }}>
        {label}
        {index > 0 && <span style={{ marginLeft: 6, color: "var(--color-text-secondary)", fontWeight: 500 }}>{t("standings.pastPeriod")}</span>}
        {refreshing && <span style={{ marginLeft: 6, color: "var(--color-text-muted)", fontWeight: 500 }}>{t("standings.updating")}</span>}
      </span>
      <NavigatorButton
        onClick={() => onChange(index - 1)}
        disabled={atNewest}
        ariaLabel={t("standings.newerPeriod")}
      >
        <ChevronRight size={17} />
      </NavigatorButton>
    </div>
  );
}

function NavigatorButton({ onClick, disabled, ariaLabel, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="challenge-period-button"
      style={{ width: 32, height: 32, display: "grid", placeItems: "center", flexShrink: 0, border: 0, borderRadius: "50%", background: "transparent", color: disabled ? "var(--color-text-muted)" : "var(--color-text-primary)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1 }}
    >
      {children}
    </button>
  );
}

function StandingsList({ standings, expandedPlayerIds, setExpandedPlayerIds, previousRankMap, closed, winnerId }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {standings.map((player, playerIndex) => {
        const rank = player.rank;
        const previousRank = previousRankMap[player.userId] ?? rank;
        const delta = rank == null || previousRank == null ? 0 : previousRank - rank;
        const isLeader = rank === 1 && player.score > 0;
        const expanded = expandedPlayerIds.has(player.userId);
        const isWinner = closed && winnerId === player.userId;
        // Why this player is above the next one when the score cannot say.
        // Without it, a table of identical scores looks arbitrary.
        const tiebreak = explainTiebreak(player, standings[playerIndex + 1]);

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
              onClick={() => setExpandedPlayerIds((current) => {
                const next = new Set(current);
                if (next.has(player.userId)) next.delete(player.userId);
                else next.add(player.userId);
                return next;
              })}
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
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-primary)", fontSize: "var(--text-body-size)", fontWeight: 600 }}>{player.name}{player.isCurrentUser ? t("standings.you") : ""}</span>
                <span style={{ display: "block", marginTop: 2, color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>
                  {t("standings.played", { played: player.played, total: player.total })}
                  {player.missed > 0 && t("standings.missed", { count: player.missed })}
                  {player.isPrivate && t("standings.private")}
                  {delta !== 0 && ` · ${delta > 0 ? "↑" : "↓"}${Math.abs(delta)}`}
                </span>
                {tiebreak && (
                  <span style={{ display: "block", marginTop: 3, color: "var(--color-warning-text)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>
                    {t(`standings.tiebreak.${tiebreak}`)}
                  </span>
                )}
              </span>
              <span style={{ flexShrink: 0, textAlign: "right" }}>
                <span style={{ display: "block", color: isLeader ? "var(--color-warning-text)" : "var(--color-text-primary)", fontSize: 19, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{player.score}</span>
                <span style={{ display: "block", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>{t("standings.score")}</span>
              </span>
              <ChevronDown size={17} style={{ flexShrink: 0, color: "var(--color-icon-subtle)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform var(--transition-fast)" }} />
            </button>
            {expanded && (
              <div id={`player-results-${player.userId}`} style={{ padding: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                {player.detailHidden ? (
                  <p style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, margin: 0, minHeight: 36, color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>
                    <LockKeyhole size={13} /> {t("standings.privateDetail", { name: player.name })}
                  </p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-2)" }}>
                    {player.dailyResults.map((res, di) => {
                      if (!res) return <span key={di} style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-surface)", color: "var(--color-text-muted)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>{t("standings.missedTile")}</span>;
                      if (res.is_private) return <span key={di} style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-surface)", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}><LockKeyhole size={13} /> {t("standings.privateTile")}</span>;
                      const score = player.dailyScores[di];
                      return (
                        <span key={di} style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 8px", border: `1px solid ${score >= 50 ? "var(--color-primary-subtle-border)" : "var(--color-danger-text)"}`, borderRadius: "var(--radius-sm)", background: score >= 50 ? "var(--color-primary-subtle)" : "var(--color-danger-bg)", color: score >= 50 ? "var(--color-primary)" : "var(--color-danger-text)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>
                          {GAME_NAMES[res.game] || res.game} {score}pt
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
      .challenge-player-toggle:focus-visible,
      .challenge-period-button:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: -2px;
      }
      @media (hover: hover) and (pointer: fine) {
        .challenge-standings-toggle:hover,
        .challenge-player-toggle:hover {
          background: var(--color-surface-elevated) !important;
        }
        .challenge-period-button:not(:disabled):hover {
          background: var(--color-surface) !important;
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