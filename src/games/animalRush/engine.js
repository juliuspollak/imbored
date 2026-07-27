export const ANIMALS = [
  { id: "fox", label: "Fox", colour: "#E9783D" },
  { id: "panda", label: "Panda", colour: "#374151" },
  { id: "owl", label: "Owl", colour: "#8B5E3C" },
  { id: "rabbit", label: "Rabbit", colour: "#7C6F9F" },
  { id: "lion", label: "Lion", colour: "#C98B2E" },
  { id: "frog", label: "Frog", colour: "#3D8C68" },
];

export const ANIMAL_IDS = ANIMALS.map((animal) => animal.id);

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

export function inviteUrl(roomCode, locationLike = {}) {
  const origin = locationLike.origin || "https://imbored.au";
  const pathname = locationLike.pathname || "/";
  const url = new URL(pathname, origin);
  url.searchParams.set("rush", String(roomCode || "").toUpperCase());
  return url.toString();
}
