import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Home,
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
import AnimalFace from "./animalRush/AnimalFace.jsx";
import {
  ANIMAL_IDS,
  animalById,
  countdownNumber,
  inviteUrl,
  isPhoneDevice,
  rankPlayers,
  roundPhase,
} from "./animalRush/engine.js";
import "./animalRush/animal-rush.css";

const ROOM_STORAGE_PREFIX = "imbored-animal-rush-room-";

function phoneSupported() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return isPhoneDevice({
    userAgent: navigator.userAgent,
    userAgentMobile: navigator.userAgentData?.mobile,
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: window.matchMedia?.("(pointer: coarse)")?.matches === true,
  });
}

function PlayerRow({ player, currentUserId, winnerId }) {
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
          {player.left_at ? "Left the room" : player.eliminated ? "Eliminated" : `${player.rounds_won || 0} rounds won`}
        </small>
      </span>
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
      <button type="button" className="rush-quiet absolute left-3 top-3" onClick={onExit}>
        <Home size={17} /> Home
      </button>
      <div className="rush-panel w-full max-w-sm p-7">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-white/8 text-emerald-300">
          <Smartphone size={30} />
        </span>
        <p className="rush-kicker mt-5">Phone-only live game</p>
        <h1 className="mt-2 text-3xl font-bold" style={{ fontFamily: "'Fredoka', sans-serif" }}>Animal Rush</h1>
        <p className="rush-muted mt-3 text-sm leading-relaxed">
          Finding an animal by mouse is not the same as reaching for it. Open ImBored on a phone so every player competes with direct touch.
        </p>
        <p className="mt-5 rounded-2xl bg-white/6 px-4 py-3 text-sm font-semibold">imbored.au</p>
      </div>
    </div>
  );
}

