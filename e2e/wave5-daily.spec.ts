import { expect, test, type Page } from '@playwright/test';
import { drawDaily } from '../src/daily/draw.ts';
import { AccountServer } from './account-server.ts';
import { roundOn } from './contract-helpers.ts';
import { DailyServer, dailyEntries } from './daily-server.ts';
import { PLACES_FIXTURE, mockPlaces, mockServices } from './fixtures.ts';
import { GamesServer } from './games-server.ts';
import { placePin, play, playLocalGame, roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { MatchServer, signIn } from './match-server.ts';
import { dailySeed } from './place-rules.ts';
import { SocialServer } from './social-server.ts';

// Wave 5, the daily challenge: one attempt a day (items 4), and everything around it (item 17):
// the streak, the countdown, rank and players beaten, the day's scores, the paged leaderboard,
// records and history, sharing, the mark in the sidebar, and a visitor's results kept and claimed.

const TODAY = '2026-10-11';
const STORE = 'plonk.daily';
const PASSWORD = 'correct horse battery';
const BEGUN = "You began today's challenge and left before the end, so today's attempt is used. A new challenge is waiting tomorrow.";
const NOT_ADDED = 'The results you played before signing in could not be added to your account.';

/**
 * The daily as "neel" sees it, or as a visitor when `username` is null. The list of places is the
 * small one: Russia (east of the Urals, so Asia), Kenya and Japan, which is exactly three countries
 * on two continents.
 */
async function setUp(page: Page, username: string | null = 'neel', country: string | null = null) {
  await mockServices(page);
  await mockPlaces(page);
  await signIn(page, username, 1000, { country });
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
const leaderboard = (page: Page) => page.getByRole('region', { name: 'Leaderboard' });
/** by class, not by name: the same in every language */
const board = (page: Page) => page.locator('.daily-board');
const rows = (page: Page) => board(page).locator('tbody:not(.daily-own-row) tr');
const ownRow = (page: Page) => board(page).locator('tbody.daily-own-row tr');
const figureOf = (page: Page, label: string) => page.locator('.figure').filter({ hasText: label });
const mark = (page: Page) => page.locator('#daily-mark');
const dailyLink = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Daily challenge', exact: true });
const summary = (page: Page) => page.getByRole('region', { name: 'Game summary' });
const kept = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE);

const FIXTURE_PLACES = PLACES_FIXTURE.locations.map(([id, lng, lat, country]) => ({ id: id as string, lng: lng as number, lat: lat as number, country: country as string }));

/**
 * One finished daily as a visitor's browser keeps it: on the three places the day's seed draws from
 * the list the page plays from, with the token its start was answered with. The server takes a
 * claimed result only with both; `token` is null for a result that is only shown.
 */
const keptResult = (daily: string, scores: number[], token: string | null = null) => ({
  daily,
  token,
  rounds: drawDaily(FIXTURE_PLACES, dailySeed(daily)).map((place, index) => roundOn(place, scores[index])),
});

/** Puts dailies in this browser's storage before the page loads, as if a visitor had played them. */
async function keep(page: Page, results: ReturnType<typeof keptResult>[]): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, value);
      }
    },
    { key: STORE, value: JSON.stringify({ started: null, results, claim: null }) },
  );
}

// --- item 4: one attempt a day ---------------------------------------------------------------------------

