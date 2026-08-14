import { CONTINENTS } from "../geo/geoRegions.js";
import { COUNTRIES } from "../geo/geoData.js";
import { SUBREGIONS_BY_CONTINENT, subregionsFor } from "../geo/geoSubregions.js";
import { shuffle } from "../../lib/seededRandom.js";

// Mon..Sun: same ramp Geo uses, so the two games feel consistent about
// which day is "easy" and which is "anything goes".
const DIFFICULTY_CEILING = [2, 2, 2, 3, 3, 3, 3];
const ROUNDS_PER_QUIZ = 3;
const LEVELS_PER_ROUND = 3; // continent -> subregion -> country

const FACT_CLUE_SOURCES = [
  { type: "animal", field: "animals" },
  { type: "flora", field: "flora" },
  { type: "landmark", field: "landmarks" },
  { type: "food", field: "foods" },
  { type: "naturalFeature", field: "naturalFeatures" },
  { type: "currency", field: "currencies", pick: (v) => v?.name },
  { type: "language", field: "languages", pick: (v) => v?.name },
];

// Each quiz deliberately mixes subjects. Previously countries were chosen
// first and clues second, which made animals and flora rare because most of
// the larger country list only contains currency/language data.
const ROUND_THEMES = [
  { id: "nature", clueTypes: ["animal", "flora"] },
  { id: "discovery", clueTypes: ["landmark", "food", "naturalFeature"] },
  { id: "world", clueTypes: ["flag", "currency", "language"] },
];

// The answer row should read in the same direction as the map. These are
// geographic west-to-east positions for broad areas, not question-specific
// answer ordering. The actual question/distractor selection remains dynamic.
const CONTINENT_X = {
  "North America": -105,
  "South America": -60,
  Europe: 15,
  Africa: 22,
  Asia: 92,
  Oceania: 145,
};

const SUBREGION_X = {
  // Europe
  "Western Europe": 3,
  "Northern Europe": 15,
  "Southern Europe": 16,
  "Eastern Europe": 29,

  // Africa
  "Western Africa": -7,
  "Northern Africa": 12,
  "Middle Africa": 20,
  "Southern Africa": 25,
  "Eastern Africa": 36,

  // Asia
  "Western Asia": 45,
  "Central Asia": 68,
  "Southern Asia": 78,
  "Eastern Asia": 112,
  "South-eastern Asia": 115,

  // North America
  "Central America": -90,
  Caribbean: -72,
  "Northern America": -95,

  // South America
  "Andean South America": -72,
  "Atlantic South America": -53,

  // Oceania
  Australia: 134,
  Melanesia: 160,
  Polynesia: 178,
};

function spatialOrder(options, positions) {
  return [...options].sort((a, b) => {
    const ax = positions[a];
    const bx = positions[b];
    if (!Number.isFinite(ax) || !Number.isFinite(bx)) return 0;
    return ax - bx;
  });
}

const LEVEL1_TEMPLATES = {
  capital: (name) => `Which continent is the city of ${name} on?`,
  animal: (name) => `Which continent is the ${name} native to?`,
  flora: (name) => `Which continent is ${name} famously grown on?`,
  landmark: (name) => `Which continent would you find ${name} on?`,
  food: (name) => `Which continent does the dish ${name} come from?`,
  naturalFeature: (name) => `Which continent is ${name} located on?`,
  currency: (name) => `Which continent uses a currency called the ${name}?`,
  language: (name) => `Which continent is ${name} widely spoken on, in this country?`,
  flag: () => "Which continent does this flag belong to?",
};

const LEVEL2_TEMPLATES = {
  capital: (name, continent) => `Still thinking of ${name} — which part of ${continent} is it in?`,
  animal: (name, continent) => `Still thinking of the ${name} — which part of ${continent} is its home?`,
  flora: (name, continent) => `Still thinking of ${name} — which part of ${continent} is it grown in?`,
  landmark: (name, continent) => `Still thinking of ${name} — which part of ${continent} is it in?`,
  food: (name, continent) => `Still thinking of ${name} — which part of ${continent} does it come from?`,
  naturalFeature: (name, continent) => `Still thinking of ${name} — which part of ${continent} is it in?`,
  currency: (name, continent) => `Same currency, the ${name} — which part of ${continent} is it used in?`,
  language: (name, continent) => `Same country — which part of ${continent} is it in?`,
  flag: (name, continent) => `Same flag — which part of ${continent} does it belong to?`,
};

const LEVEL3_TEMPLATES = {
  capital: (name, subregion) => `Still thinking of ${name} — which country in ${subregion} is it in?`,
  animal: (name, subregion) => `Still thinking of the ${name} — which country in ${subregion} are we looking for?`,
  flora: (name, subregion) => `Still thinking of ${name} — which country in ${subregion} are we looking for?`,
  landmark: (name, subregion) => `Still thinking of ${name} — which country in ${subregion} is it in?`,
  food: (name, subregion) => `Still thinking of ${name} — which country in ${subregion} does it come from?`,
  naturalFeature: (name, subregion) => `Still thinking of ${name} — which country in ${subregion} is it in?`,
  currency: (name, subregion) => `Same currency, the ${name} — which country in ${subregion} uses it?`,
  language: (name, subregion) => `Same language clue, ${name} — which country in ${subregion} are we looking for?`,
  flag: (name, subregion) => `Same flag — which country in ${subregion} does it belong to?`,
};

function clueSource(type) {
  return FACT_CLUE_SOURCES.find((source) => source.type === type);
}

function hasClue(country, type) {
  if (type === "flag") return Boolean(country.flagEmoji);
  const source = clueSource(type);
  if (!source) return false;
  return (country[source.field] || []).some((value) => source.pick ? Boolean(source.pick(value)) : Boolean(value));
}

