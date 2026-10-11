import type { Location } from './locations.ts';

/** Extra candidates drawn per game, used when a picture has been removed since the dataset was built. */
export const SPARE_ROUNDS = 5;

export interface ResolvedRound<P> {
  location: Location;
  pano: P;
}

/**
 * Loads the panorama for each round up front. A candidate whose picture is gone is skipped and
 * a later one takes its place. Any other failure (network down, server error) is rethrown: it
 * would pass on a retry, and swapping in a spare for it would give two players of the same
 * link different places.
 */
export async function resolveRounds<P>(
  candidates: readonly Location[],
  count: number,
  load: (location: Location) => Promise<P>,
  isGone: (error: unknown) => boolean,
): Promise<ResolvedRound<P>[]> {
  const attempt = async (location: Location): Promise<ResolvedRound<P> | null> => {
    try {
      return { location, pano: await load(location) };
    } catch (error) {
      if (!isGone(error)) {
        throw error;
      }
      return null;
    }
  };

  const first = await Promise.all(candidates.slice(0, count).map(attempt));
  let resolved = first.filter((round) => round !== null);
  for (const spare of candidates.slice(count)) {
    if (resolved.length >= count) {
      break;
    }
    const round = await attempt(spare);
    resolved = round ? [...resolved, round] : resolved;
  }

  if (resolved.length < count) {
    throw new Error(`Only ${resolved.length} of ${count} places could be loaded`);
  }
  return resolved;
}
