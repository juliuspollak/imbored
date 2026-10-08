import React from "react";

/**
 * One restrained seasonal corner ornament shared by every game.
 * The game itself remains the hero; this is deliberately line-art rather than
 * another large mascot/icon competing with the puzzle title.
 */
function HalloweenCorner() {
  return (
    <svg className="seasonal-game-accent__svg" viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M2 2 30 30M2 17c10 1 19 5 28 13M17 2c1 10 5 19 13 28" strokeWidth="1.6" opacity=".72" />
        <path d="M2 31c8-12 18-22 29-29M9 26c4-8 10-14 18-18M16 23c2-4 5-7 9-9" strokeWidth="1.1" opacity=".42" />
      </g>
      <g className="seasonal-game-accent__bat" fill="currentColor" transform="translate(33 13) scale(.72)" opacity=".9">
        <path d="M0 12c6-9 13-8 18-4 3-6 9-8 14-5-2 7-6 11-12 14-6 2-12 1-20-5Z" />
      </g>
      <circle cx="44" cy="17" r="1.3" fill="#f59e0b" opacity=".9" />
    </svg>
  );
}

export default function SeasonalGameAccent({ game }) {
  return (
    <span className={`seasonal-game-accent seasonal-game-accent--${game || "generic"}`} aria-hidden="true">
      <HalloweenCorner />
    </span>
  );
}
