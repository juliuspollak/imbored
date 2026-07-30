import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Clock3, Lightbulb, LockKeyhole, Minus, TriangleAlert, Trophy } from "lucide-react";
import { useI18n } from "./lib/i18n.jsx";

const HINT_PENALTY_SECONDS = 30;
const MISTAKE_PENALTY_SECONDS = 15;
const MISSED_ROUND_SCORE = -100;
const MIN_DAILY_SCORE = 20;
const MAX_DAILY_SCORE = 150;

function formatDuration(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function isoDayIndex(dateString) {
  return (new Date(`${dateString}T12:00:00`).getDay() || 7) - 1;
}

function zipEfficiency(result) {
  const required = Math.max(1,Number(result?.zip_required_moves) || 1);
  const retraced = Math.max(0,Number(result?.zip_backtracked_cells) || 0);
  return Math.round((required/(required+retraced*2))*100);
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

export default function ChallengeStandings({ rows = [], roster = [], games = [], rounds = [], benchmarks = [], previousRows = [], previousRounds = [], historyRows = [], previousWeekLabel = null, isCircle = false, userId, loading = false, refreshing = false, defaultOpen = true, embedded = false, rewardPoints = 0, closed = false, winnerId = null, stakeRewardName = null, stakeSplitMethod = null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [expandedPlayerId, setExpandedPlayerId] = useState(null);
  const gameIds = useMemo(() => games.map((game) => game.id), [games]);

  const standings = useMemo(() => {
    const rowsByPlayer = rows.reduce((grouped, row) => { (grouped[row.user_id] ||= []).push(row); return grouped; }, {});
    if (isCircle && rounds.length > 0) {
      const benchmarkMap = Object.fromEntries(benchmarks.map((item) => [`${item.game}:${item.day_index}`, Number(item.effective_seconds) || 100]));
      const today = todayString();
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
        const completedDate = memberRows.find((row) => row.challenge_date === today)?.completed_at || null;
        return { userId: member.id, name: member.member_name || member.name, icon: member.member_icon || member.icon, isOwner: member.is_owner, score, dailyResults, played: played.length, missed, completedDate, isCurrentUser: member.id === userId, isPrivate: privateStats };
      }).sort((a,b) => b.score - a.score);
    }
    return [];
  }, [rows, roster, games, rounds, benchmarks, isCircle, userId]);

  const previousStandings = useMemo(() => {
    if (!isCircle || previousRounds.length === 0) return [];
    const previousRowsByPlayer = previousRows.reduce((g, r) => { (g[r.user_id] ||= []).push(r); return g; }, {});
    const benchmarkMap = Object.fromEntries(benchmarks.map((i) => [`${i.game}:${i.day_index}`, Number(i.effective_seconds) || 100]));
    return roster.map((m) => {
      const results = previousRounds.map((round) => previousRowsByPlayer[m.id]?.find((row) => row.challenge_date === round.date && row.game === round.game) || null);
      return { userId: m.id, score: pooledChallengeScore(results, benchmarkMap) };
    }).sort((a,b) => b.score - a.score);
  }, [previousRows, previousRounds, roster, benchmarks, isCircle]);

  const Token = { t: "var(--color-text-primary)", ts: "var(--color-text-secondary)", tm: "var(--color-text-secondary)", b: "var(--color-border)", bg: "var(--color-surface)", bg2: "var(--color-surface-elevated)", a: "var(--color-primary)", s: "var(--color-success-text)", d: "var(--color-danger-text)", w: "var(--color-warning-gold)", wb: "var(--color-warning-bg)" };

  if (!standings.length) {
    return loading ? <div style={{ textAlign: "center", padding: "var(--space-4)", color: Token.ts, fontSize: "var(--text-caption-size)" }}>Loading standings…</div> : null;
  }

  const winner = standings[0];
  const maxScore = winner?.score || 0;
  const previousRankMap = Object.fromEntries(previousStandings.map((s, i) => [s.userId, i + 1]));

  if (embedded) {
    return (
      <div style={{ borderRadius: "var(--radius-lg)", border: "1px solid var(--color-border)", overflow: "hidden", background: Token.bg }}>
        <button type="button" onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%", padding: "var(--space-3) var(--space-4)", background: "transparent", border: "none", cursor: "pointer", color: Token.t, fontFamily: "inherit", textAlign: "left" }}>
          <Trophy size={15} style={{ color: Token.w }} />
          <span style={{ flex: 1, fontSize: "var(--text-body-size)", fontWeight: 700 }}>Standings</span>
          <span style={{ fontSize: "var(--text-caption-size)", color: Token.ts }}>{standings.length} players</span>
          {open ? <ChevronUp size={15} style={{ opacity: .35 }} /> : <ChevronDown size={15} style={{ opacity: .35 }} />}
        </button>
        {open && (
          <div style={{ padding: "0 var(--space-3) var(--space-3)" }}>
            <StandingsList standings={standings} userId={userId} expandedPlayerId={expandedPlayerId} setExpandedPlayerId={setExpandedPlayerId} Token={Token} previousRankMap={previousRankMap} maxScore={maxScore} games={games} closed={closed} winnerId={winnerId} rewardPoints={rewardPoints} stakeRewardName={stakeRewardName} stakeSplitMethod={stakeSplitMethod} refreshing={refreshing} />
          </div>
        )}
      </div>
    );
  }

  return <StandingsList standings={standings} userId={userId} expandedPlayerId={expandedPlayerId} setExpandedPlayerId={setExpandedPlayerId} Token={Token} previousRankMap={previousRankMap} maxScore={maxScore} games={games} closed={closed} winnerId={winnerId} rewardPoints={rewardPoints} stakeRewardName={stakeRewardName} stakeSplitMethod={stakeSplitMethod} refreshing={refreshing} />;
}

function StandingsList({ standings, userId, expandedPlayerId, setExpandedPlayerId, Token, previousRankMap, maxScore, games, closed, winnerId, rewardPoints, stakeRewardName, stakeSplitMethod, refreshing }) {
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
          <div key={player.userId} style={{ borderRadius: "var(--radius-lg)", border: `1px solid ${player.isCurrentUser ? Token.a + "40" : (isWinner ? Token.w + "50" : Token.b)}`, background: player.isCurrentUser ? Token.a + "0A" : isWinner ? Token.wb : Token.bg2, padding: "var(--space-3)" }}>
            <div onClick={() => setExpandedPlayerId(expanded ? null : player.userId)} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", cursor: "pointer" }}>
              <span style={{ fontWeight: 700, fontSize: "var(--text-body-size)", color: Token.ts, minWidth: 24, textAlign: "center", flexShrink: 0 }}>
                {isLeader ? <Trophy size={18} style={{ color: Token.w, display: "inline" }} /> : rank}
              </span>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{player.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "var(--text-body-size)", fontWeight: 600, color: Token.t }} className="truncate">{player.name}{player.isCurrentUser ? " (you)" : ""}</span>
                <span style={{ display: "block", fontSize: 11, color: Token.ts }}>
                  {player.missed > 0 && `${player.missed} missed`}
                  {player.isPrivate && " · Private"}
                  {delta !== 0 && ` · ${delta > 0 ? "↑" : "↓"}${Math.abs(delta)}`}
                </span>
              </span>
              <span style={{ flexShrink: 0, textAlign: "right" }}>
                <span style={{ display: "block", fontSize: "1.2rem", fontWeight: 800, color: Token.w, fontVariantNumeric: "tabular-nums" }}>{player.score}</span>
                <span style={{ display: "block", fontSize: 9, color: Token.ts }}>points</span>
              </span>
              {expanded ? <ChevronUp size={14} style={{ opacity: .35 }} /> : <ChevronDown size={14} style={{ opacity: .35 }} />}
            </div>
            {expanded && (
              <div style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: `1px solid ${Token.b}` }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                  {player.dailyResults.map((res, di) => {
                    if (!res) return <span key={di} style={{ borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 10, fontWeight: 600, background: Token.bg2, color: Token.ts, border: `1px solid ${Token.b}` }}>—</span>;
                    if (res.is_private) return <span key={di} style={{ borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 10, fontWeight: 600, background: Token.bg2, color: Token.ts, border: `1px solid ${Token.b}` }}><LockKeyhole size={10} /> Private</span>;
                    const { score } = dailyChallengeScore(res, 100);
                    return (
                      <span key={di} style={{ borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 10, fontWeight: 600, background: score >= 50 ? Token.a + "12" : Token.d + "0A", color: score >= 50 ? Token.a : Token.d, border: `1px solid ${score >= 50 ? Token.a + "20" : Token.d + "15"}` }}>
                        {res.game} {score}pt
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}