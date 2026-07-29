import { useEffect, useRef } from "react";

// Ticks setSeconds once per second while running and not yet solved. Shared
// by every puzzle game with a personal-best clock (not AnimalRush, whose
// intervals drive live multiplayer sync instead).
export function useGameTimer(running, solved, setSeconds) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (running && !solved) {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [running, solved]);
}
