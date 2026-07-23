import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import { rateDifficulty } from "../lib/saveStats.js";
import DifficultyRating from "../DifficultyRating.jsx";
import geoFacts from "./geo/geoFacts.json";
import { Globe2, RotateCcw, Shuffle, Lightbulb, Timer as TimerIcon, HelpCircle, Lock } from "lucide-react";

/* ---------------- continents & map ---------------- */

const CONTINENTS = ["North America", "South America", "Europe", "Africa", "Asia", "Oceania", "Antarctica"];
const MAP_REGIONS = [...CONTINENTS, "Greenland", "New Zealand"];

// Traced from real geographic data (Natural Earth, via Highcharts' map
// collection), simplified down to a clean point count — not hand-drawn
// approximations. Each continent keeps its mainland plus any secondary
// landmass at least 1.5% of the mainland's area, which is what brings in
// Greenland, Madagascar, and a few others that a
// single-polygon simplification would otherwise drop entirely.
const CONTINENT_SHAPES = {
  "North America": { d: "M 118.8 147.1 L 113.7 148.7 L 88.9 135.9 L 76.1 119.6 L 82.0 130.2 L 79.5 128.8 L 65.0 108.3 L 67.2 96.8 L 52.5 80.0 L 34.1 80.3 L 35.1 76.4 L 27.9 85.1 L 26.8 84.3 L 21.3 87.9 L 18.6 87.7 L 27.6 80.6 L 18.0 77.8 L 23.3 70.5 L 15.0 68.7 L 24.0 67.0 L 17.1 62.4 L 27.9 57.4 L 59.0 60.1 L 56.3 61.0 L 54.7 62.4 L 55.5 62.6 L 59.7 60.7 L 60.6 58.7 L 98.3 66.3 L 97.8 52.3 L 104.1 51.7 L 99.1 55.9 L 103.7 63.2 L 111.4 60.4 L 114.4 65.2 L 99.8 76.2 L 101.2 83.9 L 116.1 93.0 L 118.0 74.3 L 122.6 74.1 L 143.5 89.4 L 128.3 96.6 L 137.5 101.5 L 120.9 109.5 L 115.4 127.6 L 106.6 120.9 L 95.8 125.1 L 97.7 135.4 L 108.1 132.5 L 105.6 138.6 L 118.8 147.1 Z M 114.9 43.7 L 118.4 45.4 L 116.1 47.2 L 116.3 46.2 L 114.2 46.5 L 114.7 45.8 L 103.7 45.2 L 107.9 43.9 L 106.4 42.6 L 107.6 42.3 L 109.2 43.3 L 111.8 43.7 L 112.9 42.2 L 109.4 43.2 L 110.3 41.2 L 107.2 41.8 L 108.2 40.1 L 113.8 39.9 L 114.1 39.4 L 110.9 39.7 L 108.4 37.6 L 108.4 36.1 L 111.5 36.3 L 113.9 38.0 L 115.1 38.0 L 112.1 36.1 L 119.7 34.6 L 117.1 34.7 L 118.5 33.5 L 110.8 35.6 L 108.1 35.4 L 108.8 34.4 L 107.5 35.3 L 105.1 34.7 L 108.1 34.3 L 110.4 33.6 L 104.5 34.3 L 106.2 32.7 L 102.1 32.6 L 106.6 31.3 L 110.3 31.6 L 108.1 31.2 L 109.2 30.3 L 115.7 31.7 L 112.7 30.5 L 115.6 28.9 L 120.5 29.9 L 118.8 28.8 L 120.2 28.6 L 127.6 28.4 L 131.4 29.1 L 128.8 29.8 L 133.3 29.0 L 136.9 30.2 L 137.2 31.0 L 133.7 32.4 L 127.1 33.9 L 133.5 32.8 L 124.7 36.8 L 126.5 36.6 L 125.6 37.7 L 118.8 38.4 L 122.1 39.0 L 121.7 40.6 L 119.8 40.7 L 121.4 41.2 L 117.9 42.2 L 117.7 43.6 L 114.9 43.7 Z M 128.8 59.8 L 127.8 60.5 L 129.4 59.4 L 131.0 61.7 L 128.4 61.4 L 129.8 62.1 L 129.1 62.9 L 137.2 66.7 L 134.7 70.0 L 130.8 67.0 L 129.7 67.1 L 130.6 68.0 L 128.9 67.6 L 134.0 72.6 L 132.8 72.5 L 132.7 73.9 L 128.5 72.4 L 133.1 76.4 L 126.4 74.3 L 125.8 72.5 L 124.0 72.3 L 122.6 70.4 L 118.1 71.8 L 118.7 69.0 L 121.0 70.4 L 120.4 69.2 L 123.3 69.0 L 122.1 67.7 L 124.5 65.8 L 123.8 63.6 L 122.7 63.3 L 123.3 64.5 L 122.2 64.5 L 122.4 63.1 L 121.0 63.1 L 121.9 62.4 L 119.6 62.8 L 120.7 61.5 L 118.8 61.6 L 118.4 59.7 L 116.8 59.0 L 116.3 59.3 L 117.3 60.1 L 115.7 61.4 L 114.0 60.1 L 107.7 60.1 L 104.9 57.8 L 107.5 58.0 L 104.5 57.3 L 104.2 56.1 L 105.4 53.2 L 110.0 51.9 L 108.1 54.1 L 108.8 56.3 L 110.2 57.4 L 108.9 57.7 L 110.2 57.7 L 110.6 57.0 L 108.9 55.8 L 110.0 55.4 L 109.4 53.8 L 114.0 52.1 L 115.2 55.5 L 116.0 54.8 L 117.3 56.1 L 118.6 54.3 L 121.3 54.8 L 121.9 56.6 L 125.4 56.9 L 126.1 58.8 L 129.1 58.9 L 127.6 59.8 L 128.8 59.8 Z" },
  Greenland: { d: "M 176.7 56.9 L 178.1 57.6 L 176.7 58.1 L 178.4 58.7 L 175.2 59.2 L 176.2 58.4 L 175.4 58.3 L 175.0 59.3 L 176.7 59.1 L 175.4 59.9 L 181.7 59.8 L 173.7 63.7 L 171.1 63.9 L 170.2 62.9 L 170.7 64.0 L 167.7 67.3 L 164.8 68.9 L 163.9 68.5 L 164.7 67.3 L 163.8 67.5 L 161.4 69.0 L 161.0 72.2 L 158.8 74.3 L 157.1 79.1 L 152.1 77.3 L 147.7 71.5 L 145.9 67.7 L 147.5 66.2 L 145.6 65.9 L 147.6 65.4 L 145.7 65.6 L 145.9 64.5 L 148.5 63.7 L 146.3 63.6 L 146.6 62.8 L 149.9 62.1 L 149.0 60.1 L 144.9 58.6 L 146.0 57.3 L 146.2 58.5 L 148.3 59.2 L 146.5 57.3 L 148.1 56.8 L 143.4 56.6 L 143.0 54.3 L 144.6 53.8 L 140.5 47.5 L 134.7 46.0 L 129.0 46.7 L 125.7 44.5 L 127.8 42.9 L 123.9 41.7 L 124.3 40.8 L 131.9 39.3 L 132.9 36.9 L 130.1 36.1 L 131.5 34.8 L 137.6 33.8 L 137.0 32.3 L 138.6 31.7 L 145.0 30.5 L 145.8 32.8 L 146.3 30.9 L 150.7 31.7 L 148.9 30.2 L 155.7 32.2 L 156.7 32.0 L 152.9 29.4 L 156.5 30.5 L 156.1 31.3 L 157.3 30.5 L 155.0 29.4 L 161.6 29.6 L 153.7 28.8 L 156.2 28.2 L 172.3 27.0 L 178.0 27.9 L 177.5 28.2 L 172.2 28.4 L 167.3 29.0 L 178.5 28.3 L 182.9 29.8 L 169.8 32.0 L 170.6 32.5 L 179.2 31.6 L 177.1 33.2 L 182.9 31.4 L 183.0 32.9 L 180.9 34.5 L 186.0 32.1 L 186.9 33.2 L 187.0 32.3 L 187.6 33.0 L 189.3 32.1 L 194.3 33.1 L 189.7 35.3 L 186.0 35.5 L 189.3 35.9 L 188.5 36.4 L 184.0 37.3 L 185.3 37.7 L 185.4 40.1 L 183.4 40.1 L 182.2 42.9 L 185.2 42.3 L 185.2 41.2 L 186.3 40.5 L 185.2 43.3 L 183.5 43.0 L 185.5 44.1 L 187.1 42.6 L 186.1 47.0 L 185.5 44.9 L 181.3 45.2 L 184.5 46.3 L 185.1 48.7 L 182.5 47.9 L 184.2 50.0 L 185.7 50.0 L 186.6 48.3 L 187.5 49.2 L 185.1 50.9 L 182.4 50.5 L 181.9 51.3 L 183.8 52.8 L 177.4 53.2 L 180.9 56.5 L 182.3 56.4 L 182.7 59.0 L 180.6 59.2 L 179.5 57.8 L 176.7 56.9 Z" },,
  "South America": { d: "M 114.5 163.6 L 125.3 142.7 L 136.4 144.8 L 148.7 152.2 L 147.0 158.8 L 167.5 165.1 L 160.4 182.3 L 132.7 206.4 L 126.1 225.0 L 120.7 214.3 L 127.1 180.1 L 114.5 163.6 Z" },
  Europe: { d: "M 242.8 99.7 L 232.1 113.2 L 222.8 100.8 L 228.5 108.7 L 225.7 111.6 L 217.3 102.8 L 204.9 113.2 L 196.5 110.6 L 196.9 104.5 L 205.6 103.9 L 201.4 97.0 L 217.1 89.3 L 217.2 83.6 L 223.6 88.7 L 235.2 83.4 L 229.9 78.7 L 235.4 68.4 L 227.3 74.3 L 224.6 87.0 L 213.2 80.1 L 229.9 59.6 L 254.3 64.7 L 244.2 65.8 L 247.9 71.2 L 257.8 68.2 L 256.9 62.9 L 284.4 62.5 L 277.1 93.4 L 266.8 94.3 L 262.1 107.2 L 249.2 101.7 L 252.2 98.7 L 242.8 99.7 Z M 285.7 44.6 L 286.2 45.6 L 284.1 46.7 L 273.9 50.2 L 274.5 51.0 L 270.7 55.2 L 272.7 59.1 L 266.3 56.8 L 269.7 52.4 L 268.7 52.1 L 271.7 50.4 L 270.8 50.0 L 272.6 48.3 L 285.7 44.6 Z M 199.3 81.7 L 200.2 81.3 L 200.4 83.2 L 201.6 81.1 L 204.4 80.3 L 202.5 83.0 L 205.1 82.7 L 203.7 85.3 L 207.2 88.4 L 207.3 90.3 L 209.3 91.0 L 208.9 93.0 L 201.4 94.8 L 204.2 92.3 L 201.3 91.8 L 202.5 91.3 L 202.1 89.6 L 204.1 88.4 L 203.4 87.2 L 201.4 87.3 L 202.0 86.2 L 201.2 85.6 L 200.7 86.5 L 200.8 83.5 L 199.9 83.7 L 199.3 81.7 Z M 227.4 37.3 L 229.0 39.2 L 231.9 40.0 L 229.1 40.9 L 226.6 45.6 L 223.2 43.2 L 226.5 42.4 L 222.9 41.9 L 226.7 41.2 L 224.3 40.3 L 223.2 41.6 L 221.1 40.5 L 221.2 41.6 L 219.4 40.1 L 220.9 37.4 L 224.0 37.5 L 226.0 39.8 L 225.3 37.3 L 227.4 37.3 Z" },
  Africa: { d: "M 201.1 114.3 L 218.6 112.4 L 229.0 121.4 L 246.5 120.1 L 252.8 139.5 L 266.0 143.4 L 237.7 196.8 L 228.3 197.4 L 218.3 152.5 L 197.9 151.7 L 188.2 142.8 L 187.9 131.8 L 201.1 114.3 Z M 264.1 174.7 L 261.2 185.9 L 257.7 185.9 L 256.8 182.6 L 258.2 179.9 L 258.2 175.5 L 261.1 174.4 L 263.7 170.6 L 265.1 174.6 L 264.1 174.7 Z" },
  Asia: { d: "M 425.0 67.7 L 409.1 70.1 L 412.0 74.7 L 394.5 78.7 L 386.6 93.4 L 385.9 84.2 L 395.0 76.4 L 395.6 74.1 L 362.0 87.2 L 369.1 91.8 L 353.2 109.2 L 355.1 115.2 L 342.4 109.9 L 347.7 112.3 L 346.5 123.8 L 328.6 133.9 L 329.2 146.1 L 321.8 141.6 L 326.7 155.3 L 312.0 130.6 L 296.0 147.7 L 290.3 131.3 L 264.6 121.5 L 266.0 128.8 L 271.8 126.2 L 275.7 131.3 L 257.6 142.5 L 247.0 124.1 L 248.6 112.9 L 237.3 111.1 L 253.8 104.0 L 269.1 113.0 L 265.3 98.3 L 277.5 92.8 L 283.9 57.4 L 290.6 54.3 L 289.5 56.9 L 291.6 63.1 L 289.2 66.7 L 288.2 67.0 L 287.2 66.4 L 286.2 66.4 L 286.7 67.0 L 289.7 67.5 L 294.7 62.1 L 295.5 64.6 L 297.7 64.9 L 296.2 62.4 L 293.7 61.6 L 291.7 61.7 L 292.1 53.7 L 303.2 59.1 L 299.2 53.1 L 317.8 44.0 L 337.1 46.1 L 337.3 48.6 L 329.9 52.4 L 328.0 54.2 L 349.9 51.7 L 357.1 58.5 L 373.7 54.7 L 425.0 67.7 Z" },
  Oceania: { d: "M 370.0 168.6 L 382.8 186.0 L 378.4 202.1 L 369.4 202.9 L 357.4 194.0 L 339.0 197.6 L 337.4 183.1 L 350.5 173.5 L 363.5 170.1 L 367.5 177.3 L 370.0 168.6 Z M 368.6 167.3 L 368.6 159.9 L 372.2 160.6 L 376.5 164.2 L 375.5 164.6 L 377.3 167.2 L 379.8 167.7 L 380.0 168.5 L 376.6 168.5 L 374.5 166.1 L 371.8 165.6 L 371.4 167.2 L 368.6 167.3 Z" },
  "New Zealand": { d: "M 401.4 214.2 L 398.9 215.1 L 399.2 213.6 L 397.8 213.4 L 404.9 205.7 L 405.4 206.8 L 406.6 206.4 L 405.4 210.3 L 403.4 210.9 L 401.4 214.2 Z M 407.9 207.2 L 407.1 206.8 L 407.8 205.4 L 406.2 204.2 L 407.4 202.0 L 406.8 200.0 L 404.9 197.8 L 408.2 200.0 L 408.7 201.9 L 411.6 202.0 L 407.9 207.2 Z" },,
  Antarctica: { d: "M 18 226 C 45 218 72 221 98 216 C 126 211 154 219 181 215 C 210 210 238 218 267 214 C 296 210 326 219 352 216 C 378 213 404 220 423 225 L 416 240 C 378 244 342 239 304 243 C 266 247 228 240 190 244 C 151 248 112 241 76 244 C 51 246 31 240 20 236 Z" }
};