test('playing the daily sends start, is three rounds in three countries with no hint, and cannot be started twice', async ({ page }) => {
  const { daily, games } = await setUp(page);
  await page.goto('/#daily');
  await expect(page.getByText('No hints. One attempt a day.')).toBeVisible();
  await playButton(page).click();

  await roundReady(page);
  // the attempt was marked as begun before the first round
  expect(daily.posted('start')).toHaveLength(1);
  expect(daily.started).toBe(true);
  await expect(page.locator('.hud')).toContainText('1 / 3');
  await expect(page.getByRole('button', { name: /^Hint/ })).toBeHidden();
  await playLocalGame(page, 3);

  // three different countries on two continents: with this list, one place in each of its three countries
  const played = (games.saved[0]!.rounds as Array<{ country: string }>).map((round) => round.country);
  expect([...played].sort()).toEqual(['JP', 'KE', 'RU']);
  for (const country of ['Russia', 'Kenya', 'Japan']) {
    await expect(summary(page).locator('tbody')).toContainText(country);
  }
  await expect(summary(page)).toContainText("On today's leaderboard as neel.");
  await expect(summary(page)).toContainText('Everyone gets the same three places today. Sharing your result gives none of them away.');
  // played once: the summary offers no second go and no challenge link
  await expect(summary(page).getByRole('button', { name: 'Play again' })).toHaveCount(0);
  await expect(summary(page).getByRole('button', { name: 'Copy challenge link' })).toHaveCount(0);
  await expect(summary(page).getByRole('button', { name: 'Share result' })).toBeVisible();

  await summary(page).getByRole('button', { name: 'Home' }).click();
  await expect(figureOf(page, 'Your result today')).toContainText('/ 15,000');
  await expect(playButton(page)).toHaveCount(0);
  expect(daily.posted('start')).toHaveLength(1);
  await expect(mark(page)).toHaveAttribute('aria-label', 'Played today');
});

test('every browser draws the same three places for the day', async ({ page, browser }) => {
  const first = await setUp(page);
  await page.goto('/#daily');
  await playButton(page).click();
  await playLocalGame(page, 3);

  const other = await browser.newPage();
  const second = await setUp(other);
  await other.goto('/#daily');
  await playButton(other).click();
  await playLocalGame(other, 3);
  await other.close();

  const places = (saved: GamesServer['saved']) => (saved[0]!.rounds as Array<{ lng: number; lat: number }>).map((round) => [round.lng, round.lat]);
  expect(places(second.games.saved)).toEqual(places(first.games.saved));
});

test('leaving the daily warns that the attempt is used, and a fresh page says it was begun', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.streak = { current: 4, best: 9, atRisk: true };
  await page.goto('/#daily');
  await playButton(page).click();
  await roundReady(page);

  await page.getByRole('button', { name: 'Exit' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText("Leave today's challenge? You get one attempt a day, and leaving uses it.");
  await dialog.getByRole('button', { name: 'Leave game' }).click();

  await expect(page.getByText(BEGUN)).toBeVisible();
  await expect(playButton(page)).toHaveCount(0);
  await expect(page.getByText('Today will not count. One missed day in seven is forgiven.')).toBeVisible();

  // the same from a page that never saw the game
  await page.reload();
  await expect(page.getByText(BEGUN)).toBeVisible();
  await expect(page.getByText('One attempt a day. The next challenge opens at midnight UTC.')).toBeVisible();
  await expect(playButton(page)).toHaveCount(0);
  await expect(mark(page)).toHaveAttribute('aria-label', 'Played today');
  expect(daily.posted('start')).toHaveLength(1);
});

test('a start the server refuses is said in its words, and no game begins', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.startsRefused = true;
  await page.goto('/#daily');
  await playButton(page).click();

  await expect(page.getByRole('alert')).toHaveText('Too many dailies started in the last hour. Try again later.');
  await expect(play(page)).toHaveCount(0);
  await expect(playButton(page)).toBeEnabled();

  // a result that came in from somewhere else since the page was drawn: the pane shows it instead of starting
  daily.startsRefused = false;
  daily.rounds = [5000, 4000, 3000];
  await playButton(page).click();
  await expect(figureOf(page, 'Your result today')).toContainText('12,000 / 15,000');
  await expect(play(page)).toHaveCount(0);
});

// --- item 17: the result, the day's scores, the leaderboard ------------------------------------------------

test('a finished daily shows the score, the rank and the share of players beaten', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.rounds = [4800, 3950, 2500];
  await page.goto('/#daily');

  await expect(figureOf(page, 'Your result today')).toContainText('11,250 / 15,000');
  // between sam and ana: second, and ahead of one of the two others
  await expect(figureOf(page, 'Rank')).toHaveText('Rank2');
  await expect(page.getByText('Beat 50% of players')).toBeVisible();
  await expect(rows(page).locator('.own td')).toHaveCount(0);
  await expect(leaderboard(page).locator('tr.own td')).toHaveText(['2', 'neelyou', '11,250']);
});

test('nobody beaten is not boasted about', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.rounds = [100, 0, 0];
  await page.goto('/#daily');

  await expect(figureOf(page, 'Rank')).toHaveText('Rank3');
  await expect(page.locator('.daily-beat')).toHaveCount(0);
});

