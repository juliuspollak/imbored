import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ChevronLeft, RotateCcw, Shield, Trophy, X } from "lucide-react";
import AnimalFace from "./AnimalFace.jsx";
import {
  ANIMAL_IDS,
  animalById,
  applyWrongTap,
  botAnimalChoice,
  matchWinner,
} from "./engine.js";

const WINNING_CARDS = 7;
const BOT_ID = "animal-rush-bot";

function shuffledAnimals() {
  return [...ANIMAL_IDS].sort(() => Math.random() - 0.5);
}

function createRound(number) {
  return {
    number,
    target: ANIMAL_IDS[Math.floor(Math.random() * ANIMAL_IDS.length)],
    order: shuffledAnimals(),
    revealAt: Date.now() + 3000,
    status: "playing",
    attempts: { human: false, bot: false },
    winner: null,
  };
}

function createPlayer(userId, name, icon) {
  return {
    user_id: userId,
    player_name: name,
    player_icon: icon,
    safety_cards: 2,
    won_cards: 0,
    rounds_won: 0,
    wrong_taps: 0,
    eliminated: false,
  };
}

function createGame(userId, profile) {
  return {
    status: "playing",
    winner: null,
    round: createRound(1),
    players: [
      createPlayer(userId, profile?.name || "You", profile?.icon || "🙂"),
      createPlayer(BOT_ID, "Rush Bot", "🤖"),
    ],
  };
}

function ScoreChip({ player, isYou }) {
  return (
    <div className="rush-player-chip" data-eliminated={player.eliminated}>
      <span className="rush-player-chip__avatar">{player.player_icon}</span>
      <strong className="truncate text-[10px]">{isYou ? "You" : player.player_name}</strong>
      <span className="rush-player-chip__score">🛡{player.safety_cards} · ◆{player.won_cards}</span>
    </div>
  );
}

