import { useRef, useState } from "react";
import AnimalFace from "./AnimalFace.jsx";
import {
  DIE_ROLL_DURATION_MS,
  animalById,
  animalColour,
  hardModeTargetMutation,
} from "./engine.js";

const DIE_FACES = [
  ["fox", "front"],
  ["panda", "back"],
  ["owl", "right"],
  ["rabbit", "left"],
  ["lion", "top"],
  ["frog", "bottom"],
];

const ANIMAL_IDS = ["fox", "panda", "owl", "rabbit", "lion", "frog"];

const TARGET_ROTATIONS = {
  fox: "rotateX(0deg) rotateY(0deg)",
  panda: "rotateX(0deg) rotateY(-180deg)",
  owl: "rotateX(0deg) rotateY(-90deg)",
  rabbit: "rotateX(0deg) rotateY(90deg)",
  lion: "rotateX(-90deg) rotateY(0deg)",
  frog: "rotateX(90deg) rotateY(0deg)",
};

function misdirectAnimalId(animalId, colourMode) {
  if (colourMode !== "mixed") return undefined;
  const idx = ANIMAL_IDS.indexOf(animalId);
  if (idx === -1) return undefined;
  return ANIMAL_IDS[(idx + 1) % ANIMAL_IDS.length];
}

export default function AnimalDie({
  targetId,
  countdown,
  roundKey,
  revealed,
  concealed = false,
  colourMode = "uniform",
  rollDurationMs = 2850,
  rollElapsedMs = 0,
}) {
  const [startedRound, setStartedRound] = useState(null);
  const timingRef = useRef({ roundKey: null, durationMs: 2850, elapsedMs: 0 });
  if (timingRef.current.roundKey !== roundKey) {
    const durationMs = Math.max(0, Number(rollDurationMs) || 0);
    timingRef.current = {
      roundKey,
      durationMs,
      elapsedMs: Math.max(0, Math.min(durationMs, Number(rollElapsedMs) || 0)),
    };
  }

  // Animal Rush already gives Hard mode a 200 ms die-cover extension. Reuse
  // that existing signal so the cube and deck can share the same deterministic
  // visual mutation without changing the room schema or live-game protocol.
  const hardMode = Math.abs((Number(rollDurationMs) || 0) - (DIE_ROLL_DURATION_MS + 200)) < 1;
  const targetMutation = hardMode ? hardModeTargetMutation(roundKey) : "normal";

  return (
    <div
      className="rush-die"
      role="img"
      aria-label={revealed ? `${animalById(targetId).label} animal die` : "Animal die countdown"}
      data-revealed={revealed}
      data-concealed={concealed}
      data-spinning={startedRound === roundKey}
    >
      <div
        className="rush-die__cube"
        key={roundKey}
        onAnimationStart={(event) => {
          if (event.target === event.currentTarget) setStartedRound(roundKey);
        }}
        style={{
          "--rush-die-duration": `${timingRef.current.durationMs}ms`,
          "--rush-die-delay": `-${timingRef.current.elapsedMs}ms`,
          "--rush-die-end": TARGET_ROTATIONS[targetId] || TARGET_ROTATIONS.fox,
        }}
      >
        {DIE_FACES.map(([animalId, face]) => {
          const misdirectedId = misdirectAnimalId(animalId, colourMode);
          return (
            <span className={`rush-die__face rush-die__face--${face}`} key={animalId}>
              <AnimalFace
                animalId={animalId}
                colourMode={colourMode}
                size={58}
                mutation={animalId === targetId ? targetMutation : "normal"}
                bgColour={misdirectedId ? animalColour(misdirectedId, "mixed") : undefined}
                overrideColourAnimalId={misdirectedId}
              />
            </span>
          );
        })}
      </div>
      <span className="rush-die__still" aria-hidden="true">?</span>
      {!revealed && countdown && <span className="rush-die__countdown">{countdown}</span>}
    </div>
  );
}
