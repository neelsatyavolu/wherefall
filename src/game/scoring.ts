import { formatNumber, language, t } from '../i18n/index.ts';

export const MAX_ROUND_SCORE = 5000;

/** The scale the world map is scored on. Every other map uses the diagonal of its own places. */
export const WORLD_SCALE_KM = 20_000;

const PERFECT_WITHIN_KM = 0.03;
/** A score above this is so nearly perfect that it is given as perfect. */
const AS_GOOD_AS_PERFECT = 4997;
const DECAY = 10;

/** Points for a guess: full marks on the spot, falling off exponentially with distance. */
export function scoreForDistance(distanceKm: number, scaleKm: number): number {
  if (!(distanceKm >= 0) || !(scaleKm > 0)) {
    throw new Error(`Cannot score distance ${distanceKm} km on scale ${scaleKm} km`);
  }
  if (distanceKm <= PERFECT_WITHIN_KM) {
    return MAX_ROUND_SCORE;
  }
  const score = Math.round(MAX_ROUND_SCORE * Math.exp((-DECAY * distanceKm) / scaleKm));
  return score > AS_GOOD_AS_PERFECT ? MAX_ROUND_SCORE : score;
}

export type Units = 'km' | 'mi';

const KM_PER_MILE = 1.609344;
const FEET_PER_MILE = 5280;

const grouped = (value: number) => formatNumber(Math.round(value));
/** one decimal, with the language's own decimal mark */
const oneDecimal = (value: number) => value.toLocaleString(language(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A distance for showing, in the player's units and language. Distances are always kept in kilometres. */
export function formatDistance(km: number, units: Units = 'km'): string {
  const [value, unit, small, smallPerUnit] = units === 'mi' ? ([km / KM_PER_MILE, 'unit.mi', 'unit.ft', FEET_PER_MILE] as const) : ([km, 'unit.km', 'unit.m', 1000] as const);
  if (value < 1) {
    return t(small, { value: grouped(value * smallPerUnit) });
  }
  return t(unit, { value: value < 100 ? oneDecimal(value) : grouped(value) });
}
