import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

// Falls back to null (meaning "use each game's own static default") if
// Supabase isn't set up, or the game_config table doesn't exist yet — so
// the app keeps working normally before the migration is run.
export function useGameConfig() {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    if (!supabaseReady) return;
    supabase
      .from("game_config")
      .select("*")
      .then(({ data, error }) => {
        if (!error && data) {
          setConfig(Object.fromEntries(data.map((row) => [row.game_id, row])));
        }
      });
  }, []);

  return config;
}
