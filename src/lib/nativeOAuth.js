const NATIVE_AUTH_CALLBACK = "imbored://auth/callback";
const completedCallbacks = new Set();
const inFlightCallbacks = new Map();

function parseNativeOAuthCallback(url) {
  if (!url) return null;
  let callback;
  try {
    callback = new URL(url);
  } catch {
    return null;
  }
  if (callback.protocol !== "imbored:" || callback.hostname !== "auth" || callback.pathname !== "/callback") return null;

  const errorDescription = callback.searchParams.get("error_description") || callback.searchParams.get("error");
  if (errorDescription) return { url:callback.href, errorDescription };
  const code = callback.searchParams.get("code");
  if (!code) return { url:callback.href, errorDescription:"The sign-in callback did not contain a PKCE authorization code." };
  return { url:callback.href, code };
}

function isOAuthCancellation(value) {
  const message = String(value?.message || value?.errorDescription || value || "").toLowerCase();
  return message.includes("access_denied")
    || message.includes("user cancelled")
    || message.includes("user canceled")
    || message.includes("cancelled by user")
    || message.includes("canceled by user");
}

function completeNativeOAuthCallback(url, exchange) {
  const callback = parseNativeOAuthCallback(url);
  if (!callback) return null;
  if (completedCallbacks.has(callback.url)) return Promise.resolve();
  if (inFlightCallbacks.has(callback.url)) return inFlightCallbacks.get(callback.url);

  const completion = Promise.resolve()
    .then(() => {
      if (callback.errorDescription) throw new Error(callback.errorDescription);
      return exchange(callback.code);
    })
    .then((result) => {
      completedCallbacks.add(callback.url);
      inFlightCallbacks.delete(callback.url);
      return result;
    })
    .catch((error) => {
      // A transient lifecycle/storage-initialisation failure may be retried if
      // iOS delivers the same callback again. A successful PKCE code remains
      // one-use and is retained in completedCallbacks.
      inFlightCallbacks.delete(callback.url);
      throw error;
    });
  inFlightCallbacks.set(callback.url, completion);
  return completion;
}

export { NATIVE_AUTH_CALLBACK, completeNativeOAuthCallback, isOAuthCancellation, parseNativeOAuthCallback };
