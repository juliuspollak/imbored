import { useEffect, useMemo, useRef, useState } from "react";
import { Moon, Grid3x3, Puzzle, Waves, Check, Star, Flame, ChevronRight, ChevronDown, Globe2, Users, ZoomIn, PawPrint, Play, BarChart3 } from "lucide-react";
import { useGameConfig } from "./lib/useGameConfig.js";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { useI18n } from "./lib/i18n.jsx";
import { challengeProgress, groupChallengeCompletions } from "./lib/challengeProgress.js";
import ChallengeStandings from "./ChallengeStandings.jsx";
import { buildCircleChallengeRounds, localDateString } from "./lib/circleChallengeRounds.js";
import { attachRealtimeRefresh } from "./lib/realtimeRefresh.js";
import Page from "./components/Page.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import AvatarGroup from "./components/AvatarGroup.jsx";
import { GAME_NAMES, GRIDLY_BRAND, HIVE_BRAND } from "./lib/gameBranding.jsx";

const buttonReset = {
  appearance: "none",
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
};

function accentSurface(accent, amount = 12) {
  return `color-mix(in srgb, ${accent} ${amount}%, transparent)`;
}

export const GAME_META = [
  { id: "hive", label: HIVE_BRAND.name, desc: HIVE_BRAND.tagline, icon: HIVE_BRAND.GameIcon, tileIconSize: 32, tileBackground: HIVE_BRAND.tileBackground, accent: "#D99A18", available: true, challenge: true },
  { id: "binary", label: GAME_NAMES.binary, desc: "Place equal flame and frost in every row and column", icon: Flame, accent: "#FF7A59", available: true, challenge: true },
  { id: "gridly", label: GRIDLY_BRAND.name, desc: GRIDLY_BRAND.tagline, icon: GRIDLY_BRAND.GameIcon, tileIconSize: GRIDLY_BRAND.tileIconSize, tileBackground: GRIDLY_BRAND.tileBackground, accent: "#12946A", available: true, challenge: true },
  { id: "minisudoku", label: "Sudoku", desc: "Classic sudoku, bite-sized", icon: Grid3x3, accent: "#0E7490", available: true, challenge: true },
  { id: "patches", label: "Patches", desc: "Fit every shape into the frame", icon: Puzzle, accent: "#B45309", available: false },
  { id: "wend", label: "Wend", desc: "Weave hidden words through the grid", icon: Waves, accent: "#0EA5E9", available: false },
  { id: "geo", label: "Geo", desc: "Capitals, landmarks & wildlife by continent", icon: Globe2, accent: "#DB2777", available: true, challenge: true },
  { id: "zoom", label: "Zoom", desc: "Narrow it down: continent, region, country", icon: ZoomIn, accent: "#7C3AED", available: true, challenge: true },
  { id: "animalrush", label: "Animal Rush", desc: "Live animal race for 2–6 phones", icon: PawPrint, accent: "#15966F", available: false, live: true, requiresConfig: true },
];

const SHARED_ARTWORK_TILES = new Set(["hive", "binary", "gridly", "minisudoku", "geo", "zoom", "animalrush"]);

function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysAgoDate(days) {
  const date = new Date();
  date.setDate(date.getDate()-days);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

const PERSONAL_HISTORY_DAYS = 14;

function personalDayLabel(date, t) {
  if (date === todayString()) return t("standings.today");
  if (date === daysAgoDate(1)) return t("standings.yesterday");
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { weekday:"short", day:"numeric", month:"short" });
}

function currentWeekRange() {
  const date = new Date();
  const isoDay = date.getDay() || 7;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - isoDay + 1);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const format = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { start:format(monday), end:format(sunday) };
}

const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function challengeWeekLabel(weekStart) {
  if (!weekStart) return "";
  const monday = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(monday.getTime())) return weekStart;
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate()+6);
  const format = (date) => date.toLocaleDateString(undefined, { day:"numeric",month:"short" });
  return `${format(monday)} – ${format(sunday)}`;
}

