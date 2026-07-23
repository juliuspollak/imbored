# Geo v62

- Refactored Geo into separate region, data, generator, history and flag modules.
- Removed embedded flag emoji from question text; flag rounds render an actual flag image with emoji fallback.
- Greenland and New Zealand remain independent selectable map regions.
- Antarctica uses a thin south-polar strip and no longer overlaps South America.
- Expanded the country JSON schema with birds, mountains, sports, oceans, hemispheres, neighbours, regions, national symbols and fun-fact arrays.
- Increased history capacity to 5,000 entries and greatly widened source/fact cooldown windows.
- Selection favours the least recently seen source, reducing repeated countries across question categories.