test('the leaderboard turns its pages, with flags, and keeps the own row in sight', async ({ page }) => {
  // the account's own country is what its row shows when the page of the board does not have it
  const { daily } = await setUp(page, 'neel', 'IN');
  daily.entries = dailyEntries(45);
  daily.country = 'IN';
  daily.rounds = [1000, 500, 250];
  await page.goto('/#daily');

  await expect(leaderboard(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(20);
  await expect(rows(page).nth(0).locator('td')).toHaveText(['1', /player001$/, '14,000']);
  await expect(rows(page).nth(0).getByRole('img', { name: 'France' })).toBeVisible();
  // a player with no country has no flag
  await expect(rows(page).nth(1).locator('.flag')).toHaveCount(0);
  // 46th of 46: not on the first page, so shown under it
  await expect(ownRow(page).locator('td')).toHaveText(['46', /neelyou$/, '1,750']);
  await expect(ownRow(page).getByRole('img', { name: 'India' })).toBeVisible();
  await expect(page.locator('.pager-page')).toHaveText('Page 1');
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.pager-page')).toHaveText('Page 2');
  await expect(rows(page).nth(0).locator('td')).toHaveText(['21', 'player021', '12,000']);
  await expect(ownRow(page)).toHaveCount(1);

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.pager-page')).toHaveText('Page 3');
  // the last page has the player on it: no second copy
  await expect(rows(page)).toHaveCount(6);
  await expect(rows(page).nth(5)).toHaveClass(/own/);
  await expect(ownRow(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  expect(daily.pages).toEqual(expect.arrayContaining([2, 3]));

  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.locator('.pager-page')).toHaveText('Page 2');
});

test('a page that will not load leaves the one showing and says why', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.entries = dailyEntries(30);
  await page.goto('/#daily');
  await expect(rows(page)).toHaveCount(20);

  await page.route('**/api/daily?page=2', (route) => route.fulfill({ status: 503, json: { success: false, error: 'Try again shortly.' } }));
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(leaderboard(page).getByRole('alert')).toHaveText('Try again shortly.');
  await expect(page.locator('.pager-page')).toHaveText('Page 1');
  await expect(rows(page)).toHaveCount(20);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
});

test('a board that fits one page has no pages to turn', async ({ page }) => {
  await setUp(page);
  await page.goto('/#daily');
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('.pager')).toBeHidden();
});

test("the day's scores are ten bars with the player's own marked, beside records, the streak and 14 days of history", async ({ page }) => {
  const { daily } = await setUp(page);
  daily.rounds = [4800, 3950, 2500];
  daily.streak = { current: 5, best: 9, atRisk: false };
  daily.records = { played: 12, best: 14_200, average: 9860 };
  // the 13 days before today: every third one missed
  daily.history = Array.from({ length: 13 }, (_, i) => ({ date: `2026-${i < 3 ? '09' : '10'}-${String(i < 3 ? 28 + i : i - 2).padStart(2, '0')}`, score: i % 3 === 0 ? null : 9000 + i * 100 }));
  await page.goto('/#daily');

  const chart = page.getByRole('region', { name: "Today's scores" });
  const bars = chart.locator('.daily-bars li');
  await expect(bars).toHaveCount(10);
  // sam's 13,000, ana's 9,250 and the player's 11,250
  await expect(bars.nth(8)).toHaveAttribute('title', '12,000 to 13,499: 1 player');
  await expect(bars.nth(6)).toHaveAttribute('title', '9,000 to 10,499: 1 player');
  await expect(bars.nth(0)).toHaveAttribute('title', '0 to 1,499: 0 players');
  await expect(chart.locator('.daily-bars li.own')).toHaveCount(1);
  await expect(bars.nth(7)).toHaveClass(/own/);
  // not by colour alone: the word is over the bar
  await expect(bars.nth(7).locator('.tag')).toHaveText('you');
  await expect(chart.locator('.daily-axis')).toHaveText('015,000');
  const heights = await bars.locator('.daily-bar-fill').evaluateAll((fills) => fills.map((fill) => fill.getBoundingClientRect().height));
  expect(heights[7]).toBeGreaterThan(40);
  expect(heights[0]).toBe(0);

  const record = page.getByRole('region', { name: 'Your daily record' });
  await expect(record.locator('.figure').filter({ hasText: 'Streak' })).toHaveText('Streak5 daysBest: 9 days');
  await expect(record.getByText('Safe for today.')).toBeVisible();
  await expect(record.locator('.figure').filter({ hasText: 'Played' })).toHaveText('Played12');
  await expect(record.locator('.figure').filter({ hasText: 'Best score' })).toHaveText('Best score14,200');
  await expect(record.locator('.figure').filter({ hasText: 'Average' })).toHaveText('Average9,860');

  const days = page.getByRole('region', { name: 'Last 14 days' }).locator('li');
  await expect(days).toHaveCount(14);
  await expect(days.nth(0)).toHaveAttribute('title', 'September 28: not played');
  await expect(days.nth(0)).toHaveClass(/missed/);
  await expect(days.nth(0).locator('.daily-day-score')).toHaveText('–');
  await expect(days.nth(1)).toHaveAttribute('title', 'September 29: score 9,100');
  await expect(days.nth(1).locator('.daily-day-score')).toHaveText('9,100');
  await expect(days.nth(13)).toHaveAttribute('title', 'Today: score 11,250');
  await expect(days.nth(13)).toHaveClass(/today/);
});

test('a streak is at risk until today is played, and today is open in the history', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.streak = { current: 4, best: 9, atRisk: true };
  daily.records = { played: 11, best: 14_200, average: 9860 };
  daily.history = [{ date: '2026-10-10', score: 9000 }];
  await page.goto('/#daily');

  const record = page.getByRole('region', { name: 'Your daily record' });
  // the cell is the streak and the best one; that it is at risk is the status under the figures
  await expect(record.locator('.figure').filter({ hasText: 'Streak' })).toHaveText('Streak4 daysBest: 9 days');
  await expect(record.locator('.daily-streak-note')).toHaveText('at riskPlay today to keep it.');
  const days = page.getByRole('region', { name: 'Last 14 days' }).locator('li');
  await expect(days.nth(1)).toHaveAttribute('title', 'Today: not played yet');
  await expect(days.nth(1)).toHaveClass(/open/);
  // nobody's own bar while the player has no result
  await expect(page.locator('.daily-bars li.own')).toHaveCount(0);
  await expect(mark(page)).toHaveAttribute('aria-label', 'Streak at risk');
});

