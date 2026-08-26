import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight, LockKeyhole, RefreshCw, Trophy, X } from "lucide-react";
import { MISSED_ROUND_PENALTY, buildChallengeStandings, explainTiebreak, fromServerStandings } from "./lib/challengeStandingsScoring.js";
import { TYPICAL_SCORE } from "./lib/performanceScoring.js";
import { useI18n } from "./lib/i18n.jsx";
import { GAME_NAMES } from "./lib/gameBranding.jsx";
import { openPuzzlePractice } from "./lib/puzzleSharing.js";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { canOpenChallengeResult } from "./lib/challengeResultDetails.js";

function toBenchmarkMap(benchmarks) {
  return Object.fromEntries(benchmarks.map((item) => [`${item.game}:${item.day_index}`, {
    seconds: Number(item.effective_seconds) || 100,
    logMean: item.log_mean == null ? null : Number(item.log_mean),
    logSd: item.log_sd == null ? null : Number(item.log_sd),
  }]));
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
    if (isCircle && serverStandings?.length) return fromServerStandings(serverStandings, userId, rows);
    const slots = toSlots({ isCircle, rounds, games });
    if (slots.length === 0) return [];
    return buildChallengeStandings({ rows, roster, slots, benchmarkMap: toBenchmarkMap(benchmarks), userId, missedPenalty: isCircle ? MISSED_ROUND_PENALTY : 0 });
  }, [rows, roster, games, rounds, benchmarks, serverStandings, isCircle, userId]);

  const previousStandings = useMemo(() => {
    const slots = toSlots({ isCircle, rounds: previousRounds, games });
    if (slots.length === 0) return [];
    return buildChallengeStandings({ rows: previousRows, roster, slots, benchmarkMap: toBenchmarkMap(benchmarks), userId, missedPenalty: isCircle ? MISSED_ROUND_PENALTY : 0 });
  }, [previousRows, previousRounds, roster, benchmarks, games, isCircle, userId]);

  const hasHistory = !!onPeriodChange && periodCount > 1;
  if (!standings.length && !hasHistory) {
    return loading ? <div role="status" style={{ textAlign:"center", padding:"var(--space-4)", color:"var(--color-text-secondary)", fontSize:"var(--text-body-secondary-size)" }}>{t("standings.loading")}</div> : null;
  }

  const previousRankMap = Object.fromEntries(previousStandings.filter((s) => s.rank != null).map((s) => [s.userId, s.rank]));
  const navigator = hasHistory ? <PeriodNavigator label={periodLabel} index={periodIndex} count={periodCount} onChange={onPeriodChange} refreshing={refreshing} /> : null;
  const body = loading
    ? <div role="status" style={{ textAlign:"center", padding:"var(--space-4)", color:"var(--color-text-secondary)", fontSize:"var(--text-body-secondary-size)" }}>{t("standings.loading")}</div>
    : standings.length
      ? <StandingsList standings={standings} expandedPlayerIds={expandedPlayerIds} setExpandedPlayerIds={setExpandedPlayerIds} previousRankMap={previousRankMap} closed={closed} winnerId={winnerId} userId={userId} />
      : <p style={{ margin:0, textAlign:"center", padding:"var(--space-4)", color:"var(--color-text-secondary)", fontSize:"var(--text-body-secondary-size)" }}>{t("standings.emptyPeriod")}</p>;

  if (embedded) {
    return (
      <section style={{ marginTop:"var(--space-3)", overflow:"hidden", border:"1px solid var(--color-border)", borderRadius:"var(--radius-md)", background:"var(--color-surface)" }}>
        <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-controls="challenge-standings-list" className="challenge-standings-toggle" style={{ display:"flex", alignItems:"center", gap:"var(--space-2)", width:"100%", minHeight:"var(--control-height-md)", padding:"var(--space-2) var(--space-3)", background:"transparent", border:"none", cursor:"pointer", color:"var(--color-text-primary)", fontFamily:"inherit", textAlign:"left" }}>
          <Trophy size={17} style={{ color:"var(--color-warning-gold)" }} />
          <span style={{ flex:1, fontSize:"var(--text-body-size)", fontWeight:700 }}>{t("standings.title")}</span>
          <span style={{ fontSize:"var(--text-caption-size)", color:"var(--color-text-secondary)" }}>{t("standings.top", { count:standings.length })}</span>
          <ChevronDown size={17} style={{ color:"var(--color-icon-subtle)", transform:open ? "rotate(180deg)" : "none", transition:"transform var(--transition-fast)" }} />
        </button>
        {open && <div id="challenge-standings-list" style={{ padding:"0 var(--space-3) var(--space-3)" }}>{navigator}{body}</div>}
        <StandingsStyles />
      </section>
    );
  }

  return <>{navigator}{body}<StandingsStyles /></>;
}

