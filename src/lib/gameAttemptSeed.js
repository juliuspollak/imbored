export function createGameAttemptSeed(game) {
  const randomPart = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${game}:${randomPart}`;
}
