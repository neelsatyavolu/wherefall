import { expect, test, type Page } from '@playwright/test';
import { DailyServer } from './daily-server.ts';
import { mockServices } from './fixtures.ts';
import { GamesServer } from './games-server.ts';
import { playLocalGame, roundReady } from './helpers.ts';
import { signIn } from './match-server.ts';

/** The daily and the games it is saved to, seen by "neel". */
async function setUp(page: Page) {
  await mockServices(page);
  await signIn(page, 'neel');
  const daily = await DailyServer.install(page);
  const games = await GamesServer.install(page, daily);
  return { daily, games };
}

const leaderboard = (page: Page) => page.getByRole('region', { name: 'Leaderboard' });
const playButton = (page: Page) => page.getByRole('button', { name: "Play today's challenge" });
const ONE_ATTEMPT = 'One attempt a day. The next challenge opens at midnight UTC.';

test('the daily pane shows the day, the fixed settings and the leaderboard', async ({ page }) => {
  await setUp(page);
  await page.goto('/#daily');

  await expect(page.locator('.pane-title')).toHaveText('Daily challenge');
  await expect(page.getByText('Three places, the same for everyone, new every day at midnight UTC.')).toBeVisible();
  await expect(page.getByText('October 11, 2026')).toBeVisible();
  // three rounds of three minutes, moving, on the world
  await expect(page.getByText('World · 3 rounds · 3 min · move')).toBeVisible();
  // sam has a country, so a flag comes before the name
  await expect(leaderboard(page).locator('tbody tr').nth(0).locator('td')).toHaveText(['1', /sam$/, '13,000']);
  await expect(leaderboard(page).locator('tbody tr').nth(0).getByRole('img', { name: 'United Kingdom' })).toBeVisible();
  await expect(leaderboard(page).locator('tbody tr').nth(1).locator('td')).toHaveText(['2', 'ana', '9,250']);
  await expect(page.getByText('You have not played today. You get one attempt.')).toBeVisible();
  await expect(playButton(page)).toBeVisible();
  await expect(page.getByText(ONE_ATTEMPT)).toHaveCount(0);
});

test('a player who has played sees their own result out of 15,000 and cannot play again', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.rounds = [4800, 3950, 2500];
  await page.goto('/#daily');

  await expect(page.locator('.figure').filter({ hasText: 'Your result today' })).toContainText('11,250 / 15,000');
  // the rank is the server's: second, between sam and ana
  await expect(leaderboard(page).locator('tbody tr.own td')).toHaveText(['2', 'neelyou', '11,250']);
  await expect(leaderboard(page).locator('tbody tr')).toHaveCount(3);
  // one attempt a day: the daily is not offered a second time
  await expect(playButton(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play it again' })).toHaveCount(0);
  await expect(page.getByText(ONE_ATTEMPT)).toBeVisible();
});

test('an attempt that was begun is not offered again from a fresh page', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.started = true;
  await page.goto('/#daily');

  await expect(page.getByText('October 11, 2026')).toBeVisible();
  await expect(playButton(page)).toHaveCount(0);
  await expect(page.getByText(ONE_ATTEMPT)).toBeVisible();
});

test('an empty leaderboard and a failed load both say so', async ({ page }) => {
  const { daily } = await setUp(page);
  daily.entries = [];
  let fail = true;
  await page.route('**/api/daily**', (route) => (fail ? route.fulfill({ status: 503, json: { success: false, error: 'Try again shortly.' } }) : route.fallback()));
  await page.goto('/#daily');
  await expect(page.getByRole('alert')).toContainText('Try again shortly.');

  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('No results yet today.')).toBeVisible();
});

test("a signed-in player's daily game is three rounds of a minute, saved with the day", async ({ page }) => {
  const { daily, games } = await setUp(page);
  await page.goto('/#daily');
  await playButton(page).click();

  await roundReady(page);
  await expect(page.locator('.hud')).toContainText('1 / 3');
  await expect(page.locator('.hud')).toContainText('World');
  await expect(page.locator('.hud')).toContainText(/3:00|2:5\d/);
  // moving is allowed
  await expect(page.getByRole('button', { name: 'Return to start' })).toBeVisible();
  await playLocalGame(page, 3);

  const summary = page.getByRole('region', { name: 'Game summary' });
  await expect(summary).toContainText("On today's leaderboard as neel.");
  expect(games.saved).toHaveLength(1);
  expect(games.saved[0]).toMatchObject({ daily: '2026-10-11', seed: 'daily20261011', map: 'world', mode: 'move', timeLimit: 180 });
  expect(games.saved[0]!.rounds).toHaveLength(3);
  expect(daily.rounds).toHaveLength(3);

  // home is the daily pane again, now with the result on it and no second go
  await summary.getByRole('button', { name: 'Home' }).click();
  await expect(page).toHaveURL(/#daily$/);
  await expect(page.locator('.figure').filter({ hasText: 'Your result today' })).toContainText('/ 15,000');
  await expect(leaderboard(page).locator('tbody tr.own')).toContainText('neel');
  await expect(playButton(page)).toHaveCount(0);
  await expect(page.getByText(ONE_ATTEMPT)).toBeVisible();
});

test('a result that was already in when the game ends is the one that stays', async ({ page }) => {
  const { daily, games } = await setUp(page);
  await page.goto('/#daily');
  await playButton(page).click();
  await roundReady(page);
  // the same account finishes the daily somewhere else first: the day's one result is that one
  daily.rounds = [5000, 5000, 4999];
  await playLocalGame(page, 3);

  await expect(page.getByRole('region', { name: 'Game summary' })).toContainText("Your first result today stays on the leaderboard as neel's.");
  expect(games.saved).toHaveLength(1);
  expect(daily.rounds).toEqual([5000, 5000, 4999]);
});
