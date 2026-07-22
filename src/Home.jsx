import { Crown, Moon, Waypoints, Target, ArrowUpDown, Grid3x3, Puzzle, Waves, Circle, Check } from "lucide-react";
import { useGameConfig } from "./lib/useGameConfig.js";
import { useTodayCompletions } from "./lib/useTodayCompletions.js";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const CREAM = "#1B2129";

export const GAME_META = [
  { id: "queens", label: "Queens", desc: "One crown per row, column & region", icon: Crown, accent: "#2F6FED", available: true },
  { id: "tango", label: "Tango", desc: "Balance sun & moon in every line", icon: Moon, accent: "#4A6FA5", available: true },
  { id: "zip", label: "Zip", desc: "Trace one path through every cell", icon: Waypoints, accent: "#12946A", available: true },
  { id: "pinpoint", label: "Pinpoint", desc: "Guess the category from five clues", icon: Target, accent: "#8B5CF6", available: false },
  { id: "crossclimb", label: "Crossclimb", desc: "Solve the word ladder", icon: ArrowUpDown, accent: "#EA580C", available: false },
  { id: "minisudoku", label: "Mini Sudoku", desc: "Classic sudoku, bite-sized", icon: Grid3x3, accent: "#0E7490", available: true },
  { id: "patches", label: "Patches", desc: "Fit every shape into the frame", icon: Puzzle, accent: "#B45309", available: false },
  { id: "wend", label: "Wend", desc: "Weave hidden words through the grid", icon: Waves, accent: "#0EA5E9", available: false },
];

export default function Home({ onSelect, playMode, onPlayModeChange, players = [], userId }) {
  const { config: gameConfig, loading: gameConfigLoading } = useGameConfig();
  const todayCompletions = useTodayCompletions(playMode === "challenge" ? userId : undefined);

  // While the config is still loading, don't assume "no config yet" means
  // "nothing is hidden" — that's exactly what caused hidden games to flash
  // visible for a moment on every page load. Show nothing until we
  // actually know.
  const visibleGames = gameConfigLoading
    ? []
    : GAME_META
        .map((g, i) => {
          const cfg = gameConfig?.[g.id];
          return {
            ...g,
            available: cfg ? cfg.available : g.available,
            visible: cfg ? cfg.visible : true,
            sortOrder: cfg ? cfg.sort_order : i,
          };
        })
        .filter((g) => g.visible)
        .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div style={{ background: BG, minHeight: "100vh" }} className="flex items-start justify-center p-4 pt-10 sm:pt-16">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        @media (hover: hover) and (pointer: fine) {
          .home-tile:not(:disabled):hover { transform: translateY(-2px); filter: brightness(1.08); }
        }
        .home-tile { transition: transform 0.15s ease, filter 0.15s ease; }
      `}</style>
      <div className="w-full max-w-2xl" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="text-center mb-6">
          <h1
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: CREAM, letterSpacing: "-0.01em" }}
            className="text-5xl"
          >
            I'mBoredToday
          </h1>
          <p style={{ color: CREAM, opacity: 0.45 }} className="text-sm mt-2">
            new puzzles every day &mdash; Monday easiest, Sunday hardest
          </p>
        </div>

        {onPlayModeChange && (
          <div className="flex justify-center mb-6">
            <div className="inline-flex rounded-full p-1" style={{ background: "rgba(16,24,40,0.06)" }}>
              {["challenge", "practice"].map((m) => (
                <button
                  key={m}
                  onClick={() => onPlayModeChange(m)}
                  className="rounded-full px-4 py-1.5 text-xs font-semibold capitalize"
                  style={{
                    background: playMode === m ? PANEL : "transparent",
                    color: playMode === m ? CREAM : "rgba(27,33,41,0.5)",
                    boxShadow: playMode === m ? "0 2px 8px rgba(16,24,40,0.10)" : "none",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
        <p style={{ color: CREAM, opacity: 0.4 }} className="text-[11px] text-center -mt-4 mb-6">
          {playMode === "challenge"
            ? "one attempt a day, same puzzle for everyone — today only"
            : "any day, unlimited puzzles — nothing saved to your stats"}
        </p>

        {gameConfigLoading ? (
          <p style={{ color: CREAM, opacity: 0.3 }} className="text-xs text-center py-8">Loading…</p>
        ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {visibleGames.map((g) => {
            const Icon = g.icon;
            const playingCount = players.filter((p) => p.game === g.id).length;
            return (
              <button
                key={g.id}
                disabled={!g.available}
                onClick={() => g.available && onSelect(g.id)}
                className="home-tile relative flex flex-col items-start gap-3 rounded-2xl p-4 text-left"
                style={{
                  background: PANEL,
                  border: "1px solid rgba(16,24,40,0.09)",
                  boxShadow: "0 6px 20px rgba(16,24,40,0.08)",
                  opacity: g.available ? 1 : 0.45,
                  cursor: g.available ? "pointer" : "default",
                }}
              >
                {todayCompletions.has(g.id) && (
                  <span
                    className="absolute top-3 left-3 flex items-center justify-center rounded-full"
                    style={{ width: 18, height: 18, background: "rgba(47,111,237,0.12)" }}
                    title="Already played today"
                  >
                    <Check size={11} style={{ color: "#2F6FED" }} strokeWidth={3} />
                  </span>
                )}
                {playingCount > 0 && (
                  <span
                    className="absolute top-3 right-3 flex items-center gap-1 rounded-full px-1.5 py-0.5"
                    style={{ background: "rgba(34,197,94,0.12)" }}
                  >
                    <Circle size={5} fill="#22C55E" style={{ color: "#22C55E" }} />
                    <span style={{ color: "#16A34A", fontWeight: 700 }} className="text-[10px]">{playingCount}</span>
                  </span>
                )}
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
        )}
      </div>
    </div>
  );
}
