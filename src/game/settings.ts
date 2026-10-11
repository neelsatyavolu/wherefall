import { t } from '../i18n/index.ts';
import { isMapId, type MapId } from './locations.ts';

/** Seconds for a round: 0 for no limit, else `TIME_STEP` to `MAX_TIME_LIMIT` in steps of `TIME_STEP`. */
export type TimeLimit = number;
export const TIME_STEP = 10;
export const MAX_TIME_LIMIT = 300;

export const isTimeLimit = (seconds: number): boolean =>
  seconds === 0 || (Number.isInteger(seconds) && seconds >= TIME_STEP && seconds <= MAX_TIME_LIMIT && seconds % TIME_STEP === 0);

/** The allowed time nearest to a number of seconds: under half a step is no limit, and nothing passes the longest. */
export function nearestTimeLimit(seconds: number): TimeLimit {
  const steps = Number.isFinite(seconds) ? Math.round(seconds / TIME_STEP) : 0;
  return Math.min(MAX_TIME_LIMIT, Math.max(0, steps * TIME_STEP));
}

export const ROUND_COUNTS = [3, 5, 10] as const;
export type RoundCount = (typeof ROUND_COUNTS)[number];

/**
 * move: walk the streets. no-move: look around from one spot.
 * nmpz: no moving, panning or zooming, so the first view is all there is.
 */
export const MODES = ['move', 'no-move', 'nmpz'] as const;
export type Mode = (typeof MODES)[number];

/** A mode's name, as a choice in a form. */
export const modeName = (mode: Mode): string => t(`mode.${mode}`);

export interface GameOptions {
  map: MapId;
  /** seconds per round, 0 for no limit */
  timeLimit: TimeLimit;
  mode: Mode;
  rounds: RoundCount;
}

/** Everything needed to replay the same places: this is what a challenge link carries. */
export interface Challenge extends GameOptions {
  seed: string;
}

export const DEFAULT_OPTIONS: GameOptions = { map: 'world', timeLimit: 0, mode: 'move', rounds: 5 };

const SEED_PATTERN = /^[a-z0-9]{1,32}$/;

const mapParam = (value: string | null): MapId => (isMapId(value) ? value : DEFAULT_OPTIONS.map);

/** A link's `t`: plain digits that make an allowed time, so the 30, 60 and 120 of older links still open. */
function timeParam(value: string | null): TimeLimit {
  const seconds = value !== null && /^\d{1,3}$/.test(value) ? Number(value) : Number.NaN;
  return isTimeLimit(seconds) ? seconds : DEFAULT_OPTIONS.timeLimit;
}

export function parseChallenge(search: string): Challenge | null {
  const params = new URLSearchParams(search);
  const seed = params.get('seed');
  if (!seed || !SEED_PATTERN.test(seed)) {
    return null;
  }
  return {
    seed,
    map: mapParam(params.get('map')),
    timeLimit: timeParam(params.get('t')),
    mode: MODES.find((mode) => mode === params.get('mode')) ?? DEFAULT_OPTIONS.mode,
    rounds: ROUND_COUNTS.find((n) => String(n) === params.get('n')) ?? DEFAULT_OPTIONS.rounds,
  };
}

export function toSearch(challenge: Challenge): string {
  const params = new URLSearchParams({
    map: challenge.map,
    seed: challenge.seed,
    t: String(challenge.timeLimit),
    mode: challenge.mode,
    n: String(challenge.rounds),
  });
  return `?${params}`;
}
