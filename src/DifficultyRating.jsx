import { useState } from "react";

const INK = "#1B2129";
const ACCENT = "#2F6FED";
const TRACK = "rgba(16,24,40,0.08)";

const BAR_COUNT = 6;

export default function DifficultyRating({ onRate }) {
  const [selected, setSelected] = useState(null); // bar index, 0-based
  const [rated, setRated] = useState(false);

  function pick(i) {
    setSelected(i);
    setRated(true);
    const value = Math.round((i / (BAR_COUNT - 1)) * 100);
    onRate && onRate(value);
  }

  return (
    <div className="flex flex-col items-center">
      <div style={{ color: INK, opacity: 0.5 }} className="text-xs mb-3">
        {rated ? "Thanks — noted for next time" : "How did that feel?"}
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 52 }}>
        {Array.from({ length: BAR_COUNT }, (_, i) => {
          const heightPct = 30 + (i / (BAR_COUNT - 1)) * 70; // short to tall, left to right
          const isFilled = selected !== null && i <= selected;
          const isTip = selected === i;
          return (
            <button
              key={i}
              onClick={() => pick(i)}
              aria-label={`Difficulty level ${i + 1} of ${BAR_COUNT}`}
              className="flex items-end"
              style={{ width: 28, height: 52 }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${heightPct}%`,
                  borderRadius: 6,
                  background: isFilled ? ACCENT : TRACK,
                  opacity: isTip ? 1 : isFilled ? 0.75 : 1,
                  transform: isTip ? "scaleY(1.06)" : "scaleY(1)",
                  transformOrigin: "bottom",
                  transition: "background 0.15s ease, transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="flex justify-between w-full mt-2" style={{ maxWidth: BAR_COUNT * 28 + (BAR_COUNT - 1) * 6 }}>
        <span style={{ color: INK, opacity: 0.4 }} className="text-[10px]">Too easy</span>
        <span style={{ color: INK, opacity: 0.4 }} className="text-[10px]">Too hard</span>
      </div>
    </div>
  );
}
