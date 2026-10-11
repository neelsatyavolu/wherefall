import { expect, test, type Page } from '@playwright/test';
import { AccountServer } from './account-server.ts';
import { DailyServer, type DailyEntry } from './daily-server.ts';
import { PLACES_FIXTURE, RUSSIA_ONLY, mockPlaces, mockServices } from './fixtures.ts';
import { GamesServer } from './games-server.ts';
import { play, roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { MatchServer, signIn } from './match-server.ts';
import { servePlaces } from './place-rules.ts';
import { SocialServer } from './social-server.ts';

// Wave 6, the daily and everything a solo game saves: the result against the day's average and a
// personal best (item 11); everyone's daily begun on the server, a visitor's kept with its token
// and claimed (items 16, 17); a result refused because the site was updated under the game; the
// list of places never read from a stale copy; and what a save says when it is refused, or when
// the day's XP limit is reached.

const TODAY = '2026-10-11';
const STORE = 'plonk.daily';
const PASSWORD = 'correct horse battery';
const PHONE = { width: 390, height: 800 };
/** on the open pin map of a 1280x720 window, well inside the country */
const SIBERIA = { x: 556, y: 94 };
const BRAZIL = { x: 254, y: 278 };
const WORLD_GAME = '/?map=world&seed=e2e00001&t=0&mode=move&n=3';

const SAVED_DAILY = "On today's leaderboard as neel.";
const XP_CAPPED = "Today's XP limit for solo games is reached, so no XP was added.";
const XP_CUT = "That reaches today's XP limit for solo games, so only part of the XP was added.";
const NEXT_GAME_CURRENT = 'Wherefall was updated while this page was open, and its places changed. Your next game is played on the current ones.';
const STALE_NOTE = 'Wherefall was updated while you played, so this result could not be saved.';
const STALE_EXPLAIN =
  "The update changed today's three places, and this game was played on the earlier ones. Reload to get the new version. Today's attempt is used, so the daily cannot be played again today. The next challenge opens at midnight UTC.";
const STALE_SPENT = "Today's result could not be saved: Wherefall was updated while you played, and the update changed today's places. Today's attempt is used. A new challenge is waiting tomorrow.";
const KEPT_FOR_ACCOUNT = 'This result is kept in this browser, off the leaderboard. Create an account and it moves there.';
const KEPT_HERE_ONLY = 'This result is kept in this browser, off the leaderboard. It was played before results could move to an account, so it stays here.';

type Row = [id: string, lng: number, lat: number, country: string];

/** The same places under other ids: what the server holds after an update that replaced the list. */
const renamed = (list: { locations: unknown[] }) => ({ ...list, locations: (list.locations as Row[]).map(([id, ...rest]): Row => [`new-${id}`, ...rest]) });
const NEWER = renamed(PLACES_FIXTURE);
const KENYA_ONLY = { version: 1, regions: { KE: 'africa' }, locations: Array.from({ length: 40 }, (_, i): Row => [`ke-${String(i).padStart(2, '0')}`, 35 + (i % 9) * 0.2, -2 + Math.floor(i / 9) * 0.2, 'KE']) };

/** The page as "neel" sees it, or as a visitor when `username` is null, playing from `places`. */
async function setUp(page: Page, username: string | null = 'neel', places: unknown = PLACES_FIXTURE) {
  await mockServices(page);
  await mockPlaces(page, places);
  await signIn(page, username);
  const session = username === null ? 'none' : 'account';
  const daily = await DailyServer.install(page, session);
  const games = await GamesServer.install(page, daily);
  games.session = session;
  const social = await SocialServer.install(page);
  social.session = session;
  const match = await MatchServer.install(page);
  match.session = session;
  return { daily, games };
}

const playButton = (page: Page) => page.getByRole('button', { name: "Play today's challenge" });
const summary = (page: Page) => page.getByRole('region', { name: 'Game summary' });
const figureOf = (page: Page, label: string) => page.locator('.figure').filter({ hasText: label });
const averages = (page: Page) => page.getByRole('region', { name: "Against today's average" });
const saveNote = (page: Page) => page.locator('.status-note:has(.save-note)');
const kept = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE);
const others = (count: number, rounds: number[]): DailyEntry[] =>
  Array.from({ length: count }, (_, i) => ({ username: `player${i + 1}`, country: null, score: rounds.reduce((total, each) => total + each, 0), rounds }));

