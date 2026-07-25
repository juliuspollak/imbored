import { useState, useEffect, useRef, useCallback } from "react";

// Shared cooldown logic for every game. A ref is used as the immediate lock
// because React state updates are asynchronous; without it, two rapid clicks
// can both enter the hint handler before the button re-renders as disabled.
export function useHintCooldown(cooldownSeconds) {
  const [remaining, setRemaining] = useState(0);
  const intervalRef = useRef(null);
  const lockedRef = useRef(false);

  const reset = useCallback(() => {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
    lockedRef.current = false;
    setRemaining(0);
  }, []);

  useEffect(() => reset, [reset]);

  const startCooldown = useCallback(() => {
    const duration = Math.max(0, Number(cooldownSeconds) || 0);
    if (!duration) return;

    lockedRef.current = true;
    setRemaining(duration);
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          lockedRef.current = false;
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  }, [cooldownSeconds]);

  return {
    remaining,
    startCooldown,
    reset,
    locked: remaining > 0,
    isLocked: () => lockedRef.current,
  };
}