export default function Home({ onSelect, playMode, onPlayModeChange, userId, onOpenProgress, onOpenCircles, challengeScope, onChallengeScopeChange }) {
  const { t, language } = useI18n();
  const { config: gameConfig, loading: gameConfigLoading } = useGameConfig();
  const [progress, setProgress] = useState(null);
  const [todayPlayCounts, setTodayPlayCounts] = useState({});
  const [circleChallenges, setCircleChallenges] = useState([]);
  const [challengeHistory, setChallengeHistory] = useState([]);
  const [circleRosters, setCircleRosters] = useState({});
  const [challengeLifecycle, setChallengeLifecycle] = useState({});
  const [challengeCompletions, setChallengeCompletions] = useState({ personal: new Set() });
  const [challengesLoaded, setChallengesLoaded] = useState(false);
  const [expandedChallengeId, setExpandedChallengeId] = useState(null);
  const [challengeRows, setChallengeRows] = useState([]);
  const [challengeRounds, setChallengeRounds] = useState([]);
  const [challengeBenchmarks, setChallengeBenchmarks] = useState([]);
  const [serverStandings, setServerStandings] = useState(null);
  const [previousChallengeRows, setPreviousChallengeRows] = useState([]);
  const [previousChallengeRounds, setPreviousChallengeRounds] = useState([]);
  const [personalExpanded, setPersonalExpanded] = useState(false);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [challengeProfiles, setChallengeProfiles] = useState({});
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [standingsRefreshing, setStandingsRefreshing] = useState(false);
  const [standingsRefreshKey, setStandingsRefreshKey] = useState(0);
  const standingsCacheRef = useRef({});

  useEffect(() => {
    if (challengeScope?.type === "circle" && challengeScope.id != null) setExpandedChallengeId(challengeScope.id);
  }, [challengeScope?.id, challengeScope?.type]);

  useEffect(() => {
    if (!challengesLoaded || challengeScope?.type !== "circle") return;
    const stillActive = circleChallenges.some((item) => String(item.challenge_id) === String(challengeScope.id));
    if (!stillActive) {
      onChallengeScopeChange?.({ type:"personal",id:null,name:"My Challenge",gameIds:null });
      setExpandedChallengeId(null);
    }
  }, [challengeScope?.id, challengeScope?.type, challengesLoaded, onChallengeScopeChange, circleChallenges]);

  useEffect(() => {
    let cancelled = false;
    async function loadTodayPlayCounts() {
      if (!supabaseReady || !userId) return;
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const [{ data }, { data: animalRushResults }] = await Promise.all([
        supabase.from("game_stats").select("game").eq("user_id", userId).eq("mode", "practice").gte("completed_at", start.toISOString()).lt("completed_at", end.toISOString()),
        supabase.from("animal_rush_match_results").select("id").eq("user_id", userId).gte("finished_at", start.toISOString()).lt("finished_at", end.toISOString()),
      ]);
      if (cancelled) return;
      const counts = {};
      (data || []).forEach((row) => { counts[row.game] = (counts[row.game] || 0) + 1; });
      if (animalRushResults?.length) counts.animalrush = animalRushResults.length;
      setTodayPlayCounts(counts);
    }
    loadTodayPlayCounts();
    if (!supabaseReady || !userId) return () => { cancelled = true; };
    const detach = attachRealtimeRefresh({ channelName:`home-today-play-counts-${userId}`, tables:[{ name:"game_stats" },{ name:"animal_rush_match_results" }], refresh:loadTodayPlayCounts, fallbackMs:45000 });
    return () => { cancelled = true; detach(); };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    async function loadCircleChallenges() {
      if (!supabaseReady || !userId) return;
      setChallengesLoaded(false);
      const week = currentWeekRange();
      await supabase.rpc("finalize_due_circle_challenges");
      if (cancelled) return;
      const [{ data }, { data: personalRows }, { data: circleRows }, { data: rosterData }, { data: lifecycleData }, { data: historyData }] = await Promise.all([
        supabase.rpc("get_my_active_circle_challenges"),
        supabase.from("game_stats").select("game,circle_challenge_id,challenge_date").eq("user_id", userId).eq("mode", "challenge").is("circle_challenge_id", null).eq("challenge_date", todayString()),
        supabase.from("game_stats").select("game,circle_challenge_id,challenge_date").eq("user_id", userId).eq("mode", "challenge").not("circle_challenge_id", "is", null).gte("challenge_date", week.start).lte("challenge_date", week.end),
        supabase.rpc("get_my_circle_rosters"),
        supabase.rpc("get_my_circle_challenge_lifecycle"),
        supabase.rpc("get_my_circle_challenge_history", { history_limit_in:30 }),
      ]);
      const challenges = data || [];
      const completionRows = [...(personalRows || []), ...(circleRows || [])];
      if (cancelled) return;
      setCircleChallenges(challenges);
      setChallengeHistory(historyData || []);
      setChallengesLoaded(true);
      setChallengeCompletions(groupChallengeCompletions(completionRows));
      setChallengeLifecycle(Object.fromEntries((lifecycleData || []).map((item) => [String(item.challenge_id), item])));
      if (challenges.length > 0) {
        const circleIds = new Set(challenges.map((item) => Number(item.circle_id)));
        const grouped = {};
        (rosterData || []).forEach((member) => {
          if (!circleIds.has(Number(member.circle_id))) return;
          if (!grouped[member.circle_id]) grouped[member.circle_id] = [];
          grouped[member.circle_id].push({ id:member.user_id, name:member.member_name, icon:member.member_icon, show_stats_to_others:member.show_stats_to_others });
        });
        setCircleRosters(grouped);
      } else setCircleRosters({});
    }
    loadCircleChallenges();
    return () => { cancelled = true; };
  }, [userId]);

  const standingsPeriods = useMemo(() => {
    if (challengeScope?.type !== "circle") {
      return Array.from({ length:PERSONAL_HISTORY_DAYS }, (unused, index) => {
        const date = index === 0 ? todayString() : daysAgoDate(index);
        return { key:`personal:${date}`, date, challengeId:null, label:personalDayLabel(date, t), closed:false, winnerId:null, gameIds:null };
      });
    }
    const active = circleChallenges.find((item) => String(item.challenge_id) === String(challengeScope.id));
    const seriesTitle = active?.challenge_title ?? challengeScope.challengeTitle;
    const past = challengeHistory
      .filter((item) => Number(item.circle_id) === Number(active?.circle_id ?? challengeScope.circleId) && item.challenge_title === seriesTitle && String(item.challenge_id) !== String(challengeScope.id))
      .sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)));
    return [
      { key:`circle:${challengeScope.id}`, date:null, challengeId:challengeScope.id, label:active?.week_start ? challengeWeekLabel(active.week_start) : t("standings.thisWeek"), closed:false, winnerId:null, gameIds:active?.game_ids || challengeScope.gameIds || null },
      ...past.map((item) => ({ key:`circle:${item.challenge_id}`, date:null, challengeId:item.challenge_id, label:challengeWeekLabel(item.week_start), closed:!!item.closed_at, winnerId:item.winner_id || null, gameIds:item.game_ids || null })),
    ];
  }, [challengeScope?.type, challengeScope?.id, challengeScope?.circleId, challengeScope?.challengeTitle, challengeScope?.gameIds, circleChallenges, challengeHistory, t]);

  const periodIndex = Math.min(periodOffset, Math.max(0, standingsPeriods.length - 1));
  const selectedPeriod = standingsPeriods[periodIndex] || null;
  const comparisonPeriod = standingsPeriods[periodIndex + 1] || null;

  useEffect(() => { setPeriodOffset(0); }, [challengeScope?.type, challengeScope?.id]);

  useEffect(() => {
    if (!supabaseReady || !userId || playMode !== "challenge") return undefined;
    return attachRealtimeRefresh({ channelName:`home-standings-${userId}`, tables:[{ name:"game_stats" },{ name:"profiles" }], refresh:() => setStandingsRefreshKey((value) => value+1), fallbackMs:45000 });
  },[playMode,userId]);

  useEffect(() => {
    let cancelled = false;
    async function loadChallengeStandings() {
      if (!supabaseReady || !userId || playMode !== "challenge") {
        setChallengeRows([]); setChallengeRounds([]); setChallengeBenchmarks([]); setServerStandings(null); setPreviousChallengeRows([]); setPreviousChallengeRounds([]); setChallengeProfiles({}); setStandingsLoading(false); setStandingsRefreshing(false); return;
      }
      if (!selectedPeriod) return;
      const cacheKey = selectedPeriod.key;
      setChallengeRounds([]); setPreviousChallengeRows([]); setPreviousChallengeRounds([]);
      const cached = standingsCacheRef.current[cacheKey];
      if (cached) { setChallengeRows(cached.rows); setChallengeProfiles(cached.profiles); setStandingsLoading(false); setStandingsRefreshing(true); }
      else { setStandingsLoading(true); setStandingsRefreshing(false); setChallengeRows([]); setChallengeProfiles({}); }

      async function withLookedUpProfiles(rows) {
        const playerIds = [...new Set(rows.map((row) => row.user_id))];
        const profileResult = playerIds.length > 0 ? await supabase.from("profiles").select("id,name,icon,show_stats_to_others").in("id", playerIds) : { data:[] };
        return { rows, profiles:profileResult.data || [] };
      }
      async function fetchPeriodRows(period) {
        if (period.challengeId != null) {
          const embedded = await supabase.from("game_stats").select("user_id,game,challenge_date,seconds,mistakes,hints,correct_count,total_count,zip_backtracked_cells,zip_required_moves,wasted_moves,expected_moves,completed_at,profiles(name,icon,show_stats_to_others)").eq("mode","challenge").eq("circle_challenge_id",period.challengeId);
          if (!embedded.error) {
            const rows = embedded.data || [];
            return { rows, profiles:rows.flatMap((row) => row.profiles ? [{ id:row.user_id, ...row.profiles }] : []) };
          }
          const { data } = await supabase.from("game_stats").select("user_id,game,challenge_date,seconds,mistakes,hints,correct_count,total_count,zip_backtracked_cells,zip_required_moves,wasted_moves,expected_moves,completed_at").eq("mode","challenge").eq("circle_challenge_id",period.challengeId);
          return withLookedUpProfiles(data || []);
        }
        const personalResult = await supabase.rpc("get_personal_challenge_standings", { start_date_in:period.date, end_date_in:period.date });
        if (!personalResult.error) return { rows:(personalResult.data || []).map((row) => ({ ...row, user_id:row.result_user_id })), profiles:[] };
        const { data } = await supabase.from("game_stats").select("user_id,game,challenge_date,seconds,mistakes,hints,correct_count,total_count,zip_backtracked_cells,zip_required_moves,wasted_moves,expected_moves,completed_at").eq("mode","challenge").is("circle_challenge_id",null).eq("challenge_date",period.date);
        return withLookedUpProfiles(data || []);
      }
      function fetchPeriodRounds(period) {
        return period.challengeId != null ? supabase.from("circle_challenge_rounds").select("challenge_date,game,round_number").eq("challenge_id",period.challengeId).order("round_number") : Promise.resolve({ data:[] });
      }

      const [current, { data:roundRows }, { data:benchmarkRows }, { data:personalProfiles }, { data:rankedRows, error:rankedError }, previous, { data:previousRoundRows }] = await Promise.all([
        fetchPeriodRows(selectedPeriod),
        fetchPeriodRounds(selectedPeriod),
        supabase.from("game_time_benchmarks").select("game,day_index,effective_seconds,log_mean,log_sd").eq("mode","challenge"),
        challengeScope?.type !== "circle" ? supabase.from("profiles").select("id,name,icon,show_stats_to_others").eq("is_approved",true).eq("hidden_from_others",false) : Promise.resolve({ data:[] }),
        selectedPeriod.challengeId != null ? supabase.rpc("get_circle_challenge_standings", { target_challenge_id:selectedPeriod.challengeId }) : Promise.resolve({ data:null }),
        comparisonPeriod ? fetchPeriodRows(comparisonPeriod) : Promise.resolve({ rows:[], profiles:[] }),
        comparisonPeriod ? fetchPeriodRounds(comparisonPeriod) : Promise.resolve({ data:[] }),
      ]);
      if (cancelled) return;
      const profileMap = Object.fromEntries([...(personalProfiles || []),...current.profiles].map((profile) => [profile.id,profile]));
      standingsCacheRef.current[cacheKey] = { rows:current.rows, profiles:profileMap };
      setChallengeRows(current.rows);
      setChallengeRounds((roundRows || []).map((round) => ({ date:round.challenge_date, game:round.game, roundNumber:round.round_number })));
      setChallengeBenchmarks(benchmarkRows || []);
      setServerStandings(rankedError ? null : (rankedRows || null));
      setPreviousChallengeRows(previous.rows);
      setPreviousChallengeRounds((previousRoundRows || []).map((round) => ({ date:round.challenge_date, game:round.game, roundNumber:round.round_number })));
      setChallengeProfiles(profileMap);
      setStandingsLoading(false); setStandingsRefreshing(false);
    }
    loadChallengeStandings();
    return () => { cancelled = true; };
  }, [userId, playMode, challengeScope?.type, selectedPeriod?.key, comparisonPeriod?.key, standingsRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadProgress() {
      if (!supabaseReady || !userId) return;
      await supabase.rpc("ensure_player_progress", { uid: userId });
      const { data } = await supabase.from("player_progress").select("available_points,challenge_current_streak").eq("player_id", userId).maybeSingle();
      if (!cancelled) setProgress(data);
    }
    loadProgress();
    return () => { cancelled = true; };
  }, [userId]);

  const configuredGames = gameConfigLoading ? [] : GAME_META.map((g, i) => {
    const cfg = gameConfig?.[g.id];
    return { ...g, available:cfg ? cfg.available : g.available, visible:cfg ? cfg.visible : !g.requiresConfig, challengeEnabled:typeof cfg?.challenge_enabled === "boolean" ? cfg.challenge_enabled : g.challenge === true, sortOrder:cfg ? cfg.sort_order : i };
  }).filter((g) => g.visible).sort((a, b) => a.sortOrder - b.sortOrder);

  const visibleGames = configuredGames.filter((game) => {
    if (playMode !== "challenge") return true;
    if (challengeScope?.type === "circle") return (challengeScope.gameIds || []).includes(game.id);
    return game.challengeEnabled;
  });
  const personalGameIds = configuredGames.filter((game) => game.available && game.challengeEnabled).map((game) => game.id);
  const personalGames = personalGameIds.map((id) => configuredGames.find((game) => game.id === id)).filter(Boolean);
  const personalCompleted = challengeCompletions.personal || new Set();
  const challengeStatus = (circleChallenge) => {
    const requiredItems = circleChallenge ? buildCircleChallengeRounds({ activeDays:circleChallenge.active_days, gameIds:circleChallenge.game_ids }).map((round) => round.date) : personalGameIds;
    const completed = circleChallenge ? challengeCompletions[String(circleChallenge.challenge_id)] || new Set() : personalCompleted;
    return challengeProgress(requiredItems, completed);
  };
  const personalStatus = challengeStatus(null);
  const circleStatusLabel = (circleChallenge, status) => {
    const lifecycle = challengeLifecycle[String(circleChallenge.challenge_id)];
    if (lifecycle?.winner_id) return lifecycle.winner_id === userId ? "Finished · You won" : `Finished · ${lifecycle.winner_name || "A circlemate"} won`;
    if (!status.done) {
      if (status.completed === 0) return "Not started";
      return `${status.remaining} ${status.remaining === 1 ? "round" : "rounds"} left`;
    }
    const waiting = Math.max(0, Number(lifecycle?.member_count || 0) - Number(lifecycle?.finished_count || 0));
    return waiting > 0 ? `You finished · waiting for ${waiting}` : "You finished · finalising";
  };
  const challengeItems = [
    { key:"personal", type:"personal", active_today:true, status:personalStatus },
    ...circleChallenges.map((item) => ({ ...item, key:String(item.challenge_id), type:"circle", status:challengeStatus(item), today_done:(challengeCompletions[String(item.challenge_id)] || new Set()).has(todayString()) })),
  ];
  const pendingChallenges = challengesLoaded && !gameConfigLoading ? challengeItems.filter((item) => item.active_today && item.status.remaining > 0 && !item.today_done) : [];
  const selectedCircle = challengeScope?.type === "circle" ? circleChallenges.find((item) => String(item.challenge_id) === String(challengeScope.id)) : null;
  const selectedRoster = selectedCircle ? circleRosters[selectedCircle.circle_id] || [] : [];
  const selectedChallengeGameIds = challengeScope?.type === "circle" ? (periodIndex > 0 ? selectedPeriod?.gameIds : null) || selectedCircle?.game_ids || challengeScope.gameIds || [] : personalGameIds;
  const selectedChallengeGames = selectedChallengeGameIds.map((id) => configuredGames.find((game) => game.id === id) || GAME_META.find((game) => game.id === id)).filter(Boolean);
  const standingsRoster = challengeScope?.type === "circle" ? selectedRoster : Object.values(challengeProfiles);
  const selectedRounds = selectedCircle ? challengeRounds.length ? challengeRounds : buildCircleChallengeRounds({ activeDays:selectedCircle.active_days, gameIds:selectedCircle.game_ids }) : [];

  function choosePersonalChallenge() {
    onChallengeScopeChange({ type:"personal",id:null,name:"My Challenge",gameIds:null });
    setExpandedChallengeId(null);
  }

  function chooseCircleChallenge(circleChallenge) {
    onChallengeScopeChange({
      type:"circle", id:circleChallenge.challenge_id, circleId:circleChallenge.circle_id,
      name:circleChallenge.challenge_title || circleChallenge.circle_name, circleName:circleChallenge.circle_name,
      challengeTitle:circleChallenge.challenge_title || "Weekly challenge", emoji:circleChallenge.circle_emoji,
      gameIds:circleChallenge.game_ids, rewardPoints:circleChallenge.reward_points, activeDays:circleChallenge.active_days,
      dailyRounds:buildCircleChallengeRounds({ activeDays:circleChallenge.active_days, gameIds:circleChallenge.game_ids }),
      stakeRewardId:circleChallenge.stake_reward_id, stakeRewardName:circleChallenge.stake_reward_name,
      stakeSplitMethod:circleChallenge.stake_split_method, stakeAccepted:circleChallenge.stake_accepted,
      // A prize challenge commits the winner or the loser to something real, so
      // ChallengeGate has to ask for agreement the same way a stake does.
      rewardType:circleChallenge.reward_type, rewardGoesTo:circleChallenge.reward_goes_to,
      rewardLabel:circleChallenge.reward_label,
    });
  }

  function compactGameTile(game, completed, canPlay, onClick, keySuffix = "") {
    const Icon = game.icon;
    return (
      <button
        type="button"
        key={`${game.id}${keySuffix}`}
        disabled={!canPlay}
        onClick={onClick}
        className={`challenge-mini-game challenge-mini-game--${game.id}`}
        style={{
          ...buttonReset, position:"relative", flex:"1 0 72px", minWidth:72, maxWidth:108, minHeight:112,
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:7,
          padding:"10px 8px 9px", border:`1px solid ${canPlay && !completed ? "var(--color-primary-subtle-border)" : "var(--color-border)"}`,
          borderRadius:"var(--radius-md)", background:"var(--color-surface)", boxShadow:"var(--shadow-control)",
          opacity:canPlay || completed ? 1 : .68, cursor:canPlay ? "pointer" : "default",
        }}
      >
        {completed && <span aria-label="Completed" style={{ position:"absolute", top:7, right:7, width:20, height:20, display:"grid", placeItems:"center", borderRadius:"50%", background:"var(--color-success-bg)", color:"var(--color-success-text)" }}><Check size={12} strokeWidth={3} /></span>}
        {canPlay && !completed && <span aria-hidden="true" style={{ position:"absolute", top:6, right:6, width:22, height:22, display:"grid", placeItems:"center", borderRadius:"50%", background:"var(--color-primary)", color:"var(--color-primary-text)" }}><Play size={11} fill="currentColor" /></span>}
        <span aria-hidden="true" style={{ width:42, height:42, display:"grid", placeItems:"center", borderRadius:"var(--radius-md)", background:game.tileBackground || accentSurface(game.accent), color:game.accent }}><Icon size={game.tileIconSize || 22} /></span>
        <strong style={{ color:"var(--color-text-primary)", fontSize:"var(--text-caption-size)", lineHeight:1.1 }}>{game.label}</strong>
        {canPlay && !completed ? <span style={{ padding:"3px 10px", borderRadius:"var(--radius-full)", background:"var(--color-primary)", color:"var(--color-primary-text)", fontSize:10, fontWeight:700 }}>PLAY</span> : <span style={{ width:"75%", height:3, borderRadius:"var(--radius-full)", background:completed ? "var(--color-success-text)" : "var(--color-border)" }} />}
      </button>
    );
  }

  return (
    <Page style={{ alignItems:"flex-start" }}>
      <main style={{ padding:"var(--space-5) 0 var(--space-8)" }}>
        <header style={{ marginBottom:"var(--space-5)", paddingRight:"56px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"var(--space-2)" }}><span aria-hidden="true" style={{ fontSize:22 }}>🧩</span><h1 style={{ margin:0, color:"var(--color-text-primary)", fontSize:"var(--text-page-title-size)", lineHeight:"var(--text-page-title-line)", fontWeight:"var(--text-page-title-weight)" }}>I&apos;mBoredToday</h1></div>
          <p style={{ margin:"var(--space-1) 0 0", color:"var(--color-text-secondary)", fontSize:"var(--text-page-subtitle-size)" }}>{t("home.tagline")}</p>
        </header>

        {onOpenProgress && <button type="button" onClick={onOpenProgress} className="home-progress-control" aria-busy={!progress} style={{ ...buttonReset, minHeight:"var(--control-height-md)", display:"inline-flex", alignItems:"center", gap:"var(--space-2)", marginBottom:"var(--space-4)", padding:"0 var(--space-3)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-full)", background:"var(--color-surface)", boxShadow:"var(--shadow-control)", color:"var(--color-text-primary)" }}>
          <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:"var(--text-caption-size)", fontWeight:600 }}><Star size={15} fill="currentColor" style={{ color:"var(--color-warning-gold)" }} />{progress ? (progress.available_points || 0).toLocaleString(language === "sk" ? "sk-SK" : "en") : "…"}</span>
          <span aria-hidden="true" style={{ width:1, height:16, background:"var(--color-border)" }} />
          <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:"var(--text-caption-size)", fontWeight:600 }}><Flame size={15} style={{ color:"var(--color-danger-solid)" }} />{progress ? progress.challenge_current_streak || 0 : "…"}</span><ChevronRight size={15} style={{ color:"var(--color-icon-subtle)" }} />
        </button>}

        {onPlayModeChange && <div style={{ display:"flex", justifyContent:"center", marginBottom:"var(--space-2)" }}><div role="group" aria-label="Play mode" style={{ display:"inline-flex", gap:2, padding:3, borderRadius:"var(--radius-full)", background:"var(--color-surface-elevated)", border:"1px solid var(--color-border)" }}>
          {["challenge","practice"].map((mode) => { const active = playMode === mode; return <button type="button" key={mode} onClick={() => onPlayModeChange(mode)} aria-pressed={active} style={{ ...buttonReset, minHeight:"var(--control-height-sm)", display:"inline-flex", alignItems:"center", gap:"var(--space-1)", padding:"0 var(--space-4)", border:active ? "1px solid var(--color-primary-subtle-border)" : "1px solid transparent", borderRadius:"var(--radius-full)", background:active ? "var(--color-surface)" : "transparent", boxShadow:active ? "var(--shadow-control)" : "none", color:active ? "var(--color-primary)" : "var(--color-text-secondary)", fontSize:"var(--text-button-size)", fontWeight:600 }}>{t(`common.${mode}`)}{mode === "challenge" && pendingChallenges.length > 0 && <span style={{ minWidth:20, height:20, display:"grid", placeItems:"center", padding:"0 6px", borderRadius:"var(--radius-full)", background:"var(--color-danger-solid)", color:"var(--color-primary-text)", fontSize:11, fontWeight:700 }}>{pendingChallenges.length}</span>}</button>; })}
        </div></div>}

        <p style={{ margin:"0 0 var(--space-5)", textAlign:"center", color:"var(--color-text-secondary)", fontSize:"var(--text-body-secondary-size)" }}>{playMode === "challenge" ? t("home.challengeHint") : t("home.practiceHint")}</p>

        {playMode === "challenge" && onChallengeScopeChange && (
          <div style={{ display:"flex", flexDirection:"column", gap:"var(--space-3)" }}>
            <Card style={{ padding:0, overflow:"hidden" }}>
              <div style={{ display:"flex", alignItems:"center", gap:"var(--space-3)", padding:"var(--space-3) var(--space-4)" }}>
                <span aria-hidden="true" style={{ width:44, height:44, display:"grid", placeItems:"center", flexShrink:0, borderRadius:"var(--radius-md)", background:"var(--color-info-bg)", fontSize:21 }}>🎯</span>
                <span style={{ flex:1, minWidth:0 }}><strong style={{ display:"block", color:"var(--color-text-primary)", fontSize:"var(--text-body-size)" }}>{t("home.myChallenge")}</strong><span style={{ display:"block", marginTop:3, color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)" }}>{personalStatus.completed} of {personalStatus.total} games completed</span></span>
                <span style={{ flexShrink:0, padding:"5px 9px", borderRadius:"var(--radius-full)", background:personalStatus.done ? "var(--color-success-bg)" : "var(--color-info-bg)", color:personalStatus.done ? "var(--color-success-text)" : "var(--color-info-text)", fontSize:"var(--text-caption-size)", fontWeight:600 }}>{personalStatus.done ? "Completed today" : t("home.gamesLeft", { count:personalStatus.remaining })}</span>
              </div>
              <div style={{ padding:"0 var(--space-4) var(--space-3)" }}>
                <div style={{ display:"flex", alignItems:"center", marginBottom:8 }}><strong style={{ flex:1, fontSize:"var(--text-caption-size)", color:"var(--color-text-primary)" }}>TODAY&apos;S GAMES</strong><span style={{ color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)", fontWeight:600 }}>{personalStatus.completed} / {personalStatus.total}</span></div>
                <div className="challenge-mini-strip">{personalGames.map((game) => compactGameTile(game, personalCompleted.has(game.id), game.available && !personalCompleted.has(game.id), () => { choosePersonalChallenge(); onSelect(game.id); }, "-personal"))}</div>
              </div>
              <button type="button" onClick={() => { choosePersonalChallenge(); setPersonalExpanded((value) => !value); }} aria-expanded={personalExpanded} style={{ ...buttonReset, width:"100%", display:"flex", alignItems:"center", gap:"var(--space-2)", padding:"11px var(--space-4)", border:0, borderTop:"1px solid var(--color-border)", background:"transparent", color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)", fontWeight:600 }}><BarChart3 size={15} /><span style={{ flex:1, textAlign:"left" }}>View your results and more</span><ChevronDown size={16} style={{ transform:personalExpanded ? "rotate(180deg)" : "none" }} /></button>
              {personalExpanded && challengeScope?.type !== "circle" && <div style={{ padding:"0 var(--space-3) var(--space-3)" }}><ChallengeStandings rows={challengeRows} roster={standingsRoster} games={selectedChallengeGames} benchmarks={challengeBenchmarks} previousRows={previousChallengeRows} userId={userId} loading={standingsLoading} defaultOpen embedded refreshing={standingsRefreshing} periodLabel={selectedPeriod?.label} periodIndex={periodIndex} periodCount={standingsPeriods.length} onPeriodChange={setPeriodOffset} /></div>}
            </Card>

            {circleChallenges.map((item) => {
              const status = challengeStatus(item);
              const lifecycle = challengeLifecycle[String(item.challenge_id)];
              const selected = challengeScope?.type === "circle" && String(challengeScope.id) === String(item.challenge_id);
              const expanded = String(expandedChallengeId) === String(item.challenge_id);
              const rounds = buildCircleChallengeRounds({ activeDays:item.active_days, gameIds:item.game_ids });
              const todayRound = rounds.find((round) => round.date === localDateString());
              const completionSet = challengeCompletions[String(item.challenge_id)] || new Set();
              const todayDone = !!todayRound && completionSet.has(todayRound.date);
              const todayGame = todayRound ? configuredGames.find((game) => game.id === todayRound.game) || GAME_META.find((game) => game.id === todayRound.game) : null;
              const roster = circleRosters[item.circle_id] || [];
              const lifecycleLabel = circleStatusLabel(item, status);
              const challengeFinished = !!lifecycle?.winner_id;
              const playerFinished = status.done;
              const tone = challengeFinished ? ["var(--color-warning-bg)","var(--color-warning-text)"] : playerFinished ? ["var(--color-success-bg)","var(--color-success-text)"] : ["var(--color-info-bg)","var(--color-info-text)"];
              return (
                <Card key={item.challenge_id} style={{ padding:0, overflow:"hidden", borderColor:selected ? "var(--color-primary-subtle-border)" : undefined }}>
                  <button type="button" onClick={() => { chooseCircleChallenge(item); setExpandedChallengeId(expanded ? null : item.challenge_id); }} aria-expanded={expanded} style={{ ...buttonReset, width:"100%", display:"flex", alignItems:"center", gap:"var(--space-3)", padding:"var(--space-3) var(--space-4)", border:0, background:selected ? "var(--color-primary-subtle)" : "transparent", textAlign:"left" }}>
                    <span aria-hidden="true" style={{ width:44, height:44, display:"grid", placeItems:"center", flexShrink:0, borderRadius:"var(--radius-md)", background:"var(--color-surface-elevated)", fontSize:21 }}>{item.circle_emoji || "⭐"}</span>
                    <span style={{ flex:1, minWidth:0 }}><span style={{ display:"flex", alignItems:"center", gap:5 }}><strong style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"var(--color-text-primary)", fontSize:"var(--text-body-size)" }}>{item.challenge_title || item.circle_name}</strong>{selected && <Check size={14} strokeWidth={3} style={{ color:"var(--color-primary)", flexShrink:0 }} />}</span><span style={{ display:"block", marginTop:2, color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)" }}>{item.circle_name} · {status.completed} / {status.total} completed</span></span>
                    <span style={{ flexShrink:0, padding:"5px 9px", borderRadius:"var(--radius-full)", background:tone[0], color:tone[1], fontSize:"var(--text-caption-size)", fontWeight:600 }}>{lifecycleLabel}</span>
                  </button>

                  <div style={{ padding:"0 var(--space-4) var(--space-3)" }}>
                    <div style={{ display:"flex", alignItems:"center", marginBottom:8 }}><strong style={{ flex:1, fontSize:"var(--text-caption-size)", color:"var(--color-text-primary)" }}>TODAY&apos;S GAME</strong>{todayRound && <span style={{ color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)", fontWeight:600 }}>{todayDone ? "Completed" : "Ready to play"}</span>}</div>
                    {todayGame ? <div className="challenge-mini-strip challenge-mini-strip--single">{compactGameTile(todayGame, todayDone, item.active_today && !todayDone && todayGame.available, () => { chooseCircleChallenge(item); onSelect(todayGame.id); }, `-${item.challenge_id}`)}</div> : <div style={{ padding:"12px 14px", border:"1px dashed var(--color-border)", borderRadius:"var(--radius-md)", color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)" }}>No game scheduled for this challenge today.</div>}
                  </div>

                  <button type="button" onClick={() => { chooseCircleChallenge(item); setExpandedChallengeId(expanded ? null : item.challenge_id); }} aria-expanded={expanded} style={{ ...buttonReset, width:"100%", display:"flex", alignItems:"center", gap:"var(--space-2)", padding:"11px var(--space-4)", border:0, borderTop:"1px solid var(--color-border)", background:"transparent", color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)", fontWeight:600 }}><BarChart3 size={15} /><span style={{ flex:1, textAlign:"left" }}>Standings &amp; stats</span><ChevronDown size={16} style={{ transform:expanded ? "rotate(180deg)" : "none" }} /></button>

                  {expanded && selected && <div style={{ padding:"0 var(--space-3) var(--space-3)" }}>
                    <div style={{ margin:"var(--space-3) 0", padding:"var(--space-3)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-md)", background:"var(--color-surface-elevated)" }}>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:"var(--space-1)" }}>{rounds.map((round) => <span key={round.date} style={{ padding:"4px 7px", borderRadius:"var(--radius-full)", background:round.date === localDateString() ? "var(--color-primary-subtle)" : "var(--color-surface)", color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)", fontWeight:600 }}>{DAY_LABELS[round.isoDay - 1]} · {GAME_NAMES[round.game] || round.game}</span>)}</div>
                      <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:"var(--space-2)", marginTop:"var(--space-3)" }}><AvatarGroup members={roster} /><span style={{ color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)" }}>{t("home.members", { count:roster.length })}</span><span style={{ marginLeft:"auto", color:"var(--color-warning-text)", fontSize:"var(--text-caption-size)", fontWeight:600 }}>+{item.reward_points || 0} {t("home.points")}</span>{onOpenCircles && <Button variant="secondary" size="sm" before={<Users size={14} />} onClick={() => onOpenCircles({ circleId:item.circle_id, challengeId:item.challenge_id })}>{t("home.circleDetails")}</Button>}</div>
                    </div>
                    <ChallengeStandings rows={challengeRows} roster={standingsRoster} games={selectedChallengeGames} rounds={challengeRounds.length ? challengeRounds : periodIndex > 0 ? [] : selectedRounds} benchmarks={challengeBenchmarks} serverStandings={serverStandings} previousRows={previousChallengeRows} previousRounds={previousChallengeRounds} isCircle userId={userId} loading={standingsLoading || !selectedCircle} defaultOpen embedded closed={periodIndex > 0 ? selectedPeriod.closed : !!challengeLifecycle[String(challengeScope.id)]?.closed_at} winnerId={periodIndex > 0 ? selectedPeriod.winnerId : challengeLifecycle[String(challengeScope.id)]?.winner_id} refreshing={standingsRefreshing} periodLabel={selectedPeriod?.label} periodIndex={periodIndex} periodCount={standingsPeriods.length} onPeriodChange={setPeriodOffset} />
                  </div>}
                </Card>
              );
            })}

            {challengeHistory.length > 0 && <details style={{ padding:"var(--space-3) var(--space-4)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-md)", background:"var(--color-surface)" }}><summary style={{ ...buttonReset, display:"flex", alignItems:"center", gap:"var(--space-2)", listStyle:"none" }}><span style={{ flex:1 }}><strong style={{ display:"block", color:"var(--color-text-primary)", fontSize:"var(--text-body-size)" }}>Past challenges</strong><span style={{ color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)" }}>Your latest circle results</span></span><ChevronRight size={17} /></summary><div style={{ marginTop:"var(--space-3)" }}>{challengeHistory.slice(0,5).map((item,index) => <div key={item.challenge_id} style={{ display:"flex", alignItems:"center", gap:"var(--space-2)", padding:"10px 0", borderTop:index ? "1px solid var(--color-border)" : "none" }}><span style={{ flex:1, minWidth:0 }}><strong style={{ display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontSize:"var(--text-body-secondary-size)" }}>{item.challenge_title || item.circle_name}</strong><span style={{ color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)" }}>{item.circle_name} · {challengeWeekLabel(item.week_start)}</span></span><span style={{ color:"var(--color-text-secondary)", fontSize:"var(--text-caption-size)", fontWeight:600 }}>{item.winner_id === userId ? "You won" : item.winner_id ? `${item.winner_name || "Circlemate"} won` : "No winner"}</span></div>)}</div></details>}
          </div>
        )}

        {playMode === "practice" && (gameConfigLoading ? (
          <div aria-live="polite" className="home-game-skeleton-grid" style={{ width:"100%", maxWidth:400, margin:"0 auto", display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:"var(--space-3)" }}>{[0,1,2,3].map((item) => <div key={item} className="home-skeleton" style={{ width:"100%", aspectRatio:"5 / 4", borderRadius:"var(--radius-lg)", background:"var(--color-surface-elevated)", border:"1px solid var(--color-border)" }} />)}</div>
        ) : (
          <div className="home-game-grid" style={{ width:"100%", maxWidth:400, margin:"0 auto", display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:"var(--space-3)" }}>
            {visibleGames.map((game) => { const Icon = game.icon; const canOpenGame = game.available; const completed = !!todayPlayCounts[game.id]; return <button type="button" key={game.id} disabled={!canOpenGame} onClick={() => canOpenGame && onSelect(game.id)} className={`home-game-tile home-game-tile--${game.id}${SHARED_ARTWORK_TILES.has(game.id) ? " home-game-tile--artwork" : ""}`} style={{ ...buttonReset, position:"relative", width:"100%", minHeight:0, aspectRatio:"5 / 4", display:"flex", flexDirection:"column", alignItems:"flex-start", gap:"var(--space-3)", padding:"var(--space-4)", textAlign:"left", border:"1px solid var(--color-border)", borderRadius:"var(--radius-lg)", background:"var(--color-surface)", boxShadow:"var(--shadow-card)", cursor:canOpenGame ? "pointer" : "not-allowed", transition:"transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast)" }}>
              {completed && <span title={t("home.alreadyPlayed")} style={{ position:"absolute", top:12, left:12, width:22, height:22, display:"grid", placeItems:"center", borderRadius:"50%", background:"var(--color-info-bg)" }}><Check size={13} style={{ color:"var(--color-info-text)" }} strokeWidth={3} /></span>}
              <span aria-hidden="true" style={{ width:44, height:44, display:"grid", placeItems:"center", borderRadius:"var(--radius-md)", background:game.tileBackground || accentSurface(game.accent), color:game.accent }}><Icon size={game.tileIconSize || 22} /></span>
              <span><span style={{ display:"flex", alignItems:"center", gap:"var(--space-1)" }}><strong style={{ color:"var(--color-text-primary)", fontSize:"var(--text-body-size)" }}>{game.label}</strong>{game.live && <span style={{ padding:"3px 6px", borderRadius:"var(--radius-full)", background:"var(--color-success-bg)", color:"var(--color-success-text)", fontSize:11, fontWeight:700, textTransform:"uppercase" }}>Live</span>}</span><span style={{ display:"block", marginTop:3, color:"var(--color-text-secondary)", fontSize:"var(--text-body-secondary-size)", lineHeight:"var(--text-body-line)" }}>{t(`game.${game.id}.desc`)}</span>{!!todayPlayCounts[game.id] && <span style={{ display:"block", marginTop:"var(--space-1)", color:"var(--color-text-muted)", fontSize:"var(--text-caption-size)", fontWeight:600 }}>Played {todayPlayCounts[game.id]}× today</span>}</span>
              {!game.available && <span style={{ marginTop:"auto", color:"var(--color-text-muted)", fontSize:"var(--text-caption-size)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.04em" }}>{t("home.comingSoon")}</span>}
            </button>; })}
          </div>
        ))}
      </main>

      <style>{`
        .home-progress-control:focus-visible,
        .home-game-tile:focus-visible,
        .challenge-mini-game:focus-visible,
        main button:focus-visible,
        main summary:focus-visible { outline:2px solid var(--color-primary); outline-offset:2px; }
        .challenge-mini-strip { display:flex; gap:8px; overflow-x:auto; padding:2px 1px 6px; scrollbar-width:none; -webkit-overflow-scrolling:touch; }
        .challenge-mini-strip::-webkit-scrollbar { display:none; }
        .challenge-mini-strip--single .challenge-mini-game { flex:0 0 108px; }
        .challenge-mini-game:disabled { box-shadow:none !important; }
        .home-game-tile:disabled { background:var(--color-surface-elevated) !important; box-shadow:none !important; }
        @media (hover:hover) and (pointer:fine) {
          .home-game-tile:not(:disabled):hover, .challenge-mini-game:not(:disabled):hover { transform:translateY(-2px); border-color:var(--color-primary-subtle-border); box-shadow:var(--shadow-card-hover); }
        }
        @media (max-width:319px) { .home-game-grid,.home-game-skeleton-grid { max-width:250px !important; grid-template-columns:minmax(0,1fr) !important; } }
        @media (prefers-reduced-motion:reduce) { .home-game-tile,.challenge-mini-game { transition:none !important; } .home-game-tile:hover,.challenge-mini-game:hover { transform:none !important; } .home-skeleton { animation:none !important; } }
      `}</style>
    </Page>
  );
}
