
const CREAM = "#1B2129";import { useState, useEffect, useCallback } from "react";
import { Home, Lock, Check, Play, X } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { saveStats } from "./lib/saveStats.js";
import { weekDates, weekDayLabels } from "./lib/week.js";
import ModePill from "./ModePill.jsx";
import PointsToast from "./PointsToast.jsx";
import { buildTeamChallengeRounds, localDateString } from "./lib/teamChallengeRounds.js";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";
const GREEN = "#16A34A";


function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function describeAvg(avg) {
  if (avg < 34) return "Felt easy";
  if (avg < 67) return "Felt about right";
  return "Felt hard";
}

export default function ChallengeGate({ gameId, gameLabel, GameComponent, userId, onExit, onSwitchMode, hintCooldownConfig, weekStartsOn = 1, challengeScope = { type: "personal" } }) {
  const dates = weekDates(new Date(), weekStartsOn);
  const dayLabels = weekDayLabels(weekStartsOn);
  const teamRounds = challengeScope?.type === "team"
    ? challengeScope.dailyRounds?.length
      ? challengeScope.dailyRounds
      : buildTeamChallengeRounds({
        activeDays:challengeScope.activeDays,
        gameIds:challengeScope.gameIds,
      })
    : [];
  const scheduledDateEntries = challengeScope?.type === "team"
    ? teamRounds
      .filter((round) => round.game === gameId)
      .map((round) => ({ date:round.date,index:(round.isoDay || (new Date(`${round.date}T12:00:00`).getDay() || 7)) - 1 }))
    : dates.map((date, index) => ({ date,index }));
  const scheduledDates = scheduledDateEntries.map(({ date }) => date);
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(true);
  const [playingIdx, setPlayingIdx] = useState(null);
  const [playingDate, setPlayingDate] = useState(null);
  const [viewingIdx, setViewingIdx] = useState(null);
  const [alreadyPlayedNotice, setAlreadyPlayedNotice] = useState(false);
  const [savedStatId, setSavedStatId] = useState(null);
  const [rewardResult, setRewardResult] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [lastSolvedStats, setLastSolvedStats] = useState(null);
  const [pointsRetryStatId, setPointsRetryStatId] = useState(null);
  const [communityRatings, setCommunityRatings] = useState({}); // date -> { avg, count }
  const [leaderboards, setLeaderboards] = useState({}); // date -> [{ user_id, seconds, profiles }]
  const [startError, setStartError] = useState("");
  const [startingIdx, setStartingIdx] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabaseReady || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const scopeQuery = (query) => challengeScope?.type === "team"
      ? query.eq("team_challenge_id", challengeScope.id)
      : query.is("team_challenge_id", null);
    const [{ data }, { data: allRatings }, { data: allTimes }] = await Promise.all([
      scopeQuery(supabase.from("game_stats").select("*")
        .eq("user_id", userId).eq("game", gameId).eq("mode", "challenge").in("challenge_date", scheduledDates)),
      scopeQuery(supabase.from("game_stats").select("challenge_date, difficulty_rating")
        .eq("game", gameId).eq("mode", "challenge").in("challenge_date", scheduledDates)
        .not("difficulty_rating", "is", null)),
      scopeQuery(supabase.from("game_stats").select("challenge_date, user_id, seconds, profiles(name, icon)")
        .eq("game", gameId).eq("mode", "challenge").in("challenge_date", scheduledDates)),
    ]);
    const byDate = {};
    (data || []).forEach((row) => {
      byDate[row.challenge_date] = row;
    });
    setResults(byDate);

    const sums = {};
    (allRatings || []).forEach((r) => {
      sums[r.challenge_date] ||= { total: 0, count: 0 };
      sums[r.challenge_date].total += r.difficulty_rating;
      sums[r.challenge_date].count += 1;
    });
    const avgs = {};
    Object.entries(sums).forEach(([date, { total, count }]) => {
      avgs[date] = { avg: total / count, count };
    });
    setCommunityRatings(avgs);

    const byDateTimes = {};
    (allTimes || []).forEach((row) => {
      if (!row.profiles) return; // hidden from us — leave them out entirely, not a mystery blank row
      byDateTimes[row.challenge_date] ||= [];
      byDateTimes[row.challenge_date].push(row);
    });
    Object.values(byDateTimes).forEach((rows) => rows.sort((a, b) => a.seconds - b.seconds));
    setLeaderboards(byDateTimes);

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, userId, challengeScope?.id, challengeScope?.type, challengeScope?.activeDays?.join(",")]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function startChallenge(index, selectedDate = null) {
    const date = selectedDate || dates[index];
    setStartError("");
    if (challengeScope?.type !== "team") {
      setSavedStatId(null);
      setPlayingIdx(index);
      setPlayingDate(date);
      return;
    }
    setStartingIdx(index);
    const { error } = await supabase.rpc("start_team_challenge_game", {
      target_challenge_id: challengeScope.id,
      target_game: gameId,
      target_challenge_date: date,
    });
    setStartingIdx(null);
    if (error) {
      setStartError(error.message || "This team challenge cannot be started.");
      return;
    }
    setSavedStatId(null);
    setPlayingIdx(index);
    setPlayingDate(date);
  }

  async function handleSolved(stats) {
    setLastSolvedStats(stats);
    setSaveError("");
    setPointsRetryStatId(null);
    setSavedStatId(null);
    const res = await saveStats({ ...stats, teamChallengeId: challengeScope?.type === "team" ? challengeScope.id : null, teamId: challengeScope?.type === "team" ? challengeScope.teamId : null });
    if (res?.alreadyPlayed) {
      setAlreadyPlayedNotice(true);
      setPlayingIdx(null);
    } else if (res?.data) {
      setSavedStatId(res.data.id);
      setRewardResult({ ...(res.reward || {}), completed:true, eventId:Date.now() });
      if (res.rewardError) {
        setPointsRetryStatId(res.data.id);
        setSaveError(res.rewardError.message || "Your result was saved, but its points could not be awarded.");
      }
    } else {
      const message = res?.error?.message || "Your result could not be saved. Please retry before leaving.";
      setSaveError(message);
      setRewardResult({ completed:true,error:true,eventId:Date.now() });
    }
    await refresh();
    return res;
  }

  async function retryResultSave() {
    if (pointsRetryStatId) {
      const { data, error } = await supabase.rpc("award_game_points", { target_stat_id:pointsRetryStatId });
      if (error) {
        setSaveError(error.message || "Your points still could not be awarded.");
        return;
      }
      setRewardResult({ ...(data || {}),completed:true,eventId:Date.now() });
      setPointsRetryStatId(null);
      setSaveError("");
      return;
    }
    if (lastSolvedStats) await handleSolved(lastSolvedStats);
  }

  if (playingIdx !== null) {
    const date = playingDate || dates[playingIdx];
    const forcedDayIndex = challengeScope?.type === "team"
      ? ((new Date(`${date}T12:00:00`).getDay() || 7) - 1)
      : playingIdx;
    return (
      <div style={{ position: "relative" }}>
        <button
          onClick={onExit}
          className="gloss-button nav-btn"
          style={{
            "--nav-glow": "rgba(47,111,237,0.35)",
            "--nav-border": "rgba(47,111,237,0.4)",
            position: "fixed", top: 16, left: "max(16px, calc((100vw - var(--game-nav-width, 512px)) / 2))", zIndex: 50, width: 36, height: 36, borderRadius: "50%",
            background: "rgba(255,255,255,0.9)", backdropFilter: "blur(6px)", border: "1px solid rgba(16,24,40,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center", color: INK,
          }}
          aria-label="Home"
        >
          <Home size={17} />
        </button>
        <GameComponent
          userId={userId}
          onSolved={handleSolved}
          mode="challenge"
          forcedDayIdx={forcedDayIndex}
          seed={`${gameId}-${date}${challengeScope?.type === "team" ? `-team-${challengeScope.id}` : ""}`}
          challengeDate={date}
          hintCooldownConfig={hintCooldownConfig}
          savedStatId={savedStatId}
          rewardResult={rewardResult}
        />
        {saveError && (
          <div className="fixed left-4 right-4 bottom-5 z-[130] mx-auto max-w-sm rounded-2xl p-3 flex items-center gap-3" role="alert" style={{ background:"rgba(255,255,255,.98)",border:"1px solid rgba(181,67,58,.28)",boxShadow:"0 16px 44px rgba(16,24,40,.22)",color:"#9F2F2A" }}>
            <span className="flex-1 text-xs font-semibold">{saveError}</span>
            <button type="button" disabled={!lastSolvedStats && !pointsRetryStatId} onClick={retryResultSave} className="rounded-full px-3 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background:"#B5433A" }}>Retry</button>
          </div>
        )}
        {onSwitchMode && <ModePill mode="challenge" onSwitch={onSwitchMode} />}
        <PointsToast reward={rewardResult} />
      </div>
    );
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex items-start justify-center p-4 pt-[72px]">
      <button
        onClick={onExit}
        className="gloss-button nav-btn"
        style={{
          "--nav-glow": "rgba(47,111,237,0.35)", "--nav-border": "rgba(47,111,237,0.4)",
          position: "fixed", top: 16, left: "max(16px, calc((100vw - var(--game-nav-width, 512px)) / 2))", zIndex: 50,
          width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(6px)", border: "1px solid rgba(16,24,40,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center", color: INK,
        }}
        aria-label="Home"
      >
        <Home size={17} />
      </button>
      {onSwitchMode && <ModePill mode="challenge" onSwitch={onSwitchMode} />}

      {/* Same rounded white panel + shadow as the game screens themselves,
          so picking a day feels like the same surface you're about to play
          on, not a separate, plainer page. */}
      <div
        className="w-full max-w-sm sm:max-w-md lg:max-w-lg rounded-2xl p-5 lg:p-6 relative"
        style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
      >
        <div className="relative text-center mb-6">
          <h1 style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK, letterSpacing: "-0.01em" }} className="text-4xl lg:text-5xl">
            {gameLabel}
          </h1>
          <div className="inline-flex items-center rounded-full px-3 py-1 mt-2 text-xs font-semibold" style={{ background: "rgba(217,174,88,0.16)", color: "#9A6A12" }}>
            {challengeScope?.type === "team" ? `${challengeScope.emoji || "⭐"} ${challengeScope.name}` : "My Weekly Challenge"}
          </div>
          <p style={{ color: INK, opacity: 0.45 }} className="text-xs mt-2">
            {challengeScope?.type === "team" ? "one attempt for this team challenge" : "one personal attempt per day"}
          </p>
        </div>

        {alreadyPlayedNotice && (
          <div className="text-xs rounded-lg p-3 mb-4 flex items-center justify-between" style={{ background: "rgba(217,105,92,0.1)", color: "#B5433A" }}>
            <span>You already completed today's challenge — showing your original result.</span>
            <button className="gloss-button" onClick={() => setAlreadyPlayedNotice(false)}><X size={13} /></button>
          </div>
        )}
        {startError && (
          <div className="text-xs rounded-lg p-3 mb-4 flex items-center justify-between" style={{ background: "rgba(217,105,92,0.1)", color: "#B5433A" }}>
            <span>{startError}</span><button className="gloss-button" onClick={() => setStartError("")}><X size={13} /></button>
          </div>
        )}

        {loading ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Loading…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {scheduledDateEntries.map(({ date, index: i }) => {
              const isFuture = date > localDateString();
              const isToday = date === localDateString();
              const result = results[date];
              const isExpanded = viewingIdx === i;
              const isPlayable = !result && (challengeScope?.type === "team" ? isToday : !isFuture);
              const isMissedTeamRound = challengeScope?.type === "team" && date < localDateString() && !result;

              return (
                <div key={date}>
                  <button
                    disabled={(!result && !isPlayable) || startingIdx !== null}
                    onClick={() => {
                      if (!result && !isPlayable) return;
                      if (result) setViewingIdx(isExpanded ? null : i);
                      else {
                        startChallenge(i,date);
                      }
                    }}
                    className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left"
                    style={{
                      background: result ? "rgba(22,163,74,0.05)" : isPlayable ? "rgba(47,111,237,0.05)" : "rgba(16,24,40,0.03)",
                      border: isPlayable ? `1.5px solid ${isToday ? ACCENT : "rgba(47,111,237,0.4)"}` : "1px solid rgba(16,24,40,0.07)",
                      opacity: isFuture ? 0.45 : 1,
                      cursor: result || isPlayable ? "pointer" : "default",
                    }}
                  >
                    <div
                      className="flex items-center justify-center rounded-full flex-shrink-0"
                      style={{
                        width: 32, height: 32,
                        background: result ? "rgba(22,163,74,0.12)" : isFuture ? "rgba(16,24,40,0.05)" : "rgba(47,111,237,0.12)",
                      }}
                    >
                      {isFuture ? (
                        <Lock size={13} style={{ color: INK, opacity: 0.3 }} />
                      ) : result ? (
                        <Check size={15} style={{ color: GREEN }} />
                      ) : (
                        <Play size={13} style={{ color: ACCENT }} />
                      )}
                    </div>
                    <div className="flex-1">
                      <div style={{ color: INK, fontWeight: 600 }} className="text-sm">
                        {challengeScope?.type === "team"
                          ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{ weekday:"short" })
                          : dayLabels[i]}{isToday ? " · Today" : ""}
                      </div>
                      <div style={{ color: INK, opacity: 0.45 }} className="text-[11px]">
                        {isFuture
                          ? "Locked"
                          : result
                          ? `Solved in ${fmtTime(result.seconds)}`
                          : isToday
                          ? communityRatings[date]
                            ? `Tap to play — ${describeAvg(communityRatings[date].avg).toLowerCase()} so far`
                            : "Tap to play"
                          : isMissedTeamRound
                          ? "Missed · −100 challenge score"
                          : "Missed — tap to catch up"}
                      </div>
                    </div>
                  </button>

                  {isExpanded && result && (
                    <div className="rounded-xl px-4 py-3 mt-1" style={{ background: "rgba(16,24,40,0.03)" }}>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <Stat label="Time" value={fmtTime(result.seconds)} />
                        <Stat label="Mistakes" value={result.mistakes} />
                        <Stat label="Hints" value={result.hints} />
                      </div>
                      {communityRatings[date] && (
                        <div style={{ color: INK, opacity: 0.45, borderTop: "1px solid rgba(16,24,40,0.08)" }} className="text-[11px] text-center pt-2 mb-2">
                          {describeAvg(communityRatings[date].avg)} — {communityRatings[date].count} rating{communityRatings[date].count === 1 ? "" : "s"}
                        </div>
                      )}
                      {leaderboards[date] && leaderboards[date].length > 0 && (
                        <div style={{ borderTop: "1px solid rgba(16,24,40,0.08)" }} className="pt-2">
                          <div style={{ color: INK, opacity: 0.4 }} className="text-[10px] font-semibold uppercase tracking-wide mb-1.5 text-center">
                            Fastest today
                          </div>
                          <div className="flex flex-col gap-1">
                            {leaderboards[date].slice(0, 5).map((row, i) => {
                              const isMe = row.user_id === userId;
                              return (
                                <div
                                  key={row.user_id}
                                  className="flex items-center gap-2 rounded-lg px-2 py-1"
                                  style={{ background: isMe ? "rgba(47,111,237,0.08)" : "transparent" }}
                                >
                                  <span style={{ color: INK, opacity: 0.4, width: 14 }} className="text-[11px] font-semibold">{i + 1}</span>
                                  <span style={{ fontSize: 13 }}>{row.profiles?.icon || "🙂"}</span>
                                  <span style={{ color: INK, fontWeight: isMe ? 700 : 500 }} className="text-xs flex-1 truncate">
                                    {isMe ? "You" : row.profiles?.name || "Someone"}
                                  </span>
                                  <span style={{ color: INK, opacity: 0.6 }} className="text-xs tabular-nums">{fmtTime(row.seconds)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="text-center">
      <div style={{ color: INK, fontWeight: 700 }} className="text-sm">{value}</div>
      <div style={{ color: INK, opacity: 0.4 }} className="text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}
