import test from "node:test";
import assert from "node:assert/strict";
import {
  ANIMALS,
  ANIMAL_IDS,
  COLOUR_MODES,
  animalColour,
  applyWrongTap,
  botAnimalChoice,
  cardRotations,
  playableCards,
  decoySubmission,
  cardsConcealed,
  countdownNumber,
  inviteUrl,
  isPhoneDevice,
  matchIntroCountdown,
  matchWinner,
  playerRoundOutcome,
  rankPlayers,
  roundPhase,
  targetIsRevealed,
  visibleCardOrder,
} from "./engine.js";

test("accepts touch phones and iPads while rejecting desktops", () => {
  assert.equal(isPhoneDevice({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    maxTouchPoints: 5,
    coarsePointer: true,
  }), true);
  assert.equal(isPhoneDevice({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    maxTouchPoints: 0,
    coarsePointer: false,
  }), false);
  assert.equal(isPhoneDevice({
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    maxTouchPoints: 5,
    coarsePointer: true,
  }), true);
  assert.equal(isPhoneDevice({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
    userAgentMobile: false,
    maxTouchPoints: 5,
    coarsePointer: true,
  }), true);
  assert.equal(isPhoneDevice({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    userAgentMobile: false,
    maxTouchPoints: 0,
    coarsePointer: false,
  }), false);
});

test("bot can react correctly or choose a genuine wrong animal", () => {
  assert.equal(botAnimalChoice("fox", 0.4), "fox");
  assert.notEqual(botAnimalChoice("fox", 0.95), "fox");
  assert.ok(ANIMAL_IDS.includes(botAnimalChoice("fox", 0.95)));
});

test("opens a round only after the shared reveal time", () => {
  const room = {
    status: "countdown",
    roll_at: "2026-07-27T12:00:00.000Z",
    reveal_at: "2026-07-27T12:00:03.000Z",
  };
  assert.equal(roundPhase(room, Date.parse("2026-07-27T11:59:59.000Z")), "waiting");
  assert.equal(roundPhase(room, Date.parse("2026-07-27T12:00:01.000Z")), "rolling");
  assert.equal(countdownNumber(room, Date.parse("2026-07-27T12:00:01.000Z")), 2);
  assert.equal(roundPhase(room, Date.parse("2026-07-27T12:00:03.000Z")), "open");
});

test("finishes the match intro before the first die starts rolling", () => {
  const room = {
    status: "countdown",
    round_number: 1,
    roll_at: "2026-07-27T12:00:03.000Z",
    reveal_at: "2026-07-27T12:00:06.000Z",
  };
  assert.equal(matchIntroCountdown(room, Date.parse("2026-07-27T12:00:00.000Z")), 3);
  assert.equal(matchIntroCountdown(room, Date.parse("2026-07-27T12:00:02.100Z")), 1);
  assert.equal(matchIntroCountdown(room, Date.parse("2026-07-27T12:00:03.000Z")), null);
  assert.equal(countdownNumber(room, Date.parse("2026-07-27T12:00:03.000Z")), 3);
  assert.equal(matchIntroCountdown({ ...room, round_number: 2 }, Date.parse("2026-07-27T12:00:00.000Z")), null);
});

test("uses one shared hard-mode shuffle phase and final order", () => {
  const room = {
    status: "countdown",
    difficulty: "hard",
    roll_at: "2026-07-27T12:00:03.000Z",
    shuffle_at: "2026-07-27T12:00:06.000Z",
    reveal_at: "2026-07-27T12:00:06.800Z",
    preview_card_order: ["fox", "panda", "owl", "rabbit", "lion", "frog"],
    card_order: ["frog", "lion", "rabbit", "owl", "panda", "fox"],
  };
  assert.equal(roundPhase(room, Date.parse("2026-07-27T12:00:05.000Z")), "rolling");
  assert.equal(roundPhase(room, Date.parse("2026-07-27T12:00:06.200Z")), "shuffling");
  assert.equal(cardsConcealed(room, "rolling"), false);
  assert.equal(cardsConcealed(room, "shuffling"), true);
  assert.equal(targetIsRevealed(room, "shuffling"), false);
  assert.deepEqual(visibleCardOrder(room, "rolling"), room.preview_card_order);
  assert.deepEqual(visibleCardOrder(room, "shuffling"), room.card_order);
  assert.equal(roundPhase(room, Date.parse("2026-07-27T12:00:06.800Z")), "open");
  assert.equal(targetIsRevealed(room, "open"), true);
});

