export const HINT_PENALTY_RATIO = 0.20;
export const MISTAKE_PENALTY_RATIO = 0.10;
export const MIN_DAILY_SCORE = 45;
export const MAX_DAILY_SCORE = 150;

// A round is scored by how far it beats typical play, counted in the spread of
// that game's own times. TYPICAL_SCORE is what typical play earns and
// SPREAD_POINTS is what one standard deviation is worth. Simulated over 300
// players these put the mean and median both on 100, the 10th and 90th
// percentiles on 67 and 132, and leave only ~2% of rounds on a clamp.
export const TYPICAL_SCORE = 100;
export const SPREAD_POINTS = 25;
export const SCORE_FLOOR = 20;
// A round with nothing correct would otherwise be an infinitely slow round.
// Accuracy counts as its square: half the answers right costs what taking
// four times as long costs. Because the reference mean and spread are measured
// through the same transform, cross-game balance holds whatever this is; it
// only sets how much accuracy weighs against speed. At 1 a rushed 1-of-9 Zoom
// round still paid 71 against an honest 99 - the abuse this started from. At 2
// it pays 43, while good and perfect rounds are untouched.
export const ACCURACY_EXPONENT = 2;

// What a hint and a mistake cost a CHALLENGE round, as a share of the game's
// typical time. Deliberately separate from HINT_PENALTY_RATIO and
// MISTAKE_PENALTY_RATIO, which price the same events for the points economy -
// moving those would shift everyone's balances.
//
// Across 93 real rounds, 66% had no mistakes and no hints at all, and Hive and
// MiniSudoku had none in 29 rounds between them, so their scores were decided
// by the clock alone. At the old 10% a four-mistake Binary round lost 14 points
// against a clean one of the same length; at 25% it loses 36. Raising the cost
// is the only lever that works without new measurements, because it is the one
// non-speed signal these games already record.
export const CHALLENGE_HINT_COST = 0.35;
export const CHALLENGE_MISTAKE_COST = 0.25;

// Work the puzzle did not require, priced as time. Gridly records backtracked
// cells against required moves - 0 means the route was planned, 119 on a
// 48-move board means it was brute-forced. At 1.5 a clean route beats a typical
// one by 32 points and a slow clean solve beats a fast scrappy one - 104 to
// 83 - which is the whole point: the clock stops being the only measure.
export const INEFFICIENCY_COST = 2.5;

// Backtracked cells over required moves, clamped. A game recording neither
// contributes nothing. Undo and reset counts can feed the same channel.
export function roundInefficiency(result = {}) {
  const required = Number(
    result.expected_moves ?? result.expectedMoves
    ?? result.zip_required_moves ?? result.gridlyRequiredMoves,
  );
  if (!Number.isFinite(required) || required <= 0) return 0;
  const wasted = Number(
    result.wasted_moves ?? result.wastedMoves
    ?? result.zip_backtracked_cells ?? result.gridlyBacktrackedCells,
  );
  if (!Number.isFinite(wasted) || wasted <= 0) return 0;
  return Math.min(4, wasted / required);
}

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

// Effective seconds: the clock plus the hint surcharge, divided by the share
// of answers that were right. Accuracy and speed become one currency, so a
// quiz round and a puzzle round sit on the same axis. Simulated across 300
// players, the accuracy-multiplier rule left the quiz games averaging 66-69
// against 99-101 for the puzzles -- a 35-point gap owed purely to which game
// you opened. Expressed as time instead, all six average 89-92.
// Returns null for a graded round with nothing correct: it has no meaningful
// pace, and is scored 0 rather than ranked among rounds that were played.
export function effectiveSeconds(result = {}, typicalSeconds) {
  const typical = benchmarkSeconds(typicalSeconds);
  const accuracy = answerAccuracy(result);
  if (reportsAnswers(result) && accuracy <= 0) return null;
  // An ungraded puzzle has no accuracy to divide by, so its slips are charged
  // as time - its only penalty. A graded round is not charged here as well:
  // its mistakes ARE the wrong answers already priced into the divisor.
  const mistakePenalty = reportsAnswers(result)
    ? 0
    : Math.max(0, Number(result.mistakes) || 0) * typical * CHALLENGE_MISTAKE_COST;
  const raw = Math.max(1, Math.max(0, Number(result.seconds) || 0)
    + Math.max(0, Number(result.hints) || 0) * typical * CHALLENGE_HINT_COST
    + mistakePenalty)
    // A multiplier, not a benchmark-scaled surcharge: `typical` is a median of
    // raw seconds and can be half the typical EFFECTIVE time, which quietly
    // halved the intended weight.
    * (1 + roundInefficiency(result) * INEFFICIENCY_COST);
  return raw / Math.pow(accuracy, ACCURACY_EXPONENT);
}

// benchmark is either a plain number (the game's typical seconds, the legacy
// shape) or { seconds, logMean, logSd } once the spread has been measured.
//
// With a spread, a round scores by how many standard deviations of that
// game's own log-time it beat typical play by. Dividing by each game's own
// spread is what removes the cross-game bias, and it stops a fast game like
// Gridly -- 6-second benchmark, whole-second column -- swinging eight points
// per second while MiniSudoku swings two. Without a spread it falls back to
// the old ratio rule, so a game with no measured history still scores.
export function challengeScore(result, benchmark) {
  const profile = benchmark && typeof benchmark === 'object' ? benchmark : { seconds: benchmark };
  const typical = benchmarkSeconds(profile.seconds);
  const logMean = Number(profile.logMean ?? profile.log_mean);
  const logSd = Number(profile.logSd ?? profile.log_sd);
  const accuracy = answerAccuracy(result);
  const adjusted = effectiveSeconds(result, typical);
  if (adjusted === null) return { adjusted: null, accuracy, spreads: null, score: 0 };
  const measured = Number.isFinite(logMean) && Number.isFinite(logSd) && logSd > 0.01;
  const spreads = measured ? (logMean - Math.log(adjusted)) / logSd : null;
  // The 45-point floor exists to stop the ratio rule dumping slower players in
  // a heap at the bottom. Scoring against the spread does not have that
  // failure - 0.1% of simulated rounds reach the floor - so the measured path
  // uses the full range while the fallback keeps the floor it was built with.
  const floor = measured ? SCORE_FLOOR : MIN_DAILY_SCORE;
  const raw = measured ? TYPICAL_SCORE + SPREAD_POINTS * spreads : (100 * typical) / adjusted;
  return { adjusted, accuracy, spreads, score: Math.max(floor, Math.min(MAX_DAILY_SCORE, Math.round(raw))) };
}

export function weekdayBonus(dayIndex) {
  return [0, 0, 1, 1, 1, 2, 2][Math.max(0, Math.min(6, Number(dayIndex) || 0))];
}
