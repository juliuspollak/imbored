import { useState, useEffect, useRef } from "react";

// Shared cooldown logic for the Hint button, used identically across all
// four games. cooldownSeconds is the effective duration for the current
// day (already computed by the caller from admin config); 0 or undefined
// means no cooldown at all — the button behaves exactly as before.
export function useHintCooldown(cooldownSeconds) {
  const [remaining, setRemaining] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => () => clearInterval(intervalRef.current), []);

  function startCooldown() {
    if (!cooldownSeconds) return;
    setRemaining(cooldownSeconds);
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(intervalRef.current);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }

  function reset() {
    clearInterval(intervalRef.current);
    setRemaining(0);
  }

  return { remaining, startCooldown, reset, locked: remaining > 0 };
}