/** Pins the open map at a spot and guesses. `guess` is the button's name in the language in use. */
async function guessAt(page: Page, at: { x: number; y: number }, guess = 'Guess'): Promise<void> {
  await roundReady(page);
  await page.locator('.map-panel').hover();
  await page.waitForTimeout(500);
  await page.locator('.map-panel .maplibregl-canvas').click({ position: at });
  await page.getByRole('button', { name: guess, exact: true }).click();
  await expect(play(page)).toHaveAttribute('data-phase', 'result');
}

/** Plays a local game of three rounds through to its summary, every guess in Siberia: a Russian place scores well, so the game earns XP. */
async function playThree(page: Page, guess = 'Guess'): Promise<void> {
  for (let round = 1; round <= 3; round++) {
    await guessAt(page, SIBERIA, guess);
    await page.locator('[data-action="next"]').click();
  }
}

/** One round of a Country streak run: pins the open map in a country and guesses it. */
async function streakGuess(page: Page, at: { x: number; y: number }, country: string): Promise<void> {
  await roundReady(page);
  await page.locator('.map-panel').hover();
  await page.waitForTimeout(500);
  await page.locator('.map-panel .maplibregl-canvas').click({ position: at });
  await page.getByRole('button', { name: `Guess ${country}` }).click();
}

// --- item 11: the result against the day's average, and a personal best ------------------------------------

test("each round is set against the day's average once five players have finished, and not at four", async ({ page }) => {
  const { daily } = await setUp(page);
  daily.rounds = [4800, 3950, 2500];
  // three others and the player: four have finished
  daily.entries = others(3, [4000, 4000, 2500]);
  await page.goto('/#daily');
  await expect(figureOf(page, 'Your result today')).toContainText('11,250 / 15,000');
  // nothing about averages: no heading, no rows, no empty column
  await expect(averages(page)).toHaveCount(0);
  await expect(page.locator('.daily-averages, .daily-average-row')).toHaveCount(0);
  await expect(page.locator('.daily-you').getByText(/average/i)).toHaveCount(0);

  // a fifth finishes
  daily.entries = others(4, [4000, 4000, 2500]);
  await page.reload();
  const rows = averages(page).locator('.daily-average-row');
  await expect(rows).toHaveCount(3);
  // (4 × 4,000 + 4,800) / 5 = 4,160; (4 × 4,000 + 3,950) / 5 = 3,990; 2,500 all round
  await expect(rows.nth(0)).toHaveText(/^Round 1\s*4,800\s*\+640 above average$/);
  await expect(rows.nth(1)).toHaveText(/^Round 2\s*3,950\s*-40 below average$/);
  await expect(rows.nth(2)).toHaveText(/^Round 3\s*2,500\s*Level with the average$/);
  // the side is said in words: every row is in the page's own ink (full or quieter), and no colour stands for above or below
  const ink = (colour: string) => colour.match(/\d+/g)!.slice(0, 3).join(' ');
  const pageInk = ink(await page.evaluate(() => getComputedStyle(document.body).color));
  const inks = await rows.locator('.daily-average-diff').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
  expect(inks.map(ink)).toEqual([pageInk, pageInk, pageInk]);
  // a first daily is no personal best
  await expect(page.getByText('Personal best')).toHaveCount(0);
});

