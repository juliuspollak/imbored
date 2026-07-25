// Deterministic generation for challenge mode: every player must get the
// identical puzzle for a given (game, calendar date). The generation
// algorithms in all three games already pull randomness from a local
// shuffle() that calls Math.random() internally — rather than threading a
// seed parameter through dozens of functions across three files,
// temporarily substituting Math.random itself for the duration of one
// synchronous generation call achieves the same result with far less
// surface area for bugs, and is fully restored immediately after.

function hashSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let t = seed;
  return function () {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// seedString should uniquely identify (game, calendar date) — e.g.
// "queens-2026-07-22" — so the same day always produces the same puzzle,
// for everyone, forever (not just within one session).
export function withSeededRandom(seedString, fn) {
  const original = Math.random;
  Math.random = mulberry32(hashSeed(seedString));
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}
