const originalMediaQueries = new WeakMap();
let currentPreference = "system";
let watchingStylesheets = false;

export const THEME_PREFERENCES = ["system", "light", "dark"];
const CACHE_KEY = "imbored-theme-preference";

// The saved preference lives on the profile row, only known once auth
// resolves - too late to avoid a dark flash on the pre-login screen if the
// device's system theme is dark. Cache the last-known value locally so it
// can be applied before any network round trip.
export function getCachedThemePreference() {
  try {
    const value = window.localStorage.getItem(CACHE_KEY);
    return THEME_PREFERENCES.includes(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function cacheThemePreference(preference) {
  try {
    if (THEME_PREFERENCES.includes(preference)) window.localStorage.setItem(CACHE_KEY, preference);
  } catch {
    // Best effort only.
  }
}

function updateDarkModeRules(rules, preference) {
  for (const rule of rules) {
    if (typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule) {
      const original = originalMediaQueries.get(rule) || rule.conditionText;
      originalMediaQueries.set(rule, original);
      if (original.includes("prefers-color-scheme: dark")) {
        rule.media.mediaText = preference === "dark" ? "all" : preference === "light" ? "not all" : original;
      }
    }
    if (rule.cssRules && !(typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule)) updateDarkModeRules(rule.cssRules, preference);
  }
}

export function applyThemePreference(preference = "system") {
  if (typeof document === "undefined") return;
  const selected = THEME_PREFERENCES.includes(preference) ? preference : "system";
  currentPreference = selected;
  document.documentElement.dataset.theme = selected;
  document.documentElement.style.colorScheme = selected === "system" ? "light dark" : selected;

  for (const sheet of document.styleSheets) {
    try {
      updateDarkModeRules(sheet.cssRules, selected);
    } catch {
      // Cross-origin stylesheets cannot be inspected; the app's theme CSS is local.
    }
  }

  // Vite adds stylesheets for lazy-loaded screens (e.g. a game opened for
  // the first time) after the initial render. Apply the active override to
  // those sheets as soon as they arrive too - but a freshly inserted <link>
  // hasn't fetched/parsed yet, so reading its cssRules right away throws
  // (Safari in particular) and the override silently never lands, leaving
  // that screen on the raw system theme until some later, unrelated
  // re-apply happens to catch it already loaded (e.g. after a reload, once
  // the browser has it cached). Retry once each such link finishes loading,
  // in addition to the immediate attempt (which still covers inline <style>
  // tags that are usable right away).
  if (!watchingStylesheets && typeof MutationObserver !== "undefined") {
    watchingStylesheets = true;
    new MutationObserver((mutations) => {
      let sawNewNode = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          sawNewNode = true;
          if (node.tagName === "LINK" && node.rel === "stylesheet") {
            node.addEventListener("load", () => applyThemePreference(currentPreference), { once: true });
          }
        }
      }
      if (sawNewNode) queueMicrotask(() => applyThemePreference(currentPreference));
    }).observe(document.head, { childList: true });
  }
}
