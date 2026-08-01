import { supabase, supabaseReady } from "./supabase.js";

// Fire-and-forget: called once, right when a puzzle is solved. Silently
// no-ops if Supabase isn't configured or nobody's logged in, so the games
// keep working standalone even without accounts set up.
//
// Returns the created row (so a difficulty rating can be attached to it
// afterward) or { alreadyPlayed: true } if this was a challenge-mode save
// that hit the one-per-day constraint — a real, expected outcome (two tabs
// open, a stale page finishing late), not an error to swallow silently.
export async function saveStats({ userId, game, dayIndex, seconds, mistakes, hints, seed = null, correctCount = null, totalCount = null, roundsNailed = null, gridlyBacktrackedCells = null, gridlyRequiredMoves = null, mode = "practice", challengeDate, circleChallengeId = null, circleId = null }) {
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
      correct_count: correctCount,
      total_count: totalCount,
      rounds_nailed: roundsNailed,
      ...(game === "gridly" ? {
        zip_backtracked_cells: gridlyBacktrackedCells,
        zip_required_moves: gridlyRequiredMoves,
      } : {}),
      mode,
      challenge_date: mode === "challenge" ? challengeDate : null,
      circle_challenge_id: mode === "challenge" ? circleChallengeId : null,
      circle_id: mode === "challenge" ? circleId : null,
    };
    let { data, error } = await supabase
      .from("game_stats")
      .insert(payload)
      .select()
      .single();
    const missingSeedColumn = error
      && (error.code === "PGRST204" || /\bseed\b/i.test(error.message || ""));
    if (missingSeedColumn) {
      const compatiblePayload = { ...payload };
      delete compatiblePayload.seed;
      ({ data, error } = await supabase
        .from("game_stats")
        .insert(compatiblePayload)
        .select()
        .single());
    }
    const missingGridlyColumns = game === "gridly"
      && error
      && (
        error.code === "PGRST204"
        || /zip_(backtracked_cells|required_moves)/i.test(error.message || "")
      );
    if (missingGridlyColumns) {
      const legacyPayload = { ...payload };
      if (missingSeedColumn) delete legacyPayload.seed;
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