const MAP_VIEWBOX = "0 0 440 260";

/* ---------------- question bank ----------------
   Every fact below is a well-established, unambiguous one — deliberately
   avoiding genuinely contested cases (transcontinental countries like
   Russia or Turkey, animals native to multiple continents) so nothing in
   here is actually debatable. difficulty: 1 = famous/easy, 3 = obscure. */

const CITIES = [
  { name: "Paris", continent: "Europe", difficulty: 1 },
  { name: "Tokyo", continent: "Asia", difficulty: 1 },
  { name: "Cairo", continent: "Africa", difficulty: 1 },
  { name: "New York", continent: "North America", difficulty: 1 },
  { name: "Sydney", continent: "Oceania", difficulty: 1 },
  { name: "Rio de Janeiro", continent: "South America", difficulty: 1 },
  { name: "Nairobi", continent: "Africa", difficulty: 2 },
  { name: "Bangkok", continent: "Asia", difficulty: 2 },
  { name: "Toronto", continent: "North America", difficulty: 2 },
  { name: "Lima", continent: "South America", difficulty: 2 },
  { name: "Berlin", continent: "Europe", difficulty: 2 },
  { name: "Marrakesh", continent: "Africa", difficulty: 2 },
  { name: "Ho Chi Minh City", continent: "Asia", difficulty: 2 },
  { name: "Bogotá", continent: "South America", difficulty: 2 },
  { name: "Ulaanbaatar", continent: "Asia", difficulty: 3 },
  { name: "Ouagadougou", continent: "Africa", difficulty: 3 },
  { name: "Quito", continent: "South America", difficulty: 3 },
  { name: "Reykjavik", continent: "Europe", difficulty: 3 },
  { name: "Winnipeg", continent: "North America", difficulty: 3 },
];

