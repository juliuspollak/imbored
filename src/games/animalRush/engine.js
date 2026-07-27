export const ANIMALS = [
  { id: "fox", label: "Monkey", colour: "#9B5B42" },
  { id: "panda", label: "Snake", colour: "#49A94E" },
  { id: "owl", label: "Octopus", colour: "#B83A9D" },
  { id: "rabbit", label: "Elephant", colour: "#1EA4B8" },
  { id: "lion", label: "Lion", colour: "#D58B32" },
  { id: "frog", label: "Spider", colour: "#56376D" },
];

export const ANIMAL_IDS = ANIMALS.map((animal) => animal.id);
export const DIE_ROLL_DURATION_MS = 3000;

export function animalById(id) {
  return ANIMALS.find((animal) => animal.id === id) || ANIMALS[0];
}

export function isPhoneDevice({
  userAgent = "",
  userAgentMobile,
  maxTouchPoints = 0,
  coarsePointer = false,
} = {}) {
  const phoneUserAgent = /iPhone|iPod|Android.+Mobile|Windows Phone/i.test(userAgent);
  const reportsMobile = typeof userAgentMobile === "boolean" ? userAgentMobile : phoneUserAgent;
  return reportsMobile && maxTouchPoints > 0 && coarsePointer;
}

export function roundPhase(room, now = Date.now()) {
  if (!room) return "none";
  if (room.status !== "countdown") return room.status;
  const revealAt = room.reveal_at ? new Date(room.reveal_at).getTime() : Number.POSITIVE_INFINITY;
  return now >= revealAt ? "open" : "countdown";
}

export function countdownNumber(room, now = Date.now()) {
  if (!room?.reveal_at) return null;
  const milliseconds = new Date(room.reveal_at).getTime() - now;
  return milliseconds <= 0 ? null : Math.max(1, Math.ceil(milliseconds / 1000));
}

export function matchIntroCountdown(room, now = Date.now()) {
  if (room?.status !== "countdown" || Number(room?.round_number) !== 1 || !room?.reveal_at) return null;
  const introEndsAt = new Date(room.reveal_at).getTime() - DIE_ROLL_DURATION_MS;
  const milliseconds = introEndsAt - now;
  return milliseconds <= 0 ? null : Math.max(1, Math.ceil(milliseconds / 1000));
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