test('a total higher than every earlier daily is marked a personal best, and no other is', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.rounds = [4800, 3950, 2500];
  daily.history = [
    { date: '2026-10-09', score: 9000 },
    { date: '2026-10-10', score: null },
  ];
  await page.goto('/#daily');
  await expect(figureOf(page, 'Your result today')).toContainText('11,250 / 15,000');
  await expect(figureOf(page, 'Your result today').locator('.tag')).toHaveText('Personal best');

  daily.history = [{ date: '2026-10-09', score: 12_000 }];
  await page.reload();
  await expect(figureOf(page, 'Your result today')).toContainText('11,250 / 15,000');
  await expect(page.getByText('Personal best')).toHaveCount(0);
});

test("the game's own summary shows the personal best and the averages once the result is saved", async ({ page }) => {
  const { daily } = await setUp(page);
  // four others scored nothing, and the best daily so far was nothing: any score beats both
  daily.entries = others(4, [0, 0, 0]);
  daily.history = [{ date: '2026-10-10', score: 0 }];
  await page.goto('/#daily');
  await playButton(page).click();
  await playThree(page);

  await expect(summary(page)).toContainText(SAVED_DAILY);
  await expect(summary(page).locator('.daily-extras .tag')).toHaveText('Personal best');
  const rows = summary(page).getByRole('region', { name: "Against today's average" }).locator('.daily-average-row');
  await expect(rows).toHaveCount(3);
  // a fifth of each round's own score is the average: a round that scored is above it, one that scored nothing is level
  const scores = daily.rounds!;
  for (const [index, score] of scores.entries()) {
    const diff = score - Math.round(score / 5);
    await expect(rows.nth(index)).toContainText(diff === 0 ? 'Level with the average' : `+${diff.toLocaleString('en')} above average`);
  }
  expect(scores.some((score) => score > 0)).toBe(true);
  // the extras sit between the line about the save and the table of rounds, clear of both
  const box = async (selector: string) => (await summary(page).locator(selector).boundingBox())!;
  const [note, extras, table] = [await box('.status-note:has(.save-note)'), await box('.daily-extras'), await box('table.rounds')];
  expect(note.y + note.height).toBeLessThanOrEqual(extras.y);
  expect(extras.y + extras.height).toBeLessThanOrEqual(table.y);
});

test('a summary says nothing of averages or a personal best for a visitor, or below five finishers', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.entries = others(3, [0, 0, 0]);
  await page.goto('/#daily');
  await playButton(page).click();
  await roundReady(page);
  const asked = daily.pages.length;
  await playThree(page);
  await expect(summary(page)).toContainText(SAVED_DAILY);
  // the standing has been asked for and read: it has no averages, and a first daily is no personal best
  await expect.poll(() => daily.pages.length).toBeGreaterThan(asked);
  await expect(summary(page).locator('.daily-extras')).toBeHidden();
  await expect(summary(page).locator('.daily-average-row')).toHaveCount(0);

  // a visitor's result is on no leaderboard: nothing is known to set it against
  const visitor = await page.context().newPage();
  await setUp(visitor, null);
  await visitor.goto('/#daily');
  await playButton(visitor).click();
  await playThree(visitor);
  await expect(summary(visitor)).toContainText('It is kept in this browser and moves to your account if you create one.');
  await expect(summary(visitor).locator('.daily-extras')).toBeHidden();
  await visitor.close();
});

// --- items 16, 17: everyone's daily begins on the server ------------------------------------------------------

