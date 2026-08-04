import { challengeScore } from "./performanceScoring.js";

// Mirrors the missed-round penalty in finalize_circle_challenge, so the
// standings a circle sees during the week match the winner the server picks
// when it closes.
export const MISSED_ROUND_PENALTY = -100;
export const MAX_VISIBLE_STANDINGS = 5;

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

// Keep the challenge card compact: show the top five participants. When the
// signed-in player has participated but sits below fifth, include their row as
// well so they can still see their own position.
export function limitChallengeStandings(entries, userId, limit = MAX_VISIBLE_STANDINGS) {
  const participants = entries.filter((entry) => Number(entry.played) > 0);
  const topPlayers = participants.slice(0, limit);
  const currentPlayer = participants.find((entry) => entry.userId === userId);
  if (currentPlayer && !topPlayers.some((entry) => entry.userId === userId)) return [...topPlayers, currentPlayer];
  return topPlayers;
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

  const visibleRoster = roster.filter((member) => member.id === userId || member.is_private !== true);
  const entries = visibleRoster.map((member) => {
    const memberRows = (rowsByPlayer[member.id] || []).slice()
      .sort((a, b) => String(a.completed_at || "").localeCompare(String(b.completed_at || "")));
    const dailyResults = slots.map((slot) => memberRows.find((row) => matchesSlot(row, slot)) || null);
    const entry = {
      userId: member.id,
      name: member.member_name || member.name,
      icon: member.member_icon || member.icon,
      isCurrentUser: member.id === userId,
      isPrivate: false,
      dailyResults,
    };

    const summary = pooledChallengeSummary(dailyResults, benchmarkMap, missedPenalty);
    return {
      ...entry,
      ...summary,
      unranked: false,
      detailHidden: false,
      total: slots.length,
      missed: slots.length - summary.played,
    };
  }).filter((entry) => entry.played > 0);

  return limitChallengeStandings(rankStandings(entries), userId);
}

// Circle standings computed and ranked by the database, so the browser holds
// no copy of the weekly scoring formula. Private profiles are excluded rather
// than anonymised because private accounts cannot participate in circles.
export function fromServerStandings(serverRows = [], userId = null) {
  const entries = serverRows
    .filter((row) => (row.member_id === userId || !row.is_private) && Number(row.rounds_played) > 0)
    .map((row) => {
      const rounds = Array.isArray(row.round_scores) ? row.round_scores : null;
      return {
        userId: row.member_id,
        name: row.member_name,
        icon: row.member_icon,
        rank: Number(row.standing_rank),
        score: Number(row.challenge_score),
        played: Number(row.rounds_played),
        total: Number(row.rounds_total),
        missed: Number(row.rounds_total) - Number(row.rounds_played),
        isCurrentUser: row.member_id === userId,
        isPrivate: false,
        unranked: false,
        detailHidden: rounds === null,
        dailyResults: rounds
          ? rounds.map((round) => (round.score == null ? null : { game: round.game, challenge_date: round.challenge_date }))
          : [],
        dailyScores: rounds ? rounds.map((round) => round.score) : [],
      };
    });

  return limitChallengeStandings(entries, userId);
}
