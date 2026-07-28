import test from "node:test";
import assert from "node:assert/strict";
import {
  ANIMAL_IDS,
  applyWrongTap,
  botAnimalChoice,
  cardsConcealed,
  countdownNumber,
  inviteUrl,
  isPhoneDevice,
  matchIntroCountdown,
  matchWinner,
  rankPlayers,
  roundPhase,
  visibleCardOrder,
} from "./engine.js";

test("accepts touch phones and rejects desktop or tablet-style devices", () => {
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
  assert.deepEqual(visibleCardOrder(room, "rolling"), room.preview_card_order);
  assert.deepEqual(visibleCardOrder(room, "shuffling"), room.card_order);
  assert.equal(roundPhase(room, Date.parse("2026-07-27T12:00:06.800Z")), "open");
});

test("standard conceals cards while easy keeps them visible", () => {
  assert.equal(cardsConcealed({ difficulty: "standard", status: "countdown" }, "rolling"), true);
  assert.equal(cardsConcealed({ difficulty: "easy", status: "countdown" }, "rolling"), false);
  assert.equal(cardsConcealed({ difficulty: "standard", status: "countdown" }, "open"), false);
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
