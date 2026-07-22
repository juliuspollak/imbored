import { useState } from "react";

const INK = "#1B2129";
const ACCENT = "#2F6FED";

// A simple, low-friction post-puzzle prompt: tap a point along a triangle
// that grows from short (easy) to tall (hard) — same pattern as Apple
// Fitness's perceived-effort rating. No numbers, no forced choice, just
// "point at about where it felt."
export default function DifficultyRating({ onRate }) {
  const [value, setValue] = useState(null); // 0-100
  const [rated, setRated] = useState(false);

  function handlePick(e) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setValue(pct);
    setRated(true);
    onRate && onRate(Math.round(pct));
  }

  const dotX = value ?? 50;
  const dotY = 54 - (dotX / 100) * 48; // taller (smaller y) further right

  return (
    <div className="flex flex-col items-center">
      <div style={{ color: INK, opacity: 0.5 }} className="text-xs mb-2">
        {rated ? "Thanks — noted for next time" : "How did that feel?"}
      </div>
      <svg
        viewBox="0 0 280 60"
        onClick={handlePick}
        style={{ width: "100%", maxWidth: 280, height: 60, cursor: "pointer", touchAction: "none" }}
      >
        <polygon points="0,60 280,4 280,60" fill="rgba(16,24,40,0.07)" />
        {value !== null && (
          <>
            <line x1={(dotX / 100) * 280} y1={dotY} x2={(dotX / 100) * 280} y2={60} stroke={ACCENT} strokeWidth={1.5} strokeDasharray="3,3" opacity={0.5} />
            <circle cx={(dotX / 100) * 280} cy={dotY} r={7} fill={ACCENT} stroke="#FFFFFF" strokeWidth={2} />
          </>
        )}
      </svg>
      <div className="flex justify-between w-full max-w-[280px] mt-1">
        <span style={{ color: INK, opacity: 0.4 }} className="text-[10px]">Too easy</span>
        <span style={{ color: INK, opacity: 0.4 }} className="text-[10px]">Just right</span>
        <span style={{ color: INK, opacity: 0.4 }} className="text-[10px]">Too hard</span>
      </div>
    </div>
  );
}
