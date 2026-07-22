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

  async function signOut() {
    if (!supabaseReady) return;
    await supabase.auth.signOut();
  }

  async function saveProfile({ name, team }) {
    if (!supabaseReady || !session) return { error: new Error("Not logged in") };
    const { data, error } = await supabase
      .from("profiles")
      .upsert({ id: session.user.id, name, team })
      .select()
      .single();
    if (!error) setProfile(data);
    return { data, error };
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
    signOut,
    saveProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