test("a visitor's daily begins with a token from the server, is kept with it, and is claimed by the account made afterwards", async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page);
  const account = await AccountServer.install(page, null);
  const daily = await DailyServer.install(page, 'none');
  const games = await GamesServer.install(page, daily);
  games.session = 'none';
  const social = await SocialServer.install(page);
  social.session = 'none';
  const match = await MatchServer.install(page);
  match.session = 'none';

  await page.goto('/#daily');
  await playButton(page).click();
  await roundReady(page);
  // the start went to the server, and its token is with the attempt
  expect(daily.posted('start')).toHaveLength(1);
  const begun = await kept(page);
  expect(begun).toMatchObject({ started: TODAY, token: expect.stringMatching(/^daily\.2026-10-11\./), results: [] });

  await playThree(page);
  await expect(summary(page)).toContainText('It is kept in this browser and moves to your account if you create one.');
  expect(games.saved).toHaveLength(0);
  const stored = await kept(page);
  expect(stored.results).toHaveLength(1);
  expect(stored.results[0]).toMatchObject({ daily: TODAY, token: begun.token });
  // every round names its place, on the coordinates its list has
  const ids = (stored.results[0].rounds as Array<{ id: string }>).map((round) => round.id);
  expect(ids.every((id) => PLACES_FIXTURE.locations.some(([listed]) => listed === id))).toBe(true);
  const score = (stored.results[0].rounds as Array<{ score: number }>).reduce((total, round) => total + round.score, 0);

  await summary(page).getByRole('button', { name: 'Home' }).click();
  await expect(figureOf(page, 'Your result today')).toContainText(`${score.toLocaleString('en')} / 15,000`);
  await expect(page.getByText(KEPT_FOR_ACCOUNT)).toBeVisible();
  await expect(playButton(page)).toHaveCount(0);
  expect(daily.posted('start')).toHaveLength(1);

  // the visitor makes an account
  await page.goto('/#account');
  await page.getByRole('radio', { name: 'Create account' }).check();
  await page.getByLabel('Username').fill('neel');
  await page.getByLabel('Password').fill(PASSWORD);
  daily.session = 'account';
  social.session = 'account';
  games.session = 'account';
  match.session = 'account';
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect.poll(() => account.state.account?.username).toBe('neel');

  // whatever the page shows a new account first, the daily pane offers the server what was kept
  await page.goto('/#daily');
  await page.reload();
  await expect(figureOf(page, 'Rank')).toBeVisible();
  await expect(figureOf(page, 'Your result today')).toContainText(`${score.toLocaleString('en')} / 15,000`);
  const claims = daily.posted('claim') as Array<{ results: Array<{ daily: string; token: string; rounds: Array<{ id: string }> }> }>;
  expect(claims).toHaveLength(1);
  expect(claims[0]!.results).toHaveLength(1);
  expect(claims[0]!.results[0]).toMatchObject({ daily: TODAY, token: begun.token });
  expect(claims[0]!.results[0]!.rounds.map((round) => round.id)).toEqual(ids);
  // the server took it: it is the account's own now, and no longer kept here
  expect(daily.rounds).not.toBeNull();
  expect((await kept(page)).results).toEqual([]);
  await expect(page.getByText(KEPT_FOR_ACCOUNT)).toHaveCount(0);
});

test('a result kept before starts had tokens is still shown, and is offered to nobody', async ({ page }) => {
  const { daily } = await setUp(page, null);
  // as a browser kept it before this wave: no token, and rounds that do not name their place
  const old = { started: TODAY, results: [{ daily: TODAY, rounds: [4800, 3950, 2500].map((score) => ({ country: 'FR', distanceKm: 100, score, lng: 2, lat: 48, guessLng: 2.5, guessLat: 48.5, hinted: false })) }], claim: null };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: STORE, value: JSON.stringify(old) });
  await page.goto('/#daily');

  await expect(figureOf(page, 'Your result today')).toContainText('11,250 / 15,000');
  await expect(page.getByText(KEPT_HERE_ONLY)).toBeVisible();
  // no promise that an account would get it, and no way to play it again
  await expect(page.getByText('Create an account and it moves there.', { exact: false })).toHaveCount(0);
  await expect(page.locator('.daily-you a')).toHaveCount(0);
  await expect(playButton(page)).toHaveCount(0);
  expect(daily.posted('start')).toHaveLength(0);
});

test('an account is not asked to take a result that has no token', async ({ page }) => {
  const { daily } = await setUp(page);
  const old = { started: TODAY, results: [{ daily: TODAY, rounds: [4800, 3950, 2500].map((score) => ({ country: 'FR', distanceKm: 100, score })) }], claim: null };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: STORE, value: JSON.stringify(old) });
  await page.goto('/#daily');
  // the account has not played today: the daily is open to it, and nothing was claimed
  await expect(playButton(page)).toBeVisible();
  expect(daily.posted('claim')).toHaveLength(0);
  expect((await kept(page)).results).toHaveLength(1);
});

