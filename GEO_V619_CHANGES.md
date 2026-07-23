# Geo v61.9 changes

- Expanded `geoFacts.json` to a richer reusable country schema with arrays for capitals, cities, languages, currencies, animals, landmarks, foods, natural features, aliases and facts.
- Country-based animal, landmark, food and natural-feature questions are now generated from the JSON data.
- Reworked practice repetition protection to track 1,000 question-history entries, avoid recently used facts and countries, and choose the least-recently-seen item when fresh content is exhausted.
- Removed the forced polar question from every round.
- Fixed the invalid Geo source syntax that prevented the v61.8 map changes from compiling.
- Greenland and New Zealand are separate visible paths with enlarged invisible mobile tap targets.
- Antarctica is thinner and positioned below South America.