// --- item 17: sharing --------------------------------------------------------------------------------------

test('Share copies the date, the score, the share beaten, a square a round and the link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { daily } = await setUp(page);
  daily.rounds = [4800, 3950, 2500];
  await page.goto('/#daily');

  await page.getByRole('button', { name: 'Share result' }).click();
  await expect(page.getByRole('button', { name: 'Result copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    ['Wherefall daily challenge · October 11, 2026', '11,250 / 15,000', 'Beat 50% of players', '🟩🟨🟨', 'http://localhost:5184/#daily'].join('\n'),
  );
});

test("the summary's Share has the players beaten once the result is saved", async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { daily } = await setUp(page);
  // everyone else scored nothing, so any score at all beats them
  daily.entries = [
    { username: 'sam', country: null, score: 0 },
    { username: 'ana', country: null, score: 0 },
  ];
  await page.goto('/#daily');
  await playButton(page).click();
  await playLocalGame(page, 3);
  await expect(summary(page)).toContainText("On today's leaderboard as neel.");

  await summary(page).getByRole('button', { name: 'Share result' }).click();
  await expect(summary(page).getByRole('button', { name: 'Result copied' })).toBeVisible();
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
  const score = daily.rounds!.reduce((total, each) => total + each, 0);
  expect(copied[0]).toBe('Wherefall daily challenge · October 11, 2026');
  expect(copied[1]).toBe(`${score.toLocaleString('en')} / 15,000`);
  expect(copied[2]).toBe('Beat 100% of players');
  expect([...copied[3]!]).toHaveLength(3);
  expect(copied[4]).toBe('http://localhost:5184/#daily');
});

// --- item 17: the countdown ------------------------------------------------------------------------------