function pickClue(country, preferredTypes = []) {
  const preferred = shuffle(preferredTypes).find((type) => hasClue(country, type));
  if (preferred === "flag") return { type: "flag", name: country.name };

  const sources = preferred ? [clueSource(preferred)] : shuffle(FACT_CLUE_SOURCES);
  const usable = sources.find(({ type }) => hasClue(country, type));
  if (!usable) {
    return { type: "capital", name: country.capital || country.capitals?.[0] || country.name };
  }
  const raw = shuffle(country[usable.field]).find((value) => usable.pick ? Boolean(usable.pick(value)) : Boolean(value));
  const name = usable.pick ? usable.pick(raw) : raw;
  return { type: usable.type, name, code: usable.type === "currency" || usable.type === "language" ? raw?.code : undefined };
}

function otherOption(pool, exclude) {
  const candidates = pool.filter((value) => value !== exclude);
  return shuffle(candidates)[0];
}

function buildRound(country, roundIndex, preferredTypes) {
  const clue = pickClue(country, preferredTypes);
  const subregion = country.subregion;
  const subregionOptions = subregionsFor(country.continent);
  const continentDistractor = otherOption(CONTINENTS.filter((c) => c !== "Antarctica"), country.continent);
  const subregionDistractor = otherOption(subregionOptions, subregion);

  const sameSubregion = COUNTRIES.filter((c) => c.id !== country.id && c.subregion === subregion && c.continent === country.continent);
  const sameContinent = COUNTRIES.filter((c) => c.id !== country.id && c.continent === country.continent);
  const countryDistractorRecord = shuffle(sameSubregion.length ? sameSubregion : sameContinent)[0] || shuffle(COUNTRIES.filter((c) => c.id !== country.id))[0];

  const base = {
    roundId: `zoom:${country.id}:${roundIndex}`,
    roundIndex,
    clueType: clue.type,
    clueName: clue.name,
    flagCode: clue.type === "flag" ? country.id : undefined,
    flagEmoji: clue.type === "flag" ? country.flagEmoji : undefined,
    countryId: country.id,
    countryName: country.name,
    continent: country.continent,
    subregion,
  };

  const levels = [
    {
      ...base,
      levelIndex: 0,
      levelKey: "continent",
      prompt: (LEVEL1_TEMPLATES[clue.type] || LEVEL1_TEMPLATES.capital)(clue.name),
      answer: country.continent,
      options: spatialOrder([country.continent, continentDistractor], CONTINENT_X),
    },
    {
      ...base,
      levelIndex: 1,
      levelKey: "subregion",
      prompt: (LEVEL2_TEMPLATES[clue.type] || LEVEL2_TEMPLATES.capital)(clue.name, country.continent),
      answer: subregion,
      options: spatialOrder([subregion, subregionDistractor], SUBREGION_X),
    },
    {
      ...base,
      levelIndex: 2,
      levelKey: "country",
      prompt: (LEVEL3_TEMPLATES[clue.type] || LEVEL3_TEMPLATES.capital)(clue.name, subregion),
      answer: country.name,
      options: shuffle([country.name, countryDistractorRecord?.name || "—"]),
      countryDistractorId: countryDistractorRecord?.id,
    },
  ];

  levels[0].isFirstOfRound = true;
  levels[levels.length - 1].isLastOfRound = true;
  return levels;
}

function orderedCandidates(pool, recentIds, chosen) {
  const usedContinents = new Set(chosen.map((country) => country.continent));
  const ranked = shuffle(pool).sort((a, b) => {
    const aRecent = recentIds.includes(a.id) ? 1 : 0;
    const bRecent = recentIds.includes(b.id) ? 1 : 0;
    if (aRecent !== bRecent) return aRecent - bRecent;
    const aContinent = usedContinents.has(a.continent) ? 1 : 0;
    const bContinent = usedContinents.has(b.continent) ? 1 : 0;
    return aContinent - bContinent;
  });
  return ranked;
}

function chooseTargets(ceiling, recentIds = []) {
  const pool = COUNTRIES.filter((c) => c.difficulty <= ceiling);
  const chosen = [];

  for (const theme of ROUND_THEMES) {
    const eligible = pool.filter((country) =>
      !chosen.some((selected) => selected.id === country.id)
      && theme.clueTypes.some((type) => hasClue(country, type))
    );
    const country = orderedCandidates(eligible, recentIds, chosen.map((item) => item.country))[0];
    if (country) chosen.push({ country, theme });
  }

  // Defensive fallback for future datasets with a missing theme.
  for (const country of orderedCandidates(pool, recentIds, chosen.map((item) => item.country))) {
    if (chosen.length >= ROUNDS_PER_QUIZ) break;
    if (!chosen.some((selected) => selected.country.id === country.id)) {
      chosen.push({ country, theme: { id: "mixed", clueTypes: [] } });
    }
  }
  return chosen;
}

// Returns a flat array of "steps" (one per level, ROUNDS_PER_QUIZ *
// LEVELS_PER_ROUND long) — deliberately flat, not nested, so the game
// component can reuse the same qIdx/pick/next pattern every other game
// here already uses.
function generateZoomQuiz(dayIdx, recentIds = []) {
  const ceiling = DIFFICULTY_CEILING[dayIdx] ?? 3;
  const targets = chooseTargets(ceiling, recentIds);
  const steps = targets.flatMap(({ country, theme }, roundIndex) =>
    buildRound(country, roundIndex, theme.clueTypes).map((step) => ({ ...step, clueTheme: theme.id }))
  );
  return steps;
}

export { generateZoomQuiz, ROUNDS_PER_QUIZ, LEVELS_PER_ROUND, DIFFICULTY_CEILING, ROUND_THEMES };