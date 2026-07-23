import { useEffect, useState, useCallback } from "react";
import { supabase, supabaseReady } from "./supabase.js";

// Falls back to null config (meaning "use each game's own static default")
// if Supabase isn't set up, or the game_config table doesn't exist yet —
// so the app keeps working normally before the migration is run. loading
// starts true and flips false once the fetch resolves (or immediately if
// there's nothing to fetch) — callers should wait for loading to clear
// before trusting "no config" to mean "nothing is hidden", otherwise a
// game an admin hid would flash visible for a moment on every load.
//
// Also returns refetch() — this only fetches once on mount by default, so
// an admin changing a setting (like the hint cooldown) mid-session
// wouldn't be picked up by an already-open game screen without it. Callers
// that need the freshest possible value (like entering a game) should
// call refetch() right before it matters.
export function useGameConfig() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.from("game_config").select("*");
    if (!error && data) {
      setConfig(Object.fromEntries(data.map((row) => [row.game_id, row])));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { config, loading, refetch };
}
