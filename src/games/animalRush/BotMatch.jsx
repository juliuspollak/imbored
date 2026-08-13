import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronLeft, RotateCcw, Shield, Trophy } from "lucide-react";
import AnimalDie from "./AnimalDie.jsx";
import AnimalFace from "./AnimalFace.jsx";
import {
  ANIMAL_IDS,
  DIE_ROLL_DURATION_MS,
  SHUFFLE_DURATION_MS,
  animalById,
  applyWrongTap,
  botAnimalChoice,
  cardRotations,
  playableCards,
  decoySubmission,
  derangedShuffle,
  matchWinner,
  pickNextTarget,
  playerRoundOutcome,
} from "./engine.js";

const WINNING_CARDS = 7;
const BOT_ID = "animal-rush-bot";

function createRound(number, difficulty, previousTarget, previousOrder) {
  const previewOrder = previousOrder ? derangedShuffle(previousOrder) : [...ANIMAL_IDS].sort(() => Math.random() - 0.5);
  let order = previewOrder;
  if (difficulty === "hard") {
    // Hard mode: final order must differ from preview at every position
    order = derangedShuffle(previewOrder);
  }
  const target = previousTarget ? pickNextTarget(previousTarget) : ANIMAL_IDS[Math.floor(Math.random() * ANIMAL_IDS.length)];
  const rollAt = Date.now() + (number === 1 ? 3000 : 700);
  const shuffleAt = difficulty === "hard" ? rollAt + DIE_ROLL_DURATION_MS : null;
  return {
    number,
    target,
    difficulty,
    previewOrder,
    order,
    rollAt,
    shuffleAt,
    revealAt: (shuffleAt || rollAt + DIE_ROLL_DURATION_MS) + (shuffleAt ? SHUFFLE_DURATION_MS : 0),
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

function createGame(userId, profile, difficulty, colourMode) {
  return {
    // Seeds the hard-mode card rotations, so two bot matches do not deal out
    // the same angles round for round.
    id: `bot-${Date.now().toString(36)}`,
    status: "playing",
    winner: null,
    difficulty,
    colourMode,
    round: createRound(1, difficulty),
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

export default function BotMatch({
  userId,
  profile,
  difficulty = "standard",
  colourMode = "uniform",
  reducedMotion = false,
  spinSeconds = 14,
  onBack,
}) {
  const [game, setGame] = useState(() => createGame(userId, profile, difficulty, colourMode));
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
    const remaining = game.round.revealAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return undefined;
    const timer = window.setTimeout(() => setNow(game.round.revealAt), remaining);
    return () => window.clearTimeout(timer);
  }, [game.round.number, game.round.revealAt]);

  useEffect(() => {
    if (!game.round.shuffleAt) return undefined;
    const remaining = game.round.shuffleAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return undefined;
    const timer = window.setTimeout(() => setNow(game.round.shuffleAt), remaining);
    return () => window.clearTimeout(timer);
  }, [game.round.number, game.round.shuffleAt]);

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
        round: createRound(
          current.round.number + 1,
          current.difficulty,
          current.round.target,
          current.round.order,
        ),
      });
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [commitGame, game.round.number, game.round.status, game.status]);

  const human = game.players.find((player) => player.user_id === userId);
  const bot = game.players.find((player) => player.user_id === BOT_ID);
  const target = animalById(game.round.target);
  const introEndsAt = game.round.rollAt;
  const introActive = game.round.number === 1
    && game.round.status === "playing"
    && now < introEndsAt;
  const introCountdown = introActive ? Math.max(1, Math.ceil((introEndsAt - now) / 1000)) : null;
  const visualPhase = now < game.round.rollAt
    ? "waiting"
    : game.round.shuffleAt && now >= game.round.shuffleAt && now < game.round.revealAt
      ? "shuffling"
      : now < game.round.revealAt
        ? "rolling"
        : "open";
  const revealed = now >= game.round.revealAt;
  const targetRevealed = revealed;
  const rollEndsAt = game.round.shuffleAt || game.round.revealAt;
  const dieCoverMs = game.difficulty === "hard" ? 200 : game.difficulty === "standard" ? 260 : 0;
  const rollDurationMs = DIE_ROLL_DURATION_MS + dieCoverMs;
  const rollElapsedMs = Math.max(
    0,
    Math.min(rollDurationMs, now - game.round.rollAt),
  );
  const shuffleElapsedMs = visualPhase === "shuffling"
    ? Math.max(0, now - game.round.shuffleAt)
    : 0;
  const countdown = visualPhase !== "rolling"
    ? null
    : Math.max(1, Math.ceil((rollEndsAt - now) / 1000));
  const concealed = game.difficulty === "standard"
    ? !revealed
    : game.difficulty === "hard"
      ? visualPhase === "shuffling"
      : false;
  const dieSettling = game.difficulty === "standard"
    && visualPhase === "rolling"
    && game.round.revealAt - now > 0
    && game.round.revealAt - now <= dieCoverMs;
  const dieConcealed = game.difficulty === "hard" ? visualPhase === "shuffling" : dieSettling;
  const cardOrder = game.difficulty === "hard" && (visualPhase === "waiting" || visualPhase === "rolling")
    ? game.round.previewOrder
    : game.round.order;
  const roundSeed = `${game.id}:${game.round.number}`;
  const cardRotationsByAnimal = cardRotations({
    difficulty: game.difficulty,
    roundSeed,
  });
  const playableCardEntries = playableCards({
    order: cardOrder,
    targetAnimal: visualPhase === "waiting" || visualPhase === "rolling" ? null : game.round.target,
    difficulty: game.difficulty,
    roundSeed,
  });
  const canTap = game.status === "playing"
    && game.round.status === "playing"
    && revealed
    && !game.round.attempts.human
    && !human.eliminated;
  const outcome = useMemo(() => playerRoundOutcome({
    roundComplete: game.round.status === "result",
    winnerId: game.round.winner,
    currentUserId: userId,
    attempted: !!feedback,
    attemptCorrect: feedback?.isCorrect === true,
  }), [feedback, game.round.status, game.round.winner, userId]);

  function colourModeLabel() {
    if (game.colourMode === "individual") return "animal colours";
    if (game.colourMode === "mixed") return "mixed colours";
    return "one colour";
  }

  function restart() {
    setFeedback(null);
    commitGame(createGame(userId, profile, game.difficulty, game.colourMode));
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
            <span className="rush-icon-panel rush-icon-panel--gold mx-auto grid h-16 w-16 place-items-center rounded-3xl">
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
      <main className="rush-shell rush-shell--play">
        <div className="rush-topbar mb-3 flex items-center justify-between">
          <button type="button" className="rush-quiet -ml-2" onClick={onBack}>
            <ChevronLeft size={16} /> Game modes
          </button>
          <span className="rush-muted flex items-center gap-2 text-[11px] font-semibold">
            Test round {game.round.number}
            <span className="rush-mode-badge">
              {game.difficulty} · {colourModeLabel()}
            </span>
            {reducedMotion && <span className="rush-motion-badge">Motion reduced</span>}
          </span>
          <span className="rush-muted text-[10px]">No points</span>
        </div>

        <section className="rush-panel rush-stage p-4">
          <div className="rush-score-grid mb-3 grid grid-cols-2 gap-2">
            <ScoreChip player={human} isYou />
            <ScoreChip player={bot} />
          </div>

          {introActive && (
            <div className="rush-start-countdown" role="status" aria-live="polite">
              <div>
                <span>Match starts in</span>
                <strong key={introCountdown}>{introCountdown}</strong>
                <small>Get ready to find the animal</small>
              </div>
            </div>
          )}

          <div className="rush-round-info">
            {outcome && (
              <div className="rush-round-result mb-3" data-kind={outcome}>
                <strong className="block text-sm">
                  {outcome === "win" ? "You won this round" : "You lost this round"}
                </strong>
                {game.round.status === "result" && (
                  <small className="mt-0.5 block opacity-70">Next animal is coming…</small>
                )}
              </div>
            )}

            <div className="rush-prompt text-center">
              <p className="rush-kicker">{revealed ? "Find this animal" : visualPhase === "shuffling" ? "Cards reshuffling" : "Get ready"}</p>
              <div className="rush-target mt-2" data-open={targetRevealed}>
                {visualPhase !== "waiting" && (
                  <AnimalDie
                    targetId={target.id}
                    countdown={countdown}
                    roundKey={game.round.number}
                    revealed={targetRevealed}
                    concealed={dieConcealed}
                    colourMode={game.colourMode}
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
                {targetRevealed ? target.label : "\u00a0"}
              </strong>
            </div>
          </div>

          <div
            className="rush-grid"
            data-concealed={concealed}
            data-shuffling={visualPhase === "shuffling"}
            data-spinning={Object.keys(cardRotationsByAnimal).length > 0 && game.round.status === "playing" && spinSeconds > 0}
            style={{
              "--rush-card-spin-duration": `${spinSeconds}s`,
              ...(visualPhase === "shuffling" ? { "--rush-shuffle-delay": `-${shuffleElapsedMs}ms` } : null),
            }}
            aria-hidden={concealed}
            aria-label="Animal cards"
          >
            {playableCardEntries.map(({ key, animalId, isDecoy }) => {
              const animal = animalById(animalId);
              return (
                <button
                  type="button"
                  className="rush-animal-card"
                  key={`${game.round.number}-${key}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    if (event.pointerType && event.pointerType !== "touch") return;
                    resolveAttempt("human", isDecoy ? decoySubmission(game.round.target) : animal.id);
                  }}
                  disabled={!canTap}
                  aria-label={animal.label}
                  data-decoy={isDecoy}
                  style={cardRotationsByAnimal[animal.id]
                    ? { "--rush-card-rotation": `${cardRotationsByAnimal[animal.id]}deg` }
                    : undefined}
                >
                  <span className="rush-animal-card-inner">
                    <AnimalFace animalId={animal.id} colourMode={game.colourMode} size={72} />
                    {game.difficulty !== "hard" && <span className="rush-animal-label">{animal.label}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          {human.eliminated && (
            <p className="rush-stage-message rush-error mt-4 text-center">You have no cards left. Rush Bot wins this test.</p>
          )}
        </section>
      </main>
    </div>
  );
}
