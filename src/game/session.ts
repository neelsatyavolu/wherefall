import { distanceKm, type LngLat } from './geo.ts';
import type { Location } from './locations.ts';
import { scoreForDistance } from './scoring.ts';

export interface RoundResult {
  location: Location;
  /** null when the timer ran out before a pin was placed */
  guess: LngLat | null;
  distanceKm: number | null;
  score: number;
  /** true when the player asked for the hint, which halves the round's score */
  hinted: boolean;
  /** how long the round took, from the view loading to the guess; left out where nobody timed it */
  timeMs?: number;
}

export interface Session {
  readonly rounds: readonly Location[];
  readonly results: readonly RoundResult[];
  readonly scaleKm: number;
}

export function createSession(rounds: readonly Location[], scaleKm: number): Session {
  if (rounds.length === 0) {
    throw new Error('A game needs at least one round');
  }
  return { rounds, results: [], scaleKm };
}

export function currentRound(session: Session): Location | null {
  return session.rounds[session.results.length] ?? null;
}

export function isComplete(session: Session): boolean {
  return session.results.length >= session.rounds.length;
}

export function totalScore(session: Session): number {
  return session.results.reduce((sum, result) => sum + result.score, 0);
}

/** How many of the rounds played so far were hinted. */
export function hintsUsed(session: Session): number {
  return session.results.filter((result) => result.hinted).length;
}

export function submitGuess(session: Session, guess: LngLat | null, hinted = false, timeMs?: number): Session {
  const location = currentRound(session);
  if (!location) {
    throw new Error('The game is already complete');
  }
  const distance = guess ? distanceKm(guess, location) : null;
  const full = distance === null ? 0 : scoreForDistance(distance, session.scaleKm);
  const score = hinted ? Math.floor(full / 2) : full;
  const result: RoundResult = { location, guess, distanceKm: distance, score, hinted, ...(timeMs === undefined ? {} : { timeMs }) };
  return { ...session, results: [...session.results, result] };
}

/** Swaps the place of a round that has not been played yet, as when its picture will not load. The round count stays. */
export function replaceRound(session: Session, index: number, location: Location): Session {
  if (index < session.results.length || index >= session.rounds.length) {
    throw new Error(`Round ${index} cannot be replaced`);
  }
  return { ...session, rounds: session.rounds.map((round, i) => (i === index ? location : round)) };
}