test("standard conceals cards while easy keeps them visible", () => {
  assert.equal(cardsConcealed({ difficulty: "standard", status: "countdown" }, "rolling"), true);
  assert.equal(cardsConcealed({ difficulty: "easy", status: "countdown" }, "rolling"), false);
  assert.equal(cardsConcealed({ difficulty: "standard", status: "countdown" }, "open"), false);
});

test("supports individual, uniform, and mixed colour modes", () => {
  assert.deepEqual(COLOUR_MODES.map((mode) => mode.id), ["individual", "uniform", "mixed"]);
  assert.equal(new Set(ANIMALS.map((animal) => animalColour(animal.id, "uniform"))).size, 1);
  assert.equal(new Set(ANIMALS.map((animal) => animalColour(animal.id, "individual"))).size, ANIMALS.length);
  assert.equal(new Set(ANIMALS.map((animal) => animalColour(animal.id, "mixed"))).size, ANIMALS.length);
  assert.equal(animalColour("fox", "unknown"), animalColour("fox", "uniform"));
});

test("shows one authoritative player outcome for a round", () => {
  assert.equal(playerRoundOutcome(), null);
  assert.equal(playerRoundOutcome({ attempted: true, attemptCorrect: true }), "win");
  assert.equal(playerRoundOutcome({ attempted: true, attemptCorrect: false }), "loss");
  assert.equal(playerRoundOutcome({
    roundComplete: true,
    winnerId: "me",
    currentUserId: "me",
    attempted: true,
    attemptCorrect: false,
  }), "win");
  assert.equal(playerRoundOutcome({
    roundComplete: true,
    winnerId: "other",
    currentUserId: "me",
    attempted: true,
    attemptCorrect: true,
  }), "loss");
});

test("ranks cards before safety cards and uses join order as final tie-break", () => {
  const ranked = rankPlayers([
    { user_id: "a", won_cards: 2, safety_cards: 2, joined_at: "2026-01-01T00:00:01Z" },
    { user_id: "b", won_cards: 3, safety_cards: 0, joined_at: "2026-01-01T00:00:02Z" },
    { user_id: "c", won_cards: 2, safety_cards: 2, joined_at: "2026-01-01T00:00:00Z" },
  ]);
  assert.deepEqual(ranked.map((player) => player.user_id), ["b", "c", "a"]);
});

test("creates a shareable room link without losing the app path", () => {
  assert.equal(
    inviteUrl("ab12ef", { origin: "https://imbored.au", pathname: "/play" }),
    "https://imbored.au/play?rush=AB12EF",
  );
});

test("wrong touches consume safety before won cards and eliminate at zero", () => {
  let state = { safety_cards: 2, won_cards: 1, wrong_taps: 0, eliminated: false };
  ({ player: state } = applyWrongTap(state));
  assert.deepEqual(
    { safety: state.safety_cards, cards: state.won_cards, eliminated: state.eliminated },
    { safety: 1, cards: 1, eliminated: false },
  );
  ({ player: state } = applyWrongTap(state));
  assert.equal(state.safety_cards, 0);
  assert.equal(state.won_cards, 1);
  assert.equal(state.eliminated, false);
  const final = applyWrongTap(state);
  assert.equal(final.player.won_cards, 0);
  assert.equal(final.player.eliminated, true);
  assert.equal(final.penalty, "eliminated");
});

