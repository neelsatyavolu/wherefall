/**
 * The game's seeded generator and shuffle (`src/game/rng.ts`), kept here so
 * the server can tell which places a daily's seed draws; a test holds the
 * two copies together.
 */
export type Rng = () => number;

/** FNV-1a, 32 bit. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic generator (mulberry32): a seed always gives the same numbers. */
export function createRng(seed: string): Rng {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The first `count` of `items` in the order the generator shuffles them into. */
export function firstInOrder<T>(items: readonly T[], count: number, rng: Rng): T[] {
  const pool = [...items];
  const taken = Math.min(count, pool.length);
  for (let index = 0; index < taken; index += 1) {
    const other = index + Math.floor(rng() * (pool.length - index));
    const held = pool[index] as T;
    pool[index] = pool[other] as T;
    pool[other] = held;
  }
  return pool.slice(0, taken);
}
