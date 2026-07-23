import { useState } from "react";
import { Check } from "lucide-react";

const INK = "#1B2129";
const ACCENT = "#2F6FED";
const TRACK = "rgba(16,24,40,0.10)";
const GREEN = "#16A34A";

export const BAR_COUNT = 6;

function ratingToIndex(value) {
  return Math.max(0, Math.min(BAR_COUNT - 1, Math.round((value / 100) * (BAR_COUNT - 1))));
}

function describe(i) {
  if (i <= 1) return "Too easy";
  if (i <= 3) return "Just right";
  return "Too hard";
}

function RatingBars({ selected, compact = false, activeColor = ACCENT }) {
  const width = compact ? 8 : 28;
  const height = compact ? 20 : 52;
  const gap = compact ? 3 : 6;

  return (
    <div className="flex items-end" style={{ height, gap }}>
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const heightPct = 30 + (i / (BAR_COUNT - 1)) * 70;
        return (
          <div
            key={i}
            style={{
              width,
              height: `${heightPct}%`,
              borderRadius: compact ? 2 : 6,
              background: i === selected ? activeColor : TRACK,
              transform: i === selected && !compact ? "scaleY(1.06)" : "none",
              transformOrigin: "bottom",
              transition: "background 0.15s ease, transform 0.15s ease",
            }}
          />
        );
      })}
    </div>
  );
}

export function DifficultyRatingBadge({ value }) {
  const selected = ratingToIndex(value);
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
      style={{ background: "rgba(47,111,237,0.08)", color: INK }}
      aria-label={`Your difficulty rating: ${describe(selected)}`}
    >
      <span className="text-[10px] font-semibold" style={{ opacity: 0.55 }}>Your rating</span>
      <RatingBars selected={selected} compact />
      <span className="text-[10px] font-semibold" style={{ color: ACCENT }}>{describe(selected)}</span>
    </div>
  );
}

export default function DifficultyRating({ onRate, onRated }) {
  const [selected, setSelected] = useState(null);
  const [rated, setRated] = useState(false);
  const [saving, setSaving] = useState(false);

  async function pick(i) {
    if (saving || rated) return;
    const value = Math.round((i / (BAR_COUNT - 1)) * 100);
    setSelected(i);
    setSaving(true);
    try {
      if (onRate) await onRate(value);
      setRated(true);
      setSaving(false);
    } catch (error) {
      setSaving(false);
      setSelected(null);
      console.error("Unable to save difficulty rating", error);
    }
  }

  if (rated) {
    return (
      <div className="flex flex-col items-center gap-2" role="status" aria-live="polite">
        <div className="flex items-center gap-1.5" style={{ color: GREEN }}>
          <Check size={15} />
          <span className="text-xs font-semibold">Rating saved</span>
        </div>
        <RatingBars selected={selected} compact activeColor={GREEN} />
        <span className="text-[10px] font-medium" style={{ color: GREEN }}>{describe(selected)}</span>
        {onRated && (
          <button
            type="button"
            onClick={() => onRated(Math.round((selected / (BAR_COUNT - 1)) * 100))}
            className="mt-1 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors"
            style={{ background: ACCENT, color: "#FFFFFF" }}
          >
            View board
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div style={{ color: INK, opacity: 0.5 }} className="text-xs mb-3">
        {saving ? "Saving your rating…" : "How did that feel?"}
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 52 }}>
        {Array.from({ length: BAR_COUNT }, (_, i) => {
          const heightPct = 30 + (i / (BAR_COUNT - 1)) * 70;
          return (
            <button
              key={i}
              onClick={() => pick(i)}
              disabled={saving}
              aria-label={`Difficulty level ${i + 1} of ${BAR_COUNT}`}
              className="flex items-end"
              style={{ width: 28, height: 52, cursor: saving ? "wait" : "pointer" }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${heightPct}%`,
                  borderRadius: 6,
                  background: i === selected ? ACCENT : TRACK,
                  opacity: saving && i !== selected ? 0.55 : 1,
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
