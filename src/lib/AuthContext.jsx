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

  useEffect(() => {
    if (!supabaseReady) {
      setSession(null);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadProfile(data.session.user.id);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) loadProfile(newSession.user.id);
      else setProfile(null);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadProfile]);

  async function signInWithEmail(email) {
    if (!supabaseReady) return { error: new Error("Supabase isn't configured yet") };
    return supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
    });
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

  async function signOut() {
    if (!supabaseReady) return;
    await supabase.auth.signOut();
  }

  async function saveProfile({ name, icon, is_private, mood }) {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    const patch = { id: session.user.id };
    if (name !== undefined) patch.name = name;
    if (icon !== undefined) patch.icon = icon;
    if (is_private !== undefined) patch.is_private = is_private;
    if (mood !== undefined) patch.mood = mood;
    const { data, error } = await supabase.from("profiles").upsert(patch).select().single();
    if (!error) setProfile(data);
    return { data, error };
  }

  async function createTeam(name) {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    const { data, error } = await supabase
      .from("teams")
      .insert({ name, created_by: session.user.id })
      .select()
      .single();
    if (!error) {
      // creator joins their own team automatically
      await supabase.from("team_members").insert({ team_id: data.id, user_id: session.user.id });
    }
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
    const { error } = await supabase.from("team_members").insert({ team_id: teamId, user_id: session.user.id });
    return { error };
  }

  async function leaveTeam(teamId) {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    const { error } = await supabase.from("team_members").delete().eq("team_id", teamId).eq("user_id", session.user.id);
    return { error };
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
    signOut,
    saveProfile,
    createTeam,
    addPlayerToTeam,
    joinTeam,
    leaveTeam,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
