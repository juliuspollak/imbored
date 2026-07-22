import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// If the keys aren't set yet, the app should still load (just without
// auth/stats working) rather than crash — makes local dev before Supabase
// is configured less painful.
export const supabaseReady = Boolean(url && key);

export const supabase = supabaseReady
  ? createClient(url, key, {
      // Passkeys are still experimental in supabase-js — explicit opt-in
      // required. Safe to leave on even if you never enable passkeys in
      // the Supabase dashboard; it just won't do anything until you do.
      auth: { experimental: { passkey: true } },
    })
  : null;