const ANIMALS = [
  { name: "Kangaroo", continent: "Oceania", difficulty: 1 },
  { name: "Giant panda", continent: "Asia", difficulty: 1 },
  { name: "Lion", continent: "Africa", difficulty: 1 },
  { name: "Bald eagle", continent: "North America", difficulty: 1 },
  { name: "Jaguar", continent: "South America", difficulty: 1 },
  { name: "Koala", continent: "Oceania", difficulty: 1 },
  { name: "Giraffe", continent: "Africa", difficulty: 1 },
  { name: "Grizzly bear", continent: "North America", difficulty: 2 },
  { name: "Orangutan", continent: "Asia", difficulty: 2 },
  { name: "Llama", continent: "South America", difficulty: 2 },
  { name: "Platypus", continent: "Oceania", difficulty: 2 },
  { name: "Zebra", continent: "Africa", difficulty: 2 },
  { name: "Sloth", continent: "South America", difficulty: 2 },
  { name: "Moose", continent: "North America", difficulty: 2 },
  { name: "Iberian lynx", continent: "Europe", difficulty: 3 },
  { name: "Komodo dragon", continent: "Asia", difficulty: 3 },
  { name: "Capybara", continent: "South America", difficulty: 3 },
  { name: "Tasmanian devil", continent: "Oceania", difficulty: 3 },
  { name: "Alpine ibex", continent: "Europe", difficulty: 3 },
  { name: "Snow leopard", continent: "Asia", difficulty: 3 },
];

