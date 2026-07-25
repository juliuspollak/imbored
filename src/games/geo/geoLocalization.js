const REGION_LABELS_SK = {
  "North America": "Severná Amerika",
  "South America": "Južná Amerika",
  Europe: "Európa",
  Africa: "Afrika",
  Asia: "Ázia",
  Oceania: "Oceánia",
  Antarctica: "Antarktída",
  Arctic: "Arktída",
  Greenland: "Grónsko",
  "New Zealand": "Nový Zéland",
  "North Pole": "severný pól",
  "South Pole": "južný pól",
  Equator: "rovník",
  "Prime Meridian": "nultý poludník",
};

const TERMS_SK = {
  "American bison": "bizón americký",
  "Canadian beaver": "bobor kanadský",
  "Andean condor": "kondor andský",
  "Galápagos giant tortoise": "korytnačka slonia",
  "Amazon river dolphin": "delfínovec amazonský",
  "African elephant": "slon africký",
  "ring-tailed lemur": "lemur kata",
  shoebill: "člunozobec",
  "red panda": "panda červená",
  "proboscis monkey": "kahau nosatý",
  "saiga antelope": "sajga tatárska",
  "Japanese macaque": "makak japonský",
  "European bison": "zubor európsky",
  "Atlantic puffin": "alka bielobradá",
  "Iberian lynx": "rys iberský",
  "emperor penguin": "tučniak cisársky",
  "Weddell seal": "tuleň Weddellov",
  Kangaroo: "kengura",
  "Giant panda": "panda veľká",
  Lion: "lev",
  "Bald eagle": "orol bielohlavý",
  Jaguar: "jaguár",
  Koala: "koala",
  Giraffe: "žirafa",
  "Grizzly bear": "medveď grizly",
  Orangutan: "orangutan",
  Llama: "lama",
  Platypus: "vtákopysk",
  Zebra: "zebra",
  Sloth: "leňoch",
  Moose: "los",
  "Komodo dragon": "varan komodský",
  Capybara: "kapybara",
  "Tasmanian devil": "diabol tasmánsky",
  "Alpine ibex": "kozorožec alpský",
  "Snow leopard": "leopard snežný",
  Beaver: "bobor",
  "Polar bear": "ľadový medveď",
  Alligator: "aligátor",
  Axolotl: "axolotl",
  "Toco toucan": "tukan obrovský",
  Guanaco: "guanako",
  Puma: "puma",
  "Humboldt penguin": "tučniak Humboldtov",
  Vicuña: "vikuňa",
  "Alpine marmot": "svišť vrchovský",
  "European badger": "jazvec lesný",
  "Italian wolf": "vlk taliansky",
  "Red fox": "líška hrdzavá",
  "Mediterranean monk seal": "tuleň stredomorský",
  "Golden eagle": "orol skalný",
  "Nile crocodile": "krokodíl nílsky",
  Camel: "ťava",
  Elephant: "slon",
  Springbok: "antilopa skákavá",
  "African penguin": "tučniak okuliarnatý",
  "Barbary macaque": "makak magot",
  "Red-crowned crane": "žeriav červenokorunkatý",
  "Golden snub-nosed monkey": "langur zlatý",
  "Bengal tiger": "tiger bengálsky",
  "Indian elephant": "slon indický",
  Peacock: "páv",
  "Asian elephant": "slon ázijský",
  "Smooth-coated otter": "vydra hladkosrstá",
  kiwi: "kivi",
  wombat: "vombat",
  kākāpō: "kakapo",
  cassowary: "kazuár",
  pronghorn: "vidloroh",
  vicuña: "vikuňa",
  okapi: "okapi",
  eucalyptus: "eukalyptus",
  "silver fern": "strieborná papraď",
  "giant sequoia": "sekvojovec mamutí",
  "sugar maple": "javor cukrový",
  "saguaro cactus": "kaktus saguaro",
  dahlia: "georgína",
  "Brazil nut tree": "para orech",
  "Amazon rubber tree": "kaučukovník brazílsky",
  "monkey puzzle tree": "araukária čilská",
  "cinchona tree": "chinínovník",
  baobab: "baobab",
  "king protea": "protea kráľovská",
  papyrus: "papyrus",
  Welwitschia: "velvíčia",
  "cedar of Lebanon": "céder libanonský",
  "Rafflesia arnoldii": "raflézia Arnoldova",
  ginkgo: "ginko",
  "Himalayan blue poppy": "himálajský modrý mak",
  edelweiss: "plesnivec alpínsky",
  "Scots pine": "borovica lesná",
  "European beech": "buk lesný",
  "Antarctic hair grass": "metlica antarktická",
  "Nile": "Níl",
  "Congo River": "Kongo",
  "Niger River": "Niger",
  Zambezi: "Zambezi",
  "Amazon River": "Amazonka",
  "Paraná River": "Paraná",
  Orinoco: "Orinoko",
  "São Francisco River": "São Francisco",
  "Mississippi River": "Mississippi",
  "Missouri River": "Missouri",
  "Colorado River": "Colorado",
  "Mackenzie River": "Mackenzie",
  Yangtze: "Jang-c’-ťiang",
  Ganges: "Ganga",
  "Yellow River": "Žltá rieka",
  Mekong: "Mekong",
  Danube: "Dunaj",
  Rhine: "Rýn",
  Volga: "Volga",
  Thames: "Temža",
  "Murray River": "Murray",
  "Darling River": "Darling",
  "Waikato River": "Waikato",
  "Sepik River": "Sepik",
  "Eiffel Tower": "Eiffelova veža",
  "Great Wall of China": "Veľký čínsky múr",
  "Pyramids of Giza": "pyramídy v Gíze",
  "Statue of Liberty": "Socha slobody",
  "Sydney Opera House": "Opera v Sydney",
  "Colosseum": "Koloseum",
  "Taj Mahal": "Tádž Mahal",
  "Victoria Falls": "Viktóriine vodopády",
  "Niagara Falls": "Niagarské vodopády",
  "Christ the Redeemer": "Kristus Spasiteľ",
  "Table Mountain": "Stolová hora",
  "Great Barrier Reef": "Veľká koralová bariéra",
  "Rocky Mountains": "Skalnaté vrchy",
  "Grand Canyon": "Grand Canyon",
  "Amazon rainforest": "Amazonský dažďový prales",
  "Iguazu Falls": "vodopády Iguazú",
  "Atacama Desert": "púšť Atacama",
  Andes: "Andy",
  "Lake Titicaca": "jazero Titicaca",
  "French Alps": "Francúzske Alpy",
  "Black Forest": "Čierny les",
  "Mount Etna": "Etna",
  Dolomites: "Dolomity",
  Pyrenees: "Pyreneje",
  "White Cliffs of Dover": "biele útesy v Doveri",
  "Mount Olympus": "Olymp",
  "Austrian Alps": "Rakúske Alpy",
  "Nile River": "Níl",
  "Sahara Desert": "Sahara",
  "Great Rift Valley": "Veľká priekopová prepadlina",
  "Mount Kenya": "Keňa",
  "Kruger National Park": "Krugerov národný park",
  "Atlas Mountains": "Atlas",
  "Mount Fuji": "Fudži",
  "Yangtze River": "Jang-c’-ťiang",
  Himalayas: "Himaláje",
  "Ganges River": "Ganga",
  "Mount Everest": "Mount Everest",
};