test('a start that cannot be had is said, for a visitor too, and no game begins', async ({ page }) => {
  const { daily } = await setUp(page, null);
  daily.startsRefused = true;
  await page.goto('/#daily');
  await playButton(page).click();
  await expect(page.getByRole('alert')).toHaveText('Too many dailies started in the last hour. Try again later.');
  await expect(play(page)).toHaveCount(0);
  // nothing is counted against the day in this browser
  expect((await kept(page))?.started ?? null).toBeNull();

  daily.startsRefused = false;
  await playButton(page).click();
  await roundReady(page);
  expect(daily.posted('start')).toHaveLength(2);
});

// --- a finish the server refuses ----------------------------------------------------------------------------------

test('a daily finished sooner than the server allows is sent again when the time has passed, and saved', async ({ page }) => {
  const { daily, games } = await setUp(page);
  // the real rule: six seconds from the start. Three quick rounds take less
  daily.minMs = 6000;
  await page.goto('/#daily');
  await playButton(page).click();
  await playThree(page);

  await expect(summary(page)).toContainText(SAVED_DAILY, { timeout: 15_000 });
  await expect(saveNote(page)).toHaveAttribute('data-state', 'ok');
  // refused the first time, taken the second
  expect(games.saved).toHaveLength(2);
  expect(daily.rounds).not.toBeNull();
});

test("a daily the server has no start for is refused in the server's words", async ({ page }) => {
  const { daily } = await setUp(page);
  await page.goto('/#daily');
  await playButton(page).click();
  await roundReady(page);
  // as if the start had been lost on the server's side
  daily.started = false;
  await playThree(page);
  await expect(saveNote(page)).toHaveText('Not savedStart the daily before you finish it.');
  await expect(saveNote(page)).toHaveAttribute('data-state', 'error');
});

test('a daily played across an update of the site says so, offers a reload, and says what the reload will find', async ({ page }) => {
  const { daily, games } = await setUp(page);
  await page.goto('/#daily');
  await playButton(page).click();
  await roundReady(page);
  // the site is updated while the game is on: the server now holds another list, and today's places are others
  servePlaces(page, NEWER);
  await playThree(page);

  // not the generic failure: what happened, as a failure, and under it the way on
  await expect(saveNote(page)).toHaveText(`Not saved${STALE_NOTE}`);
  await expect(saveNote(page)).toHaveAttribute('data-state', 'error');
  const notice = summary(page).locator('.daily-stale');
  await expect(notice).toContainText(STALE_EXPLAIN);
  await expect(summary(page)).not.toContainText('This result could not be put on the leaderboard.');
  await expect(summary(page)).not.toContainText("Those are not today's places.");
  expect(games.saved).toHaveLength(1);
  expect(daily.rounds).toBeNull();

  // the reload brings the new version; the attempt is used, as the notice said, and the pane says why
  await Promise.all([page.waitForEvent('load'), notice.getByRole('button', { name: 'Reload' }).click()]);
  await expect(page.getByText(STALE_SPENT)).toBeVisible();
  await expect(page.getByText('One attempt a day. The next challenge opens at midnight UTC.')).toBeVisible();
  await expect(page.getByText("You began today's challenge and left before the end", { exact: false })).toHaveCount(0);
  await expect(playButton(page)).toHaveCount(0);
  expect(daily.posted('start')).toHaveLength(1);
});

// --- the list of places is never stale ----------------------------------------------------------------------------

