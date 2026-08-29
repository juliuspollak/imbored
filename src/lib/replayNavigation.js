export const REPLAYABLE_GAME_IDS = Object.freeze([
  "hive",
  "binary",
  "gridly",
  "minisudoku",
  "geo",
  "zoom",
]);

export const REPLAY_LOCATION_CHANGE_EVENT = "imbored:replay-location-changed";

export function replayStatIdFrom(currentLocation) {
  const url = new URL(currentLocation, "https://imbored.invalid");
  return url.searchParams.get("puzzle");
}

export function homeLocationFrom(currentLocation) {
  const url = new URL(currentLocation, "https://imbored.invalid");
  // Home is a canonical route, not a cleaned-up replay route. Discard every
  // query/hash input that could bootstrap another screen.
  return url.pathname;
}

export function replayHomeUrlFrom(currentLocation) {
  const url = new URL(currentLocation);
  url.search = "";
  url.hash = "";
  return url.href;
}

export function exitReplayToHome(browserWindow = window) {
  console.log("[REPLAY HOME] exitReplayToHome entered", {
    href: browserWindow.location.href,
    pathname: browserWindow.location.pathname,
    search: browserWindow.location.search,
    hash: browserWindow.location.hash,
  });
  const destination = replayHomeUrlFrom(browserWindow.location.href);
  // main.jsx owns the replay/App choice. Clear the URL first, then tell that
  // mounted root to re-read it. Pass WebKit a serialized URL retaining the
  // current scheme/host/path; a path-only "/" is not applied by the iOS
  // WKWebView when the document uses Capacitor's non-special custom scheme.
  browserWindow.history.replaceState({}, "", destination);
  console.log("[REPLAY HOME] after history.replaceState", {
    href: browserWindow.location.href,
    search: browserWindow.location.search,
    hash: browserWindow.location.hash,
  });
  console.log("[REPLAY HOME] dispatching replay-location event", {
    eventName: REPLAY_LOCATION_CHANGE_EVENT,
  });
  browserWindow.dispatchEvent(new browserWindow.Event(REPLAY_LOCATION_CHANGE_EVENT));
  console.log("[REPLAY HOME] replay-location event dispatched");
}
