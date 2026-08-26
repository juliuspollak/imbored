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
  url.searchParams.delete("puzzle");
  url.searchParams.delete("rush");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function exitReplayToHome(browserWindow = window) {
  const destination = homeLocationFrom(browserWindow.location.href);
  // Capacitor's local web server can treat a relative location assignment as
  // a reload of the current document. Remove replay state from history first,
  // then reload the now-clean location so main.jsx mounts the normal app.
  browserWindow.history.replaceState({}, "", destination);
  browserWindow.location.reload();
}
