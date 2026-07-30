import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Copy,
  Loader2,
  LogOut,
  Play,
  Radio,
  RotateCcw,
  Share2,
  Shield,
  Smartphone,
  Trophy,
  Users,
  Wifi,
  X,
} from "lucide-react";
import { useAuth } from "../lib/AuthContext.jsx";
import { supabase, supabaseReady } from "../lib/supabase.js";
import GameHomeButton from "../GameHomeButton.jsx";
import AnimalDie from "./animalRush/AnimalDie.jsx";
import AnimalFace from "./animalRush/AnimalFace.jsx";
import BotMatch from "./animalRush/BotMatch.jsx";
import {
  DIE_ROLL_DURATION_MS,
  COLOUR_MODES,
  DIFFICULTY_MODES,
  animalById,
  cardsConcealed,
  countdownNumber,
  inviteUrl,
  isPhoneDevice,
  matchIntroCountdown,
  playerRoundOutcome,
  rankPlayers,
  roundPhase,
  targetIsRevealed,
  visibleCardOrder,
} from "./animalRush/engine.js";
import "./animalRush/animal-rush.css";

const ROOM_STORAGE_PREFIX = "imbored-animal-rush-room-";
/** Lobby rooms older than this are considered stale and auto-cleaned on page load. */
const LOBBY_STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours

function useReducedMotionPreference() {
  const [enabled, setEnabled] = useState(() =>
    typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
  );

  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!preference) return undefined;
    const onChange = (event) => setEnabled(event.matches);
    setEnabled(preference.matches);
    if (preference.addEventListener) preference.addEventListener("change", onChange);
    else preference.addListener?.(onChange);
    return () => {
      if (preference.removeEventListener) preference.removeEventListener("change", onChange);
      else preference.removeListener?.(onChange);
    };
  }, []);

  return enabled;
}

function phoneSupported() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return isPhoneDevice({
    userAgent: navigator.userAgent,
    userAgentMobile: navigator.userAgentData?.mobile,
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: window.matchMedia?.("(pointer: coarse)")?.matches === true,
  });
}

