import { en } from './en.ts';

/** The languages the interface comes in. Messages from the server stay in English. */
export const LANGUAGES = ['en', 'es', 'fr', 'de', 'ru'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Each language under its own name, for the switch on the account pane. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', ru: 'Русский' };

export type Key = keyof typeof en;
/** A key that changes with a count: the part before `.one` / `.other`. */
export type PluralKey = Key extends infer K ? (K extends `${infer Base}.other` ? Base : never) : never;
type ExtraForms = `${PluralKey}.${'zero' | 'two' | 'few' | 'many'}`;

/**
 * A whole catalog in another language: every English key, or the type check fails, plus the
 * plural forms that language has and English does not.
 */
export type Translation = Record<Key, string> & Partial<Record<ExtraForms, string>>;

type PluralBase<K> = K extends `${infer Base}.other` ? Base : never;
/**
 * One area of a catalog in another language (`./es/daily.ts` against `./en/daily.ts`): every key of
 * the English area, plus the plural forms that language has and English does not.
 */
export type Part<English> = Record<keyof English, string> & Partial<Record<`${PluralBase<keyof English & string>}.${'zero' | 'two' | 'few' | 'many'}`, string>>;

type Params = Record<string, string | number>;

/**
 * The language to use: one forced in the address (`?lang=xx`) wins, then the one the player chose
 * before, then the first of the browser's languages that the interface has, then English.
 */
export function pickLanguage(forced: string | null, stored: string | null, preferred: readonly string[]): Language {
  const known = (code: string | null | undefined): Language | null => LANGUAGES.find((language) => language === code?.toLowerCase().split('-')[0]) ?? null;
  return known(forced) ?? known(stored) ?? preferred.map(known).find((language) => language !== null) ?? 'en';
}

/** Puts values into a string's `{name}` places. A place with no value is left as it is. */
export function format(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

const LOADERS: Record<Exclude<Language, 'en'>, () => Promise<Translation>> = {
  es: async () => (await import('./es.ts')).es,
  fr: async () => (await import('./fr.ts')).fr,
  de: async () => (await import('./de.ts')).de,
  ru: async () => (await import('./ru.ts')).ru,
};

let current: Language = 'en';
let catalog: Translation = en;

/** Switches the interface to a language, loading its catalog. A catalog that will not load leaves English. */
export async function useLanguage(language: Language): Promise<void> {
  try {
    catalog = language === 'en' ? en : await LOADERS[language]();
    current = language;
  } catch {
    catalog = en;
    current = 'en';
  }
}

/** The language in use, which is also the locale numbers, dates and country names are written in. */
export const language = (): Language => current;

/** A string in the language in use. */
export function t(key: Key, params?: Params): string {
  return format(catalog[key], params);
}

/** A string that changes with a count, in the right plural form for the language. `{count}` is the number, written for the locale. */
export function tn(key: PluralKey, count: number, params: Params = {}): string {
  const form = new Intl.PluralRules(current).select(count);
  const forms = catalog as Record<string, string | undefined>;
  return format(forms[`${key}.${form}`] ?? forms[`${key}.other`] ?? '', { count: formatNumber(count), ...params });
}

/** A whole number with the locale's grouping: 12,345 in English, 12.345 in German, 12 345 in French. */
export const formatNumber = (value: number): string => value.toLocaleString(current);
