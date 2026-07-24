import { useEffect, useState } from "react";
import { Star, Flame, Trophy } from "lucide-react";

const CONFETTI = ["⭐","✨","🎉","💫","🏆","🎊"];

export default function PointsToast({ reward }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!reward || (reward.points_awarded == null && !reward.completed)) {
      setVisible(false);
      return undefined;
    }

    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 3600);
    return () => clearTimeout(timer);
  }, [reward]);

  if (!visible || !reward || (reward.points_awarded == null && !reward.completed)) return null;
  const hasPoints = Number.isFinite(Number(reward.points_awarded));
  const noPoints = reward.points_awarded === 0;

  return (
    <div style={{ position: "fixed", inset: 0, overflow:"hidden", pointerEvents: "none", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding:16 }}>
      <style>{`
        @keyframes pointsPop{0%{opacity:0;transform:scale(.72)}65%{transform:scale(1.06)}100%{opacity:1;transform:none}}
        @keyframes celebrationFall{0%{opacity:0;transform:translate3d(0,-12vh,0) rotate(0)}12%{opacity:1}100%{opacity:0;transform:translate3d(var(--drift),105vh,0) rotate(560deg)}}
      `}</style>
      {Array.from({ length:24 }, (_, index) => (
        <span key={index} aria-hidden="true" style={{
          position:"absolute",
          top:"-8vh",
          left:`${3 + ((index * 41) % 94)}%`,
          fontSize:`${17 + (index % 4) * 5}px`,
          "--drift":`${(index % 2 ? 1 : -1) * (18 + (index % 5) * 8)}px`,
          animation:`celebrationFall ${1.8 + (index % 6) * .22}s linear ${(index % 8) * .08}s both`,
        }}>{CONFETTI[index % CONFETTI.length]}</span>
      ))}
      <div className="rounded-3xl px-6 py-5 shadow-xl" style={{ background: "rgba(255,255,255,0.97)", border: "1px solid rgba(16,24,40,0.1)", minWidth: 250, textAlign: "center", animation: "pointsPop .42s cubic-bezier(.34,1.56,.64,1)" }}>
        <div className="text-3xl mb-1">🎉</div>
        <div className="text-sm font-bold mb-2" style={{ color:"#1B2129" }}>Puzzle complete!</div>
        {!hasPoints ? (
          <div style={{ color: "#1B2129", opacity:.62 }} className="text-xs font-medium">Nice solve — keep it going!</div>
        ) : noPoints ? (
          <div style={{ color: "#1B2129", opacity:.62 }} className="text-xs font-medium">Daily practice points limit reached</div>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2" style={{ color: "#D9AE58" }}><Star size={22} fill="currentColor"/><span className="text-2xl font-bold">+{reward.points_awarded} Points</span></div>
            <div className="flex items-center justify-center gap-4 mt-2 text-xs" style={{ color: "#1B2129", opacity: .65 }}>
              <span className="flex items-center gap-1"><Flame size={14}/>{reward.streak || 0} day streak</span>
              <span className="flex items-center gap-1"><Trophy size={14}/>Level {reward.level || 1}</span>
            </div>
            {reward.level_up && <div className="mt-2 text-xs font-bold" style={{ color: "#16A34A" }}>Level up!</div>}
          </>
        )}
      </div>
    </div>
  );
}
