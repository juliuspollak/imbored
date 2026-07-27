import { supabase, supabaseReady } from "./supabase.js";

// Fire-and-forget: called once, right when a puzzle is solved. Silently
// no-ops if Supabase isn't configured or nobody's logged in, so the games
// keep working standalone even without accounts set up.
//
// Returns the created row (so a difficulty rating can be attached to it
// afterward) or { alreadyPlayed: true } if this was a challenge-mode save
// that hit the one-per-day constraint — a real, expected outcome (two tabs
// open, a stale page finishing late), not an error to swallow silently.
export async function saveStats({ userId, game, dayIndex, seconds, mistakes, hints, correctCount = null, totalCount = null, roundsNailed = null, zipBacktrackedCells = null, zipRequiredMoves = null, mode = "practice", challengeDate, teamChallengeId = null, teamId = null }) {
  if (!supabaseReady || !userId) return {};
  try {
    const payload = {
      user_id: userId,
      game,
      day_index: dayIndex,
      seconds,
      mistakes,
      hints,
      correct_count: correctCount,
      total_count: totalCount,
      rounds_nailed: roundsNailed,
      ...(game === "zip" ? {
        zip_backtracked_cells: zipBacktrackedCells,
        zip_required_moves: zipRequiredMoves,
      } : {}),
      mode,
      challenge_date: mode === "challenge" ? challengeDate : null,
      team_challenge_id: mode === "challenge" ? teamChallengeId : null,
      team_id: mode === "challenge" ? teamId : null,
    };
    let { data, error } = await supabase
      .from("game_stats")
      .insert(payload)
      .select()
      .single();
    const missingZipColumns = game === "zip"
      && error
      && (
        error.code === "PGRST204"
        || /zip_(backtracked_cells|required_moves)/i.test(error.message || "")
      );
    if (missingZipColumns) {
      const legacyPayload = { ...payload };
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
