import test from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES } from "../geo/geoData.js";
import { generateZoomQuiz, structuredClueCountryCount } from "./zoomGenerator.js";

function structuredValues(country, type) {
  return type === "language" ? (country.languages || []) : (country.currencies || []);
}

test("English is rejected as a country-identifying Zoom clue", () => {
  const english = COUNTRIES
    .flatMap((country) => country.languages || [])
    .find((language) => language?.name === "English");

  assert.ok(english, "the country dataset should contain English");
  assert.ok(
    structuredClueCountryCount("language", english) > 1,
    "English must remain recognised as a clue shared by multiple countries",
  );
});

test("generated language and currency clues identify exactly one country", () => {
  for (let pass = 0; pass < 30; pass += 1) {
    for (let day = 0; day < 7; day += 1) {
      const firstSteps = generateZoomQuiz(day).filter((step) => step.isFirstOfRound);
      for (const step of firstSteps) {
        if (step.clueType !== "language" && step.clueType !== "currency") continue;

        const country = COUNTRIES.find((candidate) => candidate.id === step.countryId);
        assert.ok(country, `country ${step.countryId} should exist`);
        const matchingValues = structuredValues(country, step.clueType)
          .filter((value) => value?.name === step.clueName);
        assert.ok(matchingValues.length > 0, `${step.clueName} should exist on ${country.name}`);
        assert.ok(
          matchingValues.some((value) => structuredClueCountryCount(step.clueType, value) === 1),
          `${step.clueType} clue ${step.clueName} must identify only ${country.name}`,
        );
      }
    }
  }
});
