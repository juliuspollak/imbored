import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

export const POKE_MESSAGES = [
  (name) => `👻 ${name} just poked you!`,
  (name) => `🎉 ${name} says hurry up!`,
  (name) => `👀 ${name} is watching your every move...`,
  (name) => `🍕 ${name} sent you a virtual slice of pizza`,
  (name) => `🐢 ${name} thinks you're going too slow`,
  (name) => `🚀 ${name} is cheering you on!`,
  (name) => `🔥 ${name} is on fire and wants you to notice`,
  (name) => `🎯 ${name} is challenging you to beat their time`,
  (name) => `☕ ${name} thinks you need more coffee`,
  (name) => `🐌 ${name} just called you a snail (affectionately)`,
];

export async function sendPoke(fromUserId, toUserId, fromName) {
  if (!supabaseReady || !fromUserId || !toUserId) return { error: new Error("Not signed in") };
  const message = POKE_MESSAGES[Math.floor(Math.random() * POKE_MESSAGES.length)](fromName || "Someone");
  const { error } = await supabase.from("pokes").insert({ from_user: fromUserId, to_user: toUserId, message });
  if (error) console.error("Unable to send poke:", error.message);
  return { error };
}

// Polls for unseen pokes directed at the current user. Returns the most
// recent one (or null) and a dismiss function that marks it seen.
export function usePokes(userId) {
  const [poke, setPoke] = useState(null);

  useEffect(() => {
    if (!supabaseReady || !userId) return;
    let cancelled = false;

    async function poll() {
      const { data } = await supabase
        .from("pokes")
        .select("id, message, from_user")
        .eq("to_user", userId)
        .eq("seen", false)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled && data && data.length > 0) {
        setPoke(data[0]);
      }
    }

    poll();
    const interval = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userId]);

  function dismiss() {
    if (poke) {
      supabase.from("pokes").update({ seen: true }).eq("id", poke.id).then();
      setPoke(null);
    }
  }

  return { poke, dismiss };
}
