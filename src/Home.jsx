import { useEffect, useRef, useState } from "react";
import { Crown, Moon, Waypoints, Target, ArrowUpDown, Grid3x3, Puzzle, Waves, Circle, Check, Star, Flame, ChevronRight, ChevronDown, Globe2, Users, ZoomIn } from "lucide-react";
import { useGameConfig } from "./lib/useGameConfig.js";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useI18n } from "./lib/i18n.jsx";
import { challengeProgress, groupChallengeCompletions } from "./lib/challengeProgress.js";
import ChallengeStandings from "./ChallengeStandings.jsx";

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
  { id: "zoom", label: "Zoom", desc: "Narrow it down: continent, region, country", icon: ZoomIn, accent: "#7C3AED", available: true },
];

function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Home({ onSelect, playMode, onPlayModeChange, players = [], userId, onOpenProgress, onOpenTeams, challengeScope, onChallengeScopeChange }) {
  const { t, language } = useI18n();
  const { config: gameConfig, loading: gameConfigLoading } = useGameConfig();
  const [progress, setProgress] = useState(null);
  const [teamChallenges, setTeamChallenges] = useState([]);
  const [teamRosters, setTeamRosters] = useState({});
  const [challengeCompletions, setChallengeCompletions] = useState({ personal: new Set() });
  const [challengesLoaded, setChallengesLoaded] = useState(false);
  const [expandedChallengeId, setExpandedChallengeId] = useState(null);
  const [challengeRows, setChallengeRows] = useState([]);
  const [challengeProfiles, setChallengeProfiles] = useState({});
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [standingsRefreshing, setStandingsRefreshing] = useState(false);
  const standingsCacheRef = useRef({});

  useEffect(() => {
    let cancelled = false;
    async function loadTeamChallenges() {
      if (!supabaseReady || !userId) return;
      const [{ data }, { data: completionRows }, { data: rosterData }] = await Promise.all([
        supabase.rpc("get_my_active_team_challenges"),
        supabase
          .from("game_stats")
          .select("game,team_challenge_id")
          .eq("user_id", userId)
          .eq("mode", "challenge")
          .eq("challenge_date", todayString()),
        supabase.rpc("get_my_team_rosters"),
      ]);
      const challenges = data || [];
      if (cancelled) return;
      setTeamChallenges(challenges);
      setChallengesLoaded(true);
      setChallengeCompletions(groupChallengeCompletions(completionRows));
      if (challenges.length > 0) {
        const teamIds = new Set(challenges.map((item) => Number(item.team_id)));
        if (!cancelled) {
          const grouped = {};
          (rosterData || []).forEach((member) => {
            if (!teamIds.has(Number(member.team_id))) return;
            if (!grouped[member.team_id]) grouped[member.team_id] = [];
            grouped[member.team_id].push({
              id:member.user_id,
              name:member.member_name,
              icon:member.member_icon,
              show_stats_to_others:member.show_stats_to_others,
            });
          });
          setTeamRosters(grouped);
        }
      } else {
        setTeamRosters({});
      }
    }
    loadTeamChallenges();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    async function loadChallengeStandings() {
      if (!supabaseReady || !userId || playMode !== "challenge") {
        setChallengeRows([]);
        setChallengeProfiles({});
        setStandingsLoading(false);
        setStandingsRefreshing(false);
        return;
      }
      const cacheKey = challengeScope?.type === "team" ? `team:${challengeScope.id}` : "personal";
      const cached = standingsCacheRef.current[cacheKey];
      if (cached) {
        setChallengeRows(cached.rows);
        setChallengeProfiles(cached.profiles);
        setStandingsLoading(false);
        setStandingsRefreshing(true);
      } else {
        setStandingsLoading(true);
        setStandingsRefreshing(false);
        setChallengeRows([]);
        setChallengeProfiles({});
      }
      let query = supabase
        .from("game_stats")
        .select("user_id,game,seconds,mistakes,hints,completed_at,profiles(name,icon,show_stats_to_others)")
        .eq("mode", "challenge")
        .eq("challenge_date", todayString());
      query = challengeScope?.type === "team"
        ? query.eq("team_challenge_id", challengeScope.id)
        : query.is("team_challenge_id", null);
      let { data: resultRows, error } = await query;
      if (cancelled) return;

      let rows = resultRows || [];
      let profiles = rows.flatMap((row) => row.profiles ? [{ id:row.user_id, ...row.profiles }] : []);
      if (error) {
        let fallback = supabase
          .from("game_stats")
          .select("user_id,game,seconds,mistakes,hints,completed_at")
          .eq("mode", "challenge")
          .eq("challenge_date", todayString());
        fallback = challengeScope?.type === "team"
          ? fallback.eq("team_challenge_id", challengeScope.id)
          : fallback.is("team_challenge_id", null);
        const { data } = await fallback;
        if (cancelled) return;
        rows = data || [];
        const playerIds = [...new Set(rows.map((row) => row.user_id))];
        const profileResult = playerIds.length > 0 ? await supabase
          .from("profiles")
          .select("id,name,icon,show_stats_to_others")
          .in("id", playerIds) : { data:[] };
        profiles = profileResult.data || [];
      }
      if (!cancelled) {
        const profileMap = Object.fromEntries(profiles.map((profile) => [profile.id, profile]));
        standingsCacheRef.current[cacheKey] = { rows, profiles:profileMap };
        setChallengeRows(rows);
        setChallengeProfiles(profileMap);
        setStandingsLoading(false);
        setStandingsRefreshing(false);
      }
    }
    loadChallengeStandings();
    return () => { cancelled = true; };
  }, [userId, playMode, challengeScope?.type, challengeScope?.id]);

  useEffect(() => {
    if (!challengesLoaded || challengeScope?.type !== "team") return;
    const selected = teamChallenges.find((item) => item.challenge_id === challengeScope.id);
    if (!selected?.active_today) {
      onChallengeScopeChange?.({ type:"personal",id:null,name:"My Challenge",gameIds:null });
    }
  }, [challengeScope?.id, challengeScope?.type, challengesLoaded, onChallengeScopeChange, teamChallenges]);

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
  const configuredGames = gameConfigLoading
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
  const visibleGames = configuredGames
    .filter((g) => playMode !== "challenge" || challengeScope?.type !== "team" || (challengeScope.gameIds || []).includes(g.id));
  const personalGameIds = configuredGames.filter((game) => game.available).map((game) => game.id);
  const personalCompleted = challengeCompletions.personal || new Set();
  const challengeStatus = (teamChallenge) => {
    const gameIds = teamChallenge ? (teamChallenge.game_ids || []) : personalGameIds;
    const completed = teamChallenge
      ? challengeCompletions[String(teamChallenge.challenge_id)] || new Set()
      : personalCompleted;
    return challengeProgress(gameIds, completed);
  };
  const personalStatus = challengeStatus(null);
  const challengeItems = [
    { key:"personal", type:"personal", active_today:true, status:personalStatus },
    ...teamChallenges.map((item) => ({ ...item, key:String(item.challenge_id), type:"team", status:challengeStatus(item) })),
  ];
  const pendingChallenges = challengeItems.filter((item) => item.active_today && item.status.remaining > 0);
  const selectedTeam = challengeScope?.type === "team"
    ? teamChallenges.find((item) => item.challenge_id === challengeScope.id)
    : null;
  const todayCompletions = challengeScope?.type === "team"
    ? challengeCompletions[String(challengeScope.id)] || new Set()
    : personalCompleted;
  const selectedRoster = selectedTeam ? teamRosters[selectedTeam.team_id] || [] : [];
  const selectedChallengeGameIds = challengeScope?.type === "team"
    ? selectedTeam?.game_ids || challengeScope.gameIds || []
    : personalGameIds;
  const selectedChallengeGames = selectedChallengeGameIds
    .map((id) => configuredGames.find((game) => game.id === id) || GAME_META.find((game) => game.id === id))
    .filter(Boolean);
  const standingsRoster = challengeScope?.type === "team"
    ? selectedRoster
    : Object.values(challengeProfiles);

  function choosePersonalChallenge() {
    onChallengeScopeChange({ type:"personal",id:null,name:"My Challenge",gameIds:null });
    setExpandedChallengeId(null);
  }

  function chooseTeamChallenge(teamChallenge) {
    if (!teamChallenge.active_today) return;
    onChallengeScopeChange({
      type:"team",
      id:teamChallenge.challenge_id,
      teamId:teamChallenge.team_id,
      name:teamChallenge.challenge_title || teamChallenge.team_name,
      teamName:teamChallenge.team_name,
      challengeTitle:teamChallenge.challenge_title || "Weekly challenge",
      emoji:teamChallenge.team_emoji,
      gameIds:teamChallenge.game_ids,
      rewardPoints:teamChallenge.reward_points,
      activeDays:teamChallenge.active_days,
    });
  }

  return (
    <div style={{ background: BG, minHeight: "100vh" }} className="flex items-start justify-center p-4 pt-6 sm:pt-8">
      <style>{`
        @media (hover: hover) and (pointer: fine) {
          .home-tile:not(:disabled):hover { transform: translateY(-2px); filter: brightness(1.08); }
        }
        .home-tile { transition: transform 0.15s ease, filter 0.15s ease; }
      `}</style>
      <div className="w-full max-w-2xl" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="flex items-center gap-2 mb-2 pr-14">
          <span className="text-xl leading-none shrink-0" aria-hidden="true">🧩</span>
          <h1
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: CREAM, letterSpacing: "-0.01em" }}
            className="text-lg sm:text-xl truncate"
          >
            I'mBoredToday
          </h1>
        </div>

        {progress && onOpenProgress && (
          <button
            onClick={onOpenProgress}
            className="flex items-center gap-2 rounded-full pl-3 pr-2 py-1.5 mb-3"
            style={{
              background: PANEL,
              border: "1px solid rgba(16,24,40,0.09)",
              boxShadow: "0 4px 14px rgba(16,24,40,0.06)",
              color: CREAM,
            }}
            aria-label={`Open My Progress — ${(progress.available_points || 0).toLocaleString(language === "sk" ? "sk-SK" : "en")} ${t("home.points")}, ${progress.current_streak || 0} ${progress.current_streak === 1 ? t("home.day") : t("home.days")}`}
          >
            <span className="flex items-center gap-1 text-xs font-semibold whitespace-nowrap">
              <Star size={13} fill="currentColor" style={{ color: "#D9AE58" }} />
              {(progress.available_points || 0).toLocaleString(language === "sk" ? "sk-SK" : "en")}
            </span>
            <span className="h-3.5 w-px" style={{ background: "rgba(16,24,40,0.10)" }} />
            <span className="flex items-center gap-1 text-xs font-semibold whitespace-nowrap">
              <Flame size={13} style={{ color: "#E05A47" }} />
              {progress.current_streak || 0}
            </span>
            <ChevronRight size={13} style={{ opacity: 0.3 }} />
          </button>
        )}
        <p style={{ color: CREAM, opacity: 0.4 }} className="text-[11px] mb-4">
          {t("home.tagline")}
        </p>

        {onPlayModeChange && (
          <div className="flex justify-center mb-2">
            <div className="inline-flex rounded-full p-1" style={{ background: "rgba(16,24,40,0.06)" }}>
              {["challenge", "practice"].map((m) => (
                <button
                  key={m}
                  onClick={() => onPlayModeChange(m)}
                  className={`gloss-button rounded-full px-4 py-1.5 text-xs font-semibold capitalize ${playMode === m ? "" : "!bg-transparent !box-shadow-none !border-none"}`}
                  style={playMode === m ? {} : {
                    background: "transparent",
                    boxShadow: "none",
                    border: "none",
                    color: "rgba(27,33,41,0.5)",
                  }}
                >
                  {t(`common.${m}`)}
                  {m === "challenge" && pendingChallenges.length > 0 && (
                    <span
                      className="ml-1.5 inline-flex items-center justify-center rounded-full text-[9px]"
                      style={{ minWidth:17,height:17,padding:"0 5px",background:"#E5484D",color:"#fff" }}
                      aria-label={t("home.pendingChallenges", { count:pendingChallenges.length })}
                    >
                      {pendingChallenges.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        <p style={{ color: CREAM, opacity: 0.4 }} className="text-[11px] text-center mb-5">
          {playMode === "challenge"
            ? t("home.challengeHint")
            : t("home.practiceHint")}
        </p>
        {playMode === "challenge" && onChallengeScopeChange && (
          <div className="mb-6 rounded-3xl p-3" style={{ background:PANEL,border:"1px solid rgba(16,24,40,.09)",boxShadow:"0 8px 24px rgba(16,24,40,.06)" }}>
            <button
              type="button"
              onClick={choosePersonalChallenge}
              className="w-full flex items-center gap-3 rounded-2xl p-3 text-left"
              style={{
                background:challengeScope?.type !== "team" ? "rgba(47,111,237,.08)" : "transparent",
                border:challengeScope?.type !== "team" ? "1px solid rgba(47,111,237,.18)" : "1px solid transparent",
              }}
            >
              <span className="grid place-items-center rounded-xl text-xl shrink-0" style={{ width:42,height:42,background:"#F1F5FF" }}>🎯</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-bold">{t("home.myChallenge")}</span>
                  {challengeScope?.type !== "team" && <Check size={13} strokeWidth={3} style={{ color:"#2F6FED" }}/>}
                </span>
                <span className="block h-1.5 rounded-full mt-2 overflow-hidden" style={{ background:"rgba(16,24,40,.07)" }}>
                  <span className="block h-full rounded-full" style={{ width:`${personalStatus.total ? (personalStatus.completed / personalStatus.total) * 100 : 0}%`,background:personalStatus.done ? "#16A34A" : "#2F6FED" }}/>
                </span>
              </span>
              <span className="rounded-full px-2.5 py-1 text-[10px] font-bold shrink-0" style={{ background:personalStatus.done ? "rgba(22,163,74,.11)" : "rgba(47,111,237,.10)",color:personalStatus.done ? "#137A3A" : "#2F6FED" }}>
                {personalStatus.done ? t("home.done") : t("home.gamesLeft", { count:personalStatus.remaining })}
              </span>
            </button>

            {teamChallenges.length > 0 && (
              <div className="mt-3 pt-3" style={{ borderTop:"1px solid rgba(16,24,40,.07)" }}>
                <div className="flex items-center px-1 mb-2">
                  <span className="text-xs font-bold flex-1" style={{ color:CREAM }}>{t("home.teamChallenges")}</span>
                  <span className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background:"rgba(16,24,40,.05)",color:"rgba(27,33,41,.48)" }}>{teamChallenges.length}</span>
                </div>
                <div className="space-y-2">
                  {teamChallenges.map((item) => {
                    const status = challengeStatus(item);
                    const selected = challengeScope?.type === "team" && challengeScope.id === item.challenge_id;
                    const expanded = expandedChallengeId === item.challenge_id;
                    const roster = teamRosters[item.team_id] || [];
                    const games = (item.game_ids || [])
                      .map((id) => configuredGames.find((game) => game.id === id) || GAME_META.find((game) => game.id === id))
                      .filter(Boolean);
                    return (
                      <div key={item.challenge_id} className="rounded-2xl overflow-hidden" style={{ background:selected ? "rgba(18,148,106,.07)" : "#F7F8FB",border:selected ? "1px solid rgba(18,148,106,.19)" : "1px solid transparent" }}>
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedChallengeId(expanded ? null : item.challenge_id);
                            if (item.active_today) chooseTeamChallenge(item);
                          }}
                          className="w-full flex items-center gap-3 p-3 text-left"
                          aria-expanded={expanded}
                        >
                          <span className="grid place-items-center rounded-xl text-lg shrink-0" style={{ width:40,height:40,background:"#fff" }}>{item.team_emoji || "⭐"}</span>
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="text-xs font-bold truncate">{item.challenge_title || item.team_name}</span>
                              {selected && <Check size={12} strokeWidth={3} style={{ color:"#12946A" }}/>}
                            </span>
                            <span className="block text-[10px] mt-0.5 truncate" style={{ color:"rgba(27,33,41,.45)" }}>{item.team_name}</span>
                          </span>
                          <span className="text-[10px] font-bold shrink-0" style={{ color:!item.active_today ? "rgba(27,33,41,.38)" : status.done ? "#137A3A" : "#A9363B" }}>
                            {!item.active_today ? t("home.notToday") : status.done ? t("home.done") : t("home.gamesLeft", { count:status.remaining })}
                          </span>
                          <ChevronDown size={15} style={{ opacity:.35,transform:expanded ? "rotate(180deg)" : "none",transition:"transform .15s ease" }}/>
                        </button>

                        {expanded && (
                          <div className="px-3 pb-3">
                            <div className="rounded-2xl p-3" style={{ background:"#fff" }}>
                              <div className="flex flex-wrap gap-1.5">
                                {games.map((game) => {
                                  const GameIcon = game.icon;
                                  return <span key={game.id} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background:`${game.accent}13`,color:game.accent }}><GameIcon size={11}/>{game.label}</span>;
                                })}
                              </div>
                              <div className="flex items-center gap-2 mt-3">
                                <div className="flex">
                                  {roster.slice(0,4).map((member,index) => <span key={member.id} className="grid place-items-center rounded-full text-[9px]" style={{ width:22,height:22,background:"#F1F3F7",border:"2px solid white",marginLeft:index ? -5 : 0 }}>{member.icon || "🙂"}</span>)}
                                </div>
                                <span className="text-[10px]" style={{ color:"rgba(27,33,41,.48)" }}>{t("home.members", { count:roster.length })}</span>
                                <span className="ml-auto text-[10px] font-semibold" style={{ color:"#9A721F" }}>+{item.reward_points || 0} {t("home.points")}</span>
                                {onOpenTeams && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenTeams({ teamId:item.team_id,challengeId:item.challenge_id })}
                                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-semibold"
                                    style={{ background:"rgba(18,148,106,.09)",color:"#0B7C58" }}
                                  >
                                    <Users size={12}/>{t("home.teamDetails")}
                                  </button>
                                )}
                              </div>
                            </div>
                            {selected && (
                              <ChallengeStandings
                                rows={challengeRows}
                                roster={standingsRoster}
                                games={selectedChallengeGames}
                                isTeam
                                userId={userId}
                                loading={standingsLoading || !selectedTeam}
                                refreshing={standingsRefreshing}
                                defaultOpen={false}
                                embedded
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {gameConfigLoading ? (
          <p style={{ color: CREAM, opacity: 0.3 }} className="text-xs text-center py-8">{t("common.loading")}</p>
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
                {challengesLoaded && todayCompletions.has(g.id) && (
                  <span
                    className="absolute top-3 left-3 flex items-center justify-center rounded-full"
                    style={{ width: 18, height: 18, background: "rgba(47,111,237,0.12)" }}
                    title={t("home.alreadyPlayed")}
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
                  <div style={{ color: CREAM, opacity: 0.5 }} className="text-xs mt-0.5 leading-snug">{t(`game.${g.id}.desc`)}</div>
                </div>
                {!g.available && (
                  <span style={{ color: CREAM, opacity: 0.35 }} className="text-[10px] font-semibold uppercase tracking-wide">
                    {t("home.comingSoon")}
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
