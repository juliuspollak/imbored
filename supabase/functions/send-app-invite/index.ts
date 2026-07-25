import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g,(character) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;",
  })[character] || character);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status:200,headers:corsHeaders });
  if (req.method !== "POST") return json({ error:"Method not allowed" },405);

  try {
    const authHeader=req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error:"Not signed in" },401);
    const url=Deno.env.get("SUPABASE_URL");
    const anon=Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey=Deno.env.get("RESEND_API_KEY");
    if (!url || !anon || !serviceKey || !resendKey) throw new Error("Invitation email is not configured.");

    const caller=createClient(url,anon,{
      global:{ headers:{ Authorization:authHeader } },
      auth:{ persistSession:false,autoRefreshToken:false },
    });
    const admin=createClient(url,serviceKey,{ auth:{ persistSession:false,autoRefreshToken:false } });
    const { data:userData,error:userError }=await caller.auth.getUser();
    if (userError || !userData.user) return json({ error:"Your session expired. Sign in again." },401);

    const body=await req.json();
    const email=String(body?.email || "").trim().toLowerCase();
    const { data:invitationId,error:prepareError }=await caller.rpc("prepare_app_email_invitation",{ target_email:email });
    if (prepareError) throw prepareError;

    const { data:profile }=await caller.from("profiles").select("name").eq("id",userData.user.id).maybeSingle();
    const inviterName=profile?.name || "A friend";
    const safeInviterName=escapeHtml(inviterName);
    const appUrl=(Deno.env.get("APP_URL") || "https://imbored.au").replace(/\/+$/,"");
    const from=Deno.env.get("RESEND_FROM_EMAIL") || "I’mBoredToday <notifications@imbored.au>";
    const response=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{ Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json" },
      body:JSON.stringify({
        from,
        to:[email],
        subject:`${inviterName} invited you to I’mBoredToday`,
        text:`${inviterName} invited you to play puzzles together on I’mBoredToday.\n\nOpen the app: ${appUrl}`,
        html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1b2129;line-height:1.6"><h2>You’ve been invited 🎉</h2><p><strong>${safeInviterName}</strong> invited you to play puzzles together on I’mBoredToday.</p><p style="margin:24px 0"><a href="${appUrl}" style="display:inline-block;background:#2f6fed;color:white;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px">Open I’mBoredToday</a></p><p style="font-size:13px;color:#667085">Create an account with this email address to get started.</p></div>`,
      }),
    });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
    await admin.from("app_email_invitations").update({ sent_at:new Date().toISOString() }).eq("id",invitationId);
    return json({ ok:true });
  } catch (error) {
    console.error("send-app-invite failed",error);
    return json({ error:error instanceof Error ? error.message : "Invitation failed" },400);
  }
});
