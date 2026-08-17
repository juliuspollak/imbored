export const ANIMALS = [
  { id: "fox", label: "Monkey", colour: "#3B9A80", individualColour: "#9B5B42" },
  { id: "panda", label: "Snake", colour: "#3B9A80", individualColour: "#49A94E" },
  { id: "owl", label: "Octopus", colour: "#3B9A80", individualColour: "#B83A9D" },
  { id: "rabbit", label: "Elephant", colour: "#3B9A80", individualColour: "#1EA4B8" },
  { id: "lion", label: "Lion", colour: "#3B9A80", individualColour: "#D58B32" },
  { id: "frog", label: "Spider", colour: "#3B9A80", individualColour: "#56376D" },
];

export const ANIMAL_IDS = ANIMALS.map((animal) => animal.id);
export const DIE_ROLL_DURATION_MS = 3000;
export const SHUFFLE_DURATION_MS = 800;
export const DIFFICULTY_MODES = [
  { id: "easy", label: "Easy", description: "Cards stay visible" },
  { id: "standard", label: "Standard", description: "Cards reveal with the animal" },
  { id: "hard", label: "Hard", description: "Match the animal and its visual detail" },
];
export const COLOUR_MODES = [
  { id: "individual", label: "Animal colours", description: "Each animal has its own colour" },
  { id: "uniform", label: "One colour", description: "Harder · recognise the shape" },
  { id: "mixed", label: "Mixed colours", description: "Die colours are misleading" },
];

export const HARD_FACE_MUTATIONS = ["normal", "closedEyes", "missingEar"];

export function animalById(id) {
  return ANIMALS.find((animal) => animal.id === id) || ANIMALS[0];
}

export function animalColour(id, colourMode = "uniform") {
  const animal = animalById(id);
  return colourMode === "individual" || colourMode === "mixed" ? animal.individualColour : animal.colour;
}

export function isPhoneDevice({
  userAgent = "",
  userAgentMobile,
  maxTouchPoints = 0,
  coarsePointer = false,
} = {}) {
  const phoneUserAgent = /iPhone|iPod|Android.+Mobile|Windows Phone/i.test(userAgent);
  const appleTablet = /iPad/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  const reportsMobile = typeof userAgentMobile === "boolean" ? userAgentMobile : phoneUserAgent;
  return (reportsMobile || appleTablet) && maxTouchPoints > 0 && coarsePointer;
}

export function derangedShuffle(arr) {
  if (arr.length < 2) return [...arr];
  const original = [...arr];
  let result;
  for (let attempt = 0; attempt < 50; attempt++) {
    result = [...original].sort(() => Math.random() - 0.5);
    if (!result.every((val, idx) => val === original[idx])) return result;
  }
  result = [...original].sort(() => Math.random() - 0.5);
  if (result.every((val, idx) => val === original[idx])) {
    const swapIdx = 1 + Math.floor(Math.random() * (result.length - 1));
    [result[0], result[swapIdx]] = [result[swapIdx], result[0]];
  }
  return result;
}

export function pickNextTarget(previousTarget) {
  const options = ANIMAL_IDS.filter((id) => id !== previousTarget);
  return options[Math.floor(Math.random() * options.length)];
}

export function roundPhase(room, now = Date.now()) {
  if (!room) return "none";
  if (room.status !== "countdown") return room.status;
  const rollAt = room.roll_at
    ? new Date(room.roll_at).getTime()
    : room.reveal_at
      ? new Date(room.reveal_at).getTime() - DIE_ROLL_DURATION_MS
      : Number.POSITIVE_INFINITY;
  if (now < rollAt) return "waiting";
  const shuffleAt = room.shuffle_at ? new Date(room.shuffle_at).getTime() : null;
  const revealAt = room.reveal_at ? new Date(room.reveal_at).getTime() : Number.POSITIVE_INFINITY;
  if (shuffleAt && now >= shuffleAt && now < revealAt) return "shuffling";
  if (now < revealAt) return "rolling";
  return now >= revealAt ? "open" : "countdown";
}

