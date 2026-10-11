export type Rng = () => number;

const SEED_LENGTH = 8;

function hashSeed(seed: string): number {
  // FNV-1a, 32 bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic generator (mulberry32), so a seed always replays the same game. */
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

export function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SEED_LENGTH));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

export function pickDistinct<T>(items: readonly T[], count: number, rng: Rng): T[] {
  if (count > items.length) {
    throw new Error(`Cannot pick ${count} items, only ${items.length} available`);
  }
  const pool = [...items];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}
