import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { isNativePlatform } from "./platform.js";
import { supabase, supabaseReady } from "./supabase.js";
import { buildDailyReminderCandidates, localCalendarDate } from "./notificationSchedule.js";

const INSTALLATION_KEY = "imbored-native-installation-id";
const LOCAL_REMINDER_KIND = "circle-daily-reminder";
let activeUserId = null;
let listenersPromise = null;

function installationId() {
  let value = window.localStorage.getItem(INSTALLATION_KEY);
  if (!value) {
    value = globalThis.crypto?.randomUUID?.() || `ios-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(INSTALLATION_KEY, value);
  }
  return value;
}

function currentTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function notificationNavigation(data = {}) {
  const route = data.route || data.type;
  if (["circle_challenge", "daily_challenge", "competition_update", "challenge_result"].includes(route)) {
    return {
      screen:"circles",
      circleId:Number(data.circleId || data.circle_id) || null,
      challengeId:Number(data.challengeId || data.challenge_id) || null,
    };
  }
  return null;
}

function dispatchNotificationNavigation(data) {
  const detail = notificationNavigation(data);
  if (detail) window.dispatchEvent(new CustomEvent("imbored:navigate", { detail }));
}

async function registerDeviceToken(token) {
  if (!activeUserId || !supabaseReady || !token) return;
  const { error } = await supabase.rpc("register_native_push_device", {
    installation_id_in:installationId(),
    platform_in:"ios",
    device_token_in:token,
    timezone_in:currentTimezone(),
  });
  if (error) console.error("Unable to register this device for notifications:", error.message);
}

async function unregisterNativeDevice() {
  if (!isNativePlatform() || !supabaseReady) return;
  await supabase.rpc("unregister_native_push_device", { installation_id_in:installationId() });
}

async function startNativeNotificationListeners(userId) {
  if (!isNativePlatform()) return () => {};
  activeUserId = userId || null;
  if (!listenersPromise) {
    listenersPromise = Promise.all([
      PushNotifications.addListener("registration", ({ value }) => { void registerDeviceToken(value); }),
      PushNotifications.addListener("registrationError", (error) => console.error("Native notification registration failed:", error?.error || error)),
      PushNotifications.addListener("pushNotificationReceived", (notification) => {
        window.dispatchEvent(new CustomEvent("imbored:notification-received", { detail:notification }));
      }),
      PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => dispatchNotificationNavigation(notification?.data)),
      LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => dispatchNotificationNavigation(notification?.extra)),
    ]);
  }
  await listenersPromise;
  return () => { if (activeUserId === userId) activeUserId = null; };
}

async function nativePermissionStatus() {
  if (!isNativePlatform()) return { native:false, receive:"unavailable" };
  const push = await PushNotifications.checkPermissions();
  return { native:true, receive:push.receive };
}

async function enableNativeNotifications() {
  if (!isNativePlatform()) return { granted:false, reason:"unavailable" };
  let push = await PushNotifications.checkPermissions();
  if (push.receive === "prompt" || push.receive === "prompt-with-rationale") push = await PushNotifications.requestPermissions();
  if (push.receive !== "granted") return { granted:false, reason:push.receive };
  const local = await LocalNotifications.checkPermissions();
  if (local.display !== "granted") await LocalNotifications.requestPermissions();
  await PushNotifications.register();
  return { granted:true };
}

async function loadNotificationPreferences(userId) {
  const defaults = { circle_challenges_enabled:true, daily_reminder_period:"off", competition_updates_enabled:true, timezone:currentTimezone() };
  if (!supabaseReady || !userId) return defaults;
  const { data, error } = await supabase.from("notification_preferences").select("*").eq("user_id", userId).maybeSingle();
  if (error) return { ...defaults, loadError:error.message };
  return { ...defaults, ...(data || {}) };
}

async function saveNotificationPreferences(userId, preferences) {
  const payload = {
    user_id:userId,
    circle_challenges_enabled:!!preferences.circle_challenges_enabled,
    daily_reminder_period:preferences.daily_reminder_period,
    competition_updates_enabled:!!preferences.competition_updates_enabled,
    timezone:currentTimezone(),
    updated_at:new Date().toISOString(),
  };
  const { data, error } = await supabase.from("notification_preferences").upsert(payload).select().single();
  if (!error) await syncDailyChallengeReminders(userId, data);
  return { data, error };
}

async function cancelDailyChallengeReminders() {
  if (!isNativePlatform()) return;
  const pending = await LocalNotifications.getPending();
  const reminders = pending.notifications.filter((item) => item.extra?.kind === LOCAL_REMINDER_KIND).map(({ id }) => ({ id }));
  if (reminders.length) await LocalNotifications.cancel({ notifications:reminders });
}

async function cancelDailyReminderForDate(dateString) {
  if (!isNativePlatform() || !dateString) return;
  const pending = await LocalNotifications.getPending();
  const reminder = pending.notifications.find((item) => item.id === Number(String(dateString).replaceAll("-", "")) && item.extra?.kind === LOCAL_REMINDER_KIND);
  if (reminder) await LocalNotifications.cancel({ notifications:[{ id:reminder.id }] });
}

async function syncDailyChallengeReminders(userId, preferences) {
  if (!isNativePlatform()) return;
  await cancelDailyChallengeReminders();
  if (!userId || preferences?.daily_reminder_period === "off") return;
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") return;
  const today = localCalendarDate();
  const through = new Date();
  through.setDate(through.getDate() + 30);
  const [{ data:rounds, error:roundError }, { data:completed, error:completedError }] = await Promise.all([
    supabase.from("circle_challenge_rounds").select("challenge_id,challenge_date,game").gte("challenge_date", today).lte("challenge_date", localCalendarDate(through)).order("challenge_date"),
    supabase.from("game_stats").select("circle_challenge_id,challenge_date").eq("user_id", userId).not("circle_challenge_id", "is", null).gte("challenge_date", today),
  ]);
  if (roundError || completedError) {
    console.error("Unable to refresh daily challenge reminders:", roundError?.message || completedError?.message);
    return;
  }
  const challengeIds = [...new Set((rounds || []).map((item) => item.challenge_id))];
  if (!challengeIds.length) return;
  const { data:challenges, error:challengeError } = await supabase.from("circle_weekly_challenges").select("id,circle_id,title,closed_at").in("id", challengeIds).is("closed_at", null);
  if (challengeError) return;
  const challengeById = new Map((challenges || []).map((item) => [Number(item.id), item]));
  const eligibleRounds = (rounds || []).filter((item) => challengeById.has(Number(item.challenge_id)));
  const reminders = buildDailyReminderCandidates({ rounds:eligibleRounds, completed:completed || [], period:preferences.daily_reminder_period });
  if (!reminders.length) return;
  await LocalNotifications.schedule({ notifications:reminders.map((item) => {
    const challenge = challengeById.get(Number(item.round.challenge_id));
    return {
      id:item.id,
      title:"Today’s Circle challenge",
      body:challenge?.title ? `${challenge.title} is ready to play.` : "Your Circle challenge is ready to play.",
      schedule:{ at:item.at, allowWhileIdle:true },
      extra:{ kind:LOCAL_REMINDER_KIND, route:"daily_challenge", circleId:challenge?.circle_id, challengeId:item.round.challenge_id, challengeDate:item.date },
    };
  }) });
}

export {
  enableNativeNotifications,
  cancelDailyReminderForDate,
  loadNotificationPreferences,
  nativePermissionStatus,
  notificationNavigation,
  saveNotificationPreferences,
  startNativeNotificationListeners,
  syncDailyChallengeReminders,
  unregisterNativeDevice,
};
