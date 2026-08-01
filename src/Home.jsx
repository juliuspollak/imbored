import { useEffect, useRef, useState } from "react";
import { Moon, Target, ArrowUpDown, Grid3x3, Puzzle, Waves, Check, Star, Flame, ChevronRight, ChevronDown, Globe2, Users, ZoomIn, PawPrint } from "lucide-react";
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
import { GRIDLY_BRAND, HIVE_BRAND } from "./lib/gameBranding.jsx";

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
  { id: "tango", label: "Tango", desc: "Balance sun & moon in every line", icon: Moon, accent: "#4A6FA5", available: true, challenge: true },
  { id: "gridly", label: GRIDLY_BRAND.name, desc: GRIDLY_BRAND.tagline, icon: GRIDLY_BRAND.GameIcon, tileIconSize: GRIDLY_BRAND.tileIconSize, tileBackground: GRIDLY_BRAND.tileBackground, accent: "#12946A", available: true, challenge: true },
  { id: "pinpoint", label: "Pinpoint", desc: "Guess the category from five clues", icon: Target, accent: "#8B5CF6", available: false },
  { id: "crossclimb", label: "Crossclimb", desc: "Solve the word ladder", icon: ArrowUpDown, accent: "#EA580C", available: false },
  { id: "minisudoku", label: "Sudoku", desc: "Classic sudoku, bite-sized", icon: Grid3x3, accent: "#0E7490", available: true, challenge: true },
  { id: "patches", label: "Patches", desc: "Fit every shape into the frame", icon: Puzzle, accent: "#B45309", available: false },
  { id: "wend", label: "Wend", desc: "Weave hidden words through the grid", icon: Waves, accent: "#0EA5E9", available: false },
  { id: "geo", label: "Geo", desc: "Capitals, landmarks & wildlife by continent", icon: Globe2, accent: "#DB2777", available: true, challenge: true },
  { id: "zoom", label: "Zoom", desc: "Narrow it down: continent, region, country", icon: ZoomIn, accent: "#7C3AED", available: true, challenge: true },
  { id: "animalrush", label: "Animal Rush", desc: "Live animal race for 2–6 phones", icon: PawPrint, accent: "#15966F", available: false, live: true, requiresConfig: true },
];

const SHARED_ARTWORK_TILES = new Set(["hive", "tango", "gridly", "minisudoku", "geo", "zoom", "animalrush"]);

