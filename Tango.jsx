import { useEffect, useState } from "react";

const EMOJI = ["🎉", "✨", "🎊", "⭐", "💥", "🔥"];

export default function PokeOverlay({ poke, onDismiss }) {
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    if (!poke) return;
    setParticles(
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        emoji: EMOJI[Math.floor(Math.random() * EMOJI.length)],
        left: Math.random() * 100,
        delay: Math.random() * 0.4,
        duration: 1.4 + Math.random() * 0.8,
        size: 16 + Math.random() * 14,
      }))
    );
    const t = setTimeout(onDismiss, 3200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poke]);

  if (!poke) return null;

  return (
    <div
      onClick={onDismiss}
      style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
    >
      <style>{`
        @keyframes pokeFall {
          0% { transform: translateY(-40px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0; }
        }
        @keyframes pokePopIn {
          0% { transform: scale(0.5) translateY(10px); opacity: 0; }
          60% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>

      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            position: "fixed",
            top: 0,
            left: `${p.left}%`,
            fontSize: p.size,
            animation: `pokeFall ${p.duration}s ease-in ${p.delay}s forwards`,
            pointerEvents: "none",
          }}
        >
          {p.emoji}
        </span>
      ))}

      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 20,
          padding: "20px 28px",
          boxShadow: "0 20px 50px rgba(16,24,40,0.25)",
          animation: "pokePopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
          maxWidth: 300,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1B2129" }}>{poke.message}</div>
        <div style={{ fontSize: 11, color: "#1B2129", opacity: 0.4, marginTop: 6 }}>tap to dismiss</div>
      </div>
    </div>
  );
}
