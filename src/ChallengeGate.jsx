import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Lock, Check, Play, X, PartyPopper } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { saveStats, rateDifficulty } from "./lib/saveStats.js";
import { weekDates, todayIndex } from "./lib/week.js";
import DifficultyRating from "./DifficultyRating.jsx";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";
const GREEN = "#16A34A";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

export default function ChallengeGate({ gameId, gameLabel, GameComponent, userId, onExit }) {
  const dates = weekDates();
  const todayIdx = todayIndex();
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(true);
  const [playingIdx, setPlayingIdx] = useState(null);
  const [viewingIdx, setViewingIdx] = useState(null);
  const [alreadyPlayedNotice, setAlreadyPlayedNotice] = useState(false);
  const [justSolved, setJustSolved] = useState(null); // { statId, seconds, mistakes, hints }
  const [communityRatings, setCommunityRatings] = useState({}); // date -> { avg, count }

  const refresh = useCallback(async () => {
    if (!supabaseReady || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data }, { data: allRatings }] = await Promise.all([
      supabase
        .from("game_stats")
        .select("*")
        .eq("user_id", userId)
        .eq("game", gameId)
        .eq("mode", "challenge")
        .in("challenge_date", dates),
      // everyone's ratings for this week's puzzles, not just this player's —
      // this is what makes "how did this land for the group" possible
      supabase
        .from("game_stats")
        .select("challenge_date, difficulty_rating")
        .eq("game", gameId)
        .eq("mode", "challenge")
        .in("challenge_date", dates)
        .not("difficulty_rating", "is", null),
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

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSolved(stats) {
    const res = await saveStats(stats);
    setPlayingIdx(null);
    if (res?.alreadyPlayed) {
      setAlreadyPlayedNotice(true);
    } else if (res?.data) {
      setJustSolved({ statId: res.data.id, seconds: stats.seconds, mistakes: stats.mistakes, hints: stats.hints });
    }
    refresh();
  }

  if (playingIdx !== null) {
    const date = dates[playingIdx];
    return (
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setPlayingIdx(null)}
          className="nav-btn"
          style={{
            "--nav-glow": "rgba(47,111,237,0.35)",
            "--nav-border": "rgba(47,111,237,0.4)",
            position: "fixed", top: 16, left: 16, zIndex: 50, width: 36, height: 36, borderRadius: "50%",
            background: "rgba(255,255,255,0.9)", backdropFilter: "blur(6px)", border: "1px solid rgba(16,24,40,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center", color: INK,
          }}
          aria-label="Back to challenge"
        >
          <ArrowLeft size={18} />
        </button>
        <GameComponent
          userId={userId}
          onSolved={handleSolved}
          mode="challenge"
          forcedDayIdx={playingIdx}
          seed={`${gameId}-${date}`}
          challengeDate={date}
        />
      </div>
    );
  }

  if (justSolved) {
    return (
      <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl p-6 text-center" style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}>
          <PartyPopper size={28} style={{ color: ACCENT, margin: "0 auto 10px" }} />
          <h2 style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontWeight: 600, color: INK }} className="text-2xl mb-1">
            Solved!
          </h2>
          <div className="flex justify-center gap-4 mb-6">
            <Stat label="Time" value={fmtTime(justSolved.seconds)} />
            <Stat label="Mistakes" value={justSolved.mistakes} />
            <Stat label="Hints" value={justSolved.hints} />
          </div>

          <DifficultyRating onRate={(value) => rateDifficulty(justSolved.statId, value)} />

          <button
            onClick={() => setJustSolved(null)}
            className="w-full rounded-lg py-2.5 text-sm font-semibold mt-6"
            style={{ background: ACCENT, color: "#FFFFFF" }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex justify-center p-4 pt-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={onExit} style={{ color: INK, opacity: 0.5 }}>
            <ArrowLeft size={18} />
          </button>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontWeight: 600, color: INK }} className="text-2xl">
            {gameLabel} — Challenge
          </h1>
        </div>
        <p style={{ color: INK, opacity: 0.45 }} className="text-xs mb-6 ml-9">
          one attempt per day, same puzzle for everyone
        </p>

        {alreadyPlayedNotice && (
          <div className="text-xs rounded-lg p-3 mb-4 flex items-center justify-between" style={{ background: "rgba(217,105,92,0.1)", color: "#B5433A" }}>
            <span>You already completed today's challenge — showing your original result.</span>
            <button onClick={() => setAlreadyPlayedNotice(false)}><X size={13} /></button>
          </div>
        )}

        {loading ? (
          <p style={{ color: INK, opacity: 0.4 }} className="text-sm text-center py-8">Loading…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {dates.map((date, i) => {
              const isFuture = i > todayIdx;
              const isToday = i === todayIdx;
              const result = results[date];
              const isExpanded = viewingIdx === i;
              const isPlayable = !isFuture && !result; // today or a missed past day, not yet attempted

              return (
                <div key={date}>
                  <button
                    disabled={isFuture}
                    onClick={() => {
                      if (isFuture) return;
                      if (result) setViewingIdx(isExpanded ? null : i);
                      else setPlayingIdx(i);
                    }}
                    className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left"
                    style={{
                      background: PANEL,
                      border: isPlayable ? `1.5px solid ${isToday ? ACCENT : "rgba(47,111,237,0.4)"}` : "1px solid rgba(16,24,40,0.09)",
                      opacity: isFuture ? 0.45 : 1,
                      cursor: isFuture ? "default" : "pointer",
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
                        {DAY_LABELS[i]}{isToday ? " · Today" : ""}
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
                        <div style={{ color: INK, opacity: 0.45, borderTop: "1px solid rgba(16,24,40,0.08)" }} className="text-[11px] text-center pt-2">
                          {describeAvg(communityRatings[date].avg)} — {communityRatings[date].count} rating{communityRatings[date].count === 1 ? "" : "s"}
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