test('a page open since before an update draws the daily from the list the server holds when the attempt begins', async ({ page }) => {
  let listsRead = 0;
  page.on('request', (request) => {
    listsRead += new URL(request.url()).pathname === '/locations.json' ? 1 : 0;
  });
  const { games } = await setUp(page);
  await page.goto('/');
  // the home screen has read the list, to offer its maps
  await expect.poll(() => listsRead).toBe(1);

  // the site is updated under the open page: the list is replaced on the server
  await mockPlaces(page, NEWER);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Daily challenge', exact: true }).click();
  await playButton(page).click();
  await playThree(page);

  // the list was read again as the attempt began, so the three places are the server's and the result is taken
  expect(listsRead).toBe(2);
  await expect(summary(page)).toContainText(SAVED_DAILY);
  const ids = (games.saved[0]!.rounds as Array<{ id: string }>).map((round) => round.id);
  expect(ids).toHaveLength(3);
  expect(ids.every((id) => id.startsWith('new-'))).toBe(true);
});

test('the list of places is asked of the server every time, and the service worker keeps no copy of it', async ({ page }) => {
  await mockServices(page);
  await signIn(page, null);
  let served = 0;
  await page.route('**/locations.json', async (route) => {
    served += 1;
    await route.fulfill({ json: { ...PLACES_FIXTURE, version: served }, headers: { 'cache-control': 'public, max-age=31536000' } });
  });
  await page.goto('/#about');

  // the worker installs and takes the page over
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');

  // asked as the game asks (`no-cache`): each answer is the server's own, though the first said it could be kept for a year
  const before = served;
  const versions = await page.evaluate(async () => {
    const ask = async () => ((await (await fetch('/locations.json', { cache: 'no-cache' })).json()) as { version: number }).version;
    return [await ask(), await ask()];
  });
  expect(versions).toEqual([before + 1, before + 2]);
  expect(served).toBe(before + 2);

  // and the worker kept neither: nothing but the shell is in its cache, and nothing of the lists in storage
  const keptPaths = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls = await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)));
    return urls.flat();
  });
  expect(keptPaths.filter((path) => path.includes('locations'))).toEqual([]);
  expect(keptPaths.every((path) => path === '/' || path.startsWith('/assets/'))).toBe(true);
  const storedKeys = await page.evaluate(async () => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), databases: (await indexedDB.databases()).map((each) => each.name) }));
  expect(JSON.stringify(storedKeys)).not.toMatch(/locations/i);
  await page.evaluate(async () => Promise.all((await navigator.serviceWorker.getRegistrations()).map((registration) => registration.unregister())));
});

// --- what a save says ---------------------------------------------------------------------------------------------

test("a saved game says XP was not added once the day's limit is reached", async ({ page }) => {
  const { games } = await setUp(page, 'neel', RUSSIA_ONLY);
  games.xpLeft = 0;
  await page.goto(WORLD_GAME);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await playThree(page);
  await expect(saveNote(page)).toHaveText(`SavedSaved to neel's stats. ${XP_CAPPED}`);
  await expect(saveNote(page)).toHaveAttribute('data-state', 'ok');
});

test('the daily says so too', async ({ page }) => {
  const { games } = await setUp(page);
  games.xpLeft = 0;
  await page.goto('/#daily');
  await playButton(page).click();
  await playThree(page);
  await expect(saveNote(page)).toHaveText(`Saved${SAVED_DAILY} ${XP_CAPPED}`);
});

test('a streak run that reaches the limit says only part of its XP was added', async ({ page }) => {
  const { games } = await setUp(page, 'neel', RUSSIA_ONLY);
  // a streak of one is worth 20 XP, and ten are left today
  games.xpLeft = 10;
  await page.goto('/#streak');
  await page.getByRole('button', { name: 'Start streak' }).click();
  await streakGuess(page, SIBERIA, 'Russia');
  await expect(page.locator('.hud .hud-cell').filter({ hasText: 'Streak' })).toHaveText('Streak1');
  await streakGuess(page, BRAZIL, 'Brazil');

  const over = page.getByRole('region', { name: 'Streak over' });
  await expect(over).toContainText(`Your best streak is 7. +10 XP. ${XP_CUT}`, { timeout: 15_000 });
  await expect(over.locator('.status-note:has(.save-note)')).toHaveAttribute('data-state', 'ok');
});

