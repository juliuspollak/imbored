export const HINT_PENALTY_RATIO = 0.20;
export const MISTAKE_PENALTY_RATIO = 0.10;
export const MIN_DAILY_SCORE = 20;
export const MAX_DAILY_SCORE = 150;

export function scoredSeconds({ seconds, hints = 0, mistakes = 0, typicalSeconds }) {
  const raw = Math.max(0, Number(seconds) || 0);
  const typical = Math.max(1, Number(typicalSeconds) || 1);
  return raw
    + Math.max(0, Number(hints) || 0) * typical * HINT_PENALTY_RATIO
    + Math.max(0, Number(mistakes) || 0) * typical * MISTAKE_PENALTY_RATIO;
}

export function performanceAdjustment(result, typicalSeconds) {
  const typical = Math.max(1, Number(typicalSeconds) || 1);
  return Math.max(-3, Math.min(3, Math.round(
    10 * (1 - scoredSeconds({ ...result, typicalSeconds: typical }) / typical),
  )));
}

export function challengeScore(result, typicalSeconds) {
  const adjusted = Math.max(1, scoredSeconds({ ...result, typicalSeconds }));
  const typical = Math.max(1, Number(typicalSeconds) || 100);
  const score = Math.round((100 * typical) / adjusted);
  return {
    adjusted,
    score: Math.max(MIN_DAILY_SCORE, Math.min(MAX_DAILY_SCORE, score)),
  };
}

export function weekdayBonus(dayIndex) {
  return [0, 1, 1, 2, 2, 3, 3][Math.max(0, Math.min(6, Number(dayIndex) || 0))];
}