const LANDMARKS = [
  { name: "Eiffel Tower", continent: "Europe", difficulty: 1 },
  { name: "Great Wall of China", continent: "Asia", difficulty: 1 },
  { name: "Pyramids of Giza", continent: "Africa", difficulty: 1 },
  { name: "Statue of Liberty", continent: "North America", difficulty: 1 },
  { name: "Sydney Opera House", continent: "Oceania", difficulty: 1 },
  { name: "Machu Picchu", continent: "South America", difficulty: 1 },
  { name: "Colosseum", continent: "Europe", difficulty: 2 },
  { name: "Taj Mahal", continent: "Asia", difficulty: 2 },
  { name: "Victoria Falls", continent: "Africa", difficulty: 2 },
  { name: "Niagara Falls", continent: "North America", difficulty: 2 },
  { name: "Christ the Redeemer", continent: "South America", difficulty: 2 },
  { name: "Uluru", continent: "Oceania", difficulty: 2 },
  { name: "Stonehenge", continent: "Europe", difficulty: 3 },
  { name: "Angkor Wat", continent: "Asia", difficulty: 3 },
  { name: "Table Mountain", continent: "Africa", difficulty: 3 },
  { name: "Chichén Itzá", continent: "North America", difficulty: 3 },
  { name: "Iguazu Falls", continent: "South America", difficulty: 3 },
  { name: "Great Barrier Reef", continent: "Oceania", difficulty: 3 },
];

const POLAR_FACTS = [
  { id: "south-pole", type: "polar", name: "South Pole", prompt: "Which continent contains the South Pole?", answer: "Antarctica", difficulty: 1 },
  { id: "emperor-penguin", type: "polar", name: "Emperor penguin", prompt: "Which continent is the emperor penguin native to?", answer: "Antarctica", difficulty: 1 },
  { id: "mount-erebus", type: "polar", name: "Mount Erebus", prompt: "Mount Erebus is located on which continent?", answer: "Antarctica", difficulty: 2 },
  { id: "mcmurdo", type: "polar", name: "McMurdo Station", prompt: "McMurdo Station is on which continent?", answer: "Antarctica", difficulty: 2 },
  { id: "north-pole-region", type: "region", name: "North Pole", prompt: "Which polar region surrounds the North Pole?", answer: "Arctic", options: ["Arctic", "Antarctica", "Oceania", "Europe"], difficulty: 1 },
  { id: "polar-bear-region", type: "region", name: "Polar bear", prompt: "Polar bears naturally live in which polar region?", answer: "Arctic", options: ["Arctic", "Antarctica", "Asia", "North America"], difficulty: 1 },
  { id: "arctic-ocean-pole", type: "region", name: "Arctic Ocean", prompt: "The Arctic Ocean surrounds which pole?", answer: "North Pole", options: ["North Pole", "South Pole", "Equator", "Prime Meridian"], difficulty: 2 },
];

