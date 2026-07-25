import { localizeGeoValue, displayName } from "../geo/geoLocalization.js";
import { COUNTRIES } from "../geo/geoData.js";

const NAME_TO_ID = new Map(COUNTRIES.map((c) => [c.name, c.id]));

// Genitive continent forms, needed for the level-2 "which part of ___"
// prompt ("v ktorej časti kontinentu Ázie"). Subregion and country names
// are fine left in the nominative/label form Slovak commonly uses after a
// generic noun ("v regióne Karibik"), so only continents need this.
const CONTINENT_GENITIVE_SK = {
  "North America": "Severnej Ameriky",
  "South America": "Južnej Ameriky",
  Europe: "Európy",
  Africa: "Afriky",
  Asia: "Ázie",
  Oceania: "Oceánie",
};

const LEVEL1_TEMPLATES_SK = {
  capital: (name) => `Na ktorom kontinente leží mesto ${name}?`,
  animal: (name) => `Na ktorom kontinente je pôvodne domovom zviera ${name}?`,
  flora: (name) => `Na ktorom kontinente sa pestuje ${name}?`,
  landmark: (name) => `Na ktorom kontinente by ste našli ${name}?`,
  food: (name) => `Z ktorého kontinentu pochádza jedlo ${name}?`,
  naturalFeature: (name) => `Na ktorom kontinente sa nachádza ${name}?`,
  currency: (name) => `Na ktorom kontinente sa používa mena ${name}?`,
  language: (name) => `V tejto krajine sa hovorí jazykom ${name}. Na ktorom kontinente leží?`,
  flag: () => "Ktorému kontinentu patrí táto vlajka?",
};

const LEVEL2_TEMPLATES_SK = {
  capital: (name, cg) => `Stále mesto ${name} — v ktorej časti kontinentu ${cg} leží?`,
  animal: (name, cg) => `Stále zviera ${name} — v ktorej časti kontinentu ${cg} žije?`,
  flora: (name, cg) => `Stále ${name} — v ktorej časti kontinentu ${cg} sa pestuje?`,
  landmark: (name, cg) => `Stále ${name} — v ktorej časti kontinentu ${cg} to je?`,
  food: (name, cg) => `Stále jedlo ${name} — z ktorej časti kontinentu ${cg} pochádza?`,
  naturalFeature: (name, cg) => `Stále ${name} — v ktorej časti kontinentu ${cg} to je?`,
  currency: (name, cg) => `Stále mena ${name} — v ktorej časti kontinentu ${cg} sa používa?`,
  language: (name, cg) => `Tá istá krajina — v ktorej časti kontinentu ${cg} leží?`,
  flag: (name, cg) => `Tá istá vlajka — v ktorej časti kontinentu ${cg} je?`,
};

function level3PromptSk(subregionSK) {
  return `Zostali dve možnosti — ktorá krajina v regióne ${subregionSK} to je?`;
}

function countryDisplayName(name, language) {
  if (language !== "sk") return name;
  const id = NAME_TO_ID.get(name);
  if (!id) return name;
  return displayName("region", id.toUpperCase(), language) || name;
}

// Options and answers: continents/subregions go through the shared
// REGION_LABELS_SK dictionary (via localizeGeoValue), countries through
// Intl.DisplayNames, everything else (the animal/landmark/food clue name)
// through Geo's existing TERMS_SK dictionary, falling back to English —
// same graceful-degradation approach Geo already uses.
function localizeZoomValue(value, language, step) {
  if (language !== "sk" || !value) return value;
  if (step?.levelKey === "country") return countryDisplayName(value, language);
  return localizeGeoValue(value, language);
}

function localizeZoomClueName(step, language) {
  if (language !== "sk" || !step?.clueName) return step?.clueName;
  return localizeGeoValue(step.clueName, language);
}

function localizeZoomPrompt(step, language) {
  if (language !== "sk") return step.prompt;
  const name = localizeZoomClueName(step, language);
  const continentSK = localizeGeoValue(step.continent, language);
  const continentGenitive = CONTINENT_GENITIVE_SK[step.continent] || continentSK;
  const subregionSK = localizeGeoValue(step.subregion, language);
  if (step.levelKey === "continent") {
    return (LEVEL1_TEMPLATES_SK[step.clueType] || LEVEL1_TEMPLATES_SK.capital)(name);
  }
  if (step.levelKey === "subregion") {
    return (LEVEL2_TEMPLATES_SK[step.clueType] || LEVEL2_TEMPLATES_SK.capital)(name, continentGenitive);
  }
  return level3PromptSk(subregionSK);
}

export { localizeZoomValue, localizeZoomPrompt, localizeZoomClueName };
