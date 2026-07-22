import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// If the keys aren't set yet, the app should still load (just without
// auth/stats working) rather than crash — makes local dev before Supabase
// is configured less painful.
export const supabaseReady = Boolean(url && key);

export const supabase = supabaseReady
  ? createClient(url, key)
  : null;
