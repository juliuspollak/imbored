export const GAME_DISPLAY_NAMES = Object.freeze({
  hive: "Hive",
  binary: "Twist",
  gridly: "Gridly",
  minisudoku: "Sudoku",
  geo: "Geo",
  zoom: "Zoom",
  animalrush: "Animal Rush",
});

export function displayGameName(gameId) {
  return GAME_DISPLAY_NAMES[gameId] || gameId;
}