test('the countdown runs to the next daily and then shows it', async ({ page }) => {
  const { daily } = await setUp(page);
  await page.goto('/#daily');

  const clock = figureOf(page, 'Next challenge in').getByRole('timer');
  await expect(clock).toHaveText(/^05:59:5\d$/);
  const first = await clock.textContent();
  await expect(clock).not.toHaveText(first!);

  // three seconds to midnight: the next day opens by itself
  daily.nextInMs = 3000;
  await page.reload();
  await expect(clock).toHaveText(/^00:00:0\d$/);
  daily.date = '2026-10-12';
  daily.seed = 'daily20261012';
  daily.nextInMs = 24 * 3_600_000;
  await expect(page.getByText('October 12, 2026')).toBeVisible({ timeout: 10_000 });
  await expect(clock).toHaveText(/^23:59:\d\d$/);
});

// --- item 17: the mark in the sidebar ----------------------------------------------------------------------

test('the Daily item in the sidebar says not played, streak at risk, or played', async ({ page }) => {
  const { daily } = await setUp(page);
  await page.goto('/');
  // a square, an exclamation mark or a tick, and a label a screen reader says after the link's own name
  await expect(mark(page)).toHaveAttribute('aria-label', 'Not played today');
  await expect(mark(page)).toHaveText('');
  await expect(dailyLink(page)).toHaveAccessibleDescription('Not played today');

  daily.streak = { current: 4, best: 9, atRisk: true };
  await page.reload();
  await expect(mark(page)).toHaveAttribute('aria-label', 'Streak at risk');
  await expect(mark(page)).toHaveText('!');
  await expect(dailyLink(page)).toHaveAccessibleDescription('Streak at risk');

  daily.rounds = [4800, 3950, 2500];
  daily.streak = { current: 5, best: 9, atRisk: false };
  await page.reload();
  await expect(mark(page)).toHaveAttribute('aria-label', 'Played today');
  await expect(mark(page)).toHaveText('✓');
  await expect(mark(page)).toBeVisible();
  // the mark sits on the item without taking its clicks
  await dailyLink(page).click();
  await expect(page).toHaveURL(/#daily$/);
});

test('a visitor is marked by what this browser kept', async ({ page }) => {
  await setUp(page, null);
  await keep(page, [keptResult(TODAY, [5000, 4000, 3000])]);
  await page.goto('/');
  await expect(mark(page)).toHaveAttribute('aria-label', 'Played today');
});

// --- item 17: a visitor's results --------------------------------------------------------------------------

test("a visitor's kept results are claimed by the account they sign up for", async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page);
  const account = await AccountServer.install(page, null);
  const daily = await DailyServer.install(page, 'none');
  const games = await GamesServer.install(page, daily);
  games.session = 'none';
  const social = await SocialServer.install(page);
  social.session = 'none';
  await MatchServer.install(page);
  // each day was begun with a start the server answered, and played on that day's places: the server takes nothing else
  await keep(page, [keptResult('2026-10-09', [3000, 3000, 3000], daily.tokenFor('2026-10-09')), keptResult(TODAY, [4800, 3950, 2500], daily.tokenFor(TODAY))]);

  await page.goto('/#account');
  await page.getByRole('radio', { name: 'Create account' }).check();
  await page.getByLabel('Username').fill('neel');
  await page.getByLabel('Password').fill(PASSWORD);
  // the session the new account gets is the daily's too
  daily.session = 'account';
  social.session = 'account';
  games.session = 'account';
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  // a new account is shown its recovery code first (wave 6); the pane follows once it is acknowledged
  await page.getByRole('button', { name: 'I have saved it' }).click();
  await expect(page.locator('.account-who')).toContainText('neel');
  expect(account.state.account?.username).toBe('neel');

  // right after registering, without the daily pane being opened
  await expect.poll(() => daily.posted('claim')).toHaveLength(1);
  const claim = daily.posted('claim')[0] as { results: Array<{ daily: string; token: string; rounds: Array<{ id: string }> }> };
  expect(claim.results.map((result) => result.daily)).toEqual(['2026-10-09', TODAY]);
  expect(claim.results[1]!.rounds).toHaveLength(3);
  // each goes with the token of its own start, and each round with its place
  expect(claim.results.map((result) => result.token)).toEqual(['daily.2026-10-09.1', 'daily.2026-10-11.2']);
  expect(claim.results.every((result) => result.rounds.every((round) => typeof round.id === 'string'))).toBe(true);
  // the server took both days, so neither is kept here any more
  await expect.poll(async () => (await kept(page)).results).toEqual([]);
  await expect(mark(page)).toHaveAttribute('aria-label', 'Played today');

  await dailyLink(page).click();
  await expect(figureOf(page, 'Your result today')).toContainText('11,250 / 15,000');
  await expect(figureOf(page, 'Rank')).toHaveText('Rank2');
  await expect(page.getByText(NOT_ADDED)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Last 14 days' }).locator('li[title="October 9: score 9,000"]')).toHaveCount(1);
  expect(daily.posted('claim')).toHaveLength(1);
});