test("simulates 1,000 varied matches without negative cards or unfinished games", () => {
  let seed = 137;
  const random = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };

  for (let match = 0; match < 1000; match += 1) {
    let players = Array.from({ length: 2 + Math.floor(random() * 5) }, (_, index) => ({
      user_id: `p${index}`,
      safety_cards: 2,
      won_cards: 0,
      wrong_taps: 0,
      eliminated: false,
    }));
    let winner = null;
    for (let round = 0; round < 300 && !winner; round += 1) {
      const active = players.filter((player) => !player.eliminated);
      for (const player of active) {
        if (random() < 0.22) {
          const result = applyWrongTap(player);
          players = players.map((item) => item.user_id === player.user_id ? result.player : item);
        }
      }
      const remaining = players.filter((player) => !player.eliminated);
      if (remaining.length > 1) {
        const roundWinner = remaining[Math.floor(random() * remaining.length)];
        players = players.map((player) => player.user_id === roundWinner.user_id
          ? { ...player, won_cards: player.won_cards + 1 }
          : player);
      }
      winner = matchWinner(players, 7);
    }
    assert.ok(winner, `match ${match} should finish`);
    assert.ok(players.every((player) => player.safety_cards >= 0 && player.won_cards >= 0));
    assert.ok(players.every((player) => !player.eliminated || player.safety_cards + player.won_cards === 0));
  }
});

test("hard mode turns every card, and only hard mode", () => {
  assert.deepEqual(cardRotations({ difficulty: "standard", roundSeed: "room-1:3" }), {});
  assert.deepEqual(cardRotations({ difficulty: "easy", roundSeed: "room-1:3" }), {});

  const rotations = cardRotations({ difficulty: "hard", roundSeed: "room-1:3" });
  assert.deepEqual(Object.keys(rotations).sort(), [...ANIMAL_IDS].sort());
  // Every card a different angle, so no two silhouettes read the same way.
  assert.equal(new Set(Object.values(rotations)).size, ANIMAL_IDS.length);
  Object.values(rotations).forEach((angle) => {
    assert.ok(Number.isInteger(angle) && angle >= 0 && angle < 360, `bad angle ${angle}`);
  });
});

test("every player in a round sees the identical board", () => {
  // A race is only fair if the rotation comes from the round, not the client.
  assert.deepEqual(
    cardRotations({ difficulty: "hard", roundSeed: "room-9:4" }),
    cardRotations({ difficulty: "hard", roundSeed: "room-9:4" }),
  );
});

test("the angles move on from round to round", () => {
  const seen = new Set();
  for (let round = 1; round <= 12; round += 1) {
    seen.add(JSON.stringify(cardRotations({ difficulty: "hard", roundSeed: `room-9:${round}` })));
  }
  // Twelve consecutive rounds should not keep serving the same arrangement.
  assert.ok(seen.size >= 10, `only ${seen.size} distinct layouts in 12 rounds`);
});

test("hard mode replaces one card with an identical target decoy", () => {
  const args = {
    order: ANIMAL_IDS,
    targetAnimal: "fox",
    difficulty: "hard",
    roundSeed: "room-9:4",
  };
  const first = playableCards(args);
  const second = playableCards(args);
  assert.deepEqual(first, second);
  assert.equal(first.length, 6);
  assert.equal(first.filter((card) => card.animalId === "fox").length, 2);
  assert.equal(first.filter((card) => card.isDecoy).length, 1);
  assert.equal(new Set(first.map((card) => card.animalId)).size, 5);
  assert.notEqual(decoySubmission("fox"), "fox");
});

test("easy and standard keep the existing six cards", () => {
  for (const difficulty of ["easy", "standard"]) {
    const cards = playableCards({ order: ANIMAL_IDS, targetAnimal: "fox", difficulty, roundSeed: "round" });
    assert.equal(cards.length, 6);
    assert.equal(cards.some((card) => card.isDecoy), false);
  }
});

test("hard mode can keep the decoy out of the pre-reveal board", () => {
  const cards = playableCards({ order: ANIMAL_IDS, targetAnimal: null, difficulty: "hard", roundSeed: "round" });
  assert.equal(cards.length, 6);
});
