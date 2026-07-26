const originalMediaQueries = new WeakMap();
let currentPreference = "system";
let watchingStylesheets = false;

export const THEME_PREFERENCES = ["system", "light", "dark"];

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

  // Vite adds stylesheets for lazy-loaded screens after the initial render.
  // Apply the active override to those sheets as soon as they arrive too.
  if (!watchingStylesheets && typeof MutationObserver !== "undefined") {
    watchingStylesheets = true;
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes.length > 0)) {
        queueMicrotask(() => applyThemePreference(currentPreference));
      }
    }).observe(document.head, { childList: true });
  }
}
