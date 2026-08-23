import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { isNativePlatform } from "./platform.js";
import { supabase, supabaseReady } from "./supabase.js";
import { buildDailyReminderCandidates, localCalendarDate, reminderHorizonEnd } from "./notificationSchedule.js";
import { notificationNavigation } from "./notificationNavigation.js";
import { hasReminderTimezoneChanged } from "./notificationTimezone.js";

const INSTALLATION_KEY = "imbored-native-installation-id";
const LOCAL_REMINDER_KIND = "circle-daily-reminder";
const REMINDER_TIMEZONE_KEY_PREFIX = "imbored-reminder-timezone";
let activeUserId = null;
let listenersPromise = null;
let reminderSyncVersion = 0;

function installationId() {
  try {
    let value = window.localStorage.getItem(INSTALLATION_KEY);
    if (!value) {
      value = globalThis.crypto?.randomUUID?.() || `ios-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(INSTALLATION_KEY, value);
    }
    return value;
  } catch (error) {
    console.error("Unable to access the native notification installation identifier:", error);
    return null;
  }
}

function currentTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function reminderTimezoneKey(userId) {
  return `${REMINDER_TIMEZONE_KEY_PREFIX}-${userId}`;
}

function reminderTimezoneChanged(userId, timezone = currentTimezone()) {
  try {
    return hasReminderTimezoneChanged(window.localStorage.getItem(reminderTimezoneKey(userId)), timezone);
  } catch {
    return true;
  }
}

function rememberReminderTimezone(userId, timezone = currentTimezone()) {
  try { window.localStorage.setItem(reminderTimezoneKey(userId), timezone); } catch { /* foreground refresh remains the fallback */ }
}

function dispatchNotificationNavigation(data) {
  const detail = notificationNavigation(data);
  if (detail) window.dispatchEvent(new CustomEvent("imbored:navigate", { detail }));
}

async function registerDeviceToken(token) {
  if (!activeUserId || !supabaseReady || !token) return;
  const nativeInstallationId = installationId();
  if (!nativeInstallationId) return;
  try {
    const { error } = await supabase.rpc("register_native_push_device", {
      installation_id_in:nativeInstallationId,
      platform_in:"ios",
      device_token_in:token,
      timezone_in:currentTimezone(),
    });
    if (error) console.error("Unable to register this device for notifications:", error.message);
  } catch (error) {
    console.error("Unable to register this device for notifications:", error);
  }
}

async function unregisterNativeDevice() {
  if (!isNativePlatform() || !supabaseReady) return;
  const nativeInstallationId = installationId();
  if (!nativeInstallationId) return;
  const { error } = await supabase.rpc("unregister_native_push_device", { installation_id_in:nativeInstallationId });
  if (error) throw error;
}

async function registerForPushIfGranted() {
  if (!activeUserId) return;
  const permission = await PushNotifications.checkPermissions();
  if (permission.receive === "granted") await PushNotifications.register();
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
  try {
    await registerForPushIfGranted();
  } catch (error) {
    console.error("Unable to refresh native push registration:", error);
  }
  return () => { if (activeUserId === userId) activeUserId = null; };
}

async function nativePermissionStatus() {
  if (!isNativePlatform()) return { native:false, receive:"unavailable" };
  try {
    const push = await PushNotifications.checkPermissions();
    return { native:true, receive:push.receive };
  } catch (error) {
    return { native:true, receive:"unavailable", error };
  }
}

async function enableNativeNotifications() {
  if (!isNativePlatform()) return { granted:false, reason:"unavailable" };
  try {
    let push = await PushNotifications.checkPermissions();
    if (push.receive === "prompt" || push.receive === "prompt-with-rationale") push = await PushNotifications.requestPermissions();
    if (push.receive !== "granted") return { granted:false, reason:push.receive };
    await PushNotifications.register();
    let local = await LocalNotifications.checkPermissions();
    if (local.display !== "granted") local = await LocalNotifications.requestPermissions();
    if (local.display !== "granted") return { granted:false, reason:local.display };
    return { granted:true };
  } catch (error) {
    console.error("Unable to enable native notifications:", error);
    return { granted:false, reason:"unavailable", error };
  }
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
  if (!error) {
    try {
      await syncDailyChallengeReminders(userId, data);
    } catch (syncError) {
      // The preference is saved server-side even if iOS scheduling is
      // temporarily unavailable. Foreground refresh will retry it later.
      console.error("Unable to apply daily challenge reminders:", syncError);
    }
  }
  return { data, error };
}

async function cancelDailyChallengeReminders() {
  if (!isNativePlatform()) return;
  try {
    const pending = await LocalNotifications.getPending();
    const reminders = pending.notifications.filter((item) => item.extra?.kind === LOCAL_REMINDER_KIND).map(({ id }) => ({ id }));
    if (reminders.length) await LocalNotifications.cancel({ notifications:reminders });
  } catch (error) {
    console.error("Unable to cancel daily challenge reminders:", error);
  }
}

async function cancelDailyReminderForDate(dateString) {
  if (!isNativePlatform() || !dateString) return;
  try {
    const pending = await LocalNotifications.getPending();
    const reminder = pending.notifications.find((item) => item.id === Number(String(dateString).replaceAll("-", "")) && item.extra?.kind === LOCAL_REMINDER_KIND);
    if (reminder) await LocalNotifications.cancel({ notifications:[{ id:reminder.id }] });
  } catch (error) {
    console.error("Unable to cancel the completed challenge reminder:", error);
  }
}

async function syncDailyChallengeReminders(userId, preferences) {
  if (!isNativePlatform()) return;
  const syncVersion = ++reminderSyncVersion;
  if (!userId || preferences?.daily_reminder_period === "off") {
    await cancelDailyChallengeReminders();
    if (userId) rememberReminderTimezone(userId);
    return;
  }
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") return;
  const today = localCalendarDate();
  const through = reminderHorizonEnd();
  const [{ data:rounds, error:roundError }, { data:completed, error:completedError }] = await Promise.all([
    supabase.from("circle_challenge_rounds").select("challenge_id,challenge_date,game").gte("challenge_date", today).lte("challenge_date", through).order("challenge_date"),
    supabase.from("game_stats").select("circle_challenge_id,challenge_date").eq("user_id", userId).not("circle_challenge_id", "is", null).gte("challenge_date", today),
  ]);
  if (roundError || completedError) {
    console.error("Unable to refresh daily challenge reminders:", roundError?.message || completedError?.message);
    return;
  }
  const challengeIds = [...new Set((rounds || []).map((item) => item.challenge_id))];
  if (!challengeIds.length) {
    if (syncVersion === reminderSyncVersion) {
      await cancelDailyChallengeReminders();
      rememberReminderTimezone(userId);
    }
    return;
  }
  const { data:challenges, error:challengeError } = await supabase.from("circle_weekly_challenges").select("id,circle_id,title,closed_at").in("id", challengeIds).is("closed_at", null);
  if (challengeError) {
    console.error("Unable to refresh daily challenge reminders:", challengeError.message);
    return;
  }
  const challengeById = new Map((challenges || []).map((item) => [Number(item.id), item]));
  const eligibleRounds = (rounds || []).filter((item) => challengeById.has(Number(item.challenge_id)));
  const reminders = buildDailyReminderCandidates({ rounds:eligibleRounds, completed:completed || [], period:preferences.daily_reminder_period });
  if (syncVersion !== reminderSyncVersion) return;
  await cancelDailyChallengeReminders();
  if (!reminders.length) {
    rememberReminderTimezone(userId);
    return;
  }
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
  rememberReminderTimezone(userId);
}

async function refreshNativeNotificationState(userId) {
  if (!userId || !isNativePlatform()) return;
  const preferences = await loadNotificationPreferences(userId);
  if (preferences.loadError) {
    console.error("Unable to load notification preferences:", preferences.loadError);
    return;
  }
  await syncDailyChallengeReminders(userId, preferences);
}

async function prepareNativeNotificationLogout() {
  if (!isNativePlatform()) return;
  activeUserId = null;
  reminderSyncVersion += 1;
  const results = await Promise.allSettled([
    cancelDailyChallengeReminders(),
    unregisterNativeDevice(),
  ]);
  for (const result of results) {
    if (result.status === "rejected") console.error("Unable to fully clean up native notifications during sign-out:", result.reason);
  }
}

export {
  enableNativeNotifications,
  cancelDailyReminderForDate,
  loadNotificationPreferences,
  nativePermissionStatus,
  prepareNativeNotificationLogout,
  refreshNativeNotificationState,
  reminderTimezoneChanged,
  saveNotificationPreferences,
  startNativeNotificationListeners,
  syncDailyChallengeReminders,
  unregisterNativeDevice,
};
