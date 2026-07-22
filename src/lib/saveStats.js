import { supabase, supabaseReady } from "./supabase.js";

// Fire-and-forget: called once, right when a puzzle is solved. Silently
// no-ops if Supabase isn't configured or nobody's logged in, so the games
// keep working standalone even without accounts set up.
//
// Returns the created row (so a difficulty rating can be attached to it
// afterward) or { alreadyPlayed: true } if this was a challenge-mode save
// that hit the one-per-day constraint — a real, expected outcome (two tabs
// open, a stale page finishing late), not an error to swallow silently.
export async function saveStats({ userId, game, dayIndex, seconds, mistakes, hints, mode = "practice", challengeDate }) {
  if (!supabaseReady || !userId) return {};
  try {
    const { data, error } = await supabase
      .from("game_stats")
      .insert({
        user_id: userId,
        game,
        day_index: dayIndex,
        seconds,
        mistakes,
        hints,
        mode,
        challenge_date: mode === "challenge" ? challengeDate : null,
      })
      .select()
      .single();
    if (error && error.code === "23505") {
      return { alreadyPlayed: true };
    }
    return { data, error };
  } catch (error) {
    return { error };
  }
}

// value: 0-100, where the person tapped on the difficulty triangle.
export async function rateDifficulty(statId, value) {
  if (!supabaseReady || !statId) return {};
  try {
    const { error } = await supabase.from("game_stats").update({ difficulty_rating: value }).eq("id", statId);
    return { error };
  } catch (error) {
    return { error };
  }
}
