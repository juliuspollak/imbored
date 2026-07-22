import { supabase, supabaseReady } from "./supabase.js";

// Fire-and-forget: called once, right when a puzzle is solved. Silently
// no-ops if Supabase isn't configured or nobody's logged in, so the games
// keep working standalone even without accounts set up.
export async function saveStats({ userId, game, dayIndex, seconds, mistakes, hints }) {
  if (!supabaseReady || !userId) return;
  try {
    await supabase.from("game_stats").insert({
      user_id: userId,
      game,
      day_index: dayIndex,
      seconds,
      mistakes,
      hints,
    });
  } catch {
    // stats saving should never break gameplay
  }
}
