export const HINT_PENALTY_RATIO = 0.20;
export const MISTAKE_PENALTY_RATIO = 0.10;
export const MIN_DAILY_SCORE = 45;
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

// Whether this result grades its own answers. Quiz games do; the solve-the-
// board puzzles report no answer count and are judged on the clock alone.
export function reportsAnswers(result = {}) {
  const total = Number(result.total_count ?? result.totalCount);
  return Number.isFinite(total) && total > 0;
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
// A completed round now keeps a meaningful 45-point speed floor (30% of the
// 150 maximum) so a slower player still has a reason to finish. Accuracy is
// applied *after* that floor and the maximum clamp, so partial or failed quiz
// results do not receive 45 points merely for ending the round. For example,
// 50% accuracy can receive at most half of the applicable speed score, while a
// zero-correct result still scores 0.
//
// A quiz game's mistakes ARE its wrong answers, so charging them as penalty
// seconds *and* as a lower accuracy share billed one set of errors twice.
// Where a result grades itself, accuracy is the whole penalty and the clock
// measures pace only; games reporting no answer count keep paying for mistakes
// in time, which is their only penalty.
export function challengeScore(result, typicalSeconds) {
  const typical = benchmarkSeconds(typicalSeconds);
  const adjusted = Math.max(1, scoredSeconds({
    ...result,
    mistakes: reportsAnswers(result) ? 0 : result.mistakes,
    typicalSeconds: typical,
  }));
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