function displayName(type, code, language) {
  if (language !== "sk" || !code || typeof Intl.DisplayNames !== "function") return null;
  try {
    return new Intl.DisplayNames(["sk"], { type }).of(code);
  } catch {
    return null;
  }
}

function localizeGeoValue(value, language, question) {
  if (language !== "sk" || !value) return value;
  if (REGION_LABELS_SK[value]) return REGION_LABELS_SK[value];
  if (question?.countryId && value === question.countryName) {
    return displayName("region", question.countryId.toUpperCase(), language) || value;
  }
  if (question?.type === "currency" && value === question.name) {
    return displayName("currency", question.code, language) || TERMS_SK[value] || value;
  }
  if (question?.type === "language" && value === question.name) {
    return displayName("language", question.code, language) || TERMS_SK[value] || value;
  }
  return TERMS_SK[value] || value;
}

const SPECIAL_PROMPTS_SK = {
  "south-pole": "Na ktorom kontinente sa nachádza južný pól?",
  "emperor-penguin": "Na ktorom kontinente prirodzene žije tučniak cisársky?",
  "mount-erebus": "Na ktorom kontinente sa nachádza sopka Erebus?",
  "north-pole-region": "Ktorá polárna oblasť obklopuje severný pól?",
  "polar-bear-region": "V ktorej polárnej oblasti prirodzene žijú ľadové medvede?",
  "arctic-ocean-pole": "Ktorý pól obklopuje Severný ľadový oceán?",
  "greenland-name": "Ťuknite na Grónsko na mape.",
  "greenland-nuuk": "Nuuk je hlavné mesto ktorého územia na mape?",
  "greenland-largest-island": "Ťuknite na najväčší ostrov sveta.",
  "greenland-arctic": "Ťuknite na veľký arktický ostrov severovýchodne od Kanady.",
  "new-zealand-name": "Ťuknite na Nový Zéland na mape.",
  "new-zealand-wellington": "Wellington je hlavné mesto ktorého miesta na mape?",
  "new-zealand-kiwi": "Ťuknite na domovinu vtáka kivi.",
  "new-zealand-aotearoa": "Ktoré miesto na mape sa nazýva aj Aotearoa?",
};

function localizeGeoQuestion(question, language) {
  if (language !== "sk") return question.prompt;
  const specialId = question.id?.split(":")[1] || question.id;
  if (SPECIAL_PROMPTS_SK[specialId]) return SPECIAL_PROMPTS_SK[specialId];

  const name = localizeGeoValue(question.name, language, question);
  const country = displayName("region", question.countryId?.toUpperCase(), language)
    || localizeGeoValue(question.countryName, language, question);
  switch (question.type) {
    case "city": return `Na ktorom kontinente sa nachádza mesto ${name}?`;
    case "animal":
    case "fauna": return `Pre ktorý kontinent je typické zviera ${name}?`;
    case "flora": return `Z ktorého kontinentu pochádza rastlina ${name}?`;
    case "river": return `Na ktorom kontinente tečie rieka ${name}?`;
    case "landmark": return `Na ktorom kontinente sa nachádza ${name}?`;
    case "country":
    case "flag": return `Na ktorom kontinente sa nachádza ${country || name}?`;
    case "capital": return `Na ktorom kontinente sa nachádza hlavné mesto ${name}?`;
    case "currency": return `V krajine ${country} sa používa mena ${name}. Na ktorom kontinente sa krajina nachádza?`;
    case "language": return `V krajine ${country} sa používa jazyk ${name}. Na ktorom kontinente sa krajina nachádza?`;
    case "food": return `Jedlo ${name} pochádza z krajiny ${country}. Na ktorom kontinente sa krajina nachádza?`;
    case "naturalFeature": return `Prírodný útvar ${name} sa nachádza v krajine ${country}. Na ktorom kontinente?`;
    default: return question.prompt;
  }
}

export { localizeGeoQuestion, localizeGeoValue };