for (const [kind, question, pick] of [
  ['country', 'Which country is this?', 'Kenya'],
  ['continent', 'Which continent is this?', 'Africa'],
] as const) {
  test(`a ${kind} guesser run says XP was not added once the day's limit is reached`, async ({ page }) => {
    const { games } = await setUp(page, 'neel', KENYA_ONLY);
    games.xpLeft = 0;
    await page.goto(`/#${kind}`);
    await page.getByRole('button', { name: 'Start game' }).click();
    const panel = page.getByRole('region', { name: question });
    for (let round = 1; round <= 10; round++) {
      await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
      await expect(page.locator('.hud')).toContainText(`${round} / 10`);
      await panel.locator('.guesser-option').filter({ hasText: pick }).first().click();
      await expect(play(page)).toHaveAttribute('data-phase', 'result');
      await panel.getByRole('button', { name: round === 10 ? 'See summary' : 'Next round' }).click();
    }
    await expect(summary(page)).toContainText(`Your best score is 10,000. ${XP_CAPPED}`, { timeout: 30_000 });
  });
}

test("a run the server refuses as finished too soon is said in the server's words, not as a plain failure", async ({ page }) => {
  const { games } = await setUp(page, 'neel', RUSSIA_ONLY);
  // far more than the two seconds a round of the real rule: the finish is refused, sent once more, and refused again
  games.roundMs = 60_000;
  await page.goto('/#streak');
  await page.getByRole('button', { name: 'Start streak' }).click();
  await streakGuess(page, SIBERIA, 'Russia');
  await expect(page.locator('.hud .hud-cell').filter({ hasText: 'Streak' })).toHaveText('Streak1');
  await streakGuess(page, BRAZIL, 'Brazil');

  const note = page.getByRole('region', { name: 'Streak over' }).locator('.status-note:has(.save-note)');
  await expect(note).toHaveText('Not savedThat run finished sooner than it could have been played.', { timeout: 15_000 });
  await expect(note).toHaveAttribute('data-state', 'error');
  expect(games.saved).toHaveLength(2);
});

