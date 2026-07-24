import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase, supabaseReady } from "./supabase.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading, null = logged out
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(async (userId) => {
    if (!supabaseReady || !userId) return;
    setProfileLoading(true);
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    setProfile(data || null);
    setProfileLoading(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user?.id) await loadProfile(session.user.id);
  }, [session?.user?.id, loadProfile]);

  useEffect(() => {
    if (!session?.user?.id || profile?.is_approved !== false) return;
    const timer = window.setInterval(() => loadProfile(session.user.id), 10000);
    return () => window.clearInterval(timer);
  }, [session?.user?.id, profile?.is_approved, loadProfile]);

  useEffect(() => {
    if (!supabaseReady) {
      setSession(null);
      return;
    }

    let cancelled = false;

    async function clearInvalidLocalSession(reason) {
      console.warn("Clearing an invalid local Supabase session:", reason);
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch (signOutError) {
        console.warn("Local session cleanup failed:", signOutError);
      }
      if (!cancelled) {
        setSession(null);
        setProfile(null);
        setProfileLoading(false);
      }
    }

    async function initialiseSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          await clearInvalidLocalSession(error.message || error);
          return;
        }
        if (cancelled) return;
        setSession(data.session);
        if (data.session) await loadProfile(data.session.user.id);
        else setProfile(null);
      } catch (error) {
        await clearInvalidLocalSession(error);
      }
    }

    initialiseSession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (cancelled) return;

      // Supabase emits SIGNED_OUT when a stored refresh token has expired,
      // been revoked, or already been rotated in another browser tab. Clear
      // the app state immediately so the client does not keep retrying the
      // same invalid token while an idle game remains open.
      if (event === "SIGNED_OUT" || !newSession) {
        setSession(null);
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      setSession(newSession);
      loadProfile(newSession.user.id);
    });

    async function checkSessionWhenVisible() {
      if (document.visibilityState !== "visible") return;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          await clearInvalidLocalSession(error.message || error);
          return;
        }
        if (!cancelled && !data.session) {
          setSession(null);
          setProfile(null);
          setProfileLoading(false);
        }
      } catch (error) {
        await clearInvalidLocalSession(error);
      }
    }

    document.addEventListener("visibilitychange", checkSessionWhenVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", checkSessionWhenVisible);
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  async function signInWithEmail(email) {
    if (!supabaseReady) return { error: new Error("Supabase isn't configured yet") };

    try {
      return await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
      });
    } catch (error) {
      // Network and 5xx Auth failures can be thrown by supabase-js rather
      // than returned in the normal { error } result. Preserve the object so
      // the login screen can turn it into a useful message.
      console.error("Supabase signInWithOtp failed:", error);
      return { error };
    }
  }

  async function verifyCode(email, token) {
    if (!supabaseReady) return { error: new Error("Supabase isn't configured yet") };
    return supabase.auth.verifyOtp({ email, token, type: "email" });
  }

  async function signInWithGoogle() {
    if (!supabaseReady) return { error: new Error("Supabase isn't configured yet") };
    return supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  // Discoverable-credential sign-in: no email needed upfront, the
  // authenticator's own picker resolves which account. Only works for
  // someone who already registered a passkey on a previous visit.
  async function signInWithPasskey() {
    if (!supabaseReady) return { error: new Error("Supabase isn't configured yet") };
    return supabase.auth.signInWithPasskey();
  }

  // Requires an existing signed-in session — this adds a passkey to the
  // CURRENT account, it doesn't create a new one. Typically called from the
  // profile screen.
  async function registerPasskey() {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    return supabase.auth.registerPasskey();
  }

  async function listPasskeys() {
    if (!supabaseReady) return { data: [] };
    return supabase.auth.passkey.list();
  }

  async function renamePasskey(passkeyId, friendlyName) {
    if (!supabaseReady) return { error: new Error("Not logged in") };
    return supabase.auth.passkey.update({ passkeyId, friendlyName });
  }

  async function deletePasskey(passkeyId) {
    if (!supabaseReady) return { error: new Error("Not logged in") };
    return supabase.auth.passkey.delete({ passkeyId });
  }

  async function listIdentities() {
    if (!supabaseReady || !session) return { data: { identities: [] }, error: new Error("Not logged in") };
    return supabase.auth.getUserIdentities();
  }

  async function linkGoogleIdentity() {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    return supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
  }

  async function unlinkIdentity(identity) {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    return supabase.auth.unlinkIdentity(identity);
  }

  async function adminAccountAction(action, targetUserId, reason = "") {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    const { data, error } = await supabase.functions.invoke("admin-user-action", {
      body: { action, targetUserId, reason },
    });
    return { data, error };
  }

  async function signOut() {
    if (!supabaseReady) return;
    await supabase.auth.signOut();
  }

  async function saveProfile({ name, icon, is_private, mood, default_mode, show_stats_to_others, week_starts_on }) {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    const { data, error } = await supabase.rpc("save_my_profile", {
      profile_name: name ?? null,
      profile_icon: icon ?? null,
      profile_is_private: is_private ?? null,
      profile_mood: mood ?? null,
      profile_default_mode: default_mode ?? null,
      profile_show_stats: show_stats_to_others ?? null,
      profile_week_starts_on: week_starts_on ?? null,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row) setProfile(row);
    return { data: row, error };
  }

  async function createTeam(name, emoji = "⭐") {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    const { data, error } = await supabase.rpc("create_team", {
      team_name: name,
      team_emoji: emoji,
    });
    return { data, error };
  }

  // Adding someone ELSE goes through a server-side function rather than a
  // direct insert, so a private profile can never be added by anyone but
  // themselves — see migration_multiteam.sql for the check. Joining
  // yourself is a plain insert, which RLS already allows directly.
  async function addPlayerToTeam(targetUserId, teamId) {
    if (!supabaseReady) return { error: new Error("Not logged in") };
    return supabase.rpc("add_player_to_team", { target_user_id: targetUserId, target_team_id: teamId });
  }

  async function joinTeam(teamId) {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    return supabase.rpc("request_team_join", { target_team_id: teamId });
  }

  async function leaveTeam(teamId) {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    return supabase.rpc("leave_team", { target_team_id: teamId });
  }

  // Admin-only: hides a player from everyone but themselves and other
  // admins. Enforced server-side via RLS, not just filtered client-side —
  // see migration_release_notes_and_hiding.sql.
  async function setUserHidden(targetUserId, hidden) {
    if (!supabaseReady) return { error: new Error("Not logged in") };
    return supabase.rpc("set_user_hidden", { target_user_id: targetUserId, hidden });
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    profileLoading,
    loading: session === undefined,
    signInWithEmail,
    verifyCode,
    signInWithGoogle,
    signInWithPasskey,
    registerPasskey,
    listPasskeys,
    renamePasskey,
    deletePasskey,
    listIdentities,
    linkGoogleIdentity,
    unlinkIdentity,
    adminAccountAction,
    signOut,
    saveProfile,
    createTeam,
    addPlayerToTeam,
    joinTeam,
    leaveTeam,
    setUserHidden,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
