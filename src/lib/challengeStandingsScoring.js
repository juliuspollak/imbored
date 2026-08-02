import { challengeScore } from "./performanceScoring.js";

// Mirrors the missed-round penalty in finalize_circle_challenge, so the
// standings a circle sees during the week match the winner the server picks
// when it closes.
export const MISSED_ROUND_PENALTY = -100;

function isoDayIndex(dateString) {
  return (new Date(`${dateString}T12:00:00`).getDay() || 7) - 1;
}

export function pooledChallengeSummary(results, benchmarkMap, missedPenalty = 0) {
  return results.reduce((summary, result) => {
    if (!result) {
      return {
        ...summary,
        score: summary.score + missedPenalty,
        dailyScores: [...summary.dailyScores, null],
      };
    }
    const daily = challengeScore(
      result,
      benchmarkMap[`${result.game}:${isoDayIndex(result.challenge_date)}`],
    );
    return {
      score: summary.score + daily.score,
      played: summary.played + 1,
      hints: summary.hints + Math.max(0, Number(result.hints) || 0),
      mistakes: summary.mistakes + Math.max(0, Number(result.mistakes) || 0),
      adjusted: summary.adjusted + daily.adjusted,
      finishedAt: String(result.completed_at || "") > summary.finishedAt
        ? String(result.completed_at || "")
        : summary.finishedAt,
      dailyScores: [...summary.dailyScores, daily.score],
    };
  }, {
    score: 0,
    played: 0,
    hints: 0,
    mistakes: 0,
    adjusted: 0,
    finishedAt: "",
    dailyScores: [],
  });
}

export function compareStandings(a, b) {
  return b.score - a.score
    || b.played - a.played
    || a.hints - b.hints
    || a.mistakes - b.mistakes
    || a.adjusted - b.adjusted
    || a.finishedAt.localeCompare(b.finishedAt)
    || String(a.userId).localeCompare(String(b.userId));
}

// Ranked players sort by score; unranked ones keep a stable alphabetical order
// at the end and never take a rank number away from someone who was scored.
export function rankStandings(entries) {
  const ranked = entries.filter((entry) => !entry.unranked).sort(compareStandings);
  const unranked = entries.filter((entry) => entry.unranked)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return [
    ...ranked.map((entry, index) => ({ ...entry, rank: index + 1 })),
    ...unranked.map((entry) => ({ ...entry, rank: null })),
  ];
}

function matchesSlot(row, slot) {
  return row.game === slot.game && (slot.date == null || row.challenge_date === slot.date);
}

// slots describe the rounds being scored: { game, date } for a circle challenge
// (one assigned game per day) or { game } for the personal one.
export function buildChallengeStandings({
  rows = [],
  roster = [],
  slots = [],
  benchmarkMap = {},
  userId = null,
  missedPenalty = 0,
} = {}) {
  const rowsByPlayer = rows.reduce((grouped, row) => {
    (grouped[row.user_id] ||= []).push(row);
    return grouped;
  }, {});

  return rankStandings(roster.map((member) => {
    const isPrivate = member.id !== userId && member.show_stats_to_others === false;
    const memberRows = (rowsByPlayer[member.id] || []).slice()
      .sort((a, b) => String(a.completed_at || "").localeCompare(String(b.completed_at || "")));
    const dailyResults = slots.map((slot) => {
      const result = memberRows.find((row) => matchesSlot(row, slot));
      if (!result) return null;
      return isPrivate ? { ...result, is_private: true } : result;
    });
    const entry = {
      userId: member.id,
      name: member.member_name || member.name,
      icon: member.member_icon || member.icon,
      isCurrentUser: member.id === userId,
      isPrivate,
      dailyResults,
    };

    // Row-level privacy is enforced in the database, so a private player's
    // results never reach us at all. An empty set therefore means "hidden",
    // not "missed" — scoring it as missed would drop someone to last place
    // for turning a privacy setting on. Leave them unranked instead.
    if (isPrivate && !dailyResults.some(Boolean)) {
      return {
        ...entry,
        unranked: true,
        score: null,
        played: null,
        missed: null,
        hints: 0,
        mistakes: 0,
        adjusted: 0,
        finishedAt: "",
        dailyScores: slots.map(() => null),
      };
    }

    const summary = pooledChallengeSummary(dailyResults, benchmarkMap, missedPenalty);
    return { ...entry, ...summary, unranked: false, missed: slots.length - summary.played };
  }));
}