function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function previousWeekDate() {
  const date = new Date();
  date.setDate(date.getDate()-7);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function daysAgoDate(days) {
  const date = new Date();
  date.setDate(date.getDate()-days);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
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
  const [previousChallengeRows, setPreviousChallengeRows] = useState([]);
  const [previousChallengeRounds, setPreviousChallengeRounds] = useState([]);
  const [previousChallengeLabel, setPreviousChallengeLabel] = useState(null);
  const [personalHistoryRows, setPersonalHistoryRows] = useState([]);
  const [personalExpanded, setPersonalExpanded] = useState(false);
  const [challengeProfiles, setChallengeProfiles] = useState({});
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [standingsRefreshing, setStandingsRefreshing] = useState(false);
  const [standingsRefreshKey, setStandingsRefreshKey] = useState(0);
  const standingsCacheRef = useRef({});

  useEffect(() => {
    if (challengeScope?.type === "circle" && challengeScope.id != null) {
      setExpandedChallengeId(challengeScope.id);
    }
  }, [challengeScope?.id, challengeScope?.type]);

  useEffect(() => {
    if (!challengesLoaded || challengeScope?.type !== "circle") return;
    const stillActive = circleChallenges.some(
      (item) => String(item.challenge_id) === String(challengeScope.id)
    );
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
      const { data } = await supabase
        .from("game_stats")
        .select("game")
        .eq("user_id", userId)
        .gte("completed_at", start.toISOString())
        .lt("completed_at", end.toISOString());
      if (cancelled) return;
      const counts = {};
      (data || []).forEach((row) => { counts[row.game] = (counts[row.game] || 0) + 1; });
      setTodayPlayCounts(counts);
    }
    loadTodayPlayCounts();
    if (!supabaseReady || !userId) return () => { cancelled = true; };
    const detach = attachRealtimeRefresh({
      channelName: `home-today-play-counts-${userId}`,
      tables: [{ name: "game_stats" }],
      refresh: loadTodayPlayCounts,
      fallbackMs: 45000,
    });
    return () => { cancelled = true; detach(); };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    async function loadCircleChallenges() {
      if (!supabaseReady || !userId) return;
      setChallengesLoaded(false);
      const week = currentWeekRange();
      // Finalise expired occurrences before active and history are read. Doing
      // all three calls concurrently caused a just-ended challenge to appear
      // in neither list on Monday until the next refresh.
      await supabase.rpc("finalize_due_circle_challenges");
      if (cancelled) return;
      const [{ data }, { data: personalRows }, { data: circleRows }, { data: rosterData }, { data: lifecycleData }, { data: historyData }] = await Promise.all([
        supabase.rpc("get_my_active_circle_challenges"),
        supabase
          .from("game_stats")
          .select("game,circle_challenge_id,challenge_date")
          .eq("user_id", userId)
          .eq("mode", "challenge")
          .is("circle_challenge_id", null)
          .eq("challenge_date", todayString()),
        supabase
          .from("game_stats")
          .select("game,circle_challenge_id,challenge_date")
          .eq("user_id", userId)
          .eq("mode", "challenge")
          .not("circle_challenge_id", "is", null)
          .gte("challenge_date", week.start)
          .lte("challenge_date", week.end),
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
        if (!cancelled) {
          const grouped = {};
          (rosterData || []).forEach((member) => {
            if (!circleIds.has(Number(member.circle_id))) return;
            if (!grouped[member.circle_id]) grouped[member.circle_id] = [];
            grouped[member.circle_id].push({
              id:member.user_id,
              name:member.member_name,
              icon:member.member_icon,
              show_stats_to_others:member.show_stats_to_others,
            });
          });
          setCircleRosters(grouped);
        }
      } else {
        setCircleRosters({});
      }
    }
    loadCircleChallenges();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!supabaseReady || !userId || playMode !== "challenge") return undefined;
    return attachRealtimeRefresh({
      channelName:`home-standings-${userId}`,
      tables:[{ name:"game_stats" },{ name:"profiles" }],
      refresh:() => setStandingsRefreshKey((value) => value+1),
      fallbackMs:45000,
    });
  },[playMode,userId]);

  useEffect(() => {
    let cancelled = false;
    async function loadChallengeStandings() {
      if (!supabaseReady || !userId || playMode !== "challenge") {
        setChallengeRows([]);
        setChallengeRounds([]);
        setChallengeBenchmarks([]);
        setPreviousChallengeRows([]);
        setPreviousChallengeRounds([]);
        setPreviousChallengeLabel(null);
        setPersonalHistoryRows([]);
        setChallengeProfiles({});
        setStandingsLoading(false);
        setStandingsRefreshing(false);
        return;
      }
      const cacheKey = challengeScope?.type === "circle" ? `circle:${challengeScope.id}` : "personal";
      const activeChallenge = challengeScope?.type === "circle"
        ? circleChallenges.find((item) => String(item.challenge_id) === String(challengeScope.id))
        : null;
      const previousChallenge = activeChallenge
        ? challengeHistory.find((item) =>
            Number(item.circle_id) === Number(activeChallenge.circle_id)
            && item.challenge_title === activeChallenge.challenge_title
          )
        : null;
      setChallengeRounds([]);
      setChallengeBenchmarks([]);
      setPreviousChallengeRows([]);
      setPreviousChallengeRounds([]);
      setPreviousChallengeLabel(
        previousChallenge
          ? challengeWeekLabel(previousChallenge.week_start)
          : challengeScope?.type !== "circle"
            ? "Same day last week"
            : null
      );
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
      const week = currentWeekRange();
      let query = supabase
        .from("game_stats")
        .select("user_id,game,challenge_date,seconds,mistakes,hints,zip_backtracked_cells,zip_required_moves,completed_at,profiles(name,icon,show_stats_to_others)")
        .eq("mode", "challenge");
      query = challengeScope?.type === "circle"
        ? query.eq("circle_challenge_id", challengeScope.id).gte("challenge_date", week.start).lte("challenge_date", week.end)
        : query.is("circle_challenge_id", null).eq("challenge_date", todayString());
      let { data:resultRows,error } = await query;
      if (challengeScope?.type !== "circle") {
        const personalResult = await supabase.rpc("get_personal_challenge_standings", {
          start_date_in:todayString(),
          end_date_in:todayString(),
        });
        if (!personalResult.error) {
          resultRows=(personalResult.data || []).map((row) => ({
            ...row,
            user_id:row.result_user_id,
          }));
          error=null;
        }
      }
      if (cancelled) return;
      const [{ data:roundRows }, { data:benchmarkRows }, { data:personalProfiles }, { data:historyRows }] = await Promise.all([
        challengeScope?.type === "circle"
          ? supabase.from("circle_challenge_rounds")
            .select("challenge_date,game,round_number")
            .eq("challenge_id",challengeScope.id)
            .order("round_number")
          : Promise.resolve({ data:[] }),
        supabase.from("game_time_benchmarks")
          .select("game,day_index,effective_seconds")
          .eq("mode","challenge"),
        challengeScope?.type !== "circle"
          ? supabase.from("profiles")
            .select("id,name,icon,show_stats_to_others")
            .eq("is_approved",true)
            .eq("hidden_from_others",false)
          : Promise.resolve({ data:[] }),
        challengeScope?.type !== "circle"
          ? supabase.rpc("get_personal_challenge_standings", {
            start_date_in:daysAgoDate(7),
            end_date_in:daysAgoDate(1),
          })
          : Promise.resolve({ data:[] }),
      ]);
      if (cancelled) return;

      let previousRows = [];
      let previousRoundRows = [];
      if (previousChallenge) {
        const [{ data:priorResults }, { data:priorRounds }] = await Promise.all([
          supabase.from("game_stats")
            .select("user_id,game,challenge_date,seconds,mistakes,hints,zip_backtracked_cells,zip_required_moves,completed_at")
            .eq("mode","challenge")
            .eq("circle_challenge_id",previousChallenge.challenge_id),
          supabase.from("circle_challenge_rounds")
            .select("challenge_date,game,round_number")
            .eq("challenge_id",previousChallenge.challenge_id)
            .order("round_number"),
        ]);
        if (cancelled) return;
        previousRows = priorResults || [];
        previousRoundRows = priorRounds || [];
      } else if (challengeScope?.type !== "circle") {
        const { data:priorResults } = await supabase.from("game_stats")
          .select("user_id,game,challenge_date,seconds,mistakes,hints,zip_backtracked_cells,zip_required_moves,completed_at")
          .eq("user_id",userId)
          .eq("mode","challenge")
          .is("circle_challenge_id",null)
          .eq("challenge_date",previousWeekDate());
        if (cancelled) return;
        previousRows = priorResults || [];
      }

      let rows = resultRows || [];
      let profiles = rows.flatMap((row) => row.profiles ? [{ id:row.user_id, ...row.profiles }] : []);
      if (error) {
        let fallback = supabase
          .from("game_stats")
          .select("user_id,game,challenge_date,seconds,mistakes,hints,zip_backtracked_cells,zip_required_moves,completed_at")
          .eq("mode", "challenge");
        fallback = challengeScope?.type === "circle"
          ? fallback.eq("circle_challenge_id", challengeScope.id).gte("challenge_date", week.start).lte("challenge_date", week.end)
          : fallback.is("circle_challenge_id", null).eq("challenge_date", todayString());
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
        const profileMap = Object.fromEntries(
          [...(personalProfiles || []),...profiles].map((profile) => [profile.id,profile])
        );
        standingsCacheRef.current[cacheKey] = { rows, profiles:profileMap };
        setChallengeRows(rows);
        setChallengeRounds((roundRows || []).map((round) => ({
          date:round.challenge_date,
          game:round.game,
          roundNumber:round.round_number,
        })));
        setChallengeBenchmarks(benchmarkRows || []);
        setPreviousChallengeRows(previousRows);
        setPersonalHistoryRows((historyRows || []).map((row) => ({
          ...row,
          user_id:row.user_id || row.result_user_id,
        })));
        setPreviousChallengeRounds(previousRoundRows.map((round) => ({
          date:round.challenge_date,
          game:round.game,
          roundNumber:round.round_number,
        })));
        setChallengeProfiles(profileMap);
        setStandingsLoading(false);
        setStandingsRefreshing(false);
      }
    }
    loadChallengeStandings();
    return () => { cancelled = true; };
  }, [userId, playMode, challengeScope?.type, challengeScope?.id, challengeHistory, circleChallenges, standingsRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadProgress() {
      if (!supabaseReady || !userId) return;
      await supabase.rpc("ensure_player_progress", { uid: userId });
      const { data } = await supabase
        .from("player_progress")
        .select("available_points,challenge_current_streak")
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
            visible: cfg ? cfg.visible : !g.requiresConfig,
            challengeEnabled: typeof cfg?.challenge_enabled === "boolean"
              ? cfg.challenge_enabled
              : g.challenge === true,
            sortOrder: cfg ? cfg.sort_order : i,
          };
        })
        .filter((g) => g.visible)
        .sort((a, b) => a.sortOrder - b.sortOrder);
  const visibleGames = configuredGames
    .filter((game) => {
      if (playMode !== "challenge") return true;
      if (challengeScope?.type === "circle") {
        return (challengeScope.gameIds || []).includes(game.id);
      }
      return game.challengeEnabled;
    });
  const personalGameIds = configuredGames
    .filter((game) => game.available && game.challengeEnabled)
    .map((game) => game.id);
  const personalCompleted = challengeCompletions.personal || new Set();
  const challengeStatus = (circleChallenge) => {
    const requiredItems = circleChallenge
      ? buildCircleChallengeRounds({
        activeDays:circleChallenge.active_days,
        gameIds:circleChallenge.game_ids,
      }).map((round) => round.date)
      : personalGameIds;
    const completed = circleChallenge
      ? challengeCompletions[String(circleChallenge.challenge_id)] || new Set()
      : personalCompleted;
    return challengeProgress(requiredItems, completed);
  };
  const personalStatus = challengeStatus(null);
  const circleStatusLabel = (circleChallenge, status) => {
    const lifecycle = challengeLifecycle[String(circleChallenge.challenge_id)];
    if (lifecycle?.winner_id) {
      return lifecycle.winner_id === userId
        ? "Finished · You won"
        : `Finished · ${lifecycle.winner_name || "A circlemate"} won`;
    }
    if (lifecycle?.current_user_finished || status.done) {
      const waiting = Math.max(0, Number(lifecycle?.member_count || 0) - Number(lifecycle?.finished_count || 0));
      return waiting > 0 ? `You finished · waiting for ${waiting}` : "You finished · finalising";
    }
    if (status.completed === 0) return "Not started";
    return `${status.remaining} ${status.remaining === 1 ? "round" : "rounds"} left`;
  };
  const challengeItems = [
    { key:"personal", type:"personal", active_today:true, status:personalStatus },
    ...circleChallenges.map((item) => ({
      ...item,
      key:String(item.challenge_id),
      type:"circle",
      status:challengeStatus(item),
      today_done:(challengeCompletions[String(item.challenge_id)] || new Set()).has(todayString()),
    })),
  ];
  // Until both inputs are loaded, an empty completion set does not mean the
  // player has completed nothing. Treating it that way made the Challenge tab
  // briefly show "1" whenever Home remounted after a Practice game, then hide
  // it again as soon as the real Challenge completions arrived.
  const pendingChallenges = challengesLoaded && !gameConfigLoading
    ? challengeItems.filter((item) =>
        item.active_today && item.status.remaining > 0 && !item.today_done
      )
    : [];
  const selectedCircle = challengeScope?.type === "circle"
    ? circleChallenges.find((item) => String(item.challenge_id) === String(challengeScope.id))
    : null;
  const todayCompletions = challengeScope?.type === "circle"
    ? challengeCompletions[String(challengeScope.id)] || new Set()
    : personalCompleted;
  const selectedRoster = selectedCircle ? circleRosters[selectedCircle.circle_id] || [] : [];
  const selectedChallengeGameIds = challengeScope?.type === "circle"
    ? selectedCircle?.game_ids || challengeScope.gameIds || []
    : personalGameIds;
  const selectedChallengeGames = selectedChallengeGameIds
    .map((id) => configuredGames.find((game) => game.id === id) || GAME_META.find((game) => game.id === id))
    .filter(Boolean);
  const standingsRoster = challengeScope?.type === "circle"
    ? selectedRoster
    : Object.values(challengeProfiles);
  const selectedChallengeStatus = selectedCircle ? challengeStatus(selectedCircle) : null;
  const selectedRounds = selectedCircle
    ? challengeRounds.length
      ? challengeRounds
      : buildCircleChallengeRounds({
        activeDays:selectedCircle.active_days,
        gameIds:selectedCircle.game_ids,
      })
    : [];
  const todayRound = selectedRounds.find((round) => round.date === localDateString());
  const todayRoundDone = !!todayRound && todayCompletions.has(todayRound.date);
  const circleChallengeIsActive = playMode === "challenge" && challengeScope?.type === "circle";
  const selectedChallengePlayable = !circleChallengeIsActive
    || (selectedCircle?.active_today && !!todayRound && !todayRoundDone);

  function choosePersonalChallenge() {
    const alreadySelected = challengeScope?.type !== "circle";
    onChallengeScopeChange({ type:"personal",id:null,name:"My Challenge",gameIds:null });
    setPersonalExpanded(alreadySelected ? (value) => !value : true);
    setExpandedChallengeId(null);
  }

  function chooseCircleChallenge(circleChallenge) {
    onChallengeScopeChange({
      type:"circle",
      id:circleChallenge.challenge_id,
      circleId:circleChallenge.circle_id,
      name:circleChallenge.challenge_title || circleChallenge.circle_name,
      circleName:circleChallenge.circle_name,
      challengeTitle:circleChallenge.challenge_title || "Weekly challenge",
      emoji:circleChallenge.circle_emoji,
      gameIds:circleChallenge.game_ids,
      rewardPoints:circleChallenge.reward_points,
      activeDays:circleChallenge.active_days,
      dailyRounds:buildCircleChallengeRounds({
        activeDays:circleChallenge.active_days,
        gameIds:circleChallenge.game_ids,
      }),
      stakeRewardId:circleChallenge.stake_reward_id,
      stakeRewardName:circleChallenge.stake_reward_name,
      stakeSplitMethod:circleChallenge.stake_split_method,
      stakeAccepted:circleChallenge.stake_accepted,
    });
  }

  return (
    <Page style={{ alignItems: "flex-start" }}>
      <main style={{ padding: "var(--space-5) 0 var(--space-8)" }}>
        <header style={{ marginBottom: "var(--space-5)", paddingRight: "56px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <span aria-hidden="true" style={{ fontSize: 22 }}>🧩</span>
            <h1 style={{ margin: 0, color: "var(--color-text-primary)", fontSize: "var(--text-page-title-size)", lineHeight: "var(--text-page-title-line)", fontWeight: "var(--text-page-title-weight)" }}>
              I&apos;mBoredToday
            </h1>
          </div>
          <p style={{ margin: "var(--space-1) 0 0", color: "var(--color-text-secondary)", fontSize: "var(--text-page-subtitle-size)" }}>{t("home.tagline")}</p>
        </header>

        {onOpenProgress && (
          <button
            type="button"
            onClick={onOpenProgress}
            className="home-progress-control"
            aria-busy={!progress}
            style={{
              ...buttonReset,
              minHeight: "var(--control-height-md)",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              marginBottom: "var(--space-4)",
              padding: "0 var(--space-3)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-full)",
              background: "var(--color-surface)",
              boxShadow: "var(--shadow-control)",
              color: "var(--color-text-primary)",
            }}
            aria-label={progress
              ? `Open My Progress — ${(progress.available_points || 0).toLocaleString(language === "sk" ? "sk-SK" : "en")} ${t("home.points")}, ${progress.challenge_current_streak || 0} ${progress.challenge_current_streak === 1 ? t("home.day") : t("home.days")}`
              : "Open My Progress — values loading"}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--text-caption-size)", fontWeight: 600 }}>
              <Star size={15} fill="currentColor" style={{ color: "var(--color-warning-gold)" }} />
              {progress
                ? (progress.available_points || 0).toLocaleString(language === "sk" ? "sk-SK" : "en")
                : <span aria-hidden="true" style={{ width: 28, height: 10, borderRadius: "var(--radius-full)", background: "var(--color-surface-elevated)" }} />}
            </span>
            <span aria-hidden="true" style={{ width: 1, height: 16, background: "var(--color-border)" }} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--text-caption-size)", fontWeight: 600 }}>
              <Flame size={15} style={{ color: "var(--color-danger-solid)" }} />
              {progress
                ? progress.challenge_current_streak || 0
                : <span aria-hidden="true" style={{ width: 14, height: 10, borderRadius: "var(--radius-full)", background: "var(--color-surface-elevated)" }} />}
            </span>
            <ChevronRight size={15} style={{ color: "var(--color-icon-subtle)" }} />
          </button>
        )}

        {onPlayModeChange && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-2)" }}>
            <div role="group" aria-label="Play mode" style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: "var(--radius-full)", background: "var(--color-surface-elevated)", border: "1px solid var(--color-border)" }}>
              {["challenge", "practice"].map((mode) => {
                const active = playMode === mode;
                return (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => onPlayModeChange(mode)}
                    aria-pressed={active}
                    style={{
                      ...buttonReset,
                      minHeight: "var(--control-height-sm)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      padding: "0 var(--space-4)",
                      border: active ? "1px solid var(--color-primary-subtle-border)" : "1px solid transparent",
                      borderRadius: "var(--radius-full)",
                      background: active ? "var(--color-surface)" : "transparent",
                      boxShadow: active ? "var(--shadow-control)" : "none",
                      color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
                      fontSize: "var(--text-button-size)",
                      fontWeight: 600,
                    }}
                  >
                    {t(`common.${mode}`)}
                    {mode === "challenge" && pendingChallenges.length > 0 && (
                      <span aria-label={t("home.pendingChallenges", { count: pendingChallenges.length })} style={{ minWidth: 20, height: 20, display: "grid", placeItems: "center", padding: "0 6px", borderRadius: "var(--radius-full)", background: "var(--color-danger-solid)", color: "var(--color-primary-text)", fontSize: 11, fontWeight: 700 }}>
                        {pendingChallenges.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p style={{ margin: "0 0 var(--space-5)", textAlign: "center", color: "var(--color-text-secondary)", fontSize: "var(--text-body-secondary-size)" }}>
          {playMode === "challenge" ? t("home.challengeHint") : t("home.practiceHint")}
        </p>

        {playMode === "challenge" && onChallengeScopeChange && (
          <Card style={{ marginBottom: "var(--space-6)", padding: "var(--space-3)" }}>
            <button
              type="button"
              onClick={choosePersonalChallenge}
              aria-expanded={challengeScope?.type !== "circle" && personalExpanded}
              style={{
                ...buttonReset,
                width: "100%",
                minHeight: 68,
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                padding: "var(--space-3)",
                textAlign: "left",
                border: challengeScope?.type !== "circle" ? "1px solid var(--color-primary-subtle-border)" : "1px solid transparent",
                borderRadius: "var(--radius-md)",
                background: challengeScope?.type !== "circle" ? "var(--color-primary-subtle)" : "transparent",
              }}
            >
              <span aria-hidden="true" style={{ width: 44, height: 44, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: "var(--radius-md)", background: "var(--color-info-bg)", fontSize: 21 }}>🎯</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block", color: "var(--color-text-primary)", fontSize: "var(--text-body-size)" }}>{t("home.myChallenge")}</strong>
                <span style={{ display: "block", height: 7, marginTop: "var(--space-2)", overflow: "hidden", borderRadius: "var(--radius-full)", background: "var(--color-border)" }}>
                  <span style={{ display: "block", width: `${personalStatus.total ? (personalStatus.completed / personalStatus.total) * 100 : 0}%`, height: "100%", borderRadius: "inherit", background: personalStatus.done ? "var(--color-success-text)" : "var(--color-primary)" }} />
                </span>
              </span>
              <span style={{ flexShrink: 0, padding: "5px 9px", borderRadius: "var(--radius-full)", background: personalStatus.done ? "var(--color-success-bg)" : "var(--color-info-bg)", color: personalStatus.done ? "var(--color-success-text)" : "var(--color-info-text)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>
                {personalStatus.done ? "Completed today" : t("home.gamesLeft", { count: personalStatus.remaining })}
              </span>
            </button>

            {challengeScope?.type !== "circle" && personalExpanded && (
              <ChallengeStandings rows={challengeRows} roster={standingsRoster} games={selectedChallengeGames} benchmarks={challengeBenchmarks} previousRows={previousChallengeRows} historyRows={personalHistoryRows} previousWeekLabel={previousChallengeLabel} userId={userId} loading={standingsLoading} refreshing={standingsRefreshing} defaultOpen embedded />
            )}

            {circleChallenges.length > 0 && (
              <section style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: "var(--space-2)" }}>
                  <h2 style={{ flex: 1, margin: 0, color: "var(--color-text-primary)", fontSize: "var(--text-section-title-size)", fontWeight: "var(--text-section-title-weight)" }}>{t("home.circleChallenges")}</h2>
                  <span style={{ padding: "3px 8px", borderRadius: "var(--radius-full)", background: "var(--color-surface-elevated)", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>{circleChallenges.length}</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {circleChallenges.map((item) => {
                    const status = challengeStatus(item);
                    const lifecycle = challengeLifecycle[String(item.challenge_id)];
                    const lifecycleLabel = circleStatusLabel(item, status);
                    const challengeFinished = !!lifecycle?.winner_id;
                    const playerFinished = !!lifecycle?.current_user_finished || status.done;
                    const selected = challengeScope?.type === "circle" && String(challengeScope.id) === String(item.challenge_id);
                    const expanded = String(expandedChallengeId) === String(item.challenge_id);
                    const roster = circleRosters[item.circle_id] || [];
                    const games = (item.game_ids || []).map((id) => configuredGames.find((game) => game.id === id) || GAME_META.find((game) => game.id === id)).filter(Boolean);
                    const itemRounds = buildCircleChallengeRounds({ activeDays: item.active_days, gameIds: item.game_ids });
                    const statusTone = challengeFinished ? "warning" : playerFinished ? "success" : status.completed === 0 ? "muted" : "danger";
                    const tone = {
                      warning: ["var(--color-warning-bg)", "var(--color-warning-text)"],
                      success: ["var(--color-success-bg)", "var(--color-success-text)"],
                      danger: ["var(--color-danger-bg)", "var(--color-danger-text)"],
                      muted: ["var(--color-surface-elevated)", "var(--color-text-secondary)"],
                    }[statusTone];

                    return (
                      <div key={item.challenge_id} style={{ overflow: "hidden", border: `1px solid ${selected ? "var(--color-primary-subtle-border)" : "var(--color-border)"}`, borderRadius: "var(--radius-md)", background: selected ? "var(--color-primary-subtle)" : "var(--color-surface-elevated)" }}>
                        <button
                          type="button"
                          onClick={() => { setExpandedChallengeId(expanded ? null : item.challenge_id); chooseCircleChallenge(item); }}
                          aria-expanded={expanded}
                          style={{ ...buttonReset, width: "100%", minHeight: 64, display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3)", textAlign: "left", border: 0, background: "transparent" }}
                        >
                          <span aria-hidden="true" style={{ width: 42, height: 42, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: "var(--radius-md)", background: "var(--color-surface)", fontSize: 20 }}>{item.circle_emoji || "⭐"}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", color: "var(--color-text-primary)", fontSize: "var(--text-body-size)", fontWeight: 700 }}>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.challenge_title || item.circle_name}</span>
                              {selected && <Check size={14} strokeWidth={3} style={{ flexShrink: 0, color: "var(--color-primary)" }} />}
                            </span>
                            <span style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>{item.circle_name}</span>
                          </span>
                          <span style={{ flexShrink: 0, textAlign: "right" }}>
                            <span style={{ display: "inline-flex", padding: "4px 8px", borderRadius: "var(--radius-full)", background: tone[0], color: tone[1], fontSize: "var(--text-caption-size)", fontWeight: 600 }}>{lifecycleLabel}</span>
                            {!item.active_today && <span style={{ display: "block", marginTop: 3, color: "var(--color-text-muted)", fontSize: "var(--text-caption-size)" }}>Not scheduled today</span>}
                          </span>
                          <ChevronDown size={17} style={{ flexShrink: 0, color: "var(--color-icon-subtle)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform var(--transition-fast)" }} />
                        </button>

                        {expanded && (
                          <div style={{ padding: "0 var(--space-3) var(--space-3)" }}>
                            <div style={{ padding: "var(--space-3)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-surface)" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
                                {games.map((game) => {
                                  const GameIcon = game.icon;
                                  return <span key={game.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 8px", borderRadius: "var(--radius-full)", background: accentSurface(game.accent), color: game.accent, fontSize: "var(--text-caption-size)", fontWeight: 600 }}><GameIcon size={13} />{game.label}</span>;
                                })}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginTop: "var(--space-2)" }}>
                                {itemRounds.map((round) => <span key={round.date} style={{ padding: "4px 7px", borderRadius: "var(--radius-full)", background: "var(--color-surface-elevated)", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>{DAY_LABELS[round.isoDay - 1]} · {round.game}</span>)}
                              </div>
                              <p style={{ margin: "var(--space-2) 0 0", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>
                                {item.repeats_weekly ? `Week ${item.occurrence_number} of ${item.series_weeks}` : "One week only"}
                                {item.closes_on ? ` · closes after ${new Date(`${item.closes_on}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}` : ""}
                              </p>
                              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                                <AvatarGroup members={roster} />
                                <span style={{ color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>{t("home.members", { count: roster.length })}</span>
                                <span style={{ marginLeft: "auto", color: "var(--color-warning-text)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>+{item.reward_points || 0} {t("home.points")}</span>
                                {onOpenCircles && <Button variant="secondary" size="sm" before={<Users size={14} />} onClick={() => onOpenCircles({ circleId: item.circle_id, challengeId: item.challenge_id })}>{t("home.circleDetails")}</Button>}
                              </div>
                            </div>
                            {selected && <ChallengeStandings rows={challengeRows} roster={standingsRoster} games={selectedChallengeGames} rounds={challengeRounds.length ? challengeRounds : selectedRounds} benchmarks={challengeBenchmarks} previousRows={previousChallengeRows} previousRounds={previousChallengeRounds} previousWeekLabel={previousChallengeLabel} isCircle userId={userId} loading={standingsLoading || !selectedCircle} refreshing={standingsRefreshing} defaultOpen embedded rewardPoints={challengeScope?.rewardPoints || 0} closed={!!challengeLifecycle[String(challengeScope.id)]?.closed_at} winnerId={challengeLifecycle[String(challengeScope.id)]?.winner_id} stakeRewardName={challengeScope?.stakeRewardName || null} stakeSplitMethod={challengeScope?.stakeSplitMethod || null} />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {challengeHistory.length > 0 && (
              <details style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                <summary style={{ ...buttonReset, display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-1)", listStyle: "none" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block", color: "var(--color-text-primary)", fontSize: "var(--text-body-size)" }}>Challenge history</strong>
                    <span style={{ display: "block", marginTop: 2, color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>Your latest circle results</span>
                  </span>
                  <span style={{ color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>{Math.min(challengeHistory.length, 5)} recent</span>
                  <ChevronDown size={17} style={{ color: "var(--color-icon-subtle)" }} />
                </summary>
                <div style={{ marginTop: "var(--space-2)", overflow: "hidden", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-surface-elevated)" }}>
                  {challengeHistory.slice(0, 5).map((item, index) => {
                    const isWinner = item.winner_id === userId;
                    const hasWinner = !!item.winner_id;
                    const entries = Number(item.entry_count) || 0;
                    const finishers = Number(item.finisher_count) || 0;
                    const resultLabel = isWinner ? "You won" : hasWinner ? `${item.winner_name || "Circlemate"} won` : "No winner";
                    return (
                      <div key={item.challenge_id} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3)", borderTop: index ? "1px solid var(--color-border)" : "none" }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-primary)", fontSize: "var(--text-body-secondary-size)" }}>{item.challenge_title || item.circle_name}</strong>
                          <span style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>{item.circle_name} · {challengeWeekLabel(item.week_start)}</span>
                        </span>
                        <span style={{ flexShrink: 0, textAlign: "right" }}>
                          <span style={{ display: "inline-flex", padding: "4px 8px", borderRadius: "var(--radius-full)", background: isWinner ? "var(--color-success-bg)" : hasWinner ? "var(--color-info-bg)" : "var(--color-surface)", color: isWinner ? "var(--color-success-text)" : hasWinner ? "var(--color-info-text)" : "var(--color-text-secondary)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>{resultLabel}</span>
                          <span style={{ display: "block", marginTop: 4, color: "var(--color-text-muted)", fontSize: "var(--text-caption-size)" }}>{entries > 0 ? `${finishers}/${entries} finished` : "No entries"}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </Card>
        )}

        {playMode === "challenge" && challengeScope?.type === "circle" && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)", padding: "var(--space-3) var(--space-4)", border: "1px solid var(--color-primary-subtle-border)", borderRadius: "var(--radius-md)", background: "var(--color-primary-subtle)" }}>
            <span aria-hidden="true" style={{ fontSize: 22 }}>{challengeScope.emoji || "⭐"}</span>
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-primary)", fontSize: "var(--text-body-size)" }}>{challengeScope.name}</strong>
              <small style={{ display: "block", marginTop: 2, color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>{todayRound ? todayRoundDone ? "Today’s round completed" : "Play today’s assigned round" : "No round scheduled today"}</small>
            </span>
          </div>
        )}

        {gameConfigLoading ? (
          <div aria-live="polite" className="home-game-skeleton-grid" style={{ width: "100%", maxWidth: 400, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-3)" }}>
            {[0, 1, 2, 3].map((item) => <div key={item} className="home-skeleton" style={{ width: "100%", aspectRatio: "5 / 4", borderRadius: "var(--radius-lg)", background: "var(--color-surface-elevated)", border: "1px solid var(--color-border)" }} />)}
          </div>
        ) : (
          <div className="home-game-grid" style={{ width: "100%", maxWidth: 400, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-3)" }}>
            {visibleGames.filter((game) => game.live || !circleChallengeIsActive || (!!todayRound && game.id === todayRound.game)).map((game) => {
              const Icon = game.icon;
              const canOpenGame = game.available && (game.live || selectedChallengePlayable);
              const completed = !game.live && challengesLoaded && (challengeScope?.type === "circle" ? todayRoundDone : todayCompletions.has(game.id));
              return (
                <button
                  type="button"
                  key={game.id}
                  disabled={!canOpenGame}
                  onClick={() => canOpenGame && onSelect(game.id)}
                  className={`home-game-tile home-game-tile--${game.id}${SHARED_ARTWORK_TILES.has(game.id) ? " home-game-tile--artwork" : ""}`}
                  style={{
                    ...buttonReset,
                    position: "relative",
                    width: "100%",
                    minHeight: 0,
                    aspectRatio: "5 / 4",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "var(--space-3)",
                    padding: "var(--space-4)",
                    textAlign: "left",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-lg)",
                    background: "var(--color-surface)",
                    boxShadow: "var(--shadow-card)",
                    cursor: canOpenGame ? "pointer" : "not-allowed",
                    transition: "transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast)",
                  }}
                >
                  {completed && <span title={t("home.alreadyPlayed")} style={{ position: "absolute", top: 12, left: 12, width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--color-info-bg)" }}><Check size={13} style={{ color: "var(--color-info-text)" }} strokeWidth={3} /></span>}
                  <span aria-hidden="true" style={{ width: 44, height: 44, display: "grid", placeItems: "center", borderRadius: "var(--radius-md)", background: game.tileBackground || accentSurface(game.accent), color: game.accent }}><Icon size={game.tileIconSize || 22} /></span>
                  <span>
                    <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                      <strong style={{ color: "var(--color-text-primary)", fontSize: "var(--text-body-size)" }}>{game.label}</strong>
                      {game.live && <span style={{ padding: "3px 6px", borderRadius: "var(--radius-full)", background: "var(--color-success-bg)", color: "var(--color-success-text)", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Live</span>}
                    </span>
                    <span style={{ display: "block", marginTop: 3, color: "var(--color-text-secondary)", fontSize: "var(--text-body-secondary-size)", lineHeight: "var(--text-body-line)" }}>{t(`game.${game.id}.desc`)}</span>
                    {playMode === "practice" && !!todayPlayCounts[game.id] && <span style={{ display: "block", marginTop: "var(--space-1)", color: "var(--color-text-muted)", fontSize: "var(--text-caption-size)", fontWeight: 600 }}>Played {todayPlayCounts[game.id]}× today</span>}
                  </span>
                  {!game.available && <span style={{ marginTop: "auto", color: "var(--color-text-muted)", fontSize: "var(--text-caption-size)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("home.comingSoon")}</span>}
                </button>
              );
            })}
          </div>
        )}
      </main>

      <style>{`
        .home-progress-control:focus-visible,
        .home-game-tile:focus-visible,
        main button:focus-visible,
        main summary:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .home-game-tile:disabled {
          background: var(--color-surface-elevated) !important;
          box-shadow: none !important;
        }
        @media (hover: hover) and (pointer: fine) {
          .home-game-tile:not(:disabled):hover {
            transform: translateY(-2px);
            border-color: var(--color-primary-subtle-border);
            box-shadow: var(--shadow-card-hover);
          }
        }
        @media (max-width: 319px) {
          .home-game-grid,
          .home-game-skeleton-grid {
            max-width: 250px !important;
            grid-template-columns: minmax(0, 1fr) !important;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .home-game-tile { transition: none !important; }
          .home-game-tile:hover { transform: none !important; }
          .home-skeleton { animation: none !important; }
        }
      `}</style>
    </Page>
  );
}
