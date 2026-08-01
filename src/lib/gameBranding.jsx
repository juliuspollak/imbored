import BeeIcon from "../components/BeeIcon.jsx";
import HiveTileIcon from "../components/HiveTileIcon.jsx";

// Everything a player sees lives here so seasonal names and artwork can change
// without touching game logic or persisted records.
export const HIVE_BRAND = {
  id: "hive",
  name: "Hive",
  tagline: "One bee per row, column & region",
  piece: "bee",
  pieces: "bees",
  GameIcon: HiveTileIcon,
  PieceIcon: BeeIcon,
};

export const GAME_NAMES = {
  hive: HIVE_BRAND.name,
  tango: "Tango",
  zip: "Zip",
  minisudoku: "Mini Sudoku",
  geo: "Geo",
  zoom: "Zoom",
  animalrush: "Animal Rush",
};
