import { isMapId, type MapId } from '../game/locations.ts';
import { tn } from '../i18n/index.ts';

/**
 * A map chosen somewhere else (the Maps pane, a community map's page) for the Singleplayer or
 * Create party form to open on. It travels in the browser's history entry, so back, forward and
 * reload keep it.
 */
export interface MapPreset {
  map: MapId;
  /** what to call it: a community map's name is not in its id */
  name: string;
  /** how many places it has, when that limits the rounds; null when it does not */
  places: number | null;
}

/** What to hand `history.pushState` to carry a preset. */
export const presetState = (preset: MapPreset) => ({ preset });

/** Reads a preset out of a history entry's state. Anything that is not one is ignored. */
export function readPreset(state: unknown): MapPreset | null {
  const preset = (state as { preset?: Partial<MapPreset> } | null)?.preset;
  if (!preset || !isMapId(preset.map) || typeof preset.name !== 'string') {
    return null;
  }
  return { map: preset.map, name: preset.name, places: typeof preset.places === 'number' ? preset.places : null };
}

/** What is wrong with playing so many rounds on the map, or null when it has enough places. */
export function roundsProblem(preset: MapPreset | null, map: MapId, rounds: number): string | null {
  if (!preset || preset.map !== map || preset.places === null || preset.places >= rounds) {
    return null;
  }
  return tn('map.tooFewPlaces', preset.places, { name: preset.name });
}
