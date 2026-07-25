// Second geography tier, sitting between continent and country. Modeled on
// the UN M49 geoscheme (simplified — this app deliberately keeps every
// transcontinental/contested case out of the country list already, so the
// subregion groupings below are uncontroversial). Used by the Zoom game to
// build a genuine three-step "narrow it down" chain: continent -> subregion
// -> country. Each country's `subregion` field (added alongside this file)
// is the source of truth; this module just lists, per continent, which
// subregions exist and in what order to show them.

const SUBREGIONS_BY_CONTINENT = {
  "North America": ["Northern America", "Central America", "Caribbean"],
  "South America": ["Andean South America", "Atlantic South America"],
  Europe: ["Northern Europe", "Western Europe", "Southern Europe", "Eastern Europe"],
  Africa: ["Northern Africa", "Western Africa", "Middle Africa", "Eastern Africa", "Southern Africa"],
  Asia: ["Eastern Asia", "South-eastern Asia", "Southern Asia", "Western Asia"],
  Oceania: ["Australia", "Melanesia", "Polynesia"],
};

// Every subregion, flattened, for quick lookup/validation.
const ALL_SUBREGIONS = Object.values(SUBREGIONS_BY_CONTINENT).flat();

function subregionsFor(continent) {
  return SUBREGIONS_BY_CONTINENT[continent] || [];
}

export { SUBREGIONS_BY_CONTINENT, ALL_SUBREGIONS, subregionsFor };
