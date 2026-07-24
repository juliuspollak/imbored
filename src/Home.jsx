import { useEffect, useState } from "react";
import { Crown, Moon, Waypoints, Target, ArrowUpDown, Grid3x3, Puzzle, Waves, Circle, Check, Star, Flame, ChevronRight, ChevronDown, Globe2, Users, X } from "lucide-react";
import { useGameConfig } from "./lib/useGameConfig.js";
import { useTodayCompletions } from "./lib/useTodayCompletions.js";
import { supabase, supabaseReady } from "./lib/supabase.js";

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
  { id: "geo", label: "Geo", desc: "Capitals, landmarks & wildlife by continent", icon: Globe2, accent: "#DB2777", available: true },
];

export default function Home({ onSelect, playMode, onPlayModeChange, players = [], userId, onOpenProgress, onOpenTeams, challengeScope, onChallengeScopeChange }) {
  const { config: gameConfig, loading: gameConfigLoading } = useGameConfig();
  const todayCompletions = useTodayCompletions(playMode === "challenge" ? userId : undefined, challengeScope);
  const [progress, setProgress] = useState(null);
  const [teamChallenges, setTeamChallenges] = useState([]);
  const [teamRosters, setTeamRosters] = useState({});
  const [scopePickerOpen, setScopePickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadTeamChallenges() {
      if (!supabaseReady || !userId || playMode !== "challenge") return;
      const { data } = await supabase.rpc("get_my_active_team_challenges");
      const challenges = data || [];
      if (cancelled) return;
      setTeamChallenges(challenges);
      if (challenges.length > 0) {
        const teamIds = challenges.map((item) => item.team_id);
        const { data: rosterData } = await supabase
          .from("team_members")
          .select("team_id,user_id,profiles(name,icon)")
          .in("team_id", teamIds);
        if (!cancelled) {
          const grouped = {};
          (rosterData || []).forEach((member) => {
            if (!grouped[member.team_id]) grouped[member.team_id] = [];
            if (member.profiles) grouped[member.team_id].push({ id:member.user_id, ...member.profiles });
          });
          setTeamRosters(grouped);
        }
      } else {
        setTeamRosters({});
      }
    }
    loadTeamChallenges();
    return () => { cancelled = true; };
  }, [userId, playMode]);

  useEffect(() => {
    let cancelled = false;
    async function loadProgress() {
      if (!supabaseReady || !userId) return;
      await supabase.rpc("ensure_player_progress", { uid: userId });
      const { data } = await supabase
        .from("player_progress")
        .select("available_points,current_streak")
        .eq("player_id", userId)
        .maybeSingle();
      if (!cancelled) setProgress(data);
    }
    loadProgress();
    return () => { cancelled = true; };
  }, [userId]);

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
        .filter((g) => g.visible && (playMode !== "challenge" || challengeScope?.type !== "team" || (challengeScope.gameIds || []).includes(g.id)))
        .sort((a, b) => a.sortOrder - b.sortOrder);
  const selectedTeam = challengeScope?.type === "team"
    ? teamChallenges.find((item) => item.challenge_id === challengeScope.id)
    : null;
  const selectedRoster = selectedTeam ? teamRosters[selectedTeam.team_id] || [] : [];

  function choosePersonalChallenge() {
    onChallengeScopeChange({ type:"personal",id:null,name:"My Challenge",gameIds:null });
    setScopePickerOpen(false);
  }

  function chooseTeamChallenge(teamChallenge) {
    if (!teamChallenge.active_today) return;
    onChallengeScopeChange({
      type:"team",
      id:teamChallenge.challenge_id,
      teamId:teamChallenge.team_id,
      name:teamChallenge.team_name,
      emoji:teamChallenge.team_emoji,
      gameIds:teamChallenge.game_ids,
      rewardPoints:teamChallenge.reward_points,
      activeDays:teamChallenge.active_days,
    });
    setScopePickerOpen(false);
  }

  return (
    <div style={{ background: BG, minHeight: "100vh" }} className="flex items-start justify-center p-4 pt-10 sm:pt-16">
      <style>{`
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

        {progress && onOpenProgress && (
          <button
            onClick={onOpenProgress}
            className="mx-auto mb-5 flex items-center gap-4 rounded-2xl px-4 py-3"
            style={{
              background: PANEL,
              border: "1px solid rgba(16,24,40,0.09)",
              boxShadow: "0 6px 20px rgba(16,24,40,0.07)",
              color: CREAM,
            }}
            aria-label="Open My Progress"
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Star size={17} fill="currentColor" style={{ color: "#D9AE58" }} />
              {(progress.available_points || 0).toLocaleString()} Points
            </span>
            <span className="h-5 w-px" style={{ background: "rgba(16,24,40,0.10)" }} />
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Flame size={17} style={{ color: "#E05A47" }} />
              {progress.current_streak || 0} day{progress.current_streak === 1 ? "" : "s"}
            </span>
            <ChevronRight size={16} style={{ opacity: 0.35 }} />
          </button>
        )}

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
        {playMode === "challenge" && onChallengeScopeChange && (
          <div className="mb-6">
            <div className="text-xs font-semibold mb-2" style={{ color:CREAM }}>Today’s challenge</div>
            <div className="rounded-3xl p-3 flex items-center gap-3" style={{ background:PANEL,border:"1px solid rgba(16,24,40,.09)",boxShadow:"0 10px 28px rgba(16,24,40,.07)" }}>
              <button onClick={() => setScopePickerOpen(true)} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                <div className="grid place-items-center rounded-2xl text-2xl" style={{ width:46,height:46,background:selectedTeam ? "rgba(18,148,106,.10)" : "rgba(47,111,237,.10)" }}>{selectedTeam?.team_emoji || "🎯"}</div>
                <div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{selectedTeam?.team_name || "My Challenge"}</div><div className="text-[11px] opacity-45">{selectedTeam ? `${selectedTeam.game_ids?.length || 0} games · ${selectedTeam.reward_points || 0} pts` : "All daily games"}</div>{selectedTeam && <div className="flex items-center mt-1"><div className="flex">{selectedRoster.slice(0,4).map((member,index) => <span key={member.id} className="grid place-items-center rounded-full text-[10px]" style={{ width:21,height:21,background:"#F1F3F7",border:"2px solid white",marginLeft:index ? -5 : 0 }}>{member.icon || "🙂"}</span>)}</div><span className="text-[9px] opacity-40 ml-1.5">{selectedRoster.length} playing</span></div>}</div>
                <ChevronDown size={16} style={{ opacity:.35 }}/>
              </button>
              {selectedTeam && onOpenTeams && <><span className="h-9 w-px" style={{ background:"rgba(16,24,40,.08)" }}/><button onClick={onOpenTeams} className="grid place-items-center rounded-full" style={{ width:38,height:38,background:"rgba(18,148,106,.09)",color:"#0B7C58" }} aria-label="Open team details"><Users size={16}/></button></>}
            </div>
          </div>
        )}

        {gameConfigLoading ? (
          <p style={{ color: CREAM, opacity: 0.3 }} className="text-xs text-center py-8">Loading…</p>
        ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {visibleGames.map((g) => {
            const Icon = g.icon;
            const playingCount = players.filter((p) => p.game === g.id && p.mode === playMode).length;
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
      {scopePickerOpen && <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background:"rgba(16,24,40,.42)" }}><div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl p-4" style={{ background:"#fff",maxHeight:"82vh",overflow:"auto" }}><div className="flex items-center gap-3 mb-3"><div className="flex-1"><div className="font-bold">Choose a challenge</div><div className="text-[11px] opacity-45">Personal or one of your teams</div></div><button onClick={() => setScopePickerOpen(false)} className="grid place-items-center rounded-full" style={{ width:32,height:32,background:"rgba(16,24,40,.05)" }}><X size={15}/></button></div><button onClick={choosePersonalChallenge} className="w-full flex items-center gap-3 rounded-2xl p-3 text-left mb-2" style={{ background:challengeScope?.type !== "team" ? "rgba(47,111,237,.10)" : "#F7F8FB",border:challengeScope?.type !== "team" ? "1px solid rgba(47,111,237,.25)" : "1px solid transparent" }}><span className="grid place-items-center rounded-xl text-xl" style={{ width:42,height:42,background:"#fff" }}>🎯</span><div className="flex-1"><div className="text-sm font-semibold">My Challenge</div><div className="text-[10px] opacity-45">All daily games</div></div>{challengeScope?.type !== "team" && <Check size={15} style={{ color:"#2F6FED" }}/>}</button>{teamChallenges.map((teamChallenge) => { const roster=teamRosters[teamChallenge.team_id] || [];const selected=challengeScope?.id === teamChallenge.challenge_id;return <button key={teamChallenge.challenge_id} disabled={!teamChallenge.active_today} onClick={() => chooseTeamChallenge(teamChallenge)} className="w-full flex items-center gap-3 rounded-2xl p-3 text-left mb-2 disabled:opacity-45" style={{ background:selected ? "rgba(18,148,106,.10)" : "#F7F8FB",border:selected ? "1px solid rgba(18,148,106,.25)" : "1px solid transparent" }}><span className="grid place-items-center rounded-xl text-xl" style={{ width:42,height:42,background:"#fff" }}>{teamChallenge.team_emoji || "⭐"}</span><div className="flex-1 min-w-0"><div className="text-sm font-semibold truncate">{teamChallenge.team_name}</div><div className="text-[10px] opacity-45">{teamChallenge.game_ids?.length || 0} games · {teamChallenge.reward_points || 0} pts{!teamChallenge.active_today ? " · Not today" : ""}</div><div className="flex items-center mt-1"><div className="flex">{roster.slice(0,4).map((member,index) => <span key={member.id} className="grid place-items-center rounded-full text-[9px]" style={{ width:19,height:19,background:"#fff",border:"1.5px solid #F7F8FB",marginLeft:index ? -4 : 0 }}>{member.icon || "🙂"}</span>)}</div><span className="text-[9px] opacity-40 ml-1.5">{roster.length} member{roster.length === 1 ? "" : "s"}</span></div></div>{selected && <Check size={15} style={{ color:"#0B7C58" }}/>}</button>; })}{onOpenTeams && <button onClick={() => { setScopePickerOpen(false);onOpenTeams(); }} className="w-full rounded-full py-2.5 mt-2 text-xs font-semibold flex items-center justify-center gap-1.5" style={{ background:"rgba(16,24,40,.05)" }}><Users size={14}/>Manage teams</button>}</div></div>}
    </div>
  );
}