export default function BotMatch({ userId, profile, onBack }) {
  const [game, setGame] = useState(() => createGame(userId, profile));
  const [now, setNow] = useState(Date.now());
  const [feedback, setFeedback] = useState(null);
  const gameRef = useRef(game);

  const commitGame = useCallback((next) => {
    gameRef.current = next;
    setGame(next);
  }, []);

  const resolveAttempt = useCallback((actor, selectedAnimal) => {
    const current = gameRef.current;
    const actorId = actor === "human" ? userId : BOT_ID;
    if (
      current.status !== "playing"
      || current.round.status !== "playing"
      || current.round.attempts[actor]
      || Date.now() < current.round.revealAt
    ) return;

    const next = {
      ...current,
      round: {
        ...current.round,
        attempts: { ...current.round.attempts, [actor]: true },
      },
      players: current.players.map((player) => ({ ...player })),
    };
    const playerIndex = next.players.findIndex((player) => player.user_id === actorId);
    const isCorrect = selectedAnimal === next.round.target;
    let penalty = null;

    if (isCorrect) {
      next.players[playerIndex].won_cards += 1;
      next.players[playerIndex].rounds_won += 1;
      next.round.status = "result";
      next.round.winner = actorId;
    } else {
      const penalised = applyWrongTap(next.players[playerIndex]);
      next.players[playerIndex] = penalised.player;
      penalty = penalised.penalty;
      if (next.round.attempts.human && next.round.attempts.bot) {
        next.round.status = "result";
      }
    }

    const winner = matchWinner(next.players, WINNING_CARDS);
    if (winner) {
      next.status = "finished";
      next.winner = winner.user_id;
      next.round.status = "result";
    }

    if (actor === "human") {
      const reactionMs = Math.max(0, Date.now() - next.round.revealAt);
      setFeedback({ isCorrect, penalty, reactionMs });
      navigator.vibrate?.(isCorrect ? [40, 35, 80] : [120, 50, 120]);
    }
    commitGame(next);
  }, [commitGame, userId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (game.status !== "playing" || game.round.status !== "playing") return undefined;
    const botReaction = 850 + Math.floor(Math.random() * 1150);
    const timer = window.setTimeout(() => {
      resolveAttempt("bot", botAnimalChoice(game.round.target, Math.random()));
    }, Math.max(0, game.round.revealAt - Date.now() + botReaction));
    return () => window.clearTimeout(timer);
  }, [game.round.number, game.round.revealAt, game.round.status, game.status, resolveAttempt]);

  useEffect(() => {
    if (game.status !== "playing" || game.round.status !== "playing") return undefined;
    const timer = window.setTimeout(() => {
      const current = gameRef.current;
      if (current.status !== "playing" || current.round.status !== "playing") return;
      commitGame({
        ...current,
        round: { ...current.round, status: "result" },
      });
    }, Math.max(0, game.round.revealAt - Date.now() + 8000));
    return () => window.clearTimeout(timer);
  }, [commitGame, game.round.number, game.round.revealAt, game.round.status, game.status]);

  useEffect(() => {
    if (game.status !== "playing" || game.round.status !== "result") return undefined;
    const timer = window.setTimeout(() => {
      const current = gameRef.current;
      if (current.status !== "playing" || current.round.status !== "result") return;
      setFeedback(null);
      commitGame({
        ...current,
        round: createRound(current.round.number + 1),
      });
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [commitGame, game.round.number, game.round.status, game.status]);

  const human = game.players.find((player) => player.user_id === userId);
  const bot = game.players.find((player) => player.user_id === BOT_ID);
  const target = animalById(game.round.target);
  const revealed = now >= game.round.revealAt;
  const countdown = revealed ? null : Math.max(1, Math.ceil((game.round.revealAt - now) / 1000));
  const canTap = game.status === "playing"
    && game.round.status === "playing"
    && revealed
    && !game.round.attempts.human
    && !human.eliminated;
  const resultText = useMemo(() => {
    if (game.round.winner === userId) return "You found it first";
    if (game.round.winner === BOT_ID) return "Rush Bot found it first";
    return "No one found it";
  }, [game.round.winner, userId]);

  function restart() {
    setFeedback(null);
    commitGame(createGame(userId, profile));
  }

  if (game.status === "finished") {
    const youWon = game.winner === userId;
    return (
      <div className="animal-rush">
        <main className="rush-shell">
          <button type="button" className="rush-quiet -ml-2 mb-3" onClick={onBack}>
            <ChevronLeft size={16} /> Game modes
          </button>
          <section className="rush-panel p-6 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-amber-300/10 text-amber-300">
              {youWon ? <Trophy size={31} /> : <Bot size={31} />}
            </span>
            <p className="rush-kicker mt-4">Practice match finished</p>
            <h1 className="mt-1 text-3xl font-bold" style={{ fontFamily: "'Fredoka', sans-serif" }}>
              {youWon ? "You beat the bot!" : "Rush Bot won"}
            </h1>
            <p className="rush-muted mt-2 text-xs">Bot matches are for testing and never award points.</p>
          </section>
          <section className="rush-panel mt-4 p-4">
            {[human, bot].map((player) => (
              <div className="rush-player mb-2" key={player.user_id} data-eliminated={player.eliminated}>
                <span className="rush-avatar">{player.player_icon}</span>
                <strong className="flex-1 text-sm">{player.user_id === userId ? "You" : player.player_name}</strong>
                {game.winner === player.user_id && <Trophy size={16} color="#F2C66D" />}
                <span className="rush-token rush-token--shield"><Shield size={11} />{player.safety_cards}</span>
                <span className="rush-token rush-token--card">◆ {player.won_cards}</span>
              </div>
            ))}
            <button type="button" className="rush-primary mt-3 w-full" onClick={restart}>
              <RotateCcw size={17} /> Play again
            </button>
            <button type="button" className="rush-secondary mt-3 w-full" onClick={onBack}>Back to game modes</button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="animal-rush">
      <main className="rush-shell">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" className="rush-quiet -ml-2" onClick={onBack}>
            <ChevronLeft size={16} /> Game modes
          </button>
          <span className="rush-muted text-[11px] font-semibold">Test round {game.round.number}</span>
          <span className="rush-muted text-[10px]">No points</span>
        </div>

        <section className="rush-panel rush-stage p-4">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <ScoreChip player={human} isYou />
            <ScoreChip player={bot} />
          </div>

          {game.round.status === "result" && (
            <div className="rush-round-result mb-3">
              <strong className="block text-sm">{resultText}</strong>
              <small className="mt-0.5 block opacity-70">Next animal is coming…</small>
            </div>
          )}

          {feedback && game.round.status !== "result" && (
            <div className={`mb-3 rounded-2xl border px-3 py-2 text-center text-xs font-semibold ${
              feedback.isCorrect
                ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
                : "border-red-300/20 bg-red-400/10 text-red-200"
            }`}>
              {feedback.isCorrect
                ? <><Check className="mr-1 inline" size={14} /> Correct · {feedback.reactionMs} ms</>
                : <><X className="mr-1 inline" size={14} /> Wrong · {feedback.penalty === "safety" ? "safety card lost" : feedback.penalty === "won_card" ? "won card lost" : "eliminated"}</>}
            </div>
          )}

          <div className="text-center">
            <p className="rush-kicker">{revealed ? "Find this animal" : "Get ready"}</p>
            <div className="rush-target mt-2" data-open={revealed}>
              {revealed
                ? <AnimalFace animalId={target.id} size={86} />
                : <span className="rush-countdown">{countdown || "•"}</span>}
            </div>
            {revealed && <strong className="mt-1 block text-sm">{target.label}</strong>}
          </div>

          <div className="rush-grid" aria-label="Animal cards">
            {game.round.order.map((animalId) => {
              const animal = animalById(animalId);
              return (
                <button
                  type="button"
                  className="rush-animal-card"
                  key={`${game.round.number}-${animal.id}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    if (event.pointerType && event.pointerType !== "touch") return;
                    resolveAttempt("human", animal.id);
                  }}
                  disabled={!canTap}
                  aria-label={animal.label}
                >
                  <AnimalFace animalId={animal.id} size={72} />
                  <span className="rush-animal-label">{animal.label}</span>
                </button>
              );
            })}
          </div>

          {human.eliminated && (
            <p className="rush-error mt-4 text-center">You have no cards left. Rush Bot wins this test.</p>
          )}
        </section>
      </main>
    </div>
  );
}