const REGION_FACTS = [
  { id: "greenland-name", name: "Greenland", prompt: "Tap Greenland on the map.", answer: "Greenland", difficulty: 1 },
  { id: "greenland-nuuk", name: "Nuuk", prompt: "Nuuk is the capital of which place shown on the map?", answer: "Greenland", difficulty: 2 },
  { id: "greenland-largest-island", name: "Largest island", prompt: "Tap the world's largest island.", answer: "Greenland", difficulty: 2 },
  { id: "greenland-arctic", name: "Arctic island", prompt: "Tap the large Arctic island northeast of Canada.", answer: "Greenland", difficulty: 2 },
  { id: "new-zealand-name", name: "New Zealand", prompt: "Tap New Zealand on the map.", answer: "New Zealand", difficulty: 1 },
  { id: "new-zealand-wellington", name: "Wellington", prompt: "Wellington is the capital of which place shown on the map?", answer: "New Zealand", difficulty: 2 },
  { id: "new-zealand-kiwi", name: "Kiwi", prompt: "Tap the home of the kiwi bird.", answer: "New Zealand", difficulty: 1 },
  { id: "new-zealand-aotearoa", name: "Aotearoa", prompt: "Which place on the map is also called Aotearoa?", answer: "New Zealand", difficulty: 2 },
];

const COUNTRIES = geoFacts.countries;


/* ---------------- generation ---------------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Mon..Sun: difficulty ceiling ramps from "easy only" to "anything goes".
const DIFFICULTY_CEILING = [1, 1, 2, 2, 3, 3, 3];

const QUESTION_TEMPLATES = {
  city: [
    ({ name }) => `Which continent is ${name} in?`,
    ({ name }) => `${name} is a city on which continent?`,
    ({ name }) => `On which continent would you find ${name}?`,
  ],
  animal: [
    ({ name }) => `Which continent is the ${name} native to?`,
    ({ name }) => `On which continent does the ${name} naturally live?`,
    ({ name }) => `Which continent is home to the ${name}?`,
  ],
  landmark: [
    ({ name }) => `Which continent is the ${name} in?`,
    ({ name }) => `On which continent is the ${name} located?`,
    ({ name }) => `Which continent would you visit to see the ${name}?`,
  ],
  country: [
    ({ name }) => `Which continent is ${name} in?`,
    ({ name }) => `${name} belongs to which continent?`,
    ({ name }) => `On which continent is ${name} located?`,
  ],
  capital: [
    ({ name }) => `${name} is a capital city on which continent?`,
    ({ name, countryName }) => `${name}, the capital of ${countryName}, is on which continent?`,
    ({ name }) => `On which continent is the capital city ${name}?`,
  ],
  currency: [
    ({ name, countryName }) => `${countryName} uses the ${name}. Which continent is ${countryName} in?`,
    ({ code, countryName }) => `The currency code ${code} is used in ${countryName}. Which continent is ${countryName} in?`,
  ],
  language: [
    ({ name, countryName }) => `${name} is a main language of ${countryName}. Which continent is ${countryName} in?`,
    ({ countryName }) => `Which continent contains ${countryName}?`,
  ],
  flag: [
    ({ name, countryName }) => `Which continent is ${countryName} in? ${name}`,
    ({ name, countryName }) => `${name} is the flag of ${countryName}. Which continent is ${countryName} in?`,
    ({ name, countryName }) => `This is the flag of ${countryName}: ${name} Which continent does ${countryName} belong to?`,
  ],
};

function makeQuestion(type, fact) {
  if (type === "region") {
    return { ...fact, type, options: shuffle([fact.answer, ...MAP_REGIONS.filter((name) => name !== fact.answer)]).slice(0, 4) };
  }
  const templates = QUESTION_TEMPLATES[type];
  const templateIndex = templates ? Math.floor(Math.random() * templates.length) : 0;
  const baseId = fact.id || fact.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const answer = fact.answer || fact.continent;
  const mode = fact.options ? "choice" : (Math.random() < 0.55 ? "map" : "choice");
  const options = fact.options || shuffle([
    answer,
    ...shuffle(CONTINENTS.filter((continent) => continent !== answer)).slice(0, 3),
  ]);

  return {
    id: `${type}:${baseId}:${templateIndex}:${mode}`,
    factId: `${type}:${baseId}`,
    sourceId: fact.sourceId || baseId,
    type,
    mode,
    prompt: fact.prompt || templates[templateIndex](fact),
    answer,
    options,
    fixedChoice: Boolean(fact.options),
  };
}

function getRecentFactIds(userId) {
  if (typeof window === "undefined") return [];
  try {
    const key = `geo_recent_facts:${userId || "guest"}`;
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 80) : [];
  } catch {
    return [];
  }
}

function rememberFacts(userId, questions) {
  if (typeof window === "undefined") return;
  try {
    const key = `geo_recent_facts:${userId || "guest"}`;
    const existing = getRecentFactIds(userId);
    const next = [...questions.map((q) => q.factId), ...existing.filter((id) => !questions.some((q) => q.factId === id))].slice(0, 80);
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Local history is a best-effort repetition guard only.
  }
}

function chooseFact(pool, usedSources, recent) {
  const unseen = pool.filter((q) => !usedSources.has(q.sourceId) && !recent.has(q.factId));
  const fallback = pool.filter((q) => !usedSources.has(q.sourceId));
  return shuffle(unseen.length ? unseen : fallback)[0];
}

function countryFactPools(ceiling) {
  const records = COUNTRIES.filter((country) => country.difficulty <= ceiling);
  return {
    country: records.map((country) => ({
      id: country.id,
      sourceId: `country:${country.id}`,
      name: country.name,
      continent: country.continent,
    })),
    capital: records.filter((country) => country.capital).map((country) => ({
      id: country.id,
      sourceId: `country:${country.id}`,
      name: country.capital,
      countryName: country.name,
      continent: country.continent,
    })),
    currency: records.filter((country) => country.currencyName).map((country) => ({
      id: country.id,
      sourceId: `country:${country.id}`,
      name: country.currencyName,
      code: country.currencyCode,
      countryName: country.name,
      continent: country.continent,
    })),
    language: records.filter((country) => country.languageName).map((country) => ({
      id: country.id,
      sourceId: `country:${country.id}`,
      name: country.languageName,
      countryName: country.name,
      continent: country.continent,
    })),
    flag: records.filter((country) => country.flag).map((country) => ({
      id: country.id,
      sourceId: `country:${country.id}`,
      name: country.flag,
      countryName: country.name,
      continent: country.continent,
    })),
  };
}

function generateQuiz(dayIdx, recentFactIds = []) {
  const ceiling = DIFFICULTY_CEILING[dayIdx];
  const recent = new Set(recentFactIds);
  const tag = (type, q) => ({
    ...q,
    sourceId: `${type}:${q.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    factId: `${type}:${q.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  });
  const structured = countryFactPools(ceiling);
  const pools = {
    city: CITIES.filter((q) => q.difficulty <= ceiling).map((q) => tag("city", q)),
    animal: ANIMALS.filter((q) => q.difficulty <= ceiling).map((q) => tag("animal", q)),
    landmark: LANDMARKS.filter((q) => q.difficulty <= ceiling).map((q) => tag("landmark", q)),
    polar: POLAR_FACTS.filter((q) => q.difficulty <= ceiling).map((q) => ({
      ...q,
      sourceId: `polar:${q.id}`,
      factId: `polar:${q.id}`,
    })),
    region: REGION_FACTS.filter((q) => q.difficulty <= ceiling).map((q) => ({
      ...q,
      sourceId: `region:${q.id}`,
      factId: `region:${q.id}`,
    })),
    ...structured,
  };

  const questions = [];
  const usedSources = new Set();

  // Always include one polar fact so Antarctica/Arctic content is genuinely
  // part of every round rather than being left to chance.
  const polarFact = chooseFact(pools.polar || [], usedSources, recent);
  if (polarFact) {
    usedSources.add(polarFact.sourceId);
    questions.push(makeQuestion("polar", polarFact));
  }

  const categoryOrder = shuffle(["country", "capital", "flag", "city", "animal", "landmark", "currency", "language", "region"]);
  for (const type of categoryOrder) {
    if (questions.length >= 5) break;
    const fact = chooseFact(pools[type] || [], usedSources, recent);
    if (!fact) continue;
    usedSources.add(fact.sourceId);
    questions.push(makeQuestion(type, fact));
  }

  const mixed = shuffle(questions);
  const fixedChoiceCount = mixed.filter((question) => question.fixedChoice).length;
  const targetMapCount = Math.min(3, mixed.length - fixedChoiceCount);
  let mapCount = 0;

  return mixed.map((question) => {
    if (question.type === "region") return { ...question, mode: "map" };
    if (question.fixedChoice) return { ...question, mode: "choice" };
    if (mapCount < targetMapCount) {
      mapCount += 1;
      return { ...question, mode: "map" };
    }
    return { ...question, mode: "choice" };
  });
}

/* ---------------- design tokens ---------------- */

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";
const RED = "#E5484D";
const GREEN = "#16A34A";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/* ---------------- component ---------------- */

