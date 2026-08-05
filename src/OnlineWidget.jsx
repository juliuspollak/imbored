import { useState, useEffect } from "react";
import { Users } from "lucide-react";
import { GAME_META } from "./Home.jsx";
import { sendPoke } from "./lib/pokes.js";

const PANEL = "var(--color-surface)";
const TEXT = "var(--color-text-primary)";
const GREEN = "var(--color-success-text)";

export default function OnlineWidget({ players, userId, myName, onOpenChat, unreadBySender = {} }) {
  const [open, setOpen] = useState(false);
  const [poked, setPoked] = useState(null); // id of the player just poked, for a quick confirm flash

  const others = players.filter((p) => p.user_id !== userId);

  // periodic little wiggle to draw the eye
  const shouldWiggle = others.length > 0;

  // "1 online = just me" isn't useful information — only show this at all
  // once someone else is actually around
  if (others.length === 0) return null;

  async function handlePoke(p) {
    const { error } = await sendPoke(userId, p.user_id, myName);
    if (error) return; // failed silently server-side (e.g. RLS) — no false "Poked!" confirmation
    setPoked(p.user_id);
    setTimeout(() => setPoked(null), 1200);
  }

  return (
    <div style={{ position: "relative" }}>
      <style>{`
        @keyframes onlineRingSpin { to { transform: rotate(360deg); } }
        .online-ring { animation: onlineRingSpin 3s linear infinite; }
        @keyframes onlineWiggle {
          0%, 92%, 100% { transform: rotate(0deg); }
          93% { transform: rotate(-8deg); }
          94% { transform: rotate(8deg); }
          95% { transform: rotate(-6deg); }
          96% { transform: rotate(6deg); }
          97% { transform: rotate(-3deg); }
          98% { transform: rotate(0deg); }
        }
        .online-wiggle { animation: onlineWiggle 6s ease-in-out infinite; }
        .online-btn {
          width: 32px;
          height: 32px;
          transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .online-btn-icon { width: 13px; height: 13px; }
        @media (max-width: 520px) {
          .online-btn { width: 44px; height: 44px; }
          .online-btn-icon { width: 18px; height: 18px; }
          .online-btn-count {
            top: -4px !important;
            right: -4px !important;
            min-width: 19px !important;
            height: 19px !important;
            padding: 0 4px !important;
            font-size: 10px !important;
            border-width: 2px !important;
          }
        }
        .online-btn:active { transform: scale(0.9); }
        @media (hover: hover) and (pointer: fine) {
          .online-btn:hover { transform: scale(1.08); }
        }
        @keyframes balloonPop {
          0% { transform: scale(0.4) translateY(-8px); opacity: 0; }
          60% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        .balloon { animation: balloonPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
      `}</style>

      <button
        onClick={() => setOpen((o) => !o)}
        className={`online-btn relative flex items-center justify-center ${shouldWiggle ? "online-wiggle" : ""}`}
        aria-label="Who's online"
      >
        <div className="online-ring absolute inset-0 rounded-full" style={{ background: `conic-gradient(from 0deg, ${GREEN}, var(--color-success-border), ${GREEN})` }} />
        <div className="absolute rounded-full flex items-center justify-center" style={{ inset: 2.5, background: PANEL }}>
          <Users className="online-btn-icon" style={{ color: TEXT }} />
        </div>
        <div
          className="online-btn-count absolute flex items-center justify-center rounded-full"
          style={{ top: -3, right: -3, minWidth: 15, height: 15, padding: "0 3px", background: GREEN, color: "var(--color-primary-text)", fontSize: 9, fontWeight: 700, border: "1.5px solid var(--color-page-bg)" }}
        >
          {others.length}
        </div>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 flex flex-col items-end gap-1.5" style={{ zIndex: 60 }}>
          <div style={{ color: "var(--color-text-secondary)", background: PANEL, borderRadius: 999, padding: "2px 10px" }} className="text-[10px] font-semibold uppercase tracking-wide balloon">
            {others.length} online
          </div>
          {others.map((p, i) => {
              const meta = GAME_META.find((g) => g.id === p.game);
              const isPoked = poked === p.user_id;
              const unread = unreadBySender[p.user_id] || 0;
              return (
                <div
                  key={p.user_id || i}
                  className="balloon flex items-center rounded-full p-1"
                  style={{
                    animationDelay: `${i * 0.05}s`,
                    background: unread > 0 ? "var(--color-primary-subtle)" : PANEL,
                    boxShadow: "var(--shadow-menu)",
                    border: unread > 0 ? "1px solid var(--color-primary-subtle-border)" : "1px solid var(--color-border)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => { setOpen(false); onOpenChat?.(p); }}
                    className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 text-left"
                    style={{ border: 0, background: "transparent" }}
                    aria-label={`Chat with ${p.profiles?.name || "player"}`}
                  >
                    <span style={{ position: "relative", fontSize: 18 }}>
                      {p.profiles?.icon || "🙂"}
                      {unread > 0 && <span style={{ position:"absolute", top:-7, right:-9, minWidth:15, height:15, padding:"0 3px", borderRadius:999, display:"grid", placeItems:"center", background:"var(--color-primary)", color:"var(--color-primary-text)", fontSize:9, fontWeight:800 }}>{unread}</span>}
                    </span>
                    <div>
                      <div style={{ color: TEXT, fontWeight: 700 }} className="text-xs leading-tight">
                        {p.profiles?.name || "Someone"}
                      </div>
                      <div style={{ color: meta ? meta.accent : "var(--color-text-secondary)" }} className="text-[10px] leading-tight">
                        {unread > 0 ? `${unread} new message${unread === 1 ? "" : "s"}` : meta ? `playing ${meta.label}` : "tap to chat"}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePoke(p)}
                    title={`Poke ${p.profiles?.name || "player"}`}
                    aria-label={`Poke ${p.profiles?.name || "player"}`}
                    style={{ width:30, height:30, borderRadius:999, border:0, background:isPoked ? "var(--color-primary-subtle)" : "var(--color-surface-elevated)", color: "var(--color-text-primary)", fontSize:15 }}
                  >
                    {isPoked ? "✓" : "👋"}
                  </button>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
