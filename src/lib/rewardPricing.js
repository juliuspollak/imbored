// What a week of play is worth, so a reward can be priced against effort
// rather than guessed at.
//
// Mirrors award_game_points() in public.sql. If the scoring there changes,
// change it here too — rewardPricing.test.js pins the arithmetic to the
// twelve days of real play the prices were originally calibrated against.

import { weekdayBonus } from "./performanceScoring.js";

// A player who beats the community median by a modest margin. The benchmark is
// the median, so +0 is literally average and +4 is the cap; +2 is "good, not
// flawless". Validated against real data: it predicts ~970 points of game
// income for a strong week, and the best player measured earned ~990.
export const GOOD_PERFORMANCE = 2;

// One week of good play buys a $5 AUD item. Everything else scales from this.
export const ANCHOR_DOLLARS = 5;

const DEFAULT_CHALLENGE_GAMES = 6;
const PER_AWARD_CEILING = 50;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

export function readRules(rules) {
  return {
    basePoints: Number(rules?.base_points ?? 6),
    minimumPoints: Number(rules?.minimum_points ?? 2),
    maximumPoints: Number(rules?.maximum_points ?? 15),
    practicePercent: Number(rules?.practice_points_percent ?? 50),
    practiceLimit: Number(rules?.practice_daily_limit ?? 3),
    streakWeeklyBonus: Number(rules?.streak_weekly_bonus ?? 100),
  };
}

// One challenge game on a given weekday, for a good player.
export function challengeAward(rules, dayIndex) {
  const { basePoints, minimumPoints, maximumPoints } = readRules(rules);
  const unscaled = basePoints + weekdayBonus(dayIndex) + GOOD_PERFORMANCE;
  return clamp(clamp(unscaled, minimumPoints, maximumPoints), 0, PER_AWARD_CEILING);
}

// One rewarded practice round on the same day. Practice pays a percentage of
// the equivalent challenge award, against its own scaled floor and ceiling.
export function practiceAward(rules, dayIndex) {
  const { basePoints, minimumPoints, maximumPoints, practicePercent } = readRules(rules);
  const unscaled = basePoints + weekdayBonus(dayIndex) + GOOD_PERFORMANCE;
  const scaled = Math.round((unscaled * practicePercent) / 100);
  const floor = Math.ceil((minimumPoints * practicePercent) / 100);
  const ceiling = Math.floor((maximumPoints * practicePercent) / 100);
  return clamp(clamp(scaled, floor, ceiling), 0, PER_AWARD_CEILING);
}

// A good week: every challenge game and every rewarded practice round, all
// seven days, which also earns the weekly streak bonus.
export function weeklyEarnings(rules, challengeGames = DEFAULT_CHALLENGE_GAMES) {
  const { practiceLimit, streakWeeklyBonus } = readRules(rules);
  const games = Math.max(0, Number(challengeGames) || 0);
  let total = streakWeeklyBonus;
  const days = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const challenge = games * challengeAward(rules, dayIndex);
    const practice = games * practiceLimit * practiceAward(rules, dayIndex);
    days.push({ dayIndex, challenge, practice, total: challenge + practice });
    total += challenge + practice;
  }
  return { total, days, streakBonus: streakWeeklyBonus, challengeGames: games };
}

function roundToStep(value, step = 50) {
  return Math.max(step, Math.round(value / step) * step);
}

// Points per dollar follows from the anchor, so every other price is just
// proportional to how long it takes to earn.
export function pointsPerDollar(rules, challengeGames) {
  return weeklyEarnings(rules, challengeGames).total / ANCHOR_DOLLARS;
}

export function suggestedPrice(rules, dollars, challengeGames) {
  return roundToStep(pointsPerDollar(rules, challengeGames) * dollars);
}

export const PRICE_EXAMPLES = [2, 5, 10, 20];

export function priceGuide(rules, challengeGames = DEFAULT_CHALLENGE_GAMES) {
  const weekly = weeklyEarnings(rules, challengeGames);
  return {
    weekly,
    perDollar: Math.round(weekly.total / ANCHOR_DOLLARS),
    rows: PRICE_EXAMPLES.map((dollars) => ({
      dollars,
      points: suggestedPrice(rules, dollars, challengeGames),
      // How long an average player takes — they earn roughly 80% of a good
      // week, which is what the measured spread showed.
      averageDays: Math.round((suggestedPrice(rules, dollars, challengeGames) / (weekly.total * 0.8 / 7)) * 10) / 10,
    })),
  };
}

// Games that actually appear in a daily challenge. Falls back to the current
// line-up when game_config has not been loaded or does not exist yet.
export function countChallengeGames(gameConfig) {
  if (!gameConfig) return DEFAULT_CHALLENGE_GAMES;
  const enabled = Object.values(gameConfig).filter((row) => row.available && row.challenge_enabled);
  return enabled.length || DEFAULT_CHALLENGE_GAMES;
}