function PeriodNavigator({ label, index, count, onChange, refreshing = false }) {
  const { t } = useI18n();
  const atOldest = index >= count - 1;
  const atNewest = index <= 0;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"var(--space-2)", margin:"var(--space-2) 0 var(--space-3)", padding:3, border:"1px solid var(--color-border)", borderRadius:"var(--radius-full)", background:"var(--color-surface-elevated)" }}>
      <NavigatorButton onClick={() => onChange(index + 1)} disabled={atOldest} ariaLabel={t("standings.olderPeriod")}><ChevronLeft size={17} /></NavigatorButton>
      <span aria-live="polite" style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textAlign:"center", color:"var(--color-text-primary)", fontSize:"var(--text-body-secondary-size)", fontWeight:600 }}>
        {label}{index > 0 && <span style={{ marginLeft:6, color:"var(--color-text-secondary)", fontWeight:500 }}>{t("standings.pastPeriod")}</span>}{refreshing && <span style={{ marginLeft:6, color:"var(--color-text-muted)", fontWeight:500 }}>{t("standings.updating")}</span>}
      </span>
      <NavigatorButton onClick={() => onChange(index - 1)} disabled={atNewest} ariaLabel={t("standings.newerPeriod")}><ChevronRight size={17} /></NavigatorButton>
    </div>
  );
}

function NavigatorButton({ onClick, disabled, ariaLabel, children }) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel} className="challenge-period-button" style={{ width:32, height:32, display:"grid", placeItems:"center", flexShrink:0, border:0, borderRadius:"50%", background:"transparent", color:disabled ? "var(--color-text-muted)" : "var(--color-text-primary)", cursor:disabled ? "default" : "pointer", opacity:disabled ? .4 : 1 }}>{children}</button>;
}