test('a game whose places the server no longer has says so in its words, and the next game is on the current list with no reload', async ({ page }) => {
  const { games } = await setUp(page, 'neel', RUSSIA_ONLY);
  await page.goto(WORLD_GAME);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await page.evaluate(() => Object.assign(window, { neverReloaded: true }));
  // the site is updated while the game is on: the list is replaced, for the server and for whoever asks for it next
  await mockPlaces(page, renamed(RUSSIA_ONLY));
  await playThree(page);
  await expect(saveNote(page)).toHaveText(`Not savedThat game could not be saved: its places are not on its map. ${NEXT_GAME_CURRENT}`);
  await expect(saveNote(page)).toHaveAttribute('data-state', 'error');

  // the same page, never reloaded: its next game reads the list again and is saved
  await summary(page).getByRole('button', { name: 'Play again' }).click();
  await playThree(page);
  await expect(saveNote(page)).toHaveText(/^SavedSaved to neel's stats\./);
  expect(await page.evaluate(() => (window as { neverReloaded?: boolean }).neverReloaded)).toBe(true);
  // the games themselves, among the runs the background country streak posts (each with a `kind`)
  const played = games.saved.filter((body) => (body as { kind?: string }).kind === undefined) as Array<{ rounds: Array<{ id: string }> }>;
  expect(played).toHaveLength(2);
  expect(played[0]!.rounds.every((round) => !round.id.startsWith('new-'))).toBe(true);
  expect(played[1]!.rounds.every((round) => round.id.startsWith('new-'))).toBe(true);
});

// --- layout and language ----------------------------------------------------------------------------------------

for (const size of [{ width: 1360, height: 840 }, PHONE]) {
  for (const scheme of ['dark', 'light'] as const) {
    test(`the result with its averages and personal best fits ${size.width}x${size.height} in ${scheme}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: scheme });
      const { daily } = await setUp(page);
      daily.rounds = [4800, 3950, 2500];
      daily.entries = others(4, [4000, 4000, 2500]);
      daily.history = [{ date: '2026-10-10', score: 9000 }];
      await page.goto('/#daily');
      await expect(averages(page).locator('.daily-average-row')).toHaveCount(3);
      await expect(page.getByText('Personal best')).toBeVisible();

      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      const spilling = await page
        .locator('.daily-average-row, .daily-average-row span, .daily-you .figure, .daily-you .tag')
        .evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().right > innerWidth).map((node) => node.textContent));
      expect(spilling).toEqual([]);
      // each row is one line: the round, its score and the words beside one another
      const heights = await page.locator('.daily-average-row').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
      expect(Math.max(...heights)).toBeLessThan(48);
    });
  }
}

for (const code of ['de', 'ru']) {
  test.describe(`in ${code}`, () => {
    const say = CATALOGS[code]!;
    const NAMES = ['neel', ...others(4, [0]).map((entry) => entry.username)];
    /** the day and the settings line are written for the language by the browser and from parts, not taken whole from a catalog */
    const written = async (page: Page) => [...(await page.locator('.daily-facts .figure-value, .daily-facts .settings-line').allTextContents()), ...(await page.locator('.flag-code').allTextContents())];

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
    });

    test('the result with its averages and a personal best is in the language, on a phone', async ({ page }) => {
      await page.setViewportSize(PHONE);
      const { daily } = await setUp(page);
      daily.rounds = [4800, 3950, 2500];
      daily.entries = others(4, [4000, 4000, 2500]);
      daily.history = [{ date: '2026-10-10', score: 9000 }];
      daily.streak = { current: 2, best: 9, atRisk: false };
      daily.records = { played: 12, best: 11_250, average: 9860 };
      await page.goto('/#daily');
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(page.locator('.daily-average-row')).toHaveCount(3);
      await expect(page.locator('.daily-average-diff').nth(0)).toHaveText(say['daily.average.above'].replace('{points}', '+640'));
      await expect(page.locator('.daily-average-diff').nth(1)).toHaveText(say['daily.average.below'].replace('{points}', '-40'));
      await expect(page.locator('.daily-average-diff').nth(2)).toHaveText(say['daily.average.level']);
      await expect(page.locator('.daily-you .tag')).toHaveText(say['daily.personalBest']);
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
      const cut = await page.locator('.daily-average-row span, .daily-you .tag').evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().right > innerWidth).map((node) => node.textContent));
      expect(cut).toEqual([]);
    });

    test('a daily lost to an update says so in the language, on its summary and after the reload', async ({ page }) => {
      const { daily } = await setUp(page);
      await page.goto('/#daily');
      await page.getByRole('button', { name: say['daily.play'], exact: true }).click();
      await roundReady(page);
      servePlaces(page, NEWER);
      await playThree(page, say['round.guess']);

      // read on a phone, where the summary is a sheet at the foot of the screen
      await page.setViewportSize(PHONE);
      const notice = page.locator('.summary-panel .daily-stale');
      await expect(notice).toContainText(say['daily.stale.explain']);
      await expect(page.locator('.summary-panel .save-note')).toHaveText(say['daily.stale.note']);
      await expectTranslated(page, code, NAMES);
      // the notice and its button are whole inside the sheet
      const reload = notice.getByRole('button', { name: say['daily.stale.reload'], exact: true });
      await reload.scrollIntoViewIfNeeded();
      const [sheet, button] = [(await page.locator('.summary-panel').boundingBox())!, (await reload.boundingBox())!];
      expect(button.x).toBeGreaterThanOrEqual(sheet.x);
      expect(button.x + button.width).toBeLessThanOrEqual(sheet.x + sheet.width);
      expect(button.height).toBeGreaterThanOrEqual(44);

      await Promise.all([page.waitForEvent('load'), reload.click()]);
      await expect(page.getByText(say['daily.stale.spent'])).toBeVisible();
      await expectTranslated(page, code, [...NAMES, 'sam', 'ana', ...(await written(page))]);
      expect(daily.posted('start')).toHaveLength(1);
    });
  });
}
