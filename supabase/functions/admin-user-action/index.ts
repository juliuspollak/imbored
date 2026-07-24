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
    if (!targetUserId || !action || !["approve", "block", "unblock", "delete"].includes(action)) {
      return jsonResponse({ error: "Invalid action" }, 400);
    }
    if (targetUserId === userData.user.id) {
      return jsonResponse({ error: "You cannot change your own admin account here" }, 400);
    }

    if (action === "approve") {
      const { data: target, error: targetError } = await caller
        .from("profiles")
        .select("is_admin,is_approved,is_blocked,account_deleted_at")
        .eq("id", targetUserId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || target.account_deleted_at || target.is_blocked) {
        throw new Error("This player is not available for approval.");
      }
      if (target.is_admin || target.is_approved) {
        return jsonResponse({ ok: true, emailSent: false, alreadyApproved: true });
      }

      const { data: authTarget, error: authTargetError } = await admin.auth.admin.getUserById(targetUserId);
      if (authTargetError) throw authTargetError;
      const email = authTarget.user?.email;
      if (!email) throw new Error("This account has no email address.");

      const { error: approvalError } = await caller.rpc("set_user_approval", {
        target_user_id: targetUserId,
        approved: true,
      });
      if (approvalError) throw approvalError;

      // Supabase does not provide a separate "account approved" template.
      // Trigger the existing Magic Link / OTP template for this already
      // registered user and distinguish it with the configured redirect.
      const appUrl = (Deno.env.get("APP_URL") || req.headers.get("origin") || "").replace(/\/+$/, "");
      const mailer = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: emailError } = await mailer.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          ...(appUrl ? { emailRedirectTo: `${appUrl}/?approved=1` } : {}),
        },
      });

      // Approval remains successful if Supabase temporarily rate-limits the
      // notification. Report the delivery state so the admin sees the truth.
      if (emailError) {
        console.error("Player approved, but approval email was not sent", emailError);
        return jsonResponse({
          ok: true,
          emailSent: false,
          emailError: emailError.message || "Supabase could not send the approval email.",
        });
      }
      return jsonResponse({ ok: true, emailSent: true });
    } else if (action === "delete") {
      // Validate directly so deletion does not depend on a recently added
      // database function being deployed before this Edge Function.
      const { data: target, error: targetError } = await caller
        .from("profiles")
        .select("is_admin,account_deleted_at")
        .eq("id", targetUserId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) throw new Error("Player profile not found.");
      if (target.is_admin) throw new Error("Another admin cannot be deleted here.");

      // A previous failed attempt may already have prepared the historical
      // profile. Skip repeated cleanup in that case and retry Auth deletion,
      // which releases linked Google identities.
      if (!target.account_deleted_at) {
        const { error: prepError } = await caller.rpc("prepare_account_deletion", {
          target_user_id: targetUserId,
        });
        if (prepError) throw prepError;
      }

      const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId, false);
      // Treat an already-removed Auth user as a successful idempotent retry.
      if (deleteError && !/user.*not found/i.test(deleteError.message || "")) {
        throw deleteError;
      }

      const { error: markDeletedError } = await admin
        .from("profiles")
        .update({ auth_deleted_at: new Date().toISOString() })
        .eq("id", targetUserId);
      // Auth deletion has already succeeded. Older databases may not have the
      // tracking column until v99 is applied, so do not turn that success into
      // a misleading deletion failure.
      if (markDeletedError && markDeletedError.code !== "42703") {
        console.error("Unable to record completed Auth deletion", markDeletedError);
      }
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
