import { supabase, supabaseReady } from "./supabase.js";
import { requestPushWake } from "./pushWakeCore.js";

/** Best-effort only: the outbox and scheduled worker remain authoritative. */
export async function wakePushNotifications(client = supabase) {
  if (!supabaseReady && client === supabase || !client?.functions?.invoke) return false;
  return requestPushWake(client);
}
