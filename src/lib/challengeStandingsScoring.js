import { challengeScore } from "./performanceScoring.js";

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
