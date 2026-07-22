import { Crown, Moon, Waypoints, Target, ArrowUpDown, Grid3x3, Puzzle, Waves } from "lucide-react";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const CREAM = "#1B2129";

export const GAME_META = [
  { id: "queens", label: "Queens", desc: "One crown per row, column & region", icon: Crown, accent: "#2F6FED", available: true },
  { id: "tango", label: "Tango", desc: "Balance sun & moon in every line", icon: Moon, accent: "#4A6FA5", available: true },
  { id: "zip", label: "Zip", desc: "Trace one path through every cell", icon: Waypoints, accent: "#12946A", available: true },
  { id: "pinpoint", label: "Pinpoint", desc: "Guess the category from five clues", icon: Target, accent: "#8B5CF6", available: false },
  { id: "crossclimb", label: "Crossclimb", desc: "Solve the word ladder", icon: ArrowUpDown, accent: "#EA580C", available: false },
  { id: "minisudoku", label: "Mini Sudoku", desc: "Classic sudoku, bite-sized", icon: Grid3x3, accent: "#0E7490", available: false },
  { id: "patches", label: "Patches", desc: "Fit every shape into the frame", icon: Puzzle, accent: "#B45309", available: false },
  { id: "wend", label: "Wend", desc: "Weave hidden words through the grid", icon: Waves, accent: "#0EA5E9", available: false },
];

export default function Home({ onSelect }) {
  return (
    <div style={{ background: BG, minHeight: "100vh" }} className="flex items-start justify-center p-4 pt-10 sm:pt-16">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;1,600&family=Inter:wght@400;500;600;700&display=swap');
        @media (hover: hover) and (pointer: fine) {
          .home-tile:not(:disabled):hover { transform: translateY(-2px); filter: brightness(1.08); }
        }
        .home-tile { transition: transform 0.15s ease, filter 0.15s ease; }
      `}</style>
      <div className="w-full max-w-2xl" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="text-center mb-8">
          <h1
            style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontWeight: 600, color: CREAM, letterSpacing: "-0.01em" }}
            className="text-5xl"
          >
            Puzzle Games
          </h1>
          <p style={{ color: CREAM, opacity: 0.45 }} className="text-sm mt-2">
            new puzzles every day &mdash; Monday easiest, Sunday hardest
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {GAME_META.map((g) => {
            const Icon = g.icon;
            return (
              <button
                key={g.id}
                disabled={!g.available}
                onClick={() => g.available && onSelect(g.id)}
                className="home-tile flex flex-col items-start gap-3 rounded-2xl p-4 text-left"
                style={{
                  background: PANEL,
                  border: "1px solid rgba(16,24,40,0.09)",
                  boxShadow: "0 6px 20px rgba(16,24,40,0.08)",
                  opacity: g.available ? 1 : 0.45,
                  cursor: g.available ? "pointer" : "default",
                }}
              >
                <div
                  className="flex items-center justify-center rounded-xl"
                  style={{ width: 40, height: 40, background: `${g.accent}22` }}
                >
                  <Icon size={20} style={{ color: g.accent }} />
                </div>
                <div>
                  <div style={{ color: CREAM, fontWeight: 600 }} className="text-sm">{g.label}</div>
                  <div style={{ color: CREAM, opacity: 0.5 }} className="text-xs mt-0.5 leading-snug">{g.desc}</div>
                </div>
                {!g.available && (
                  <span style={{ color: CREAM, opacity: 0.35 }} className="text-[10px] font-semibold uppercase tracking-wide">
                    Coming soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