function StandingsList({ standings, expandedPlayerIds, setExpandedPlayerIds, previousRankMap, closed, winnerId, userId }) {
  const { t } = useI18n();
  const [selectedResult, setSelectedResult] = useState(null);
  const resultRequestRef = useRef(0);

  async function openCompletedResult(result, score, player) {
    if (!canOpenChallengeResult(result, { isCurrentUser:player.isCurrentUser, detailHidden:player.detailHidden }) || !userId) return;
    const requestId = ++resultRequestRef.current;
    const base = { ...result, score, playerName:player.name, isCurrentUser:player.isCurrentUser };
    if (!player.isCurrentUser) {
      setSelectedResult({ ...base, loading:false, loadError:"" });
      return;
    }
    setSelectedResult({ ...base, loading:true, loadError:"" });
    if (!supabaseReady) {
      if (requestId === resultRequestRef.current) setSelectedResult({ ...base, loading:false, loadError:"This result cannot be reopened right now." });
      return;
    }
    const { data, error } = await supabase
      .from("game_stats")
      .select("id,game,challenge_date,seconds,mistakes,hints,correct_count,total_count,wasted_moves,expected_moves,zip_backtracked_cells,zip_required_moves,completed_at,seed")
      .eq("user_id", userId)
      .eq("mode", "challenge")
      .eq("game", result.game)
      .eq("challenge_date", result.challenge_date)
      .order("completed_at", { ascending:false })
      .limit(1)
      .maybeSingle();
    if (requestId !== resultRequestRef.current) return;
    if (error || !data) {
      setSelectedResult({ ...base, loading:false, loadError:"This saved game could not be opened." });
      return;
    }
    setSelectedResult({ ...base, ...data, loading:false, loadError:"" });
  }

  function closeCompletedResult() {
    resultRequestRef.current += 1;
    setSelectedResult(null);
  }

  return (
    <>
      <div style={{ display:"flex", flexDirection:"column", gap:"var(--space-2)" }}>
        {standings.map((player, playerIndex) => {
          const rank = player.rank;
          const previousRank = previousRankMap[player.userId] ?? rank;
          const delta = rank == null || previousRank == null ? 0 : previousRank - rank;
          const isLeader = rank === 1 && player.score > 0;
          const expanded = expandedPlayerIds.has(player.userId);
          const isWinner = closed && winnerId === player.userId;
          const typicalScore = player.total * TYPICAL_SCORE;
          const tiebreak = explainTiebreak(player, standings[playerIndex + 1]);
          return (
            <article key={player.userId} style={{ overflow:"hidden", borderRadius:"var(--radius-md)", border:`1px solid ${player.isCurrentUser ? "var(--color-primary-subtle-border)" : isWinner ? "var(--color-warning-border)" : "var(--color-border)"}`, background:player.isCurrentUser ? "var(--color-primary-subtle)" : isWinner ? "var(--color-warning-bg)" : "var(--color-surface-elevated)" }}>
              <button type="button" onClick={() => setExpandedPlayerIds((current) => { const next = new Set(current); if (next.has(player.userId)) next.delete(player.userId); else next.add(player.userId); return next; })} aria-expanded={expanded} aria-controls={`player-results-${player.userId}`} className="challenge-player-toggle" style={{ width:"100%", minHeight:64, display:"flex", alignItems:"center", gap:"var(--space-3)", padding:"var(--space-3)", border:0, background:"transparent", color:"inherit", font:"inherit", textAlign:"left", cursor:"pointer" }}>
                <span style={{ minWidth:24, flexShrink:0, textAlign:"center", color:"var(--color-text-secondary)", fontSize:"var(--text-body-size)", fontWeight:700 }}>{isLeader || isWinner ? <Trophy size={19} style={{ color:"var(--color-warning-gold)", display:"inline" }} /> : rank}</span>
                <span aria-hidden="true" style={{ width:36, height:36, display:"grid", placeItems:"center", flexShrink:0, borderRadius:"50%", background:"var(--color-avatar-bg)", border:"2px solid var(--color-avatar-border)", fontSize:20 }}>{player.icon || "🙂"}</span>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"var(--color-text-primary)", fontSize:"var(--text-body-size)", fontWeight:600 }}>{player.name}{player.isCurrentUser ? t("standings.you") : ""}</span>
                  <span style={{ display:"block", marginTop:2, color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)" }}>{t("standings.played", { played:player.played, total:player.total })}{player.missed > 0 && t("standings.missed", { count:player.missed })}{player.isPrivate && t("standings.private")}{delta !== 0 && ` · ${delta > 0 ? "↑" : "↓"}${Math.abs(delta)}`}</span>
                  {tiebreak && <span style={{ display:"block", marginTop:3, color:"var(--color-warning-text)", fontSize:"var(--text-caption-size)", fontWeight:600 }}>{t(`standings.tiebreak.${tiebreak}`)}</span>}
                </span>
                <span style={{ flexShrink:0, textAlign:"right" }}><span style={{ display:"block", color:isLeader ? "var(--color-warning-text)" : "var(--color-text-primary)", fontSize:19, fontWeight:800, fontVariantNumeric:"tabular-nums" }}>{player.score}</span><span style={{ display:"block", color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)" }}>{t("standings.ofTypical", { typical:typicalScore })}</span></span>
                <ChevronDown size={17} style={{ flexShrink:0, color:"var(--color-icon-subtle)", transform:expanded ? "rotate(180deg)" : "none", transition:"transform var(--transition-fast)" }} />
              </button>
              {expanded && <div id={`player-results-${player.userId}`} style={{ padding:"var(--space-3)", borderTop:"1px solid var(--color-border)" }}>
                {player.detailHidden ? <p style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, margin:0, minHeight:36, color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)" }}><LockKeyhole size={13} /> {t("standings.privateDetail", { name:player.name })}</p> :
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:"var(--space-2)" }}>
                    {player.dailyResults.map((res, di) => {
                      if (!res) return <span key={di} style={{ minHeight:36, display:"flex", alignItems:"center", justifyContent:"center", border:"1px solid var(--color-border)", borderRadius:"var(--radius-sm)", background:"var(--color-surface)", color:"var(--color-text-muted)", fontSize:"var(--text-caption-size)", fontWeight:600 }}>{t("standings.missedTile")}</span>;
                      if (res.is_private) return <span key={di} style={{ minHeight:36, display:"flex", alignItems:"center", justifyContent:"center", gap:5, border:"1px solid var(--color-border)", borderRadius:"var(--radius-sm)", background:"var(--color-surface)", color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)", fontWeight:600 }}><LockKeyhole size={13} /> {t("standings.privateTile")}</span>;
                      const score = player.dailyScores[di];
                      const resultStyle = { minHeight:36, display:"flex", alignItems:"center", justifyContent:"center", gap:5, padding:"6px 8px", border:`1px solid ${score >= TYPICAL_SCORE ? "var(--color-success-border)" : score >= TYPICAL_SCORE * .8 ? "var(--color-primary-subtle-border)" : "var(--color-danger-text)"}`, borderRadius:"var(--radius-sm)", background:score >= TYPICAL_SCORE ? "var(--color-success-bg)" : score >= TYPICAL_SCORE * .8 ? "var(--color-primary-subtle)" : "var(--color-danger-bg)", color:score >= TYPICAL_SCORE ? "var(--color-success-text)" : score >= TYPICAL_SCORE * .8 ? "var(--color-primary)" : "var(--color-danger-text)", fontSize:"var(--text-caption-size)", fontWeight:600 };
                      const canOpen = canOpenChallengeResult(res, { isCurrentUser:player.isCurrentUser, detailHidden:player.detailHidden });
                      if (!canOpen) return <span key={di} title={t("standings.roundHint")} style={resultStyle}>{GAME_NAMES[res.game] || res.game} {score}</span>;
                      return <button key={di} type="button" onClick={() => openCompletedResult(res, score, player)} aria-label={`Open ${player.name}'s ${GAME_NAMES[res.game] || res.game} result, score ${score}`} className="challenge-result-button" style={{ ...resultStyle, width:"100%", fontFamily:"inherit", cursor:"pointer" }}><span>{GAME_NAMES[res.game] || res.game} {score}</span><ChevronRight size={14} aria-hidden="true" /></button>;
                    })}
                  </div>}
              </div>}
            </article>
          );
        })}
      </div>
      {selectedResult && typeof document !== "undefined" && createPortal(<CompletedResultDialog result={selectedResult} onClose={closeCompletedResult} />, document.body)}
    </>
  );
}

