import { useEffect } from "react";
import { Star, Flame, Trophy } from "lucide-react";

export default function PointsToast({ reward, onDone }) {
  useEffect(() => {
    if (!reward) return;
    const timer = setTimeout(() => onDone?.(), 3200);
    return () => clearTimeout(timer);
  }, [reward, onDone]);

  if (!reward || reward.points_awarded == null) return null;
  const noPoints = reward.points_awarded === 0;
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 72 }}>
      <div className="rounded-2xl px-5 py-4 shadow-xl" style={{ background: "rgba(255,255,255,0.96)", border: "1px solid rgba(16,24,40,0.1)", minWidth: 230, textAlign: "center", animation: "pointsPop .3s cubic-bezier(.34,1.56,.64,1)" }}>
        <style>{`@keyframes pointsPop{from{opacity:0;transform:translateY(-12px) scale(.85)}to{opacity:1;transform:none}}`}</style>
        {noPoints ? (
          <div style={{ color: "#1B2129" }} className="text-sm font-semibold">Daily practice points limit reached</div>
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
