/**
 * Repeat avoidance: which places this browser has shown, and how a new game steers clear of them.
 * A game is always drawn from its seed alone, so a link gives everyone the same places. What is
 * chosen with the seen places in mind is the seed of a game nobody sent: of a few random seeds,
 * the one whose places are the least familiar. A challenge link, the daily, the tutorial and a
 * match come with their seed or their places, and nothing here touches them.
 */

/** How many places are remembered; the oldest go first. */
export const SEEN_LIMIT = 5000;

/** How many random seeds a fresh game is chosen from. */
export const SEED_TRIES = 40;

interface Shown {
  id: string;
}

/** The remembered places with `ids` added as the newest. One shown again moves to the newest end. */
export function remember(seen: readonly string[], ids: readonly string[], limit = SEEN_LIMIT): string[] {
  const added = [...new Set(ids)];
  const again = new Set(added);
  const all = [...seen.filter((id) => !again.has(id)), ...added];
  return all.slice(Math.max(0, all.length - limit));
}

export const countSeen = (places: readonly Shown[], seen: ReadonlySet<string>): number => places.filter((place) => seen.has(place.id)).length;

/** The same places with the unseen ones first, each group in the order it came. Seen ones stay, to fill a game when the unseen run out. */
export function unseenFirst<T extends Shown>(places: readonly T[], seen: ReadonlySet<string>): T[] {
  return [...places.filter((place) => !seen.has(place.id)), ...places.filter((place) => seen.has(place.id))];
}

/**
 * Of some seeds, the one whose game (`draw`) shows the fewest places seen before; the first of
 * them when several tie. With too few unseen places left, that game is partly or wholly seen ones.
 */
export function freshestSeed(seeds: readonly string[], draw: (seed: string) => readonly Shown[], seen: ReadonlySet<string>): string {
  const [first, ...rest] = seeds;
  if (first === undefined) {
    throw new Error('No seed to choose from');
  }
  if (seen.size === 0) {
    return first;
  }
  let best = { seed: first, seen: countSeen(draw(first), seen) };
  for (const seed of rest) {
    if (best.seen === 0) {
      break;
    }
    const count = countSeen(draw(seed), seen);
    best = count < best.seen ? { seed, seen: count } : best;
  }
  return best.seed;
}
