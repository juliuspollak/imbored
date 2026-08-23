import { supabase, supabaseReady } from "./supabase.js";
import { cancelDailyReminderForDate } from "./nativeNotifications.js";

// Fire-and-forget: called once, right when a puzzle is solved. Silently
// no-ops if Supabase isn't configured or nobody's logged in, so the games
// keep working standalone even without accounts set up.
//
// Returns the created row (so a difficulty rating can be attached to it
// afterward) or { alreadyPlayed: true } if this was a challenge-mode save
// that hit the one-per-day constraint — a real, expected outcome (two tabs
// open, a stale page finishing late), not an error to swallow silently.
export async function saveStats({ userId, game, dayIndex, seconds, mistakes, hints, seed = null, generatorVersion = null, generatorConfig = null, correctCount = null, totalCount = null, roundsNailed = null, wastedMoves = null, expectedMoves = null, gridlyBacktrackedCells = null, gridlyRequiredMoves = null, mode = "practice", challengeDate, circleChallengeId = null, circleId = null }) {
  if (!supabaseReady || !userId) return {};
  try {
    const payload = {
      user_id: userId,
      game,
      day_index: dayIndex,
      seconds,
      mistakes,
      hints,
      seed,
      generator_version: generatorVersion,
      generator_config: generatorConfig,
      correct_count: correctCount,
      total_count: totalCount,
      rounds_nailed: roundsNailed,
      // Work placed and taken back, against the work the puzzle required. The
      // only signal beyond the clock that Hive, Binary and Sudoku produce.
      wasted_moves: wastedMoves,
      expected_moves: expectedMoves,
      ...(game === "gridly" ? {
        zip_backtracked_cells: gridlyBacktrackedCells,
        zip_required_moves: gridlyRequiredMoves,
      } : {}),
      mode,
      challenge_date: mode === "challenge" ? challengeDate : null,
      circle_challenge_id: mode === "challenge" ? circleChallengeId : null,
      circle_id: mode === "challenge" ? circleId : null,
    };
    const compatiblePayload = { ...payload };
    const optionalColumns = ["seed", "generator_version", "generator_config"];
    let data;
    let error;
    // During a rolling deploy, PostgREST reports one unknown column at a
    // time. Remove only the column explicitly named by that schema-cache
    // error; never discard a supported seed because some other column failed.
    for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
      ({ data, error } = await supabase
        .from("game_stats")
        .insert(compatiblePayload)
        .select()
        .single());
      if (!error) break;
      const message = (error.message || "").toLowerCase();
      const missingColumn = error.code === "PGRST204"
        ? optionalColumns.find((column) => message.includes(column))
        : null;
      if (!missingColumn || !(missingColumn in compatiblePayload)) break;
      delete compatiblePayload[missingColumn];
    }
    const missingGridlyColumns = game === "gridly"
      && error
      && (
        error.code === "PGRST204"
        || /zip_(backtracked_cells|required_moves)/i.test(error.message || "")
      );
    if (missingGridlyColumns) {
      const legacyPayload = { ...compatiblePayload };
      delete legacyPayload.zip_backtracked_cells;
      delete legacyPayload.zip_required_moves;
      ({ data, error } = await supabase
        .from("game_stats")
        .insert(legacyPayload)
        .select()
        .single());
    }
    if (error && error.code === "23505") {
      return { alreadyPlayed: true };
    }
    if (data?.id) {
      if (data.circle_challenge_id && data.challenge_date) void cancelDailyReminderForDate(data.challenge_date);
      const { data: reward, error: rewardError } = await supabase.rpc("award_game_points", { target_stat_id: data.id });
      return { data, error, reward, rewardError };
    }
    return { data, error };
  } catch (error) {
    return { error };
  }
}

// value: 0-100, where the person tapped on the difficulty triangle.
export async function rateDifficulty(statId, value) {
  if (!supabaseReady || !statId) return {};
  const { error } = await supabase.from("game_stats").update({ difficulty_rating: value }).eq("id", statId);
  if (error) throw error;
  return {};
}
