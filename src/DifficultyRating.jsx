import { useState } from "react";
import { Check } from "lucide-react";

const INK = "#1B2129";
const ACCENT = "#2F6FED";
const TRACK = "rgba(16,24,40,0.08)";
const GREEN = "#16A34A";

const BAR_COUNT = 6;

function describe(i) {
  if (i <= 1) return "Too easy";
  if (i <= 3) return "Just right";
  return "Too hard";
}

export default function DifficultyRating({ onRate }) {
  const [selected, setSelected] = useState(null); // bar index, 0-based
  const [rated, setRated] = useState(false);

  function pick(i) {
    setSelected(i);
    setRated(true);
    const value = Math.round((i / (BAR_COUNT - 1)) * 100);
    onRate && onRate(value);
  }

  // Once rated, collapse to a small pill instead of taking up the same
  // space as the picker — a tiny echo of the bar they picked plus a quick
  // confirmation, so the completed board underneath stays the focus.
  if (rated) {
    const heightPct = 30 + (selected / (BAR_COUNT - 1)) * 70;
    return (
      <div className="flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(22,163,74,0.08)" }}>
        <div className="flex items-end" style={{ width: 10, height: 14 }}>
          <div style={{ width: "100%", height: `${heightPct}%`, borderRadius: 2, background: GREEN }} />
        </div>
        <span style={{ color: GREEN }} className="text-xs font-medium">{describe(selected)}</span>
        <Check size={12} style={{ color: GREEN }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div style={{ color: INK, opacity: 0.5 }} className="text-xs mb-3">
        How did that feel?
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 52 }}>
        {Array.from({ length: BAR_COUNT }, (_, i) => {
          const heightPct = 30 + (i / (BAR_COUNT - 1)) * 70; // short to tall, left to right
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
                  background: TRACK,
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
