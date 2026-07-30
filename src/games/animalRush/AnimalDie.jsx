import { useRef, useState } from "react";
import AnimalFace from "./AnimalFace.jsx";
import { animalById, animalColour } from "./engine.js";

const DIE_FACES = [
  ["fox", "front"],
  ["panda", "back"],
  ["owl", "right"],
  ["rabbit", "left"],
  ["lion", "top"],
  ["frog", "bottom"],
];

const TARGET_ROTATIONS = {
  fox: "rotateX(0deg) rotateY(0deg)",
  panda: "rotateX(0deg) rotateY(-180deg)",
  owl: "rotateX(0deg) rotateY(-90deg)",
  rabbit: "rotateX(0deg) rotateY(90deg)",
  lion: "rotateX(-90deg) rotateY(0deg)",
  frog: "rotateX(90deg) rotateY(0deg)",
};

/**
 * Returns a misleading background colour for each die face so that
 * no animal's die face shows its correct card colour.
 * This prevents players from matching by colour instead of shape.
 * Each die face gets the individual colour of the NEXT animal in the list.
 */
function misdirectDieColour(animalId, colourMode) {
  if (colourMode !== "individual") return undefined;
  const animalIds = ["fox", "panda", "owl", "rabbit", "lion", "frog"];
  const idx = animalIds.indexOf(animalId);
  if (idx === -1) return undefined;
  const nextIdx = (idx + 1) % animalIds.length;
  const nextAnimalId = animalIds[nextIdx];
  return animalColour(nextAnimalId, "individual");
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
        {DIE_FACES.map(([animalId, face]) => (
          <span className={`rush-die__face rush-die__face--${face}`} key={animalId}>
            <AnimalFace
              animalId={animalId}
              colourMode={colourMode}
              size={58}
              bgColour={misdirectDieColour(animalId, colourMode)}
            />
          </span>
        ))}
      </div>
      <span className="rush-die__still" aria-hidden="true">?</span>
      {!revealed && countdown && <span className="rush-die__countdown">{countdown}</span>}
    </div>
  );
}