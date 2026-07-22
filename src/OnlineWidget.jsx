import { useState } from "react";
import { Users } from "lucide-react";
import { GAME_META } from "./Home.jsx";

const PANEL = "#FFFFFF";
const CREAM = "#1B2129";
const GREEN = "#22C55E";

export default function OnlineWidget({ players, userId }) {
  const [open, setOpen] = useState(false);
  if (players.length === 0) return null;

  const me = players.find((p) => p.user_id === userId);
  const others = players.filter((p) => p.user_id !== userId);

  return (
    <div style={{ position: "fixed", top: 16, left: 16, zIndex: 50 }}>
      <style>{`
        @keyframes onlineRingSpin { to { transform: rotate(360deg); } }
        .online-ring { animation: onlineRingSpin 3s linear infinite; }
      `}</style>

      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center justify-center"
        style={{ width: 44, height: 44 }}
        aria-label="Who's online"
      >
        <div
          className="online-ring absolute inset-0 rounded-full"
          style={{ background: `conic-gradient(from 0deg, ${GREEN}, #BBF7D0, ${GREEN})` }}
        />
        <div
          className="absolute rounded-full flex items-center justify-center"
          style={{ inset: 3, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(6px)" }}
        >
          <Users size={16} style={{ color: CREAM }} />
        </div>
        <div
          className="absolute flex items-center justify-center rounded-full"
          style={{
            top: -4, right: -4, minWidth: 18, height: 18, padding: "0 4px",
            background: GREEN, color: "#FFFFFF", fontSize: 10, fontWeight: 700,
            border: "2px solid #F1F3F7",
          }}
        >
          {players.length}
        </div>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-2 rounded-2xl p-3 w-64"
          style={{ background: PANEL, border: "1px solid rgba(16,24,40,0.09)", boxShadow: "0 12px 30px rgba(16,24,40,0.14)" }}
        >
          <div style={{ color: CREAM, opacity: 0.5 }} className="text-[10px] font-semibold uppercase tracking-wide mb-2">
            {players.length} online now
          </div>
          <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
            {me && <PlayerRow p={me} isMe />}
            {others.map((p, i) => (
              <PlayerRow key={i} p={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerRow({ p, isMe }) {
  const meta = GAME_META.find((g) => g.id === p.game);
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: isMe ? "rgba(47,111,237,0.08)" : "rgba(16,24,40,0.03)" }}>
      <span style={{ fontSize: 15 }}>{p.profiles?.icon || "🙂"}</span>
      <div className="flex-1 min-w-0">
        <div style={{ color: CREAM, fontWeight: 600 }} className="text-xs truncate">
          {isMe ? "You" : p.profiles?.name || "Someone"}
        </div>
        <div style={{ color: meta ? meta.accent : CREAM, opacity: meta ? 1 : 0.4 }} className="text-[10px] truncate">
          {meta ? `playing ${meta.label}` : "browsing"}
          {p.profiles?.mood ? ` · ${p.profiles.mood}` : ""}
        </div>
      </div>
    </div>
  );
}
