import { expect, type Locator, type Page } from '@playwright/test';
import type { Account } from '../src/account/client.ts';
import { COUNTRY_CODES } from '../src/account/countries.ts';
import { LANGUAGE_NAMES } from '../src/i18n/index.ts';
import { AccountServer } from './account-server.ts';
import { DailyServer, dailyEntries } from './daily-server.ts';
import { mockPlaces, mockServices } from './fixtures.ts';
import { GamesServer } from './games-server.ts';
import { MapsServer } from './maps-server.ts';
import { MatchServer } from './match-server.ts';
import { SocialServer, boardEntries } from './social-server.ts';

// What the three wave-6 pane specs share: the stand-ins behind a pane, the way to one, and the
// map editor opened with its stand-in for the Street View lookup.

export const PHONE = { width: 390, height: 800 };
export const DESKTOP = { width: 1360, height: 840 };
export const WIDE = 880;
export const PANO = 'AbCdEfGhIjKlMnOpQrSt-_';
/** what players typed themselves, which no catalog has */
export const NAMES = ['neel', 'sam', 'ana', 'kit', 'lee', 'zoe', 'Paris walk', 'My coast', 'Left bank and right, all on foot.', 'half of it is indoors', 'rude in chat', 'left every game', ...boardEntries(100).map((entry) => entry.username)];

export interface Options {
  username?: string | null;
  language?: string;
  account?: Partial<Account>;
}

export async function setUp(page: Page, options: Options = {}) {
  const username = options.username === undefined ? 'neel' : options.username;
  const session = username === null ? 'none' : 'account';
  await mockServices(page);
  await mockPlaces(page);
  const account = await AccountServer.install(page, username, 1016, { moderator: true, country: 'IN', ...options.account });
  const daily = await DailyServer.install(page, session);
  daily.entries = dailyEntries(45);
  const games = await GamesServer.install(page, daily);
  games.session = session;
  const social = await SocialServer.install(page);
  social.session = session;
  const match = await MatchServer.install(page);
  match.session = session;
  const maps = await MapsServer.install(page);
  maps.session = session;
  await page.addInitScript(
    ([language]) => {
      localStorage.setItem('plonk.language', language as string);
      localStorage.setItem('plonk.intro-seen', '1');
    },
    [options.language ?? 'en'] as const,
  );
  return { account, daily, games, social, match, maps };
}

export async function open(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await expect(page.locator('.pane-title')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

export const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
export const box = async (locator: Locator) => (await locator.boundingBox())!;

/** Days, countries and languages are written by the browser, not taken from a catalog. */
export async function written(page: Page): Promise<string[]> {
  const drawn = await page.locator('time, .daily-facts .figure-value, .daily-facts .settings-line, .flag-code').allTextContents();
  const countries = await page.evaluate((codes) => {
    const names = new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'region' });
    return codes.map((country) => names.of(country) ?? country);
  }, [...COUNTRY_CODES]);
  return [...Object.values(LANGUAGE_NAMES), ...drawn.map((text) => text.trim()), ...countries];
}

export type Point = { day: string; xp: number; rating: number; xpRank: number | null; ratingRank: number | null };

/** A history as the server keeps it: the last day's point is written with the XP and the rating themselves. */
export const history = (xp: number, rating: number, ratingRank: number | null): Point[] => [
  { day: '2026-10-04', xp: xp - 2400, rating: rating - 31, xpRank: 9, ratingRank: ratingRank === null ? null : ratingRank + 3 },
  { day: '2026-10-08', xp: xp - 900, rating: rating + 12, xpRank: 7, ratingRank: ratingRank === null ? null : ratingRank + 1 },
  { day: '2026-10-10', xp, rating, xpRank: 6, ratingRank },
];

// --- the map editor, as `maps-harness.ts` opens it ----------------------------------------------------------------

export const harness = (page: Page, call: string) => page.evaluate(`import('/e2e/maps-harness.ts').then((harness) => harness.${call})`);

export async function openEditor(page: Page, slug: string | null = null, delayMs = 0): Promise<void> {
  await page.goto(`/?edit=${slug ?? 'new'}`);
  // the app's own pane has settled first: the notice that this site has no Google imagery or, where it has, the editor itself
  await expect(page.locator('.pane .notice .button, #map-name').first()).toBeVisible();
  await harness(page, `mountEditor(${JSON.stringify(slug)}, ${JSON.stringify({ delayMs })})`);
  await expect(page.locator('#map-file')).toBeAttached();
  await expect(page.locator('#map-name')).toBeVisible();
}

export const upload = (page: Page, name: string, content: string | Buffer, mimeType = '') =>
  page.locator('#map-file').setInputFiles({ name, mimeType, buffer: typeof content === 'string' ? Buffer.from(content) : content });

/** Five spots in Paris, latitude first. */
export const SPOTS: Array<[number, number]> = [[48.8566, 2.3522], [48.8606, 2.3376], [48.8738, 2.295], [48.853, 2.3499], [48.8462, 2.3464]];
