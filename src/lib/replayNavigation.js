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

export function exitReplayToHome(browserWindow = window) {
  const destination = homeLocationFrom(browserWindow.location.href);
  // main.jsx owns the replay/App choice. Clear the URL first, then tell that
  // mounted root to re-read it. This avoids relying on a capacitor:// document
  // reload, which can retain/reopen the WebView's replay bootstrap document.
  browserWindow.history.replaceState({}, "", destination);
  browserWindow.dispatchEvent(new browserWindow.Event(REPLAY_LOCATION_CHANGE_EVENT));
}