test('results an account cannot take are kept, and the player is told once', async ({ page }) => {
  const { daily } = await setUp(page);
  // an account more than a day old
  daily.claimable = false;
  await keep(page, [keptResult(TODAY, [4800, 3950, 2500], daily.tokenFor(TODAY))]);
  await page.goto('/');
  await expect.poll(() => daily.posted('claim')).toHaveLength(1);

  await dailyLink(page).click();
  await expect(page.getByText(NOT_ADDED)).toBeVisible();
  // the account has not played: the result kept as a visitor is not its own
  await expect(playButton(page)).toBeVisible();
  expect((await kept(page)).results).toHaveLength(1);

  await page.reload();
  await expect(playButton(page)).toBeVisible();
  await expect(page.getByText(NOT_ADDED)).toHaveCount(0);
  expect(daily.posted('claim')).toHaveLength(1);
});

test('a claim that fails for now is tried again, from the daily pane too', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.claimsRefused = true;
  await keep(page, [keptResult(TODAY, [4800, 3950, 2500], daily.tokenFor(TODAY))]);
  await page.goto('/#daily');
  await expect(page.getByText(NOT_ADDED)).toBeVisible();
  await expect(playButton(page)).toBeVisible();

  daily.claimsRefused = false;
  await page.reload();
  await expect(figureOf(page, 'Your result today')).toContainText('11,250 / 15,000');
  await expect(page.getByText(NOT_ADDED)).toHaveCount(0);
  expect((await kept(page)).results).toEqual([]);
});

// --- layout and language -----------------------------------------------------------------------------------

