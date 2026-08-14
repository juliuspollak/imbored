export const HINT_PENALTY_RATIO = 0.20;
export const MISTAKE_PENALTY_RATIO = 0.10;
export const MIN_DAILY_SCORE = 20;
export const MAX_DAILY_SCORE = 150;

function benchmarkSeconds(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

export function scoredSeconds({ seconds, hints = 0, mistakes = 0, typicalSeconds }) {
  const raw = Math.max(0, Number(seconds) || 0);
  const typical = benchmarkSeconds(typicalSeconds);
  return raw
    + Math.max(0, Number(hints) || 0) * typical * HINT_PENALTY_RATIO
    + Math.max(0, Number(mistakes) || 0) * typical * MISTAKE_PENALTY_RATIO;
}

export function performanceAdjustment(result, typicalSeconds) {
  const typical = benchmarkSeconds(typicalSeconds);
  return Math.max(-4, Math.min(4, Math.round(
    10 * (1 - scoredSeconds({ ...result, typicalSeconds: typical }) / typical),
  )));
}

// Share of the round's questions actually answered correctly, 0..1. Games that
// don't report a per-answer breakdown score purely on time, as before.
export function answerAccuracy(result = {}) {
  const total = Number(result.total_count ?? result.totalCount);
  if (!Number.isFinite(total) || total <= 0) return 1;
  const correct = Number(result.correct_count ?? result.correctCount);
  if (!Number.isFinite(correct) || correct <= 0) return 0;
  return Math.min(1, correct / total);
}

// Speed alone used to decide a challenge round, so bailing out of a quiz with
// every answer wrong beat working through it carefully: the failure ended the
// round in a few seconds and the cap hid the difference.
//
// Accuracy is applied *after* the clamp, not inside it. Scaling the raw speed
// figure first let a fast enough run stay above 150 even with a wrong answer,
// so the cap swallowed the penalty and a flawed round still showed full marks.
// Clamping the speed part first means the accuracy share always lands on the
// visible score: 8 of 9 correct tops out at 133, never 150.
//
// A round answered entirely wrong scores 0, the same as a missed one — but
// having played still counts, because rounds played is the next tiebreaker
// after score in compareStandings().
export function challengeScore(result, typicalSeconds) {
  const typical = benchmarkSeconds(typicalSeconds);
  const adjusted = Math.max(1, scoredSeconds({ ...result, typicalSeconds: typical }));
  const accuracy = answerAccuracy(result);
  const speedScore = Math.max(
    MIN_DAILY_SCORE,
    Math.min(MAX_DAILY_SCORE, Math.round((100 * typical) / adjusted)),
  );
  return {
    adjusted,
    accuracy,
    speedScore,
    score: Math.round(speedScore * accuracy),
  };
}

export function weekdayBonus(dayIndex) {
  return [0, 0, 1, 1, 1, 2, 2][Math.max(0, Math.min(6, Number(dayIndex) || 0))];
}
