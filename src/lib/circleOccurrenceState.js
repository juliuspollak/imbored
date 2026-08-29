export const CIRCLE_OCCURRENCE_STATE = Object.freeze({
  OPEN: "OPEN",
  GRACE: "GRACE",
  FINAL: "FINAL",
});

export function circleOccurrenceState(rounds = []) {
  if (rounds.some((round) => round.round_state === "open" || round.round_state === "scheduled")) return CIRCLE_OCCURRENCE_STATE.OPEN;
  if (rounds.some((round) => round.round_state === "grace")) return CIRCLE_OCCURRENCE_STATE.GRACE;
  return CIRCLE_OCCURRENCE_STATE.FINAL;
}

export function circleOccurrenceCutoff(rounds = []) {
  return rounds.reduce((latest, round) => {
    if (!round.closes_at) return latest;
    return !latest || new Date(round.closes_at) > new Date(latest) ? round.closes_at : latest;
  }, null);
}

export function circleHistoryResultLabel({ item, userId, state, standings = [] }) {
  if (state !== CIRCLE_OCCURRENCE_STATE.FINAL) {
    const current = standings.find((player) => String(player.userId) === String(userId));
    const rank = Number(current?.rank);
    if (Number.isInteger(rank) && rank > 0) return `Currently ${rank}${ordinalSuffix(rank)} · ${state === CIRCLE_OCCURRENCE_STATE.GRACE ? "grace" : "open"}`;
    return state === CIRCLE_OCCURRENCE_STATE.GRACE ? "Grace period · provisional" : "Open · provisional";
  }
  if (item.winner_id === userId) return "Final · You won";
  return item.winner_id ? `Final · ${item.winner_name || "Circlemate"} won` : "Final · No winner";
}

function ordinalSuffix(value) {
  const remainder100 = value % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return "th";
  if (value % 10 === 1) return "st";
  if (value % 10 === 2) return "nd";
  if (value % 10 === 3) return "rd";
  return "th";
}