export default function GeoGame({ userId, onSolved, mode = "practice", forcedDayIdx, seed, challengeDate, hintCooldownConfig, savedStatId } = {}) {
  const todayIdx = (() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  })();
  const isChallenge = mode === "challenge";
  const [dayIdx, setDayIdx] = useState(isChallenge ? forcedDayIdx ?? todayIdx : todayIdx);
  const hintCooldownSeconds = (hintCooldownConfig?.hint_cooldown_base || 0) + (hintCooldownConfig?.hint_cooldown_per_day || 0) * dayIdx;
  const hintCooldown = useHintCooldown(hintCooldownSeconds);

  const [questions, setQuestions] = useState(null);
  const [qIdx, setQIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [eliminated, setEliminated] = useState([]); // continents faded by the map hint, this question only
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [solved, setSolved] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const timerRef = useRef(null);

  const newQuiz = useCallback((dIdx) => {
    const recent = isChallenge ? [] : getRecentFactIds(userId);
    const gen = () => generateQuiz(dIdx, recent);
    const qs = isChallenge && seed ? withSeededRandom(seed, gen) : gen();
    setQuestions(qs);
    if (!isChallenge) rememberFacts(userId, qs);
    setQIdx(0);
    setSelected(null);
    setAnswered(false);
    setEliminated([]);
    setSeconds(0);
    setRunning(true);
    setSolved(false);
    setMistakes(0);
    setHintsUsed(0);
    hintCooldown.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChallenge, seed, userId]);

  useEffect(() => {
    newQuiz(dayIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIdx]);

  useEffect(() => {
    if (running && !solved) {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [running, solved]);

  if (!questions) {
    return (
      <div style={{ background: BG, minHeight: "100vh" }} className="flex items-center justify-center">
        <span style={{ color: INK, opacity: 0.6 }} className="text-sm">Building today's quiz…</span>
      </div>
    );
  }

  const q = questions[qIdx];
  const isLast = qIdx === questions.length - 1;

  function pick(option) {
    if (answered || solved) return;
    setSelected(option);
    setAnswered(true);
    if (option !== q.answer) setMistakes((m) => m + 1);
  }

  function next() {
    if (isLast) {
      setSolved(true);
      setRunning(false);
      onSolved && onSolved({ userId, game: "geo", dayIndex: dayIdx, seconds, mistakes, hints: hintsUsed, mode, challengeDate: isChallenge ? challengeDate : undefined });
      return;
    }
    setQIdx((i) => i + 1);
    setSelected(null);
    setAnswered(false);
    setEliminated([]);
  }

  function handleHint() {
    if (solved || answered || hintCooldown.locked || eliminated.length > 0) return;
    const candidates = q.mode === "choice" ? q.options : CONTINENTS;
    const wrongAnswers = candidates.filter((option) => option !== q.answer);
    const toEliminate = shuffle(wrongAnswers).slice(0, 2);
    setEliminated(toEliminate);
    setHintsUsed((h) => h + 1);
    hintCooldown.startCooldown();
  }

  function handleReset() {
    if (solved) return;
    newQuiz(dayIdx);
  }

  return (
    <div style={{ background: BG, minHeight: "100vh" }} className="flex items-center justify-center p-4">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .geo-card { font-family: 'Inter', sans-serif; }
        @media (hover: hover) and (pointer: fine) {
          .geo-option:not(:disabled):hover { filter: brightness(0.97); transform: translateY(-1px); }
          .geo-day-btn:hover { filter: brightness(1.12); }
          .geo-icon-btn:hover { opacity: 0.85; }
          .geo-toolbar-btn:not(:disabled):hover { background: rgba(16,24,40,0.10) !important; }
          .geo-next-btn:hover { filter: brightness(1.08); }
          .geo-continent:not([aria-disabled="true"]):hover { filter: brightness(1.08); }
        }
        .geo-continent:focus-visible { outline: none; filter: drop-shadow(0 0 4px rgba(47,111,237,0.8)); }
        .geo-map-shell { box-shadow: inset 0 0 0 1px rgba(47,111,237,0.08); }
        @media (max-width: 420px) {
          .geo-card { padding: 16px !important; }
          .geo-map-shell { margin-left: -4px; width: calc(100% + 8px); }
        }
      `}</style>

      <div
        className="geo-card w-full max-w-sm sm:max-w-md lg:max-w-lg rounded-2xl p-5 lg:p-6 relative"
        style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
      >
        <button onClick={() => setShowHelp((h) => !h)} className="geo-icon-btn absolute top-4 right-4 transition-opacity" style={{ color: INK, opacity: 0.5 }}>
          <HelpCircle size={16} />
        </button>

        <div className="text-center mb-4">
          <h1 style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK, letterSpacing: "-0.01em" }} className="text-4xl lg:text-5xl">
            Geo
          </h1>
          <p style={{ color: INK, opacity: 0.45 }} className="text-xs mt-1">five quick questions — tap or choose</p>
        </div>

        {isChallenge ? (
          <div className="flex justify-center mb-4">
            <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: `${ACCENT}18`, color: ACCENT }}>
              <span className="text-xs font-semibold">Today's Challenge</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-1.5 mb-4">
            {DAYS.map((d, i) => (
              <button
                key={d}
                onClick={() => setDayIdx(i)}
                className="geo-day-btn flex items-center justify-center rounded-lg px-2.5 py-1.5 transition-colors"
                style={{ background: i === dayIdx ? ACCENT : "rgba(16,24,40,0.05)", color: i === dayIdx ? "#FFFFFF" : INK, minWidth: 38 }}
              >
                <span className="text-xs font-semibold">{d}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-center gap-4 mb-3 px-1">
          <div className="flex items-center gap-1.5" style={{ color: INK, opacity: 0.7 }}>
            <TimerIcon size={14} />
            <span className="text-xs tabular-nums">{fmtTime(seconds)}</span>
          </div>
          <div style={{ color: INK, opacity: 0.7 }} className="text-xs">
            question <span style={{ color: ACCENT, fontWeight: 600 }}>{Math.min(qIdx + 1, questions.length)}</span>/{questions.length}
          </div>

        </div>

        <div className="flex items-center justify-center gap-2 mb-4">
          {[
            { Icon: RotateCcw, label: "Restart", onClick: handleReset, disabled: solved },
            { Icon: Shuffle, label: "New", onClick: () => newQuiz(dayIdx), disabled: isChallenge },
            {
              Icon: hintCooldown.locked ? Lock : Lightbulb,
              label: hintCooldown.locked ? `${hintCooldown.remaining}s` : "Hint",
              onClick: handleHint,
              disabled: solved || answered || hintCooldown.locked || eliminated.length > 0,
            },
          ].map(({ Icon, label, onClick, disabled }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={disabled}
              className="geo-toolbar-btn flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 transition-colors"
              style={{ background: "rgba(16,24,40,0.05)", color: disabled ? "rgba(27,33,41,0.28)" : INK, cursor: disabled ? "default" : "pointer" }}
            >
              <Icon size={15} />
              <span className="text-[9px]">{label}</span>
            </button>
          ))}
        </div>

        {showHelp && (
          <div className="text-xs rounded-lg p-2.5 mb-3" style={{ background: "rgba(16,24,40,0.05)", color: INK, opacity: 0.75, lineHeight: 1.4 }}>
            Five quick geography questions. Some use the map; others use four answers. On four-answer questions, the hint removes two wrong choices. On map questions, it fades two wrong continents.
          </div>
        )}

        {!solved && (
          <>
            <p style={{ color: INK, fontWeight: 600 }} className="text-base text-center mb-3 min-h-[48px] flex items-center justify-center">
              {q.prompt}
            </p>

            {q.mode === "map" ? (
              <>
            <div className="relative w-full rounded-xl overflow-hidden mb-3 geo-map-shell">
              <svg
                viewBox={MAP_VIEWBOX}
                className="w-full block"
                role="group"
                aria-label="Tap the correct place on the map"
                style={{ background: "linear-gradient(180deg, #D7ECFA 0%, #EEF7FC 100%)", borderRadius: 16, touchAction: "manipulation" }}
              >
                <defs>
                  <linearGradient id="geo-land" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#B9D2E6" />
                    <stop offset="100%" stopColor="#91B5D1" />
                  </linearGradient>
                  <filter id="geo-shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#315A7A" floodOpacity="0.20" />
                  </filter>
                  <filter id="geo-active" x="-25%" y="-25%" width="150%" height="150%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#163B5C" floodOpacity="0.28" />
                  </filter>
                </defs>
                <g opacity="0.20" fill="none" stroke="#6EA4C8" strokeWidth="0.7">
                  <path d="M 16 68 Q 220 50 424 68" />
                  <path d="M 16 118 Q 220 104 424 118" />
                  <path d="M 16 168 Q 220 156 424 168" />
                  <path d="M 110 22 Q 96 118 110 232" />
                  <path d="M 220 20 Q 220 118 220 234" />
                  <path d="M 330 22 Q 344 118 330 232" />
                </g>
                {Object.entries(CONTINENT_SHAPES).map(([name, shape]) => {
                  const isEliminated = eliminated.includes(name);
                  const isPicked = selected === name;
                  const isCorrect = answered && name === q.answer;
                  const isWrong = answered && isPicked && name !== q.answer;
                  let fill = name === "Antarctica" ? "#DCEAF4" : "url(#geo-land)";
                  if (name === "Greenland") fill = "#C9DFEC";
                  if (name === "New Zealand") fill = "#A8C8DE";
                  if (isPicked && !answered) fill = ACCENT;
                  if (isCorrect) fill = GREEN;
                  if (isWrong) fill = RED;

                  return (
                    <path
                      key={name}
                      d={shape.d}
                      fill={fill}
                      stroke="#F8FCFF"
                      strokeWidth={name === "Antarctica" ? 2.6 : name === "New Zealand" ? 3.4 : 2.2}
                      strokeLinejoin="round"
                      filter={isPicked || isCorrect || isWrong ? "url(#geo-active)" : "url(#geo-shadow)"}
                      opacity={isEliminated ? 0.18 : 1}
                      onClick={() => !isEliminated && pick(name)}
                      onKeyDown={(event) => {
                        if (!isEliminated && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          pick(name);
                        }
                      }}
                      role="button"
                      tabIndex={answered || isEliminated ? -1 : 0}
                      aria-label={name}
                      aria-disabled={answered || isEliminated}
                      className="geo-continent"
                      style={{ cursor: answered || isEliminated ? "default" : "pointer", transformOrigin: "center", transition: "fill 180ms ease, opacity 180ms ease, filter 140ms ease" }}
                    />
                  );
                })}
              </svg>
            </div>

            {!answered && (
              <p className="text-center text-xs mb-3" style={{ color: INK, opacity: 0.52 }}>
                Tap the correct place
              </p>
            )}

              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {q.options.map((option) => {
                  const isEliminated = eliminated.includes(option);
                  const isPicked = selected === option;
                  const isCorrect = answered && option === q.answer;
                  const isWrong = answered && isPicked && option !== q.answer;
                  let background = "rgba(16,24,40,0.05)";
                  let color = INK;
                  let border = "1px solid rgba(16,24,40,0.10)";
                  if (isCorrect) { background = "rgba(22,163,74,0.11)"; color = GREEN; border = `1px solid ${GREEN}55`; }
                  if (isWrong) { background = "rgba(229,72,77,0.10)"; color = RED; border = `1px solid ${RED}55`; }
                  return (
                    <button
                      key={option}
                      onClick={() => !isEliminated && pick(option)}
                      disabled={answered || isEliminated}
                      className="geo-option rounded-xl px-3 py-3 text-sm font-semibold transition-all min-h-[52px]"
                      style={{ background, color, border, opacity: isEliminated ? 0.22 : 1, cursor: answered || isEliminated ? "default" : "pointer" }}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            )}

            {answered && (
              <div className="mb-3 text-center rounded-xl px-3 py-2.5" style={{ background: selected === q.answer ? "rgba(22,163,74,0.09)" : "rgba(229,72,77,0.08)" }}>
                <div className="text-sm font-semibold" style={{ color: selected === q.answer ? GREEN : RED }}>
                  {selected === q.answer ? `Correct — ${q.answer}` : `${selected} — the answer is ${q.answer}`}
                </div>
              </div>
            )}

            {answered && (
              <button onClick={next} className="geo-next-btn w-full rounded-lg py-2.5 text-sm font-semibold transition-all" style={{ background: ACCENT, color: "#FFFFFF" }}>
                {isLast ? "See results" : "Next question"}
              </button>
            )}
          </>
        )}

        {solved && (
          <div className="flex flex-col items-center gap-2 py-4">
            <Globe2 size={32} style={{ color: ACCENT }} />
            <p style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600, color: INK }} className="text-2xl">
              {questions.length - mistakes}/{questions.length} correct
            </p>
            <p style={{ color: INK, opacity: 0.7 }} className="text-xs mb-1">
              {fmtTime(seconds)} &middot; {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
            </p>
            {savedStatId && <DifficultyRating onRate={(value) => rateDifficulty(savedStatId, value)} />}
            {!isChallenge && (
              <button onClick={() => newQuiz(dayIdx)} className="geo-next-btn mt-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors" style={{ background: ACCENT, color: "#FFFFFF" }}>
                Play again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