function CompletedResultDialog({ result, onClose }) {
  const gameName = GAME_NAMES[result.game] || result.game;
  const seconds = Number(result.seconds);
  const mistakes = Math.max(0, Number(result.mistakes) || 0);
  const hints = Math.max(0, Number(result.hints) || 0);
  const accuracy = Number(result.total_count) > 0 ? Math.round((Math.max(0, Number(result.correct_count) || 0) / Number(result.total_count)) * 100) : null;

  return (
    <div role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} style={{ position:"fixed", zIndex:1000, inset:0, display:"flex", alignItems:"flex-end", justifyContent:"center", padding:"var(--space-3)", paddingBottom:"max(var(--space-3), env(safe-area-inset-bottom))", background:"rgba(0,0,0,.42)", overscrollBehavior:"contain" }}>
      <section role="dialog" aria-modal="true" aria-label={`${gameName} completed result`} style={{ width:"min(100%,430px)", maxHeight:"85dvh", overflow:"auto", border:"1px solid var(--color-border)", borderRadius:"var(--radius-xl)", background:"var(--color-surface)", boxShadow:"var(--shadow-card)", padding:"var(--space-4)", WebkitOverflowScrolling:"touch", touchAction:"pan-y" }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:"var(--space-3)" }}>
          <div style={{ flex:1, minWidth:0 }}><p style={{ margin:0, color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)", fontWeight:700, textTransform:"uppercase", letterSpacing:".04em" }}>{result.isCurrentUser ? "Your completed game" : `${result.playerName}'s completed game`}</p><h3 style={{ margin:"3px 0 0", color:"var(--color-text-primary)", fontSize:20 }}>{gameName} · {result.score}</h3></div>
          <button type="button" onClick={onClose} aria-label="Close result" className="challenge-result-close" style={{ width:40, height:40, margin:"-3px -3px 0 0", display:"grid", placeItems:"center", flexShrink:0, border:0, borderRadius:"50%", background:"var(--color-surface-elevated)", color:"var(--color-text-secondary)", cursor:"pointer", touchAction:"manipulation" }}><X size={18} /></button>
        </div>
        {result.loading ? <p role="status" style={{ margin:"var(--space-4) 0", color:"var(--color-text-secondary)", fontSize:"var(--text-body-secondary-size)" }}>Opening your saved result…</p> : result.loadError ? <p role="status" style={{ margin:"var(--space-4) 0", color:"var(--color-danger-text)", fontSize:"var(--text-body-secondary-size)" }}>{result.loadError}</p> : <>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:"var(--space-2)", marginTop:"var(--space-4)" }}>
            <ResultFact label="Time" value={Number.isFinite(seconds) ? formatTime(seconds) : "—"} /><ResultFact label="Challenge score" value={result.score ?? "—"} /><ResultFact label="Mistakes" value={mistakes} /><ResultFact label="Hints" value={hints} />{accuracy !== null && <ResultFact label="Accuracy" value={`${accuracy}%`} />}
          </div>
          {result.isCurrentUser && <><div style={{ marginTop:"var(--space-4)", padding:"var(--space-3)", border:"1px solid var(--color-primary-subtle-border)", borderRadius:"var(--radius-md)", background:"var(--color-primary-subtle)" }}><p style={{ margin:0, color:"var(--color-text-primary)", fontSize:"var(--text-body-secondary-size)", fontWeight:700 }}>Your original Challenge result stays locked.</p><p style={{ margin:"4px 0 0", color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)", lineHeight:1.45 }}>Replaying opens the exact same puzzle as Practice, so it cannot replace or change this score.</p></div>
          <button type="button" onClick={() => openPuzzlePractice(result.id)} disabled={!result.id} className="challenge-result-replay" style={{ width:"100%", minHeight:44, marginTop:"var(--space-4)", display:"inline-flex", alignItems:"center", justifyContent:"center", gap:7, border:0, borderRadius:"var(--radius-full)", background:"var(--color-primary)", color:"var(--color-primary-text)", fontFamily:"inherit", fontSize:"var(--text-button-size)", fontWeight:800, cursor:result.id ? "pointer" : "default", opacity:result.id ? 1 : .5, touchAction:"manipulation" }}><RefreshCw size={16} /> Practise this game</button></>}
        </>}
      </section>
    </div>
  );
}

