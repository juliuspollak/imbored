import geoFacts from "./geoFacts.json";

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
const SPECIAL_REGIONS = geoFacts.specialRegions || [];

export { CITIES, ANIMALS, LANDMARKS, POLAR_FACTS, REGION_FACTS, COUNTRIES, SPECIAL_REGIONS };