export default function AnimalRush({ onExit }) {
  const { user, profile } = useAuth();
  const supported = useMemo(phoneSupported, []);
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [joinCode, setJoinCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("rush")?.toUpperCase() || "";
  });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [attemptFeedback, setAttemptFeedback] = useState(null);
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
    setRoom(nextRoom);
    setPlayers(nextPlayers || []);
    setLoading(false);
    return nextRoom;
  }, [roomStorageKey]);

  const synchroniseClock = useCallback(async () => {
    const sentAt = Date.now();
    const { data } = await supabase.rpc("animal_rush_server_time");
    const receivedAt = Date.now();
    if (data) {
      setServerOffset(new Date(data).getTime() - ((sentAt + receivedAt) / 2));
    }
  }, []);

  useEffect(() => {
    if (!supported || !user?.id || !supabaseReady) {
      setLoading(false);
      return;
    }
    void synchroniseClock();
    const savedRoomId = window.localStorage.getItem(roomStorageKey);
    if (savedRoomId) void refreshRoom(savedRoomId);
    else setLoading(false);
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
    const fallback = window.setInterval(refresh, 12000);
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
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (roundRef.current === room?.round_number) return;
    roundRef.current = room?.round_number;
    attemptRef.current = false;
    setAttemptFeedback(null);
  }, [room?.round_number]);

  const serverNow = now + serverOffset;
  const phase = roundPhase(room, serverNow);
  const countdown = countdownNumber(room, serverNow);
  const me = players.find((player) => player.user_id === user?.id);
  const roundWinner = players.find((player) => player.user_id === room?.round_winner_id);
  const matchWinner = players.find((player) => player.user_id === room?.winner_user_id);
  const activePlayers = players.filter((player) => !player.eliminated && !player.left_at);
  const orderedPlayers = rankPlayers(players);
  const isHost = room?.host_user_id === user?.id;

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
    window.localStorage.setItem(roomStorageKey, nextRoom.id);
    setRoom(nextRoom);
  }

  async function createRoom() {
    setWorking("create");
    setMessage("");
    const { data, error } = await supabase.rpc("animal_rush_create_room");
    setWorking("");
    const nextRoom = Array.isArray(data) ? data[0] : data;
    if (error || !nextRoom) {
      setMessage(error?.message || "Couldn’t create the room.");
      return;
    }
    rememberRoom(nextRoom);
    await synchroniseClock();
    await refreshRoom(nextRoom.id);
  }

  async function joinRoom() {
    const cleanCode = joinCode.trim().toUpperCase();
    if (cleanCode.length !== 6) {
      setMessage("Enter the six-character room code.");
      return;
    }
    setWorking("join");
    setMessage("");
    const { data, error } = await supabase.rpc("animal_rush_join_room", { room_code: cleanCode });
    setWorking("");
    const nextRoom = Array.isArray(data) ? data[0] : data;
    if (error || !nextRoom) {
      setMessage(error?.message || "Couldn’t join that room.");
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
    const { error } = await supabase.rpc("animal_rush_leave_room", { target_room_id: room.id });
    setWorking("");
    if (error) {
      setMessage(error.message);
      return;
    }
    window.localStorage.removeItem(roomStorageKey);
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
          <button type="button" className="rush-quiet -ml-2 mb-3" onClick={onExit}>
            <Home size={16} /> Home
          </button>
          <section className="rush-panel p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="rush-kicker">Live · 2–6 phones</p>
                <h1 className="mt-1 text-4xl font-bold" style={{ fontFamily: "'Fredoka', sans-serif" }}>Animal Rush</h1>
              </div>
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-300/10 text-emerald-300">
                <Radio size={24} />
              </span>
            </div>
            <p className="rush-muted mt-3 text-sm leading-relaxed">
              Roll the animal, find it first and protect your two safety cards. A wrong touch costs a safety card, then one you have won.
            </p>

            <button type="button" className="rush-primary mt-6 w-full" onClick={createRoom} disabled={!!working}>
              {working === "create" ? <Loader2 className="animate-spin" size={17} /> : <Wifi size={17} />}
              Create live room
            </button>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="rush-muted text-[10px] font-bold uppercase tracking-[.18em]">or join</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <input
              className="rush-input"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6))}
              placeholder="ROOM CODE"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              inputMode="text"
              aria-label="Room code"
            />
            <button type="button" className="rush-secondary mt-3 w-full" onClick={joinRoom} disabled={!!working}>
              {working === "join" ? <Loader2 className="animate-spin" size={17} /> : <Users size={17} />}
              Join room
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
            <button type="button" className="rush-quiet -ml-2" onClick={onExit}><Home size={16} /> Home</button>
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
              <span className="rush-muted text-xs">{players.length}/6</span>
            </div>
            <div className="space-y-2">
              {players.map((player) => (
                <PlayerRow key={player.user_id} player={player} currentUserId={user?.id} />
              ))}
            </div>
            {players.length < 2 && (
              <p className="rush-muted mt-4 flex items-center justify-center gap-2 text-xs">
                <Loader2 className="animate-spin" size={13} /> Waiting for another player
              </p>
            )}
            {isHost ? (
              <button type="button" className="rush-primary mt-4 w-full" onClick={startGame} disabled={players.length < 2 || !!working}>
                {working === "start" ? <Loader2 className="animate-spin" size={17} /> : <Play size={17} fill="currentColor" />}
                Start match
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
          <button type="button" className="rush-quiet -ml-2 mb-3" onClick={onExit}><Home size={16} /> Home</button>
          <section className="rush-panel p-6 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-amber-300/10 text-amber-300">
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
            {isHost && (
              <button type="button" className="rush-primary mt-4 w-full" onClick={rematch} disabled={!!working}>
                {working === "rematch" ? <Loader2 className="animate-spin" size={17} /> : <RotateCcw size={17} />}
                Play again
              </button>
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
  const cardOrder = Array.isArray(room.card_order) && room.card_order.length === ANIMAL_IDS.length
    ? room.card_order
    : ANIMAL_IDS;

  return (
    <div className="animal-rush">
      <main className="rush-shell">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" className="rush-quiet -ml-2" onClick={onExit}><Home size={16} /> Home</button>
          <span className="rush-muted text-[11px] font-semibold">Round {room.round_number}</span>
          <span className="rush-muted text-[11px]">{activePlayers.length} active</span>
        </div>

        <section className="rush-panel rush-stage p-4">
          <div className="mb-3 grid grid-cols-2 gap-2">
            {players.map((player) => (
              <PlayerChip key={player.user_id} player={player} currentUserId={user?.id} />
            ))}
          </div>

          {room.status === "round_result" && (
            <div className="rush-round-result mb-3">
              <strong className="block text-sm">
                {!roundWinner
                  ? "No one found it"
                  : roundWinner.user_id === user?.id
                    ? "You found it first"
                    : `${roundWinner.player_name} found it first`}
              </strong>
              <small className="mt-0.5 block opacity-70">Next animal is coming…</small>
            </div>
          )}

          {attemptFeedback && room.status !== "round_result" && (
            <div className={`mb-3 rounded-2xl border px-3 py-2 text-center text-xs font-semibold ${
              attemptFeedback.correct
                ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
                : "border-red-300/20 bg-red-400/10 text-red-200"
            }`}>
              {attemptFeedback.pending
                ? "Checking your touch…"
                : attemptFeedback.correct
                  ? <><Check className="mr-1 inline" size={14} /> Correct · {attemptFeedback.reactionMs} ms</>
                  : <><X className="mr-1 inline" size={14} /> Wrong · {attemptFeedback.penalty === "safety" ? "safety card lost" : attemptFeedback.penalty === "won_card" ? "won card lost" : "eliminated"}</>}
            </div>
          )}

          <div className="text-center">
            <p className="rush-kicker">{phase === "open" ? "Find this animal" : room.status === "round_result" ? "Round complete" : "Get ready"}</p>
            <div className="rush-target mt-2" data-open={phase === "open"}>
              {phase === "open" || room.status === "round_result"
                ? <AnimalFace animalId={targetAnimal.id} size={86} />
                : <span className="rush-countdown">{countdown || "•"}</span>}
            </div>
            {(phase === "open" || room.status === "round_result") && (
              <strong className="mt-1 block text-sm">{targetAnimal.label}</strong>
            )}
          </div>

          <div className="rush-grid" aria-label="Animal cards">
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
                  <AnimalFace animalId={animal.id} size={72} />
                  <span className="rush-animal-label">{animal.label}</span>
                </button>
              );
            })}
          </div>

          {me?.eliminated && (
            <p className="rush-error mt-4 text-center">You have no cards left. You can watch the rest of the match.</p>
          )}
          {message && <p className="rush-error mt-4">{message}</p>}
        </section>
      </main>
    </div>
  );
}