function ResultFact({ label, value }) {
  return <div style={{ minHeight:58, padding:"var(--space-2) var(--space-3)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-md)", background:"var(--color-surface-elevated)" }}><span style={{ display:"block", color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)" }}>{label}</span><strong style={{ display:"block", marginTop:3, color:"var(--color-text-primary)", fontSize:"var(--text-body-size)", fontVariantNumeric:"tabular-nums" }}>{value}</strong></div>;
}

function formatTime(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function StandingsStyles() {
  return <style>{`
    .challenge-standings-toggle:focus-visible,
    .challenge-player-toggle:focus-visible,
    .challenge-period-button:focus-visible,
    .challenge-result-button:focus-visible,
    .challenge-result-close:focus-visible,
    .challenge-result-replay:focus-visible { outline:2px solid var(--color-primary); outline-offset:-2px; }
    @media (hover:hover) and (pointer:fine) {
      .challenge-standings-toggle:hover,
      .challenge-player-toggle:hover { background:var(--color-surface-elevated) !important; }
      .challenge-period-button:not(:disabled):hover,
      .challenge-result-close:hover { background:var(--color-surface) !important; }
      .challenge-result-button:hover { filter:brightness(.98); }
    }
    @media (min-width:480px) { [id^="player-results-"] > div { grid-template-columns:repeat(3,minmax(0,1fr)) !important; } }
    @media (prefers-reduced-motion:reduce) { .challenge-standings-toggle svg, .challenge-player-toggle svg { transition:none !important; } }
  `}</style>;
}
