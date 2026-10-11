import { randomUUID } from 'node:crypto';
import { MAX_STREAK, RUN_KINDS, type RunFinish } from '../account/input.js';
import { sign, verify } from '../account/session.js';
import type { RunKind } from '../db/games.js';
import { continentOf } from '../places/continents.js';
import { knownPlace, type KnownPlace } from '../places/lists.js';

/**
 * A run of the country streak, Country Guesser or Continent Guesser begins
 * on the server, which hands the browser a signed note of who began it, of
 * what kind and when. The run is finished with that note, so the server
 * knows how long it took and counts each run once.
 */

// Its own prefix, so a run's token is never taken for a session, nor a session or any other token for a run.
const PREFIX = 'run.';
const ID = /^[0-9a-f]{32}$/;

/** A finish is refused when it comes sooner than this for each round it sends. */
export const RUN_ROUND_MS = 2_000;

export interface StartedRun {
  /** What tells this run from every other. */
  id: string;
  userId: string;
  kind: RunKind;
  /** Epoch milliseconds. */
  startedAt: number;
}

/** The token a run is finished with. */
export function runToken(userId: string, kind: RunKind, now: number, secret: Buffer): string {
  return sign(`${PREFIX}${randomUUID().replaceAll('-', '')}.${userId}.${kind}.${now}`, secret);
}

const isKind = (kind: string | undefined): kind is RunKind => RUN_KINDS.some((known) => known === kind);

/** The run a token was made for, or null when this server did not make it as a run's token. */
export function startedRun(token: string, secret: Buffer): StartedRun | null {
  const value = verify(token, secret);
  if (!value?.startsWith(PREFIX)) {
    return null;
  }
  const [id, userId, kind, started] = value.slice(PREFIX.length).split('.');
  const startedAt = Number(started);
  const sound = id !== undefined && ID.test(id) && userId !== undefined && isKind(kind) && Number.isSafeInteger(startedAt);
  return sound ? { id, userId, kind, startedAt } : null;
}

/** The places of a run's rounds, or null when one of them is in neither list. */
function placesOf(rounds: ReadonlyArray<{ id: string }>): KnownPlace[] | null {
  const places = rounds.flatMap((round) => knownPlace(round.id) ?? []);
  return places.length === rounds.length ? places : null;
}

/**
 * What a finished run comes to, counted by the server from the place of each
 * round and what the player chose. A streak is the rounds from the first
 * whose answer is the place's country, up to the first that is not. A
 * guesser's is how many answers are right. Null when a place is not one the
 * server knows, or is on no continent and so could not have been asked about
 * in Continent Guesser.
 */
export function countRun(run: RunFinish): number | null {
  const places = placesOf(run.rounds);
  if (!places) {
    return null;
  }
  if (run.kind === 'continent') {
    const continents = places.map(continentOf);
    return continents.includes(null) ? null : run.rounds.filter((round, index) => round.answer === continents[index]).length;
  }
  const right = run.rounds.map((round, index) => round.answer === places[index]?.country);
  if (run.kind === 'country') {
    return right.filter(Boolean).length;
  }
  const lost = right.indexOf(false);
  return Math.min(MAX_STREAK, lost === -1 ? right.length : lost);
}