for (const size of [
  { width: 1360, height: 840 },
  { width: 390, height: 800 },
]) {
  for (const scheme of ['dark', 'light'] as const) {
    test(`the pane fits ${size.width}x${size.height} in ${scheme}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: scheme });
      const { daily } = await setUp(page);
      daily.entries = dailyEntries(45);
      daily.rounds = [4800, 3950, 2500];
      daily.streak = { current: 5, best: 9, atRisk: false };
      daily.records = { played: 12, best: 14_200, average: 9860 };
      daily.history = Array.from({ length: 13 }, (_, i) => ({ date: `2026-${i < 3 ? '09' : '10'}-${String(i < 3 ? 28 + i : i - 2).padStart(2, '0')}`, score: i % 2 ? 15_000 : null }));
      await page.goto('/#daily');
      await expect(rows(page)).toHaveCount(20);

      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      // every day's cell holds its score, and every bar stays inside the chart
      const spilling = await page
        .locator('.daily-day, .daily-bar, .pager .button, .daily-you .button')
        .evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent));
      expect(spilling).toEqual([]);
      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(background).toBe(scheme === 'dark' ? 'rgb(14, 14, 13)' : 'rgb(247, 245, 239)');
    });
  }
}

for (const code of ['de', 'ru']) {
  test.describe(`in ${code}`, () => {
    const say = CATALOGS[code]!;
    const NAMES = ['neel', 'sam', 'ana', ...dailyEntries(45).map((entry) => entry.username)];
    /** the day and the settings line are written for the language by the browser and from parts, not taken whole from a catalog */
    const written = async (page: Page) => [...(await page.locator('.daily-facts .figure-value, .daily-facts .settings-line').allTextContents()), ...(await page.locator('.flag-code').allTextContents())];

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
    });

    test('the pane before playing, with a streak at risk, is in the language', async ({ page }) => {
      const { daily } = await setUp(page);
      daily.streak = { current: 4, best: 9, atRisk: true };
      daily.records = { played: 11, best: 14_200, average: 9860 };
      daily.history = [{ date: '2026-10-09', score: null }, { date: '2026-10-10', score: 9000 }];
      await page.goto('/#daily');
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(page.getByRole('button', { name: say['daily.play'], exact: true })).toBeVisible();
      await expect(page.getByText(say['daily.streak.atRisk'])).toBeVisible();
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);

      // the sidebar with its mark
      await page.locator('.menu-toggle').click();
      await expect(mark(page)).toHaveAttribute('aria-label', say['daily.nav.atRisk']);
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
    });

    test('the pane after playing, with the pages of the leaderboard, is in the language', async ({ page }) => {
      const { daily } = await setUp(page, 'neel', 'IN');
      daily.entries = dailyEntries(45);
      daily.country = 'IN';
      daily.rounds = [1000, 500, 250];
      daily.streak = { current: 5, best: 9, atRisk: false };
      daily.records = { played: 12, best: 14_200, average: 9860 };
      daily.history = Array.from({ length: 13 }, (_, i) => ({ date: `2026-${i < 3 ? '09' : '10'}-${String(i < 3 ? 28 + i : i - 2).padStart(2, '0')}`, score: i % 2 ? 15_000 : null }));
      await page.goto('/#daily');
      await expect(page.getByText(say['daily.againNote'])).toBeVisible();
      await expect(rows(page)).toHaveCount(20);
      await expect(ownRow(page)).toHaveCount(1);
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);

      await page.getByRole('button', { name: say['daily.nextPage'], exact: true }).click();
      await expect(page.locator('.pager-page')).toHaveText(say['daily.page'].replace('{page}', '2'));
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
    });

    test('an attempt that was begun and left, and a claim that failed, are in the language', async ({ page }) => {
      const { daily } = await setUp(page);
      daily.started = true;
      daily.claimable = false;
      daily.streak = { current: 4, best: 9, atRisk: true };
      daily.records = { played: 11, best: 14_200, average: 9860 };
      await keep(page, [keptResult('2026-10-10', [3000, 3000, 3000], daily.tokenFor('2026-10-10'))]);
      await page.goto('/#daily');
      await expect(page.getByText(say['daily.started'])).toBeVisible();
      await expect(page.getByText(say['daily.claimFailed'])).toBeVisible();
      await expect(page.getByText(say['daily.streak.spent'])).toBeVisible();
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
    });

    test("a visitor's pane says that playing needs an account, in the language", async ({ page }) => {
      await setUp(page, null);
      // a result this browser kept from before playing took an account is for the account to claim: the pane does not open on it
      await keep(page, [keptResult(TODAY, [4800, 3950, 2500])]);
      await page.goto('/#daily');
      await expect(page.locator('.pane-section .notice')).toContainText(say['pane.needsAccount'].replace('{what}', say['play.what']));
      await expect(page.getByRole('button', { name: say['daily.play'], exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: say['summary.shareResult'], exact: true })).toHaveCount(0);
      await expectTranslated(page, code);
    });

    test("the daily's leave warning and its summary are in the language", async ({ page }) => {
      await setUp(page);
      await page.goto('/#daily');
      await page.getByRole('button', { name: say['daily.play'], exact: true }).click();
      await roundReady(page);
      await page.getByRole('button', { name: say['round.exit'], exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(say['daily.leaveConfirm']);
      expect(await dialog.evaluate((node) => node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().right > innerWidth)).toBe(false);
      await dialog.getByRole('button', { name: say['play.keepPlaying'], exact: true }).click();
      // the rest is played on a wide screen, where the map is open beside the view
      await page.setViewportSize({ width: 1360, height: 840 });

      for (let round = 1; round <= 3; round++) {
        await roundReady(page);
        await placePin(page, { x: 150, y: 150 });
        await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
        await expect(play(page)).toHaveAttribute('data-phase', 'result');
        await page.locator('[data-action="next"]').click();
      }
      await expect(page.locator('.summary-panel')).toContainText(say['daily.summary.share']);
      await expect(page.locator('.summary-panel .save-note')).not.toBeEmpty();
      await expect(page.locator('.summary-panel').getByRole('button', { name: say['play.again'], exact: true })).toHaveCount(0);
    });
  });
}
