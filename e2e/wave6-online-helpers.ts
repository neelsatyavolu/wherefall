import { expect, type Page, type Request } from '@playwright/test';
import type { Location } from '../src/game/locations.ts';
import { pickRounds } from '../src/game/locations.ts';
import { continentCount, drawSpread } from '../src/game/spread.ts';
import type { MatchState } from '../src/multiplayer/client.ts';
import { drawSeed } from '../src/multiplayer/draw.ts';
import { KIND_SETTINGS, PLACES, guessRow, guest, matchState, outcome, player, rankedState, settings, teamState, viewer } from '../src/multiplayer/testing.ts';
import { AccountServer } from './account-server.ts';
import { openPlaces } from './contract-helpers.ts';
import { mockServices } from './fixtures.ts';
import { CATALOGS } from './language-checks.ts';
import { MatchServer, signIn } from './match-server.ts';

/** What the wave-6 match tests share: the matches they open, the draws they expect, and how a page gets into one. */

export const PHONE = { width: 390, height: 800 };
export const GUEST = 'Guest #4821';
export const AS_GUEST = viewer({ username: GUEST, guest: true });
export const ROUNDS = 5;

export const ids = (places: ReadonlyArray<{ id: string }>) => places.map((place) => place.id);

/** The places a page draws from: the real open list, which the dev server serves. */
const open = openPlaces();

/** The plain draw of a seed: the first places its order gives, as a party and a game alone take them. */
export const plainDraw = (seed: string): Location[] => pickRounds(open, seed, ROUNDS);

/** The draw of an online world game: the same order, held to three continents. `refused` sets were turned down before it; `gone` have no picture. */
export const spreadDraw = (seed: string, refused = 0, gone: readonly string[] = []): Location[] =>
  drawSpread(pickRounds(open, drawSeed(seed, refused), open.length), ROUNDS, new Set(gone));

/**
 * A seed whose plain draw is on fewer than three continents: the open list is mostly Europe, so
 * most are. A game drawn from it shows whether the rule was applied.
 */
export const LOPSIDED_SEED = Array.from({ length: 200 }, (_, index) => `e2e${String(index).padStart(5, '0')}`).find((seed) => continentCount(plainDraw(seed)) < 3)!;

/** A match of each kind waiting for its places, which "neel" is the one to post. */
export const PREPARING: Record<'unranked' | 'ranked' | 'team' | 'party', () => MatchState> = {
  unranked: () =>
    matchState({ id: 'm9', code: null, kind: 'unranked', phase: 'preparing', settings: KIND_SETTINGS.unranked, you: viewer({ isResolver: true }), players: [player('neel'), player('ana')], seed: LOPSIDED_SEED }),
  ranked: () => rankedState({ id: 'm7', phase: 'preparing', seed: LOPSIDED_SEED }),
  team: () => teamState({ id: 'm8', phase: 'preparing', seed: LOPSIDED_SEED }),
  party: () => matchState({ phase: 'preparing', settings: settings({ rounds: ROUNDS }), seed: LOPSIDED_SEED }),
};

/** A party that has been played to its end by "neel" and "sam", seen by "neel". */
export const finishedParty = (): MatchState =>
  matchState({
    you: viewer(),
    players: [player('sam'), player('neel')],
    phase: 'finished',
    places: PLACES,
    round: 2,
    results: [0, 1, 2].map((round) => ({ round, guesses: [guessRow('neel', 4000), guessRow('sam', 3000)] })),
    outcome: outcome(['neel']),
  });

/** The signed-in "neel" with the match server behind the page, in `code`. No page is opened yet. */
export async function asNeel(page: Page, code = 'en'): Promise<MatchServer> {
  const server = await MatchServer.install(page);
  await signIn(page, 'neel', 1016);
  await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
  await mockServices(page);
  return server;
}

/** Puts the signed-in "neel" in the match `state`, by way of the home screen's Rejoin, in `code`. `server` is one `asNeel` made earlier, when routes had to be laid over the stand-ins first. */
export async function enterMatch(page: Page, state: MatchState, code = 'en', server?: MatchServer): Promise<MatchServer> {
  server ??= await asNeel(page, code);
  server.state = state;
  server.matchFound(state.id);
  await page.goto('/');
  await page.getByRole('button', { name: CATALOGS[code]!['home.resume.rejoin'] }).click();
  return server;
}

/** A party of "neel", its host, and "sam", in its lobby. */
export const ownLobby = (): MatchState => matchState({ players: [player('neel'), player('sam')] });

/** A browser with no session, and the two servers that know it. */
export async function asVisitor(page: Page): Promise<{ accounts: AccountServer; server: MatchServer }> {
  const accounts = await AccountServer.install(page, null);
  const server = await MatchServer.install(page);
  server.session = 'none';
  await mockServices(page);
  return { accounts, server };
}

/** A party in its lobby with "sam" its host, for a visitor to open by its code. */
export const hostedParty = (allowGuests: boolean, inside: MatchState['players'] = []): MatchState =>
  matchState({ settings: settings({ guests: allowGuests }), you: AS_GUEST, players: [player('sam'), ...inside] });

export const guestInside = (): MatchState['players'] => [guest(4821)];

/** The places of each `places` post the page has made, in order. */
export const postedPlaces = (server: MatchServer): Location[][] => server.posted('places').map((body) => body.places as Location[]);

/** When the page asked for its match, on this clock, from now on. */
export function watchPolls(page: Page): number[] {
  const times: number[] = [];
  page.on('request', (request: Request) => {
    if (request.method() === 'GET' && request.url().includes('/api/match?id=')) {
      times.push(Date.now());
    }
  });
  return times;
}

/** Waits for the match's next reply to a poll and gives the moment it came. */
export async function nextPoll(page: Page): Promise<number> {
  await page.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes('/api/match?id='));
  return Date.now();
}

/** Makes one place's picture gone from the open imagery: a search for it finds nothing. */
export async function pictureGone(page: Page, id: string): Promise<void> {
  await page.route(
    (url) => url.hostname === 'api.panoramax.xyz' && url.searchParams.get('ids') === id,
    (route) => route.fulfill({ json: { features: [] } }),
  );
}

/** Makes one place's picture take `ms` longer to be found. */
export async function pictureLate(page: Page, id: string, ms: number): Promise<void> {
  await page.route(
    (url) => url.hostname === 'api.panoramax.xyz' && url.searchParams.get('ids') === id,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.fallback();
    },
  );
}

export const final = (page: Page) => page.getByRole('region', { name: 'Final standing' });
export const typical = (page: Page) => page.locator('.queue-typical');

/** The lopsided seed is what the tests of the rule stand on: without one they would prove nothing. */
export function expectLopsided(): void {
  expect(LOPSIDED_SEED).toBeDefined();
  expect(continentCount(plainDraw(LOPSIDED_SEED))).toBeLessThan(3);
  expect(continentCount(spreadDraw(LOPSIDED_SEED))).toBeGreaterThanOrEqual(3);
}
