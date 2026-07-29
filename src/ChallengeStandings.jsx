import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Clock3, Lightbulb, LockKeyhole, Minus, TriangleAlert, Trophy } from "lucide-react";
import { useI18n } from "./lib/i18n.jsx";

const INK = "#1B2129";
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
  const adjusted = Math.max(1,
    (Number(result.seconds) || 0)
    + (Number(result.hints) || 0) * HINT_PENALTY_SECONDS
    + (Number(result.mistakes) || 0) * MISTAKE_PENALTY_SECONDS
  );
  const score = Math.round((100 * Math.max(1, Number(benchmark) || 100)) / adjusted);
  return {
    adjusted,
    score:Math.max(MIN_DAILY_SCORE,Math.min(MAX_DAILY_SCORE,score)),
  };
}

function pooledChallengeScore(results, benchmarkMap) {
  const played = results.filter(Boolean);
  if (played.length === 0) return 0;
  return played.reduce((total, result) => total + dailyChallengeScore(
    result,
    benchmarkMap[`${result.game}:${isoDayIndex(result.challenge_date)}`]
  ).score, 0);
}

export default function ChallengeStandings({ rows = [], roster = [], games = [], rounds = [], benchmarks = [], previousRows = [], previousRounds = [], historyRows = [], previousWeekLabel = null, isTeam = false, userId, loading = false, refreshing = false, defaultOpen = true, embedded = false, rewardPoints = 0, closed = false, winnerId = null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [expandedPlayerId, setExpandedPlayerId] = useState(null);
  const gameIds = useMemo(() => games.map((game) => game.id), [games]);

  const standings = useMemo(() => {
    const rowsByPlayer = rows.reduce((grouped, row) => {
      (grouped[row.user_id] ||= []).push(row);
      return grouped;
    }, {});
    if (isTeam && rounds.length > 0) {
      const benchmarkMap = Object.fromEntries(
        benchmarks.map((item) => [`${item.game}:${item.day_index}`,Number(item.effective_seconds) || 100])
      );
      const today = todayString();
      const ranked = roster.map((member) => {
        const privateStats = member.id !== userId && member.show_stats_to_others === false;
        const memberRows = (rowsByPlayer[member.id] || []).slice().sort((a,b) =>
          String(a.completed_at || "").localeCompare(String(b.completed_at || ""))
        );
        const dailyResults = rounds.map((round) => {
          const result = memberRows.find((row) =>
            row.challenge_date === round.date && row.game === round.game
          );
          if (result) {
            const performance = dailyChallengeScore(
              result,
              benchmarkMap[`${round.game}:${isoDayIndex(round.date)}`]
            );
            return { ...round,result,played:true,missed:false,upcoming:false,...performance };
          }
          const missed = closed || round.date < today;
          return {
            ...round,
            result:null,
            played:false,
            missed,
            upcoming:!missed,
            adjusted:0,
            score:missed ? MISSED_ROUND_SCORE : 0,
          };
        });
        return {
          ...member,
          rows:memberRows,
          dailyResults,
          privateStats,
          completed:dailyResults.filter((round) => round.played).length,
          missed:dailyResults.filter((round) => round.missed).length,
          challengeScore:dailyResults.reduce((sum, round) => sum + round.score,0),
          totalSeconds:dailyResults.reduce((sum, round) => sum + (Number(round.result?.seconds) || 0),0),
          adjustedSeconds:dailyResults.reduce((sum, round) => sum + round.adjusted,0),
          hints:dailyResults.reduce((sum, round) => sum + (Number(round.result?.hints) || 0),0),
          mistakes:dailyResults.reduce((sum, round) => sum + (Number(round.result?.mistakes) || 0),0),
          finishedAt:memberRows.reduce((latest, row) =>
            String(row.completed_at || "") > latest ? String(row.completed_at || "") : latest
          ,""),
        };
      }).sort((a,b) => {
        if (a.challengeScore !== b.challengeScore) return b.challengeScore - a.challengeScore;
        if (a.completed !== b.completed) return b.completed - a.completed;
        if (a.hints !== b.hints) return a.hints - b.hints;
        if (a.mistakes !== b.mistakes) return a.mistakes - b.mistakes;
        if (a.adjustedSeconds !== b.adjustedSeconds) return a.adjustedSeconds - b.adjustedSeconds;
        if (a.finishedAt !== b.finishedAt) return a.finishedAt.localeCompare(b.finishedAt);
        return String(a.id || "").localeCompare(String(b.id || ""));
      });
      let competitionRank = 0;
      return ranked.map((standing) => ({
        ...standing,
        // Privacy hides the underlying time/hints/mistakes, not the player's
        // competition position. Otherwise the visible leader could disagree
        // with the server-selected winner.
        rank:standing.completed > 0 || standing.missed > 0 ? ++competitionRank : null,
      }));
    }
    const benchmarkMap = Object.fromEntries(
      benchmarks.map((item) => [`${item.game}:${item.day_index}`,Number(item.effective_seconds) || 100])
    );
    const ranked = roster
      .map((member) => {
        const privateStats = member.id !== userId && member.show_stats_to_others === false;
        const playerRows = (rowsByPlayer[member.id] || []).filter((row) => gameIds.includes(row.game));
        return {
          ...member,
          rows:playerRows,
          privateStats,
          completed:playerRows.length,
          totalSeconds:playerRows.reduce((total,row) => total + (Number(row.seconds) || 0),0),
          adjustedSeconds:playerRows.reduce((total,row) => total + dailyChallengeScore(
            row,
            benchmarkMap[`${row.game}:${isoDayIndex(row.challenge_date)}`]
          ).adjusted,0),
          challengeScore:pooledChallengeScore(playerRows,benchmarkMap),
          hints:playerRows.reduce((total,row) => total + (Number(row.hints) || 0),0),
          mistakes:playerRows.reduce((total,row) => total + (Number(row.mistakes) || 0),0),
        };
      })
      .sort((a,b) => {
        if (a.privateStats !== b.privateStats) return a.privateStats ? 1 : -1;
        if (a.completed !== b.completed) return b.completed - a.completed;
        if (a.challengeScore !== b.challengeScore) return b.challengeScore - a.challengeScore;
        if (a.adjustedSeconds !== b.adjustedSeconds) return a.adjustedSeconds - b.adjustedSeconds;
        if (a.hints !== b.hints) return a.hints - b.hints;
        if (a.mistakes !== b.mistakes) return a.mistakes - b.mistakes;
        return (a.name || "").localeCompare(b.name || "");
      });
    let visibleRank = 0;
    return ranked.map((standing) => ({
      ...standing,
      rank: !standing.privateStats && standing.completed > 0 ? ++visibleRank : null,
    }));
  }, [benchmarks, closed, gameIds, isTeam, roster, rounds, rows, userId]);

  const myStanding = standings.find((standing) => standing.id === userId) || null;
  const previousComparison = useMemo(() => {
    if (!myStanding) return null;
    const benchmarkMap = Object.fromEntries(
      benchmarks.map((item) => [`${item.game}:${item.day_index}`,Number(item.effective_seconds) || 100])
    );
    const myPreviousRows = previousRows.filter((row) => row.user_id === userId);

    if (isTeam) {
      if (previousRounds.length === 0) return null;
      const comparableCount = closed
        ? rounds.length
        : myStanding.dailyResults.filter((round) => !round.upcoming).length;
      if (comparableCount <= 0) return null;
      const priorScore = previousRounds.slice(0,comparableCount).reduce((sum,round) => {
        const result = myPreviousRows.find((row) =>
          row.challenge_date === round.date && row.game === round.game
        );
        if (!result) return sum + MISSED_ROUND_SCORE;
        return sum + dailyChallengeScore(
          result,
          benchmarkMap[`${round.game}:${isoDayIndex(round.date)}`]
        ).score;
      },0);
      const currentScore = myStanding.dailyResults
        .slice(0,comparableCount)
        .reduce((sum,round) => sum + round.score,0);
      return { rounds:comparableCount,previousScore:priorScore,currentScore,delta:currentScore-priorScore };
    }

    const matchingGames = myStanding.rows
      .filter((row) => myPreviousRows.some((previous) => previous.game === row.game));
    if (matchingGames.length === 0) return null;
    const priorResults = matchingGames.map((current) =>
      myPreviousRows.find((row) => row.game === current.game)
    );
    const priorScore = pooledChallengeScore(priorResults,benchmarkMap);
    const currentScore = pooledChallengeScore(matchingGames,benchmarkMap);
    return {
      rounds:matchingGames.length,
      previousScore:priorScore,
      currentScore,
      delta:currentScore-priorScore,
    };
  }, [benchmarks, closed, isTeam, myStanding, previousRounds, previousRows, rounds.length, userId]);

  const historyStandings = useMemo(() => {
    if (isTeam || historyRows.length === 0) return [];
    const benchmarkMap = Object.fromEntries(
      benchmarks.map((item) => [`${item.game}:${item.day_index}`,Number(item.effective_seconds) || 100])
    );
    const grouped = historyRows.reduce((players,row) => {
      if (!gameIds.includes(row.game)) return players;
      const entry = players[row.user_id] ||= { rows:[],dates:new Set() };
      entry.rows.push(row);
      entry.dates.add(row.challenge_date);
      return players;
    },{});
    return roster.map((member) => {
      const result = grouped[member.id] || { rows:[],dates:new Set() };
      return {
        ...member,
        completed:result.rows.length,
        days:result.dates.size,
        challengeScore:pooledChallengeScore(result.rows,benchmarkMap),
        privateStats:member.id !== userId && member.show_stats_to_others === false,
      };
    }).filter((item) => item.completed > 0 || item.privateStats)
      .sort((a,b) => {
        if (a.privateStats !== b.privateStats) return a.privateStats ? 1 : -1;
        if (a.challengeScore !== b.challengeScore) return b.challengeScore-a.challengeScore;
        if (a.completed !== b.completed) return b.completed-a.completed;
        return (a.name || "").localeCompare(b.name || "");
      }).map((item,index) => ({ ...item,rank:item.privateStats ? null : index+1 }));
  },[benchmarks,gameIds,historyRows,isTeam,roster,userId]);
  const myHistory = historyStandings.find((item) => item.id === userId) || null;
  const personalHistoryByDate = useMemo(() => {
    if (isTeam) return [];
    const benchmarkMap = Object.fromEntries(
      benchmarks.map((item) => [`${item.game}:${item.day_index}`,Number(item.effective_seconds) || 100])
    );
    return historyRows.filter((row) => row.user_id === userId)
      .reduce((dates,row) => {
        const item = dates.find((entry) => entry.date === row.challenge_date);
        if (item) {
          item.games += 1;
          item.rows.push(row);
        } else {
          dates.push({ date:row.challenge_date,games:1,rows:[row] });
        }
        return dates;
      },[]).map((item) => ({
        ...item,
        score:pooledChallengeScore(item.rows,benchmarkMap),
      })).sort((a,b) => b.date.localeCompare(a.date));
  },[benchmarks,historyRows,isTeam,userId]);

  const playedCount = standings.filter((standing) => standing.completed > 0).length;
  const displayedStandings = useMemo(() => {
    if (isTeam) return standings;
    const active = standings.filter((standing) => standing.completed > 0 && !standing.privateStats);
    const top = active.slice(0,3);
    const mine = active.find((standing) => standing.id === userId);
    return mine && !top.some((standing) => standing.id === userId) ? [...top,mine] : top;
  },[isTeam,standings,userId]);
  const displayedHistoryStandings = useMemo(() => {
    const visible = historyStandings.filter((standing) => !standing.privateStats);
    const top = visible.slice(0,3);
    const mine = visible.find((standing) => standing.id === userId);
    return mine && !top.some((standing) => standing.id === userId) ? [...top,mine] : top;
  },[historyStandings,userId]);
  const leader = (closed && winnerId
    ? standings.find((standing) => standing.id === winnerId)
    : null) || standings.find((standing) => standing.rank === 1);
  const challengeComplete = isTeam && closed;

  const heading = challengeComplete ? "Final results" : isTeam ? t("standings.title") : "Today’s standings";
  const summary = challengeComplete
    ? `${rounds.length || games.length} rounds · missed round −${Math.abs(MISSED_ROUND_SCORE)}`
    : isTeam
      ? `${playedCount} of ${roster.length} started · ${rounds.length || games.length} daily rounds`
      : `${playedCount} of ${roster.length} players started · ${games.length} games today`;

  return (
    <div className={`challenge-standings-card ${embedded ? "rounded-2xl" : "rounded-3xl"} mt-3 overflow-hidden`} style={{ background:"#fff",border:"1px solid rgba(16,24,40,.09)",boxShadow:embedded ? "none" : "0 10px 28px rgba(16,24,40,.06)" }}>
      <button type="button" onClick={() => setOpen((value) => !value)} className={`w-full flex items-center gap-3 text-left ${embedded ? "p-3" : "p-4"}`} aria-expanded={open}>
        <span className="grid place-items-center rounded-2xl shrink-0" style={{ width:embedded ? 36 : 42,height:embedded ? 36 : 42,background:challengeComplete ? "rgba(22,163,74,.12)" : "rgba(217,174,88,.13)",color:challengeComplete ? "#137A3A" : "#9A721F" }}><Trophy size={embedded ? 16 : 19}/></span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold">{heading}</span>
            {(loading || refreshing) && <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color:"rgba(27,33,41,.42)" }}><span className="inline-block rounded-full animate-pulse" style={{ width:6,height:6,background:"#2F6FED" }}/>{t(refreshing ? "standings.updating" : "standings.loadingShort")}</span>}
            {!loading && leader && (
              <span className="truncate text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background:challengeComplete ? "rgba(22,163,74,.11)" : "rgba(217,174,88,.13)",color:challengeComplete ? "#137A3A" : "#80601D" }}>
                {leader.icon || "🙂"} {challengeComplete ? `${leader.name} won` : t("standings.leads", { name:leader.name })}
              </span>
            )}
          </span>
          <span className="block text-[11px] mt-0.5" style={{ color:"rgba(27,33,41,.48)" }}>{summary}</span>
        </span>
        {open ? <ChevronUp size={16} style={{ opacity:.35 }}/> : <ChevronDown size={16} style={{ opacity:.35 }}/>} 
      </button>

      {open && (
        <div className="px-3 pb-3">
          {!loading && isTeam && challengeComplete && (
            <div className="challenge-complete-card rounded-2xl mb-3" role="status">
              <span className="challenge-complete-icon" aria-hidden="true">🏆</span>
              <span className="challenge-complete-copy">
                <span className="challenge-complete-title">Challenge complete</span>
                {leader && (
                  <span className="challenge-complete-winner">
                    <span aria-hidden="true">{leader.icon || "🙂"}</span>
                    <span><strong>{leader.name}</strong> won with {leader.challengeScore} challenge points</span>
                  </span>
                )}
              </span>
              {rewardPoints > 0 && (
                <span className="challenge-complete-points">+{rewardPoints}<small>Winner’s prize</small></span>
              )}
            </div>
          )}
          {!loading && myStanding && myStanding.completed > 0 && (
            <div className="challenge-my-summary rounded-2xl px-3 py-3 mb-3" style={{ background:"linear-gradient(135deg,rgba(47,111,237,.10),rgba(124,58,237,.055))",border:"1px solid rgba(47,111,237,.14)" }}>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="challenge-summary-muted text-[9px] font-bold uppercase tracking-[.12em]" style={{ color:"rgba(27,33,41,.42)" }}>{isTeam ? "Your week" : "Your result"}</div>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-base font-bold">{myStanding.rank ? `#${myStanding.rank}` : "—"}</span>
                    <span className="challenge-summary-muted text-[10px]" style={{ color:"rgba(27,33,41,.46)" }}>
                      {isTeam
                        ? `of ${standings.filter((item) => item.rank).length}`
                        : `of ${playedCount} active today`}
                    </span>
                  </div>
                  <div className="challenge-summary-muted text-[10px] mt-1" style={{ color:"rgba(27,33,41,.50)" }}>
                    {myStanding.completed}/{rounds.length || games.length} played · {formatDuration(myStanding.adjustedSeconds)} adjusted
                    {isTeam && myStanding.missed ? ` · ${myStanding.missed} missed` : ""}
                  </div>
                </div>
                <div className="challenge-summary-points rounded-full px-3 py-1.5 text-sm font-bold shrink-0" style={{ background:"#fff",color:"#2F6FED",boxShadow:"0 4px 12px rgba(47,111,237,.10)" }}>
                  {myStanding.challengeScore} pts
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2.5 pt-2.5" style={{ borderTop:"1px solid rgba(47,111,237,.10)" }}>
                {previousComparison ? (
                  <>
                    <span className="grid place-items-center rounded-full" style={{ width:22,height:22,background:previousComparison.delta > 0 ? "rgba(18,148,106,.12)" : previousComparison.delta < 0 ? "rgba(181,67,58,.10)" : "rgba(16,24,40,.06)",color:previousComparison.delta > 0 ? "#0B7C58" : previousComparison.delta < 0 ? "#B5433A" : "rgba(27,33,41,.55)" }}>
                      {previousComparison.delta > 0 ? <ArrowUp size={12}/> : previousComparison.delta < 0 ? <ArrowDown size={12}/> : <Minus size={12}/>}
                    </span>
                    <span className="text-[10px] font-semibold">
                      {previousComparison.delta > 0
                        ? `${previousComparison.delta} points ahead of last week`
                        : previousComparison.delta < 0
                          ? `${Math.abs(previousComparison.delta)} points behind last week`
                          : "Level with last week"}
                    </span>
                    <span className="ml-auto text-[9px]" style={{ color:"rgba(27,33,41,.38)" }}>
                      same {previousComparison.rounds} {isTeam ? `round${previousComparison.rounds === 1 ? "" : "s"}` : `game${previousComparison.rounds === 1 ? "" : "s"}`}
                    </span>
                  </>
                ) : (
                  <span className="challenge-summary-muted text-[10px]" style={{ color:"rgba(27,33,41,.44)" }}>
                    {previousWeekLabel ? (isTeam ? "Comparison starts after your first scheduled round." : "No matching result from last week.") : "No previous result to compare."}
                  </span>
                )}
              </div>
            </div>
          )}
          {!loading && displayedStandings.length > 0 && (
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-[.12em]" style={{ color:"rgba(27,33,41,.38)" }}>{isTeam ? "Team standings" : "Challenge standings"}</span>
              <span className="text-[9px]" style={{ color:"rgba(27,33,41,.38)" }}>{isTeam ? "Highest score first" : "Completed, then overall score"}</span>
            </div>
          )}
          {loading ? (
            <div className="space-y-2" role="status" aria-label={t("standings.loading")}>
              {[0,1,2].map((item) => <div key={item} className="h-[58px] rounded-2xl animate-pulse" style={{ background:"linear-gradient(90deg,#F4F5F8,#FAFAFC,#F4F5F8)" }}/>) }
            </div>
          ) : standings.length === 0 ? (
            <div className="rounded-2xl py-5 px-4 text-center" style={{ background:"#F7F8FB" }}>
              <div className="text-sm font-semibold">{t("standings.emptyTitle")}</div>
              <div className="text-[11px] mt-1" style={{ color:"rgba(27,33,41,.48)" }}>{t("standings.emptyBody")}</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {displayedStandings.map((standing) => {
                const isExpanded = expandedPlayerId === standing.id;
                const requiredCount = isTeam && rounds.length ? rounds.length : games.length;
                const progress = requiredCount ? Math.round((standing.completed / requiredCount) * 100) : 0;
                const finished = requiredCount > 0 && standing.completed === requiredCount;
                return (
                  <button
                    type="button"
                    key={standing.id}
                    onClick={() => !standing.privateStats && setExpandedPlayerId(isExpanded ? null : standing.id)}
                    className="challenge-standing-row w-full rounded-2xl p-3 text-left"
                    data-current={standing.id === userId ? "true" : "false"}
                    data-leading={standing.rank === 1 ? "true" : "false"}
                    style={{ background:standing.id === userId ? "rgba(47,111,237,.07)" : "#F7F8FB",border:standing.rank === 1 ? "1px solid rgba(217,174,88,.35)" : "1px solid transparent" }}
                    aria-expanded={isExpanded}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="w-5 text-center text-xs font-bold" style={{ color:standing.rank === 1 ? "#9A721F" : "rgba(27,33,41,.35)" }}>{standing.rank || "—"}</span>
                      <span className="challenge-standing-avatar grid place-items-center rounded-full text-sm shrink-0" style={{ width:32,height:32,background:"#fff" }}>{standing.icon || "🙂"}</span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold truncate">{standing.name || t("common.player")}{standing.id === userId ? ` · ${t("standings.you")}` : ""}</span>
                          {finished && (
                            <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold shrink-0" style={{ background:"rgba(18,148,106,.10)",color:"#0B7C58" }}>
                              <Check size={9} strokeWidth={3}/> Completed
                            </span>
                          )}
                        </span>
                        {standing.privateStats ? (
                          <span className="flex items-center gap-1 text-[10px] mt-0.5" style={{ color:"rgba(27,33,41,.42)" }}><LockKeyhole size={10}/>{t("standings.private")}</span>
                        ) : (
                          <span className="block h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background:"rgba(16,24,40,.08)" }}>
                            <span className="block h-full rounded-full" style={{ width:`${progress}%`,background:finished ? "#12946A" : "#2F6FED" }}/>
                          </span>
                        )}
                      </span>
                      {!standing.privateStats && (
                        <span className="text-right shrink-0">
                          <span className="block text-xs font-bold">
                            {`${standing.challengeScore} pts`}
                          </span>
                          <span className="flex items-center justify-end gap-1 text-[10px] mt-0.5" style={{ color:"rgba(27,33,41,.48)" }}>
                            {isTeam
                              ? `${standing.completed}/${requiredCount} played${standing.missed ? ` · ${standing.missed} missed` : ""}`
                              : standing.completed > 0
                                ? `${standing.completed}/${requiredCount} played · ${formatDuration(standing.adjustedSeconds)} adjusted`
                                : t("standings.notStarted")}
                          </span>
                        </span>
                      )}
                    </span>

                    {isExpanded && (
                      <span className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-3 pt-3" style={{ borderTop:"1px solid rgba(16,24,40,.07)" }}>
                        {(isTeam ? standing.dailyResults : games).map((item) => {
                          const game = isTeam
                            ? games.find((candidate) => candidate.id === item.game) || { id:item.game,label:item.game,icon:Clock3,accent:"#2F6FED" }
                            : item;
                          const result = isTeam ? item.result : standing.rows.find((row) => row.game === game.id);
                          const GameIcon = game.icon;
                          return (
                            <span key={isTeam ? item.date : game.id} className="challenge-round-result flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background:"#fff" }}>
                              <GameIcon size={13} style={{ color:game.accent }}/>
                              <span className="text-[11px] font-medium flex-1">
                                {isTeam ? `${new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined,{ weekday:"short" })} · ` : ""}{game.label}
                              </span>
                              {result ? (
                                <span className="text-[10px] font-semibold flex items-center gap-1.5" style={{ color:INK }}>
                                  <Clock3 size={10}/>{formatDuration(result.seconds)}
                                  {(Number(result.hints) || 0) > 0 && <><Lightbulb size={10}/>{result.hints}</>}
                                  {game.id === "zip" && result.zip_required_moves
                                    ? <>
                                      <span style={{ color:zipEfficiency(result) >= 85 ? "#137A3A" : "#9A721F" }}>{zipEfficiency(result)}% efficient</span>
                                      {(Number(result.mistakes) || 0) > 0 && <><TriangleAlert size={10}/>{result.mistakes}</>}
                                    </>
                                    : (Number(result.mistakes) || 0) > 0 && <><TriangleAlert size={10}/>{result.mistakes}</>}
                                  {isTeam && <strong style={{ color:item.score >= 100 ? "#137A3A" : "#9F2F2A" }}>{item.score > 0 ? "+" : ""}{item.score}</strong>}
                                </span>
                              ) : isTeam && item.missed ? (
                                <span className="text-[10px] font-semibold" style={{ color:"#B5433A" }}>Missed {item.score}</span>
                              ) : (
                                <span className="text-[10px] font-semibold" style={{ color:"rgba(27,33,41,.32)" }}>{isTeam ? "Upcoming" : t("standings.notPlayed")}</span>
                              )}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="px-2 pt-1 text-[9px] text-center" style={{ color:"rgba(27,33,41,.34)" }}>
                {isTeam
                  ? "Highest total wins · missed round −100 · hint +30s · mistake/reset +15s"
                  : displayedStandings.length < playedCount
                    ? `Top 3 + your position · ${playedCount} active today`
                    : "Games completed first · pooled time, hints and mistakes"}
              </div>
              {!isTeam && (
                <details className="mt-3 pt-3" style={{ borderTop:"1px solid rgba(16,24,40,.08)" }}>
                  <summary className="flex items-center gap-3 px-1 py-1 cursor-pointer list-none">
                    <span className="flex-1">
                      <span className="block text-[10px] font-bold uppercase tracking-[.12em]" style={{ color:"rgba(27,33,41,.42)" }}>7-day overview</span>
                      <span className="block text-[9px] mt-0.5" style={{ color:"rgba(27,33,41,.40)" }}>Weekly leaders and your recent results</span>
                    </span>
                    {myHistory && <span className="text-[10px] font-bold" style={{ color:"#2F6FED" }}>#{myHistory.rank} · {myHistory.challengeScore} pts</span>}
                    <ChevronDown size={14} style={{ opacity:.36 }}/>
                  </summary>
                  <div className="pt-2">
                    {displayedHistoryStandings.length > 0 ? (
                      <div className="rounded-2xl overflow-hidden" style={{ background:"#F7F8FB" }}>
                        {displayedHistoryStandings.map((item,index) => (
                          <div key={item.id} className="flex items-center gap-2 px-3 py-2 text-[10px]" style={{ borderTop:index ? "1px solid rgba(16,24,40,.06)" : "none" }}>
                            <span className="w-4 text-center font-bold" style={{ color:item.rank === 1 ? "#9A721F" : "rgba(27,33,41,.40)" }}>{item.rank}</span>
                            <span aria-hidden="true">{item.icon || "🙂"}</span>
                            <span className="flex-1 font-semibold truncate">{item.name}{item.id === userId ? " · You" : ""}</span>
                            <span className="font-bold">{item.challengeScore} pts · {item.days}d</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl px-3 py-3 text-[10px] text-center" style={{ background:"#F7F8FB",color:"rgba(27,33,41,.45)" }}>No results in the last 7 days.</div>
                    )}
                    {personalHistoryByDate.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[9px] font-bold uppercase tracking-[.1em] px-1 mb-1.5" style={{ color:"rgba(27,33,41,.36)" }}>Your recent days</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          {personalHistoryByDate.slice(0,4).map((item) => (
                            <div key={item.date} className="rounded-xl px-2.5 py-2" style={{ background:"rgba(47,111,237,.06)",border:"1px solid rgba(47,111,237,.10)" }}>
                              <div className="text-[9px] font-semibold" style={{ color:"rgba(27,33,41,.46)" }}>{new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined,{ weekday:"short",day:"numeric" })}</div>
                              <div className="text-[11px] font-bold mt-0.5">{item.score} pts</div>
                              <div className="text-[8px]" style={{ color:"rgba(27,33,41,.38)" }}>{item.games} game{item.games === 1 ? "" : "s"}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
