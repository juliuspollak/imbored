import { createPortal } from "react-dom";
import { RefreshCw, X } from "lucide-react";
import { GAME_NAMES } from "./lib/gameBranding.jsx";
import { openPuzzlePractice } from "./lib/puzzleSharing.js";
import { supabase, supabaseReady } from "./lib/supabase.js";

const RESULT_FIELDS = "id,game,challenge_date,seconds,mistakes,hints,correct_count,total_count,wasted_moves,expected_moves,zip_backtracked_cells,zip_required_moves,completed_at,seed";

export async function fetchCurrentUserChallengeResult({ userId, game, challengeDate, circleChallengeId = undefined }) {
  if (!supabaseReady || !userId || !game || !challengeDate) return { data:null, error:new Error("This result cannot be reopened right now.") };
  let query = supabase.from("game_stats").select(RESULT_FIELDS)
    .eq("user_id", userId).eq("mode", "challenge").eq("game", game).eq("challenge_date", challengeDate);
  if (circleChallengeId === null) query = query.is("circle_challenge_id", null);
  else if (circleChallengeId !== undefined) query = query.eq("circle_challenge_id", circleChallengeId);
  return query.order("completed_at", { ascending:false }).limit(1).maybeSingle();
}

export default function ChallengeResultDialog({ result, onClose }) {
  if (!result || typeof document === "undefined") return null;
  const gameName = GAME_NAMES[result.game] || result.game;
  const seconds = Number(result.seconds);
  const mistakes = Math.max(0, Number(result.mistakes) || 0);
  const hints = Math.max(0, Number(result.hints) || 0);
  const accuracy = Number(result.total_count) > 0 ? Math.round((Math.max(0, Number(result.correct_count) || 0) / Number(result.total_count)) * 100) : null;

  return createPortal(<div role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} style={{ position:"fixed", zIndex:1000, inset:0, display:"flex", alignItems:"flex-end", justifyContent:"center", padding:"var(--space-3)", paddingBottom:"max(var(--space-3), env(safe-area-inset-bottom))", background:"rgba(0,0,0,.42)", overscrollBehavior:"contain" }}>
    <section role="dialog" aria-modal="true" aria-label={`${gameName} completed result`} style={{ width:"min(100%,430px)", maxHeight:"85dvh", overflow:"auto", border:"1px solid var(--color-border)", borderRadius:"var(--radius-xl)", background:"var(--color-surface)", boxShadow:"var(--shadow-card)", padding:"var(--space-4)", WebkitOverflowScrolling:"touch", touchAction:"pan-y" }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:"var(--space-3)" }}>
        <div style={{ flex:1, minWidth:0 }}><p style={{ margin:0, color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)", fontWeight:700, textTransform:"uppercase", letterSpacing:".04em" }}>{result.isCurrentUser ? "Your completed game" : `${result.playerName}'s completed game`}</p><h3 style={{ margin:"3px 0 0", color:"var(--color-text-primary)", fontSize:20 }}>{gameName} · {result.score}</h3></div>
        <button type="button" onClick={onClose} aria-label="Close result" className="challenge-result-close" style={{ width:40, height:40, margin:"-3px -3px 0 0", display:"grid", placeItems:"center", flexShrink:0, border:0, borderRadius:"50%", background:"var(--color-surface-elevated)", color:"var(--color-text-secondary)", cursor:"pointer", touchAction:"manipulation" }}><X size={18} /></button>
      </div>
      {result.loading ? <p role="status" style={{ margin:"var(--space-4) 0", color:"var(--color-text-secondary)", fontSize:"var(--text-body-secondary-size)" }}>Opening your saved result…</p> : result.loadError ? <p role="status" style={{ margin:"var(--space-4) 0", color:"var(--color-danger-text)", fontSize:"var(--text-body-secondary-size)" }}>{result.loadError}</p> : <>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:"var(--space-2)", marginTop:"var(--space-4)" }}>
          <ResultFact label="Time" value={Number.isFinite(seconds) ? formatTime(seconds) : "—"} /><ResultFact label="Challenge score" value={result.score ?? "—"} /><ResultFact label="Mistakes" value={mistakes} /><ResultFact label="Hints" value={hints} />{accuracy !== null && <ResultFact label="Accuracy" value={`${accuracy}%`} />}
        </div>
        {result.isCurrentUser && <><div style={{ marginTop:"var(--space-4)", padding:"var(--space-3)", border:"1px solid var(--color-primary-subtle-border)", borderRadius:"var(--radius-md)", background:"var(--color-primary-subtle)" }}><p style={{ margin:0, color:"var(--color-text-primary)", fontSize:"var(--text-body-secondary-size)", fontWeight:700 }}>Your original Challenge result stays locked.</p><p style={{ margin:"4px 0 0", color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)", lineHeight:1.45 }}>Replaying opens the exact same puzzle as Practice, so it cannot replace or change this score.</p></div>
        <button type="button" onClick={() => openPuzzlePractice(result.id)} disabled={!result.id} className="challenge-result-replay" style={{ width:"100%", minHeight:44, marginTop:"var(--space-4)", display:"inline-flex", alignItems:"center", justifyContent:"center", gap:7, border:0, borderRadius:"var(--radius-full)", background:"var(--color-primary)", color:"var(--color-primary-text)", fontFamily:"inherit", fontSize:"var(--text-button-size)", fontWeight:800, cursor:result.id ? "pointer" : "default", opacity:result.id ? 1 : .5, touchAction:"manipulation" }}><RefreshCw size={16} /> Practise this game</button></>}
      </>}
    </section>
    <style>{`.challenge-result-close:focus-visible,.challenge-result-replay:focus-visible{outline:2px solid var(--color-primary);outline-offset:-2px}@media (hover:hover) and (pointer:fine){.challenge-result-close:hover{background:var(--color-surface)!important}}`}</style>
  </div>, document.body);
}

function ResultFact({ label, value }) {
  return <div style={{ minHeight:58, padding:"var(--space-2) var(--space-3)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-md)", background:"var(--color-surface-elevated)" }}><span style={{ display:"block", color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)" }}>{label}</span><strong style={{ display:"block", marginTop:3, color:"var(--color-text-primary)", fontSize:"var(--text-body-size)", fontVariantNumeric:"tabular-nums" }}>{value}</strong></div>;
}

function formatTime(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
