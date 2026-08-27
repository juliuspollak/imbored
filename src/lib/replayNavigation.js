export const REPLAYABLE_GAME_IDS = Object.freeze([
  "hive",
  "binary",
  "gridly",
  "minisudoku",
  "geo",
  "zoom",
]);

export function homeLocationFrom(currentLocation) {
  const url = new URL(currentLocation, "https://imbored.invalid");
  // Home is a canonical route, not a cleaned-up replay route. Discard every
  // query/hash input that could bootstrap another screen.
  return url.pathname;
}

export function exitReplayToHome(browserWindow = window) {
  const destination = new URL(homeLocationFrom(browserWindow.location.href), browserWindow.location.href).href;
  // Replay is selected by main.jsx before React mounts. A single absolute
  // replace clears that bootstrap state and prevents Back returning to it.
  browserWindow.location.replace(destination);
}
