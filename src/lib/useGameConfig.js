import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

// Falls back to null config (meaning "use each game's own static default")
// if Supabase isn't set up, or the game_config table doesn't exist yet —
// so the app keeps working normally before the migration is run. loading
// starts true and flips false once the fetch resolves (or immediately if
// there's nothing to fetch) — callers should wait for loading to clear
// before trusting "no config" to mean "nothing is hidden", otherwise a
// game an admin hid would flash visible for a moment on every load.
export function useGameConfig() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    supabase
      .from("game_config")
      .select("*")
      .then(({ data, error }) => {
        if (!error && data) {
          setConfig(Object.fromEntries(data.map((row) => [row.game_id, row])));
        }
        setLoading(false);
      });
  }, []);

  return { config, loading };
}
