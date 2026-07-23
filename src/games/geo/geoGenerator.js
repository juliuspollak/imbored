import { CONTINENTS, MAP_REGIONS } from "./geoRegions.js";
import { CITIES, ANIMALS, LANDMARKS, POLAR_FACTS, REGION_FACTS, COUNTRIES } from "./geoData.js";
import { buildHistoryIndex } from "./geoHistory.js";

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Mon..Sun: difficulty ceiling ramps from "easy only" to "anything goes".
const HISTORY_LIMIT = 5000;
const STRICT_RECENT_SOURCE_COUNT = 300;
const STRICT_RECENT_FACT_COUNT = 800;

const DIFFICULTY_CEILING = [2, 2, 2, 3, 3, 3, 3];

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
  food: [
    ({ name, countryName }) => `${name} is associated with ${countryName}. Which continent is ${countryName} in?`,
    ({ name, countryName }) => `The food ${name} comes from ${countryName}. Tap or choose its continent.`,
  ],
  naturalFeature: [
    ({ name, countryName }) => `${name} is found in ${countryName}. Which continent is it on?`,
    ({ name }) => `On which continent would you find ${name}?`,
  ],
  flag: [
    ({ countryName }) => `Which continent is ${countryName} in?`,
    ({ countryName }) => `This flag belongs to ${countryName}. Which continent is ${countryName} in?`,
    ({ countryName }) => `Which continent does ${countryName} belong to?`,
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
    factId: fact.factId || `${type}:${baseId}`,
    sourceId: fact.sourceId || baseId,
    templateIndex,
    type,
    mode,
    prompt: fact.prompt || templates[templateIndex](fact),
    answer,
    options,
    fixedChoice: Boolean(fact.options),
    countryName: fact.countryName,
    countryId: fact.countryId,
    flagCode: fact.flagCode,
    flagEmoji: fact.flagEmoji,
    flagAsset: fact.flagAsset,
  };
}


function chooseFact(pool, usedSources, historyIndex) {
  const candidates = pool.filter((fact) => !usedSources.has(fact.sourceId));
  if (!candidates.length) return null;

  // Never repeat a fact while there are unseen facts available. A different
  // wording does not make an already-used fact "new".
  const neverSeen = candidates.filter((fact) => !historyIndex.factRank.has(fact.factId));
  if (neverSeen.length) return shuffle(neverSeen)[0];

  const fresh = candidates.filter((fact) => {
    const sourcePosition = historyIndex.sourceRank.get(fact.sourceId);
    const factPosition = historyIndex.factRank.get(fact.factId);
    return (sourcePosition === undefined || sourcePosition >= STRICT_RECENT_SOURCE_COUNT)
      && (factPosition === undefined || factPosition >= STRICT_RECENT_FACT_COUNT);
  });

  if (fresh.length) return shuffle(fresh)[0];

  const ranked = candidates
    .map((fact) => {
      const sourceAge = historyIndex.sourceRank.get(fact.sourceId) ?? HISTORY_LIMIT;
      const factAge = historyIndex.factRank.get(fact.factId) ?? HISTORY_LIMIT;
      return { fact, score: (sourceAge * 4) + factAge + Math.random() };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.fact || null;
}

function countryFactPools(ceiling) {
  const records = COUNTRIES.filter((country) => country.difficulty <= ceiling);
  const base = (country, type, suffix, extra = {}) => ({
    id: `${country.id}:${suffix}`,
    factId: `${type}:${country.id}:${suffix}`,
    sourceId: `country:${country.id}`,
    countryId: country.id,
    countryName: country.name,
    continent: country.continent,
    difficulty: country.difficulty,
    ...extra,
  });

  return {
    country: records.map((country) => base(country, "country", "location", { name: country.name })),
    capital: records.flatMap((country) => (country.capitals || []).map((capital, index) =>
      base(country, "capital", `capital-${index}`, { name: capital }))),
    currency: records.flatMap((country) => (country.currencies || []).map((currency, index) =>
      base(country, "currency", `currency-${index}`, { name: currency.name, code: currency.code }))),
    language: records.flatMap((country) => (country.languages || []).map((language, index) =>
      base(country, "language", `language-${index}`, { name: language.name, code: language.code }))),
    flag: records.filter((country) => country.flagEmoji).map((country) =>
      base(country, "flag", "flag", { name: country.name, flagCode: country.id, flagEmoji: country.flagEmoji, flagAsset: country.flagAsset })),
    animal: records.flatMap((country) => (country.animals || []).map((animal, index) =>
      base(country, "animal", `animal-${index}`, { name: animal }))),
    landmark: records.flatMap((country) => (country.landmarks || []).map((landmark, index) =>
      base(country, "landmark", `landmark-${index}`, { name: landmark }))),
    food: records.flatMap((country) => (country.foods || []).map((food, index) =>
      base(country, "food", `food-${index}`, { name: food }))),
    naturalFeature: records.flatMap((country) => (country.naturalFeatures || []).map((feature, index) =>
      base(country, "naturalFeature", `feature-${index}`, { name: feature }))),
  };
}

function generateQuiz(dayIdx, history = []) {
  const ceiling = DIFFICULTY_CEILING[dayIdx];
  const historyIndex = buildHistoryIndex(history);
  const tag = (type, q) => ({
    ...q,
    sourceId: `${type}:${q.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    factId: `${type}:${q.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  });
  const structured = countryFactPools(ceiling);
  const pools = {
    city: CITIES.filter((q) => q.difficulty <= ceiling).map((q) => tag("city", q)),
    animalLegacy: ANIMALS.filter((q) => q.difficulty <= ceiling).map((q) => tag("animalLegacy", q)),
    landmarkLegacy: LANDMARKS.filter((q) => q.difficulty <= ceiling).map((q) => tag("landmarkLegacy", q)),
    polar: POLAR_FACTS.filter((q) => q.id !== "mcmurdo" && q.difficulty <= ceiling).map((q) => ({
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


  const categoryOrder = shuffle(["country", "capital", "flag", "city", "animal", "landmark", "food", "naturalFeature", "currency", "language", "region", "polar", "animalLegacy", "landmarkLegacy"]);
  for (const type of categoryOrder) {
    if (questions.length >= 5) break;
    const fact = chooseFact(pools[type] || [], usedSources, historyIndex);
    if (!fact) continue;
    usedSources.add(fact.sourceId);
    const questionType = type === "animalLegacy" ? "animal" : type === "landmarkLegacy" ? "landmark" : type;
    questions.push(makeQuestion(questionType, fact));
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


export { shuffle, generateQuiz };
