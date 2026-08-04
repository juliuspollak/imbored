import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// App Store guideline 5.1.1(v): an account created in the app must be
// deletable from inside the app. delete_my_account() clears the player's app
// data and anonymises their profile row, but removing the Auth user -- and
// with it the stored email address and any linked Google identity -- needs the
// service role, which the browser must never hold. Hence this function.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = request.headers.get("Authorization") || "";
    if (!authHeader) {
      return jsonResponse({ error: "You must be signed in." }, 401);
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
      return jsonResponse({ error: "Your session has expired. Sign in again." }, 401);
    }
    const userId = userData.user.id;

    // Runs as the caller, so it can only ever delete the caller's own data and
    // refuses for an administrator account.
    const { error: prepError } = await caller.rpc("delete_my_account");
    if (prepError) {
      console.error("delete_my_account failed", prepError);
      return jsonResponse({ error: prepError.message || "Your account could not be deleted." }, 400);
    }

    // Releases the email address and any linked identity. An already-removed
    // Auth user means a previous attempt got this far -- treat as success.
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId, false);
    if (authDeleteError && !/user.*not found/i.test(authDeleteError.message || "")) {
      console.error("Auth deletion failed", authDeleteError);
      return jsonResponse({ error: "Your data was removed but the sign-in could not be closed. Please contact support." }, 500);
    }

    // The anonymised profile row is no longer referenced by anything the player
    // can reach; drop it so no personal data is retained.
    const { error: profileDeleteError } = await admin
      .from("profiles")
      .delete()
      .eq("id", userId);
    if (profileDeleteError) {
      console.error("Profile row removal failed", profileDeleteError);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("delete-my-account crashed", error);
    return jsonResponse({ error: "Your account could not be deleted." }, 500);
  }
});
