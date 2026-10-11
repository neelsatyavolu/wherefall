import { formatDistance, type Units } from '../game/scoring.ts';

/** Settings kept in this browser, not on the account: they are about the screen in front of the player. */

export const MAP_SIZES = ['small', 'medium', 'large'] as const;
export type MapSize = (typeof MAP_SIZES)[number];
export const UNITS = ['km', 'mi'] as const;
/** what the guess map can be drawn as; `map-types.ts` says where each comes from */
export const MAP_TYPES = ['streets', 'satellite', 'hybrid', 'terrain'] as const;
export type MapType = (typeof MAP_TYPES)[number];

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const KEYS = { units: 'plonk.units', mapSize: 'plonk.map-size', intro: 'plonk.intro-seen', sound: 'plonk.sound', language: 'plonk.language' } as const;
const ROAD_NAMES_KEY = 'plonk.road-names';
const VOLUME_KEY = 'plonk.volume';
const MAP_TYPE_KEY = 'plonk.map-type';
const MAP_KEEP_OPEN_KEY = 'plonk.map-keep-open';
const WELCOME_KEY = 'plonk.welcome-seen';

/** The sound effects' volume runs from 0 to `MAX_VOLUME`; a new browser starts in the middle, with room either way. */
export const MAX_VOLUME = 100;
export const DEFAULT_VOLUME = 50;

/** where distances are read in miles: the browser's own locale, as it names it */
const MILE_LOCALES = ['en-us', 'en-gb'];

/** The units a browser starts with, before any choice: miles when it is set to US or UK English, else kilometres. */
export const defaultUnits = (locale: string | null | undefined): Units => (MILE_LOCALES.includes((locale ?? '').toLowerCase()) ? 'mi' : 'km');

/**
 * Storage can be missing or blocked (private windows, strict settings): every read then gives the default.
 * `locale` is the browser's own (`navigator.language`), which only the default units go by.
 */
export function createPrefs(storage: () => Storage, locale: () => string | undefined = () => undefined) {
  const startingUnits = (): Units => {
    try {
      return defaultUnits(locale());
    } catch {
      return 'km';
    }
  };
  const read = (key: string): string | null => {
    try {
      return storage().getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string): void => {
    try {
      storage().setItem(key, value);
    } catch {
      // nowhere to keep it: the choice lasts for this page only where the caller holds it
    }
  };
  const oneOf = <T extends string>(allowed: readonly T[], value: string | null, fallback: T): T => allowed.find((item) => item === value) ?? fallback;

  return {
    units: (): Units => oneOf(UNITS, read(KEYS.units), startingUnits()),
    setUnits: (units: Units) => write(KEYS.units, units),
    mapSize: (): MapSize => oneOf(MAP_SIZES, read(KEYS.mapSize), 'medium'),
    setMapSize: (size: MapSize) => write(KEYS.mapSize, size),
    /** what the guess map is drawn as: streets unless another was chosen */
    mapType: (): MapType => oneOf(MAP_TYPES, read(MAP_TYPE_KEY), 'streets'),
    setMapType: (type: MapType) => write(MAP_TYPE_KEY, type),
    /** true keeps the guess map at its open size when the pointer leaves it */
    mapKeepOpen: (): boolean => read(MAP_KEEP_OPEN_KEY) === '1',
    setMapKeepOpen: (on: boolean) => write(MAP_KEEP_OPEN_KEY, on ? '1' : '0'),
    /** on unless it was switched off */
    sound: (): boolean => read(KEYS.sound) !== '0',
    setSound: (on: boolean) => write(KEYS.sound, on ? '1' : '0'),
    /** how loud the sound effects are, 0 to 100 */
    volume: (): number => {
      const stored = read(VOLUME_KEY) ?? '';
      return /^\d{1,3}$/.test(stored) && Number(stored) <= MAX_VOLUME ? Number(stored) : DEFAULT_VOLUME;
    },
    setVolume: (volume: number) => write(VOLUME_KEY, String(Math.round(Math.min(MAX_VOLUME, Math.max(0, volume))))),
    /** the language chosen on the account pane, or null to follow the browser */
    language: (): string | null => read(KEYS.language),
    setLanguage: (language: string) => write(KEYS.language, language),
    /** street names drawn in the Street View picture: off unless switched on */
    roadNames: (): boolean => read(ROAD_NAMES_KEY) === '1',
    setRoadNames: (on: boolean) => write(ROAD_NAMES_KEY, on ? '1' : '0'),
    introSeen: (): boolean => read(KEYS.intro) === '1',
    dismissIntro: () => write(KEYS.intro, '1'),
    /** the welcome a new visitor gets was answered: the tutorial was chosen, or it was skipped */
    welcomeSeen: (): boolean => read(WELCOME_KEY) === '1',
    markWelcomeSeen: () => write(WELCOME_KEY, '1'),
  };
}

export const prefs = createPrefs(
  () => window.localStorage,
  () => navigator.language,
);

/** A distance in the units the player chose. */
export const showDistance = (km: number) => formatDistance(km, prefs.units());
