import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  // Browser preflight requests do not contain a user JWT. This must run
  // before any authentication or body parsing.
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Not signed in" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !anon || !service) {
      console.error("Missing required Supabase Edge Function environment variables");
      return jsonResponse({ error: "Function configuration is incomplete" }, 500);
    }

    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) {
      console.error("Caller authentication failed", userError);
      return jsonResponse({ error: "Your admin session has expired. Sign in again." }, 401);
    }

    const { data: me, error: profileError } = await caller
      .from("profiles")
      .select("is_admin,is_blocked,account_deleted_at")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Unable to load admin profile", profileError);
      return jsonResponse({ error: "Unable to verify administrator access" }, 500);
    }
    if (!me?.is_admin || me?.is_blocked || me?.account_deleted_at) {
      return jsonResponse({ error: "Admin only" }, 403);
    }

    let body: { action?: string; targetUserId?: string; reason?: string | null };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }

    const { action, targetUserId, reason } = body;
    if (!targetUserId || !action || !["block", "unblock", "delete"].includes(action)) {
      return jsonResponse({ error: "Invalid action" }, 400);
    }
    if (targetUserId === userData.user.id) {
      return jsonResponse({ error: "You cannot block or delete your own admin account" }, 400);
    }

    if (action === "delete") {
      // Validate before changing either system. The old order marked the
      // profile deleted first; if Auth deletion then failed, the target was
      // left with a live login attached to a disabled historical profile.
      const { error: validationError } = await caller.rpc("validate_account_deletion", {
        target_user_id: targetUserId,
      });
      if (validationError) throw validationError;

      const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId, false);
      if (deleteError) throw deleteError;

      const { error: prepError } = await caller.rpc("prepare_account_deletion", {
        target_user_id: targetUserId,
      });
      if (prepError) throw prepError;
    } else {
      const blocked = action === "block";
      const { error: authError } = await admin.auth.admin.updateUserById(targetUserId, {
        ban_duration: blocked ? "876000h" : "none",
      });
      if (authError) throw authError;

      const { error: dbError } = await caller.rpc("admin_set_user_block", {
        target_user_id: targetUserId,
        blocked,
        reason: reason || null,
      });
      if (dbError) throw dbError;
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("admin-user-action failed", error);
    const message = error instanceof Error ? error.message : "Action failed";
    return jsonResponse({ error: message }, 400);
  }
});
