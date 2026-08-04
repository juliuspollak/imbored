import { Capacitor } from "@capacitor/core";

// One place to ask "are we inside the native shell?", so feature code never
// has to sniff the user agent. In a browser these all report web and every
// caller falls back to its existing behaviour.
export function isNativePlatform() {
  return Capacitor.isNativePlatform();
}

export function currentPlatform() {
  return Capacitor.getPlatform(); // "ios" | "android" | "web"
}

export function isIOS() {
  return Capacitor.getPlatform() === "ios";
}
