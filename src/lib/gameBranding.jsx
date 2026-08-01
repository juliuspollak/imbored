import BeeIcon from "../components/BeeIcon.jsx";
import HiveTileIcon from "../components/HiveTileIcon.jsx";
import GridlyIcon from "../components/GridlyIcon.jsx";

const ACTIVE_SEASON = import.meta.env?.VITE_SEASONAL_THEME || "default";

function gameBrand(base) {
  const seasonalOverride = base.seasons?.[ACTIVE_SEASON] || {};
  return { ...base, ...seasonalOverride };
}

// Everything a player sees lives here so seasonal names and artwork can change
// without touching game logic or persisted records.
export const HIVE_BRAND = gameBrand({
  id: "hive",
  name: "Hive",
  tagline: "One bee per row, column & region",
  piece: "bee",
  pieces: "bees",
  GameIcon: HiveTileIcon,
  PieceIcon: BeeIcon,
  tileBackground: null,
  seasons: {},
});

export const GRIDLY_BRAND = gameBrand({
  id: "gridly",
  name: "Gridly",
  tagline: "Connect the numbers. Fill the grid.",
  GameIcon: GridlyIcon,
  tileIconSize: 28,
  tileBackground: null,
  seasons: {},
});

export const GAME_NAMES = {
  hive: HIVE_BRAND.name,
  tango: "Tango",
  gridly: GRIDLY_BRAND.name,
  minisudoku: "Sudoku",
  geo: "Geo",
  zoom: "Zoom",
  animalrush: "Animal Rush",
};
