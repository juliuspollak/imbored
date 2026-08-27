import { App } from "@capacitor/app";
import { isNativePlatform } from "./platform.js";

export const WHATS_NEW_REVISION = 168;
const SEEN_KEY = "imbored-whats-new-seen";

export async function currentReleaseIdentity({ native = isNativePlatform(), getInfo = () => App.getInfo() } = {}) {
  if (!native) return `web:r${WHATS_NEW_REVISION}`;
  try {
    const info = await getInfo();
    return `ios:${info.version || "0"}(${info.build || "0"}):r${WHATS_NEW_REVISION}`;
  } catch {
    return `ios:unknown:r${WHATS_NEW_REVISION}`;
  }
}

export function hasUnseenRelease(identity, storage = globalThis.localStorage) {
  try { return storage?.getItem(SEEN_KEY) !== identity; } catch { return true; }
}

export function markReleaseSeen(identity, storage = globalThis.localStorage) {
  try { storage?.setItem(SEEN_KEY, identity); } catch { /* server timestamp remains a fallback */ }
}

export function releaseLabel(identity) {
  const native = /^ios:([^:]+):/.exec(identity)?.[1];
  return native ? `${native} · What’s New r${WHATS_NEW_REVISION}` : `What’s New r${WHATS_NEW_REVISION}`;
}