function DifficultySelector({ value, onChange, disabled = false, label = "Difficulty" }) {
  return (
    <fieldset className="rush-difficulty">
      <legend>{label}</legend>
      <div>
        {DIFFICULTY_MODES.map((mode) => (
          <button
            type="button"
            key={mode.id}
            data-selected={value === mode.id}
            onClick={() => onChange?.(mode.id)}
            disabled={disabled}
          >
            <strong>{mode.label}</strong>
            <small>{mode.description}</small>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ColourModeSelector({ value, onChange, disabled = false, label = "Animal colours" }) {
  return (
    <fieldset className="rush-difficulty rush-difficulty--colours">
      <legend>{label}</legend>
      <div>
        {COLOUR_MODES.map((mode) => (
          <button
            type="button"
            key={mode.id}
            data-selected={value === mode.id}
            onClick={() => onChange?.(mode.id)}
            disabled={disabled}
          >
            <strong>{mode.label}</strong>
            <small>{mode.description}</small>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function PlayerRow({ player, currentUserId, winnerId, synchronised }) {
  const isYou = player.user_id === currentUserId;
  const isWinner = player.user_id === winnerId;
  return (
    <div className="rush-player" data-eliminated={player.eliminated || !!player.left_at}>
      <span className="rush-avatar">{player.player_icon || "🙂"}</span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[13px]">
          {player.player_name}{isYou ? " · You" : ""}
        </strong>
        <small className="rush-muted block text-[10px]">
          {player.left_at
            ? "Left the room"
            : player.eliminated
              ? "Eliminated"
              : typeof synchronised === "boolean"
                ? synchronised ? "Synchronised" : "Synchronising phone…"
                : `${player.rounds_won || 0} rounds won`}
        </small>
      </span>
      {typeof synchronised === "boolean" && (
        <span className="rush-sync-dot" data-ready={synchronised} aria-hidden="true" />
      )}
      {isWinner && <Trophy size={16} color="#F2C66D" />}
      <span className="rush-token rush-token--shield"><Shield size={11} />{player.safety_cards || 0}</span>
      <span className="rush-token rush-token--card"><span>◆</span>{player.won_cards || 0}</span>
    </div>
  );
}

function PlayerChip({ player, currentUserId }) {
  return (
    <div className="rush-player-chip" data-eliminated={player.eliminated || !!player.left_at}>
      <span className="rush-player-chip__avatar">{player.player_icon || "🙂"}</span>
      <strong className="truncate text-[10px]">
        {player.user_id === currentUserId ? "You" : player.player_name}
      </strong>
      <span className="rush-player-chip__score">🛡{player.safety_cards || 0} · ◆{player.won_cards || 0}</span>
    </div>
  );
}

function PhoneOnly({ onExit }) {
  return (
    <div className="animal-rush rush-phone-only">
      <GameHomeButton onClick={onExit} />
      <div className="rush-panel w-full max-w-sm p-7">
        <span className="rush-icon-panel rush-icon-panel--mint mx-auto grid h-16 w-16 place-items-center rounded-3xl">
          <Smartphone size={30} />
        </span>
        <p className="rush-kicker mt-5">Phone-only live game</p>
        <h1 className="mt-2 text-3xl font-bold" style={{ fontFamily: "'Fredoka', sans-serif" }}>Animal Rush</h1>
        <p className="rush-muted mt-3 text-sm leading-relaxed">
          Finding an animal by mouse is not the same as reaching for it. Open ImBored on a phone so every player competes with direct touch.
        </p>
        <p className="rush-address mt-5 rounded-2xl px-4 py-3 text-sm font-semibold">imbored.au</p>
      </div>
    </div>
  );
}

export default function AnimalRush({ onExit }) {
  const { user, profile } = useAuth();
  const supported = useMemo(phoneSupported, []);
  const reducedMotion = useReducedMotionPreference();
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [joinCode, setJoinCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("rush")?.toUpperCase() || "";
  });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [joinError, setJoinError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [attemptFeedback, setAttemptFeedback] = useState(null);
  const [botMode, setBotMode] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState("standard");
  const [botColourMode, setBotColourMode] = useState("uniform");
  const [clockRtt, setClockRtt] = useState(null);
  const attemptRef = useRef(false);
  const roundRef = useRef(null);
  const advanceRef = useRef(null);
  const revealBuzzRef = useRef(null);
  const roomStorageKey = `${ROOM_STORAGE_PREFIX}${user?.id || "guest"}`;

  const refreshRoom = useCallback(async (roomId, quiet = false) => {
    if (!supabaseReady || !roomId) {
      if (!quiet) setLoading(false);
      return null;
    }
    const [{ data: nextRoom, error: roomError }, { data: nextPlayers, error: playersError }] = await Promise.all([
      supabase.from("animal_rush_rooms").select("*").eq("id", roomId).maybeSingle(),
      supabase.from("animal_rush_players").select("*").eq("room_id", roomId).order("joined_at"),
    ]);
    if (roomError || playersError) {
      const error = roomError || playersError;
      if (!quiet) {
        setMessage(
          error.code === "42P01" || /animal_rush/i.test(error.message || "")
            ? "Animal Rush needs its Supabase migration before it can open."
            : error.message,
        );
        setLoading(false);
      }
      return null;
    }
    if (!nextRoom) {
      window.localStorage.removeItem(roomStorageKey);
      setRoom(null);
      setPlayers([]);
      setLoading(false);
      return null;
    }
    const nextPlayersList = nextPlayers || [];
    // If the current user is no longer a player and the room is in lobby,
    // treat it as stale — clear the saved room so they can start fresh.
    if (
      nextRoom.status === "lobby"
      && user?.id
      && !nextPlayersList.some((p) => p.user_id === user.id)
    ) {
      window.localStorage.removeItem(roomStorageKey);
      setRoom(null);
      setPlayers([]);
      setLoading(false);
      return null;
    }
    setRoom(nextRoom);
    setPlayers(nextPlayersList);
    setLoading(false);
    return nextRoom;
  }, [roomStorageKey]);

  const synchroniseClock = useCallback(async () => {
    const samples = await Promise.all(Array.from({ length: 5 }, async () => {
      const sentAt = Date.now();
      const { data, error } = await supabase.rpc("animal_rush_server_time");
      const receivedAt = Date.now();
      if (error || !data) return null;
      return {
        rtt: receivedAt - sentAt,
        offset: new Date(data).getTime() - ((sentAt + receivedAt) / 2),
      };
    }));
    const best = samples.filter(Boolean).sort((left, right) => left.rtt - right.rtt)[0];
    if (best) {
      setServerOffset(best.offset);
      setClockRtt(best.rtt);
    }
    return best || null;
  }, []);

  useEffect(() => {
    if (!supported || !user?.id || !supabaseReady) {
      setLoading(false);
      return;
    }
    void synchroniseClock();
    const raw = window.localStorage.getItem(roomStorageKey);
    if (!raw) {
      setLoading(false);
      return;
    }
    // Parse saved room data — stored as JSON with a timestamp so we can
    // detect and discard stale lobby rooms that were joined hours ago.
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      // Legacy: plain room ID string, migrate it to timestamped format.
      parsed = { id: raw };
    }
    const savedRoomId = typeof parsed === "object" && parsed?.id ? parsed.id : null;
    if (!savedRoomId) {
      window.localStorage.removeItem(roomStorageKey);
      setLoading(false);
      return;
    }
    // If the room was saved more than 3 hours ago, treat it as stale
    // and clear it so the user starts with a fresh game screen.
    const savedAt = typeof parsed?.savedAt === "number" ? parsed.savedAt : 0;
    if (savedAt > 0 && Date.now() - savedAt > LOBBY_STALE_THRESHOLD_MS) {
      window.localStorage.removeItem(roomStorageKey);
      setLoading(false);
      return;
    }
    void refreshRoom(savedRoomId);
  }, [refreshRoom, roomStorageKey, supported, synchroniseClock, user?.id]);

  useEffect(() => {
    if (!room?.id) return undefined;
    const refresh = () => void refreshRoom(room.id, true);
    const channel = supabase
      .channel(`animal-rush-${room.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "animal_rush_rooms",
        filter: `id=eq.${room.id}`,
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "animal_rush_players",
        filter: `room_id=eq.${room.id}`,
      }, refresh)
      .subscribe();
    const fallback = window.setInterval(refresh, 4000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void synchroniseClock();
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(fallback);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [refreshRoom, room?.id, synchroniseClock]);

  useEffect(() => {
    if (!room?.id || room.status === "lobby" || room.status === "finished") return undefined;
    const timer = window.setInterval(() => void synchroniseClock(), 20000);
    return () => window.clearInterval(timer);
  }, [room?.id, room?.status, synchroniseClock]);

  useEffect(() => {
    if (room?.status !== "lobby" || !room?.id || !user?.id || !supabaseReady) return undefined;
    let disposed = false;
    let measuredRtt = clockRtt;

    const heartbeat = async (resynchronise = false) => {
      if (resynchronise || measuredRtt === null) {
        const sample = await synchroniseClock();
        if (!sample || disposed) return;
        measuredRtt = sample.rtt;
      }
      await supabase.rpc("animal_rush_set_ready", {
        target_room_id: room.id,
        measured_rtt_ms: measuredRtt,
      });
      if (!disposed) void refreshRoom(room.id, true);
    };

    void heartbeat(true);
    const timer = window.setInterval(() => void heartbeat(false), 10000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void heartbeat(true);
      else void supabase.rpc("animal_rush_set_not_ready", { target_room_id: room.id });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshRoom, room?.id, room?.match_number, room?.status, synchroniseClock, user?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!room?.reveal_at) return undefined;
    const revealAt = new Date(room.reveal_at).getTime();
    const clientRevealAt = revealAt - serverOffset;
    const remaining = clientRevealAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return undefined;
    const timer = window.setTimeout(() => setNow(clientRevealAt), remaining);
    return () => window.clearTimeout(timer);
  }, [room?.reveal_at, serverOffset]);

  useEffect(() => {
    if (!room?.shuffle_at) return undefined;
    const shuffleAt = new Date(room.shuffle_at).getTime();
    const clientShuffleAt = shuffleAt - serverOffset;
    const remaining = clientShuffleAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return undefined;
    const timer = window.setTimeout(() => setNow(clientShuffleAt), remaining);
    return () => window.clearTimeout(timer);
  }, [room?.shuffle_at, serverOffset]);

  useEffect(() => {
    if (roundRef.current === room?.round_number) return;
    roundRef.current = room?.round_number;
    attemptRef.current = false;
    setAttemptFeedback(null);
  }, [room?.round_number]);

  const serverNow = now + serverOffset;
  const phase = roundPhase(room, serverNow);
  const introCountdown = matchIntroCountdown(room, serverNow);
  const introActive = introCountdown !== null;
  const preparingMatch = room?.status === "countdown"
    && Number(room?.round_number) === 1
    && phase === "waiting"
    && !introActive;
  const countdown = introActive ? null : countdownNumber(room, serverNow);
  const joinCodeReady = joinCode.trim().length === 6;
  const me = players.find((player) => player.user_id === user?.id);
  const matchWinner = players.find((player) => player.user_id === room?.winner_user_id);
  const hostPlayer = players.find((player) => player.user_id === room?.host_user_id);
  const activePlayers = players.filter((player) => !player.eliminated && !player.left_at);
  const lobbyPlayers = players.filter((player) => !player.left_at);
  const orderedPlayers = rankPlayers(players);
  const isHost = room?.host_user_id === user?.id;
  const playerIsSynchronised = useCallback((player) =>
    !!player?.ready_at
    && new Date(player.ready_at).getTime() > serverNow - 25000
    && Number(player.clock_rtt_ms ?? 9999) <= 750
  , [serverNow]);
  const allPlayersReady = lobbyPlayers.length >= 2 && lobbyPlayers.every(playerIsSynchronised);

  useEffect(() => {
    if (phase !== "open" || revealBuzzRef.current === room?.round_number) return;
    revealBuzzRef.current = room?.round_number;
    navigator.vibrate?.(35);
  }, [phase, room?.round_number]);

  useEffect(() => {
    if (phase === "open" && room?.reveal_at) {
      const timeoutKey = `timeout-${room.round_number}`;
      if (serverNow >= new Date(room.reveal_at).getTime() + 8100 && advanceRef.current !== timeoutKey) {
        advanceRef.current = timeoutKey;
        void supabase.rpc("animal_rush_advance_room", { target_room_id: room.id })
          .then(() => refreshRoom(room.id, true));
      }
      return;
    }
    const resultKey = `result-${room?.round_number}`;
    if (room?.status !== "round_result" || !room.round_closed_at || advanceRef.current === resultKey) return;
    const delay = Math.max(0, new Date(room.round_closed_at).getTime() + 2400 - serverNow);
    const timer = window.setTimeout(async () => {
      advanceRef.current = resultKey;
      await supabase.rpc("animal_rush_advance_room", { target_room_id: room.id });
      void refreshRoom(room.id, true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [refreshRoom, room, serverNow]);

  function rememberRoom(nextRoom) {
    // Store room ID with a timestamp so stale rooms can be detected
    // and auto-cleaned on next page load.
    window.localStorage.setItem(roomStorageKey, JSON.stringify({
      id: nextRoom.id,
      savedAt: Date.now(),
    }));
    setRoom(nextRoom);
  }

  async function createRoom() {
    setWorking("create");
    setMessage("");
    const { data, error } = await supabase.rpc("animal_rush_create_room");
    setWorking("");
    const nextRoom = Array.isArray(data) ? data[0] : data;
    if (error || !nextRoom) {
      setMessage(error?.message || "Couldn't create the room.");
      return;
    }
    rememberRoom(nextRoom);
    await synchroniseClock();
    await refreshRoom(nextRoom.id);
  }

  async function joinRoom() {
    const cleanCode = joinCode.trim().toUpperCase();
    if (cleanCode.length !== 6) return;
    setWorking("join");
    setMessage("");
    setJoinError("");
    const { data, error } = await supabase.rpc("animal_rush_join_room", { room_code: cleanCode });
    setWorking("");
    const nextRoom = Array.isArray(data) ? data[0] : data;
    if (error || !nextRoom) {
      const errorMessage = error?.message || "Couldn't join that room.";
      if (/room not found/i.test(errorMessage)) setJoinError("Room not found — check the code");
      else setMessage(errorMessage);
      return;
    }
    rememberRoom(nextRoom);
    await synchroniseClock();
    await refreshRoom(nextRoom.id);
  }

  async function startGame() {
    setWorking("start");
    setMessage("");
    const { error } = await supabase.rpc("animal_rush_start_room", { target_room_id: room.id });
    setWorking("");
    if (error) setMessage(error.message);
    await synchroniseClock();
    await refreshRoom(room.id, true);
  }

  async function changeDifficulty(nextDifficulty) {
    if (!isHost || !DIFFICULTY_MODES.some((mode) => mode.id === nextDifficulty)) return;
    setWorking("difficulty");
    setMessage("");
    const { error } = await supabase.rpc("animal_rush_set_difficulty", {
      target_room_id: room.id,
      selected_difficulty: nextDifficulty,
    });
    setWorking("");
    if (error) setMessage(error.message);
    await refreshRoom(room.id, true);
  }

  async function changeColourMode(nextColourMode) {
    if (!isHost || !COLOUR_MODES.some((mode) => mode.id === nextColourMode)) return;
    setWorking("colour");
    setMessage("");
    const { error } = await supabase.rpc("animal_rush_set_colour_mode", {
      target_room_id: room.id,
      selected_colour_mode: nextColourMode,
    });
    setWorking("");
    if (error) setMessage(error.message);
    await refreshRoom(room.id, true);
  }

  async function submitAnimal(event, animalId) {
    event.preventDefault();
    if (event.pointerType && event.pointerType !== "touch") {
      setMessage("Animal Rush accepts direct phone touches only.");
      return;
    }
    if (phase !== "open" || attemptRef.current || me?.eliminated || me?.left_at) return;
    attemptRef.current = true;
    setAttemptFeedback({ pending: true, animalId });
    const { data, error } = await supabase.rpc("animal_rush_submit_attempt", {
      target_room_id: room.id,
      selected_animal: animalId,
    });
    if (error) {
      setAttemptFeedback({ error: true, text: error.message, animalId });
      if (error.code !== "23505") attemptRef.current = false;
      void refreshRoom(room.id, true);
      return;
    }
    const result = Array.isArray(data) ? data[0] : data;
    const correct = result?.correct === true;
    navigator.vibrate?.(correct ? [40, 35, 80] : [120, 50, 120]);
    setAttemptFeedback({
      correct,
      animalId,
      reactionMs: result?.reaction_ms,
      penalty: result?.penalty,
      eliminated: result?.eliminated,
    });
    void refreshRoom(room.id, true);
  }

  async function shareRoom() {
    const url = inviteUrl(room.code, window.location);
    const shareData = {
      title: "Join my Animal Rush game",
      text: `Join my Animal Rush room: ${room.code}`,
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await navigator.clipboard?.writeText(`${shareData.text}\n${url}`);
    setMessage("Room link copied.");
  }

  async function leaveRoom() {
    if (room.status !== "lobby" && room.status !== "finished" && !window.confirm("Leave this live match? You will be eliminated.")) return;
    setWorking("leave");
    // Clear local storage BEFORE the RPC so that even if it fails or times out,
    // the user is not permanently stuck in a stale room.
    window.localStorage.removeItem(roomStorageKey);
    const { error } = await supabase.rpc("animal_rush_leave_room", { target_room_id: room.id });
    setWorking("");
    if (error) console.warn("animal_rush_leave_room RPC failed, room already cleaned locally:", error.message);
    setRoom(null);
    setPlayers([]);
    onExit?.();
  }

  async function rematch() {
    setWorking("rematch");
    setMessage("");
    const { error } = await supabase.rpc("animal_rush_rematch", { target_room_id: room.id });
    setWorking("");
    if (error) setMessage(error.message);
    await refreshRoom(room.id, true);
  }

  if (!supported) return <PhoneOnly onExit={onExit} />;

  if (botMode) {
    return (
      <BotMatch
        userId={user?.id || "local-player"}
        profile={profile}
        difficulty={botDifficulty}
        colourMode={botColourMode}
        reducedMotion={reducedMotion}
        onBack={() => setBotMode(false)}
      />
    );
  }

  if (loading) {
    return (
      <div className="animal-rush rush-phone-only">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="animal-rush">
        <main className="rush-shell">
          <GameHomeButton onClick={onExit} />
          <section className="rush-panel p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="rush-kicker">Live · 2–6 phones</p>
                <h1 className="mt-1 text-4xl font-bold" style={{ fontFamily: "'Fredoka', sans-serif" }}>Animal Rush</h1>
              </div>
              <span className="rush-icon-panel rush-icon-panel--mint grid h-12 w-12 place-items-center rounded-2xl">
                <Radio size={24} />
              </span>
            </div>
            <p className="rush-muted mt-3 text-sm leading-relaxed">
              Roll the animal, find it first and protect your two safety cards. A wrong touch costs a safety card, then one you have won.
            </p>
            {reducedMotion && (
              <div className="rush-motion-notice mt-4" role="status">
                <strong>Reduce Motion is on</strong>
                <span>The die will use a static countdown, then reveal the animal.</span>
              </div>
            )}

            <DifficultySelector
              value={botDifficulty}
              onChange={setBotDifficulty}
              label="Computer match difficulty"
            />
            <ColourModeSelector
              value={botColourMode}
              onChange={setBotColourMode}
            />

            <button type="button" className="rush-primary mt-6 w-full" onClick={() => setBotMode(true)} disabled={!!working}>
              <Bot size={18} />
              Play against computer
            </button>
            <p className="rush-muted mt-2 text-center text-[10px]">Solo testing · full rules · no points awarded</p>

            <div className="my-5 flex items-center gap-3">
              <span className="rush-divider h-px flex-1" />
              <span className="rush-muted text-[10px] font-bold uppercase tracking-[.18em]">or play live</span>
              <span className="rush-divider h-px flex-1" />
            </div>

            <button type="button" className="rush-secondary w-full" onClick={createRoom} disabled={!!working}>
              {working === "create" ? <Loader2 className="animate-spin" size={17} /> : <Wifi size={17} />}
              Create live room
            </button>

            <div className="my-5 flex items-center gap-3">
              <span className="rush-divider h-px flex-1" />
              <span className="rush-muted text-[10px] font-bold uppercase tracking-[.18em]">or join</span>
              <span className="rush-divider h-px flex-1" />
            </div>
            <input
              className="rush-input"
              value={joinCode}
              onChange={(event) => {
                setJoinCode(event.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6));
                setMessage("");
                setJoinError("");
              }}
              placeholder="ROOM CODE"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              inputMode="text"
              aria-label="Room code"
            />
            <button
              type="button"
              className="rush-secondary mt-3 w-full"
              onClick={joinRoom}
              disabled={!!working || !joinCodeReady}
              data-error={!!joinError}
              aria-live="polite"
            >
              {working === "join"
                ? <Loader2 className="animate-spin" size={17} />
                : joinError
                  ? <X size={17} />
                  : <Users size={17} />}
              {working === "join"
                ? "Joining…"
                : joinError || (joinCodeReady ? "Join room" : "Enter 6-character code")}
            </button>
            {message && <p className="rush-error mt-4">{message}</p>}
          </section>
        </main>
      </div>
    );
  }

  if (room.status === "lobby") {
    return (
      <div className="animal-rush">
        <main className="rush-shell">
          <div className="mb-3 flex items-center justify-between">
            <GameHomeButton onClick={leaveRoom} />
            <span aria-hidden="true" style={{ width:36, height:36 }} />
            <button type="button" className="rush-quiet -mr-2" onClick={leaveRoom} disabled={working === "leave"}>
              <LogOut size={15} /> Leave
            </button>
          </div>
          <section className="rush-panel p-6 text-center">
            <p className="rush-kicker">Room ready</p>
            <p className="rush-code mt-2">{room.code}</p>
            <p className="rush-muted mt-1 text-xs">Share this code with players on their phones.</p>
            <button type="button" className="rush-secondary mt-4" onClick={shareRoom}>
              {navigator.share ? <Share2 size={15} /> : <Copy size={15} />} Invite players
            </button>
          </section>

          <section className="rush-panel mt-4 p-4">
            <div className="mb-3 flex items-center justify-between">
              <strong className="text-sm">Players</strong>
              <span className="rush-muted text-xs">{lobbyPlayers.length}/6</span>
            </div>
            <div className="space-y-2">
              {lobbyPlayers.map((player) => (
                <PlayerRow
                  key={player.user_id}
                  player={player}
                  currentUserId={user?.id}
                  synchronised={playerIsSynchronised(player)}
                />
              ))}
            </div>
            {lobbyPlayers.length < 2 && (
              <p className="rush-muted mt-4 flex items-center justify-center gap-2 text-xs">
                <Loader2 className="animate-spin" size={13} /> Waiting for another player
              </p>
            )}
            <DifficultySelector
              value={room.difficulty || "standard"}
              onChange={changeDifficulty}
              disabled={!isHost || !!working}
              label={isHost ? "Match difficulty" : "Host-selected difficulty"}
            />
            <ColourModeSelector
              value={room.colour_mode || "uniform"}
              onChange={changeColourMode}
              disabled={!isHost || !!working}
              label={isHost ? "Animal colours" : "Host-selected colours"}
            />
            {isHost ? (
              <button type="button" className="rush-primary mt-4 w-full" onClick={startGame} disabled={!allPlayersReady || !!working}>
                {working === "start" ? <Loader2 className="animate-spin" size={17} /> : <Play size={17} fill="currentColor" />}
                {allPlayersReady ? "Start match" : "Waiting for synced phones"}
              </button>
            ) : (
              <p className="rush-muted mt-4 text-center text-xs">The room creator will start the match.</p>
            )}
            {message && <p className="rush-error mt-4">{message}</p>}
          </section>
        </main>
      </div>
    );
  }

  if (room.status === "finished") {
    return (
      <div className="animal-rush">
        <main className="rush-shell">
          <GameHomeButton onClick={leaveRoom} />
          <section className="rush-panel p-6 text-center">
            <span className="rush-icon-panel rush-icon-panel--gold mx-auto grid h-16 w-16 place-items-center rounded-3xl">
              <Trophy size={31} />
            </span>
            <p className="rush-kicker mt-4">Match finished</p>
            <h1 className="mt-1 text-3xl font-bold" style={{ fontFamily: "'Fredoka', sans-serif" }}>
              {matchWinner?.user_id === user?.id ? "You won!" : `${matchWinner?.player_name || "A player"} won`}
            </h1>
            <p className="rush-muted mt-2 text-xs">First to {room.winning_cards} cards or last player standing.</p>
          </section>
          <section className="rush-panel mt-4 p-4">
            <div className="space-y-2">
              {orderedPlayers.map((player) => (
                <PlayerRow key={player.user_id} player={player} currentUserId={user?.id} winnerId={room.winner_user_id} />
              ))}
            </div>
            {isHost ? (
              <button type="button" className="rush-primary mt-4 w-full" onClick={rematch} disabled={!!working}>
                {working === "rematch" ? <Loader2 className="animate-spin" size={17} /> : <RotateCcw size={17} />}
                Play again
              </button>
            ) : (
              <p className="rush-muted mt-4 text-center text-xs">
                Stick around and you'll rejoin automatically if {hostPlayer?.player_name || "the room creator"} starts a rematch — or leave whenever you like.
              </p>
            )}
            <button type="button" className="rush-secondary mt-3 w-full" onClick={leaveRoom}>
              Leave room
            </button>
            {message && <p className="rush-error mt-4">{message}</p>}
          </section>
        </main>
      </div>
    );
  }

  const targetAnimal = animalById(room.target_animal);
  const canTap = phase === "open" && !attemptRef.current && !me?.eliminated && !me?.left_at;
  const cardOrder = visibleCardOrder(room, phase);
  const concealed = cardsConcealed(room, phase);
  const shuffling = phase === "shuffling";
  const targetRevealed = targetIsRevealed(room, phase);
  const outcome = playerRoundOutcome({
    roundComplete: room.status === "round_result",
    winnerId: room.round_winner_id,
    currentUserId: user?.id,
    attempted: !!attemptFeedback && !attemptFeedback.pending && !attemptFeedback.error,
    attemptCorrect: attemptFeedback?.correct === true,
  });
  const rollStartedAt = room.roll_at
    ? new Date(room.roll_at).getTime()
    : new Date(room.reveal_at).getTime() - DIE_ROLL_DURATION_MS;
  const dieCoverMs = room.difficulty === "hard" ? 200 : room.difficulty === "standard" ? 260 : 0;
  const rollDurationMs = DIE_ROLL_DURATION_MS + dieCoverMs;
  const rollElapsedMs = Math.max(0, Math.min(rollDurationMs, serverNow - rollStartedAt));
  const shuffleElapsedMs = shuffling && room.shuffle_at
    ? Math.max(0, serverNow - new Date(room.shuffle_at).getTime())
    : 0;
  const revealAtMs = room.reveal_at ? new Date(room.reveal_at).getTime() : null;
  const dieSettling = room.difficulty === "standard"
    && phase === "rolling"
    && revealAtMs !== null
    && revealAtMs - serverNow > 0
    && revealAtMs - serverNow <= dieCoverMs;
  const dieConcealed = room.difficulty === "hard" ? shuffling : dieSettling;

  return (
    <div className="animal-rush">
      <main className="rush-shell rush-shell--play">
        <div className="rush-topbar mb-3 flex items-center justify-between">
          <GameHomeButton onClick={leaveRoom} />
          <span aria-hidden="true" style={{ width:36, height:36 }} />
          <span className="rush-muted flex items-center gap-2 text-[11px] font-semibold">
            Round {room.round_number}
            <span className="rush-mode-badge">
              {room.difficulty || "standard"} · {room.colour_mode === "individual" ? "animal colours" : "one colour"}
            </span>
            {reducedMotion && <span className="rush-motion-badge">Motion reduced</span>}
          </span>
          <span className="rush-muted text-[11px]">{activePlayers.length} active</span>
        </div>

        <section className="rush-panel rush-stage p-4">
          <div className="rush-score-grid mb-3 grid grid-cols-2 gap-2">
            {players.map((player) => (
              <PlayerChip key={player.user_id} player={player} currentUserId={user?.id} />
            ))}
          </div>

          {(preparingMatch || introActive) && (
            <div className="rush-start-countdown" role="status" aria-live="polite">
              <div>
                {preparingMatch ? (
                  <>
                    <span>Synchronising players</span>
                    <Loader2 className="rush-sync-spinner" size={40} />
                    <small>Every phone has the same start time</small>
                  </>
                ) : (
                  <>
                    <span>Match starts in</span>
                    <strong key={introCountdown}>{introCountdown}</strong>
                    <small>Get ready to find the animal</small>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="rush-round-info">
            {outcome && (
              <div className="rush-round-result mb-3" data-kind={outcome}>
                <strong className="block text-sm">
                  {outcome === "win" ? "You won this round" : "You lost this round"}
                </strong>
                {room.status === "round_result" && (
                  <small className="mt-0.5 block opacity-70">Next animal is coming…</small>
                )}
              </div>
            )}

            <div className="rush-prompt text-center">
              <p className="rush-kicker">
                {phase === "open" ? "Find this animal" : shuffling ? "Cards reshuffling" : room.status === "round_result" ? "Round complete" : "Get ready"}
              </p>
              <div className="rush-target mt-2" data-open={targetRevealed}>
                {phase !== "waiting" && (
                  <AnimalDie
                    targetId={targetAnimal.id}
                    countdown={countdown}
                    roundKey={room.round_number}
                    revealed={targetRevealed}
                    concealed={dieConcealed}
                    colourMode={room.colour_mode || "uniform"}
                    rollDurationMs={rollDurationMs}
                    rollElapsedMs={rollElapsedMs}
                  />
                )}
              </div>
              <strong
                className="rush-target-label"
                data-visible={targetRevealed}
                aria-hidden={!targetRevealed}
              >
                {targetRevealed ? targetAnimal.label : "\u00a0"}
              </strong>
            </div>
          </div>

          <div
            className="rush-grid"
            data-concealed={concealed}
            data-shuffling={shuffling}
            style={shuffling ? { "--rush-shuffle-delay": `-${shuffleElapsedMs}ms` } : undefined}
            aria-hidden={concealed}
            aria-label="Animal cards"
          >
            {cardOrder.map((animalId) => {
              const animal = animalById(animalId);
              return (
                <button
                  type="button"
                  className="rush-animal-card"
                  key={`${room.round_number}-${animal.id}`}
                  onPointerDown={(event) => submitAnimal(event, animal.id)}
                  disabled={!canTap}
                  aria-label={animal.label}
                >
                  <AnimalFace animalId={animal.id} colourMode={room.colour_mode || "uniform"} size={72} />
                  <span className="rush-animal-label">{animal.label}</span>
                </button>
              );
            })}
          </div>

          {me?.eliminated && (
            <p className="rush-stage-message rush-error mt-4 text-center">You have no cards left. You can watch the rest of the match.</p>
          )}
          {message && <p className="rush-stage-message rush-error mt-4">{message}</p>}
        </section>
      </main>
    </div>
  );
}