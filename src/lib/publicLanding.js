export function shouldShowPublicLanding({ native = false, pathname = "/", search = "", hash = "" } = {}) {
  return !native && pathname === "/" && !search && !hash;
}

export function shouldShowPublicSupport({ native = false, pathname = "/", search = "", hash = "" } = {}) {
  return !native && (pathname === "/support" || pathname === "/support/") && !search && !hash;
}

export function shouldShowPublicPrivacy({ native = false, pathname = "/", search = "", hash = "" } = {}) {
  return !native && (pathname === "/privacy" || pathname === "/privacy/") && !search && !hash;
}

export function shouldShowPublicTerms({ native = false, pathname = "/", search = "", hash = "" } = {}) {
  return !native && (pathname === "/terms" || pathname === "/terms/") && !search && !hash;
}

export const PUBLIC_APP_STORE_URL = "https://apps.apple.com/au/app/imboredtoday/id6804962205";

export function configuredAppStoreUrl(env = import.meta.env) {
  const value = String(env?.VITE_APP_STORE_URL || PUBLIC_APP_STORE_URL).trim();
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "apps.apple.com" ? url.href : null;
  } catch {
    return null;
  }
}