export function countdownNumber(room, now = Date.now()) {
  if (roundPhase(room, now) !== "rolling") return null;
  const rollEndsAt = room?.shuffle_at || room?.reveal_at;
  if (!rollEndsAt) return null;
  const milliseconds = new Date(rollEndsAt).getTime() - now;
  return milliseconds <= 0 ? null : Math.max(1, Math.ceil(milliseconds / 1000));
}

export function matchIntroCountdown(room, now = Date.now()) {
  if (room?.status !== "countdown" || Number(room?.round_number) !== 1) return null;
  const rollAt = room?.roll_at
    ? new Date(room.roll_at).getTime()
    : room?.reveal_at
      ? new Date(room.reveal_at).getTime() - DIE_ROLL_DURATION_MS
      : null;
  if (!rollAt) return null;
  const milliseconds = rollAt - now;
  if (milliseconds <= 0 || milliseconds > 3000) return null;
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

export function cardsConcealed(room, phase) {
  if (room?.status === "round_result" || room?.status === "finished" || phase === "open") return false;
  if (room?.difficulty === "easy") return false;
  if (room?.difficulty === "hard") return phase === "shuffling";
  return true;
}

export function targetIsRevealed(room, phase) {
  return phase === "open" || room?.status === "round_result" || room?.status === "finished";
}

export function playerRoundOutcome({
  roundComplete = false,
  winnerId = null,
  currentUserId = null,
  attempted = false,
  attemptCorrect = false,
} = {}) {
  if (roundComplete) return winnerId === currentUserId ? "win" : "loss";
  if (!attempted) return null;
  return attemptCorrect ? "win" : "loss";
}

export const CARD_ROTATION_STEPS = [0, 60, 120, 180, 240, 300];

function rotationHash(seed) {
  let hash = 2166136261;
  const text = String(seed);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function roundKeyFromSeed(seed) {
  const text = String(seed ?? "0");
  const separator = text.lastIndexOf(":");
  return separator >= 0 ? text.slice(separator + 1) : text;
}

export function hardModeTargetMutation(roundSeedOrKey) {
  const roundKey = roundKeyFromSeed(roundSeedOrKey);
  return HARD_FACE_MUTATIONS[rotationHash(`hard-face:${roundKey}`) % HARD_FACE_MUTATIONS.length];
}

function differentHardMutation(targetMutation, roundSeed) {
  const alternatives = HARD_FACE_MUTATIONS.filter((mutation) => mutation !== targetMutation);
  return alternatives[rotationHash(`${roundSeed}:decoy-face`) % alternatives.length];
}

function correctMutationSentinel(mutation) {
  if (mutation === "closedEyes") return 0;
  if (mutation === "missingEar") return "";
  return false;
}

export function cardRotations({ difficulty, roundSeed, animalIds = ANIMAL_IDS } = {}) {
  if (difficulty !== "hard") return {};
  const hash = rotationHash(roundSeed);
  const offset = hash % 60;
  const steps = [...CARD_ROTATION_STEPS];
  let cursor = hash;
  for (let index = steps.length - 1; index > 0; index -= 1) {
    cursor = (Math.imul(cursor, 1664525) + 1013904223) >>> 0;
    const swap = cursor % (index + 1);
    [steps[index], steps[swap]] = [steps[swap], steps[index]];
  }
  return Object.fromEntries(
    animalIds.map((animalId, index) => [animalId, (steps[index % steps.length] + offset) % 360]),
  );
}

/**
 * Builds the playable card list. Hard mode keeps six cards, but one non-target
 * card is replaced by a second copy of the target. The die and one target card
 * share the same visual mutation; the other target card is a near-match decoy
 * with a different mutation. This prevents players from solving the round by
 * simply spotting the duplicated animal in the deck.
 */
export function playableCards({ order, targetAnimal, difficulty, roundSeed } = {}) {
  const safeOrder = Array.isArray(order) && order.length === ANIMAL_IDS.length ? order : ANIMAL_IDS;
  const cards = safeOrder.map((animalId) => ({
    key: animalId,
    animalId,
    isDecoy: false,
  }));
  if (difficulty !== "hard" || !ANIMAL_IDS.includes(targetAnimal)) return cards;

  const targetIndex = cards.findIndex((card) => card.animalId === targetAnimal);
  const replaceableIndexes = cards
    .map((_, index) => index)
    .filter((index) => index !== targetIndex);
  const replaceIndex = replaceableIndexes[rotationHash(`${roundSeed}:replace`) % replaceableIndexes.length];
  const targetMutation = hardModeTargetMutation(roundSeed);
  const decoyMutation = differentHardMutation(targetMutation, roundSeed);
  const originalIsCorrect = rotationHash(`${roundSeed}:correct`) % 2 === 0;
  const correctCard = { isDecoy: correctMutationSentinel(targetMutation) };
  const decoyCard = { isDecoy: decoyMutation };

  cards[targetIndex] = {
    ...cards[targetIndex],
    ...(originalIsCorrect ? correctCard : decoyCard),
  };
  cards[replaceIndex] = {
    key: `${targetAnimal}-duplicate`,
    animalId: targetAnimal,
    ...(originalIsCorrect ? decoyCard : correctCard),
  };
  return cards;
}

export function decoySubmission(targetAnimal) {
  return ANIMAL_IDS.find((animalId) => animalId !== targetAnimal) || ANIMAL_IDS[0];
}

export function visibleCardOrder(room, phase) {
  const finalOrder = Array.isArray(room?.card_order) && room.card_order.length === ANIMAL_IDS.length
    ? room.card_order
    : ANIMAL_IDS;
  if (
    room?.difficulty === "hard"
    && (phase === "waiting" || phase === "rolling")
    && Array.isArray(room?.preview_card_order)
    && room.preview_card_order.length === ANIMAL_IDS.length
  ) {
    return room.preview_card_order;
  }
  return finalOrder;
}

export function rankPlayers(players = []) {
  return [...players].sort((left, right) =>
    Number(right.won_cards || 0) - Number(left.won_cards || 0)
    || Number(right.safety_cards || 0) - Number(left.safety_cards || 0)
    || Number(right.rounds_won || 0) - Number(left.rounds_won || 0)
    || String(left.joined_at || "").localeCompare(String(right.joined_at || ""))
  );
}

export function applyWrongTap(player) {
  const next = {
    ...player,
    safety_cards: Number(player.safety_cards || 0),
    won_cards: Number(player.won_cards || 0),
    wrong_taps: Number(player.wrong_taps || 0) + 1,
  };
  let penalty = "eliminated";
  if (next.safety_cards > 0) {
    next.safety_cards -= 1;
    penalty = "safety";
  } else if (next.won_cards > 0) {
    next.won_cards -= 1;
    penalty = "won_card";
  }
  next.eliminated = next.safety_cards + next.won_cards === 0;
  if (next.eliminated) penalty = "eliminated";
  return { player: next, penalty };
}

export function matchWinner(players = [], winningCards = 7) {
  const active = players.filter((player) => !player.eliminated && !player.left_at);
  const targetWinner = active.find((player) => Number(player.won_cards || 0) >= winningCards);
  if (targetWinner) return targetWinner;
  return active.length === 1 ? active[0] : null;
}

export function botAnimalChoice(targetAnimal, randomValue = Math.random(), accuracy = 0.84) {
  if (randomValue < accuracy) return targetAnimal;
  const alternatives = ANIMAL_IDS.filter((animalId) => animalId !== targetAnimal);
  const missPosition = Math.min(
    alternatives.length - 1,
    Math.floor(((randomValue - accuracy) / Math.max(1 - accuracy, Number.EPSILON)) * alternatives.length),
  );
  return alternatives[Math.max(0, missPosition)];
}

export function inviteUrl(roomCode, locationLike = {}) {
  const origin = locationLike.origin || "https://imbored.au";
  const pathname = locationLike.pathname || "/";
  const url = new URL(pathname, origin);
  url.searchParams.set("rush", String(roomCode || "").toUpperCase());
  return url.toString();
}
