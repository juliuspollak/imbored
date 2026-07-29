import { CONTINENTS } from "../geo/geoRegions.js";
import { COUNTRIES } from "../geo/geoData.js";
import { SUBREGIONS_BY_CONTINENT, subregionsFor } from "../geo/geoSubregions.js";
import { shuffle } from "../../lib/seededRandom.js";

// Mon..Sun: same ramp Geo uses, so the two games feel consistent about
// which day is "easy" and which is "anything goes".
const DIFFICULTY_CEILING = [2, 2, 2, 3, 3, 3, 3];
const ROUNDS_PER_QUIZ = 3;
const LEVELS_PER_ROUND = 3; // continent -> subregion -> country

// One hook fact per round, drawn from whichever of these a country actually
// has (every country always has a capital, so that's the guaranteed
// fallback — nothing ever comes back empty-handed).
const CLUE_SOURCES = [
  { type: "animal", field: "animals" },
  { type: "flora", field: "flora" },
  { type: "landmark", field: "landmarks" },
  { type: "food", field: "foods" },
  { type: "naturalFeature", field: "naturalFeatures" },
  { type: "currency", field: "currencies", pick: (v) => v?.name },
  { type: "language", field: "languages", pick: (v) => v?.name },
];

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

function level3Prompt(subregion) {
  return `Down to two — which country in ${subregion} is it?`;
}

function pickClue(country) {
  const usable = shuffle(CLUE_SOURCES).find(({ field, pick }) => {
    const value = country[field]?.[0];
    return pick ? Boolean(pick(value)) : Boolean(value);
  });
  if (!usable) {
    return { type: "capital", name: country.capital || country.capitals?.[0] || country.name };
  }
  const raw = shuffle(country[usable.field])[0];
  const name = usable.pick ? usable.pick(raw) : raw;
  return { type: usable.type, name, code: usable.type === "currency" || usable.type === "language" ? raw?.code : undefined };
}

function otherOption(pool, exclude) {
  const candidates = pool.filter((value) => value !== exclude);
  return shuffle(candidates)[0];
}

function buildRound(country, roundIndex, useFlag) {
  const clue = useFlag && country.flagEmoji ? { type: "flag", name: country.name } : pickClue(country);
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
      options: shuffle([country.continent, continentDistractor]),
    },
    {
      ...base,
      levelIndex: 1,
      levelKey: "subregion",
      prompt: (LEVEL2_TEMPLATES[clue.type] || LEVEL2_TEMPLATES.capital)(clue.name, country.continent),
      answer: subregion,
      options: shuffle([subregion, subregionDistractor]),
    },
    {
      ...base,
      levelIndex: 2,
      levelKey: "country",
      prompt: level3Prompt(subregion),
      answer: country.name,
      options: shuffle([country.name, countryDistractorRecord?.name || "—"]),
      countryDistractorId: countryDistractorRecord?.id,
    },
  ];

  levels[0].isFirstOfRound = true;
  levels[levels.length - 1].isLastOfRound = true;
  return levels;
}

function chooseTargets(ceiling, recentIds = []) {
  const pool = COUNTRIES.filter((c) => c.difficulty <= ceiling);
  const fresh = shuffle(pool.filter((c) => !recentIds.includes(c.id)));
  const stale = shuffle(pool.filter((c) => recentIds.includes(c.id)));
  const ordered = [...fresh, ...stale];
  const chosen = [];
  for (const country of ordered) {
    if (chosen.length >= ROUNDS_PER_QUIZ) break;
    chosen.push(country);
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
  const steps = targets.flatMap((country, roundIndex) => buildRound(country, roundIndex, Math.random() < 0.4));
  return steps;
}

export { generateZoomQuiz, ROUNDS_PER_QUIZ, LEVELS_PER_ROUND, DIFFICULTY_CEILING };
