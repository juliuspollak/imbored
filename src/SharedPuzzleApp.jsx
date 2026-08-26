import { lazy, Suspense, useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./lib/AuthContext.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { saveStats } from "./lib/saveStats.js";
import { useGameConfig } from "./lib/useGameConfig.js";
import GameHomeButton from "./GameHomeButton.jsx";
import { GAME_NAMES } from "./lib/gameBranding.jsx";
import { exitReplayToHome } from "./lib/replayNavigation.js";

const GAMES = {
  hive: { Component:lazy(() => import("./games/Hive.jsx")), label:"Hive" },
  binary: { Component:lazy(() => import("./games/Binary.jsx")), label:GAME_NAMES.binary },
  gridly: { Component:lazy(() => import("./games/Gridly.jsx")), label:"Gridly" },
  minisudoku: { Component:lazy(() => import("./games/MiniSudoku.jsx")), label:"Sudoku" },
  geo: { Component:lazy(() => import("./games/Geo.jsx")), label:"Geo" },
  zoom: { Component:lazy(() => import("./games/Zoom.jsx")), label:"Zoom" },
};

function goHome() { if (typeof window !== "undefined") exitReplayToHome(window); }

function Message({ children }) {
  return (
    <div style={{ minHeight:"100dvh", display:"grid", placeItems:"center", background:"var(--color-page-bg)", padding:24 }}>
      <div style={{ width:"min(100%,380px)", textAlign:"center", background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-xl)", padding:24, boxShadow:"var(--shadow-card)" }}>
        {children}
      </div>
    </div>
  );
}

function SharedPuzzleInner({ statId }) {
  const { loading, user } = useAuth();
  const { config:gameConfig } = useGameConfig();
  const [puzzle, setPuzzle] = useState(null);
  const [error, setError] = useState("");
  const [savedStatId, setSavedStatId] = useState(null);
  const [rewardResult, setRewardResult] = useState(null);

  useEffect(() => {
    if (loading || !user?.id || !supabaseReady) return;
    let cancelled = false;
    setError("");
    supabase.rpc("get_replayable_puzzle", { target_stat_id:Number(statId) })
      .then(({ data,error:loadError }) => {
        if (cancelled) return;
        if (loadError || !data) {
          setError(loadError?.message || "This shared puzzle is no longer available.");
          return;
        }
        setPuzzle(data);
      });
    return () => { cancelled = true; };
  }, [loading, user?.id, statId]);

  if (loading) return <Message><p style={{ margin:0, color:"var(--color-text-secondary)" }}>Opening puzzle…</p></Message>;
  if (!user?.id) {
    return (
      <Message>
        <div style={{ fontSize:34, marginBottom:8 }}>🧩</div>
        <h1 style={{ margin:"0 0 7px", fontSize:20 }}>Sign in to play this puzzle</h1>
        <p style={{ margin:"0 0 16px", color:"var(--color-text-secondary)", fontSize:13 }}>Shared puzzles are available to the circle members they were sent to.</p>
        <button type="button" onClick={goHome} style={{ border:0, borderRadius:999, padding:"10px 16px", background:"var(--color-primary)", color:"var(--color-primary-text)", fontWeight:800 }}>Go to ImBored</button>
      </Message>
    );
  }
  if (error) {
    return (
      <Message>
        <div style={{ fontSize:34, marginBottom:8 }}>🧩</div>
        <h1 style={{ margin:"0 0 7px", fontSize:20 }}>Puzzle unavailable</h1>
        <p style={{ margin:"0 0 16px", color:"var(--color-text-secondary)", fontSize:13 }}>{error}</p>
        <button type="button" onClick={goHome} style={{ border:0, borderRadius:999, padding:"10px 16px", background:"var(--color-primary)", color:"var(--color-primary-text)", fontWeight:800 }}>Back home</button>
      </Message>
    );
  }
  if (!puzzle) return <Message><p style={{ margin:0, color:"var(--color-text-secondary)" }}>Loading the exact puzzle…</p></Message>;

  const game = GAMES[puzzle.game];
  if (!game) return <Message><p style={{ margin:0 }}>This game cannot be replayed yet.</p></Message>;
  const Current = game.Component;

  async function handleSolved(stats) {
    setSavedStatId(null);
    const saved = await saveStats({
      ...stats,
      mode:"practice",
      challengeDate:null,
      circleChallengeId:null,
      circleId:null,
    });
    if (saved?.data) {
      setSavedStatId(saved.data.id);
      setRewardResult(saved.rewardError
        ? { completed:true,error:true,message:saved.rewardError.message,eventId:Date.now() }
        : { ...(saved.reward || {}),completed:true,eventId:Date.now() });
    } else {
      setRewardResult({ completed:true,error:true,message:saved?.error?.message || "Your practice result could not be saved.",eventId:Date.now() });
    }
    return saved;
  }

  return (
    <div style={{ position:"relative", minHeight:"100dvh", background:"var(--color-page-bg)" }}>
      <GameHomeButton onClick={goHome} />
      <div style={{ position:"fixed", zIndex:125, top:"max(calc(env(safe-area-inset-top) + 12px), 12px)", left:"50%", transform:"translateX(-50%)", pointerEvents:"none" }}>
        <div style={{ borderRadius:999, padding:"7px 12px", background:"var(--color-surface-raised)", border:"1px solid var(--color-primary-subtle-border)", boxShadow:"var(--shadow-control)", color:"var(--color-primary)", fontSize:11, fontWeight:900, whiteSpace:"nowrap" }}>
          Practice replay · same {game.label} puzzle
        </div>
      </div>
      <Suspense fallback={<Message><p style={{ margin:0, color:"var(--color-text-secondary)" }}>Building the puzzle…</p></Message>}>
        <Current
          userId={user.id}
          onSolved={handleSolved}
          mode="challenge"
          forcedDayIdx={Number(puzzle.day_index)}
          seed={puzzle.seed}
          hintCooldownConfig={gameConfig?.[puzzle.game]}
          savedStatId={savedStatId}
          rewardResult={rewardResult}
          initialSeconds={0}
        />
      </Suspense>
    </div>
  );
}

export default function SharedPuzzleApp({ statId }) {
  return (
    <AuthProvider>
      <SharedPuzzleInner statId={statId} />
    </AuthProvider>
  );
}
