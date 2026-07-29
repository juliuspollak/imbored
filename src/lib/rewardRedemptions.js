import { supabase } from "./supabase.js";

export async function reviewRedemption(id, status) {
  return supabase.rpc("review_redemption", { target_id: id, new_status: status, admin_note_in: null });
}
