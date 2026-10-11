import { formatNumber, t } from '../i18n/index.ts';
import { MAP_LIMITS, type MapContent, type MapRow } from './maps.ts';

/** A community map while it is being made or edited. Changes return a new draft. */
export interface Draft {
  readonly name: string;
  /** the short description, which every map must have */
  readonly description: string;
  /** the long description, which may be empty */
  readonly details: string;
  readonly places: readonly MapRow[];
}

export const emptyDraft = (): Draft => ({ name: '', description: '', details: '', places: [] });

/** Adds a place at the end. The same panorama twice, or one place too many, leaves the draft as it was. */
export function addPlace(draft: Draft, place: MapRow): Draft {
  if (draft.places.length >= MAP_LIMITS.maxPlaces || draft.places.some(([id]) => id === place[0])) {
    return draft;
  }
  return { ...draft, places: [...draft.places, place] };
}

export function removePlace(draft: Draft, id: string): Draft {
  return { ...draft, places: draft.places.filter(([placeId]) => placeId !== id) };
}

/** What stops the draft being saved, in words for its maker, or null when nothing does. */
export function problemWith(draft: Draft): string | null {
  const name = draft.name.trim();
  if (name.length < MAP_LIMITS.minName || name.length > MAP_LIMITS.maxName) {
    return t('draft.name', { min: MAP_LIMITS.minName, max: MAP_LIMITS.maxName });
  }
  const description = draft.description.trim();
  if (description.length < MAP_LIMITS.minDescription || description.length > MAP_LIMITS.maxDescription) {
    return t('draft.description', { min: MAP_LIMITS.minDescription, max: MAP_LIMITS.maxDescription });
  }
  if (draft.details.trim().length > MAP_LIMITS.maxDetails) {
    return t('draft.details', { max: formatNumber(MAP_LIMITS.maxDetails) });
  }
  const missing = MAP_LIMITS.minPlaces - draft.places.length;
  if (missing > 0) {
    return t('draft.places', { min: MAP_LIMITS.minPlaces, missing });
  }
  return null;
}

/** What is sent to be saved. The long description always goes, so that emptying it takes it off the map. */
export function toContent(draft: Draft): MapContent {
  return { name: draft.name.trim(), description: draft.description.trim(), details: draft.details.trim(), locations: [...draft.places] };
}

/** How many places the editor lists at once: a map may have five thousand, and that many rows would not be usable. */
export const PLACES_PER_PAGE = 50;

/** The number of the last page of so many places, counting from 0. */
export const lastPage = (count: number): number => Math.max(0, Math.ceil(count / PLACES_PER_PAGE) - 1);

export interface PlacesPage {
  rows: readonly MapRow[];
  /** the page shown, which is the last one when the page asked for is not there */
  page: number;
  /** where in the whole list the first row is, counting from 0 */
  first: number;
  total: number;
}

export function placesOnPage(places: readonly MapRow[], wanted: number): PlacesPage {
  const page = Math.min(Math.max(0, wanted), lastPage(places.length));
  const first = page * PLACES_PER_PAGE;
  return { rows: places.slice(first, first + PLACES_PER_PAGE), page, first, total: places.length };
}
