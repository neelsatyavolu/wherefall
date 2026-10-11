import { expect, test, type Page } from '@playwright/test';
import { RUSSIA_ONLY, mockPlaces, mockServices } from './fixtures.ts';
import { GamesServer } from './games-server.ts';
import { roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { signIn } from './match-server.ts';
import { PHONE, stored, useLanguage } from './round-boxes.ts';

// Wave 6, item 3: the country streak that singleplayer games on the world map keep in the
// background. Counted round by round, said on the round's result, carried from game to game in the
// browser, and sent to the account as a streak ends and as a game finishes with one grown.

const STREAK_KEY = 'plonk.world-streak';
/** on the open map of a 1280x720 window */
const SIBERIA = { x: 556, y: 94 };
const BRAZIL = { x: 254, y: 278 };
const WORLD_GAME = (rounds: number, map = 'world') => `/?map=${map}&seed=e2e00001&t=0&mode=move&n=${rounds}`;
const result = (page: Page) => page.getByRole('region', { name: 'Round result' });
const streakLine = (page: Page) => result(page).locator('.streak-line');
/** the finishes of streak runs the page sent, in order */
const finishes = (games: GamesServer) => games.saved.filter((body) => (body as { kind?: string }).kind === 'streak') as Array<{ run: string; rounds: Array<{ id: string; answer: string | null }>; inPlay?: boolean }>;
const kept = async (page: Page) => JSON.parse((await stored(page, STREAK_KEY)) ?? 'null') as { rounds: Array<{ id: string; answer: string | null }>; begun: { run: string; at: number } | null } | null;
/** a streak of four that a visitor left in this browser: no run was begun for it */
const FOUR = JSON.stringify({ rounds: ['ru-00', 'ru-01', 'ru-02', 'ru-03'].map((id) => ({ id, answer: 'RU' })), begun: null });

/** Puts that streak in the browser before the page loads. */
const leaveFour = (page: Page) => page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [STREAK_KEY, FOUR]);

async function guessAt(page: Page, at: { x: number; y: number }): Promise<void> {
  await roundReady(page);
  await page.locator('.map-panel').hover();
  await page.waitForTimeout(500);
  await page.locator('.map-panel .maplibregl-canvas').click({ position: at });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(result(page)).toBeVisible();
}

async function startWorldGame(page: Page, rounds: number, username: string | null = 'neel'): Promise<GamesServer> {
  await mockServices(page);
  await mockPlaces(page, RUSSIA_ONLY);
  await signIn(page, username);
  const games = await GamesServer.install(page);
  games.session = username === null ? 'none' : 'account';
  await page.goto(WORLD_GAME(rounds));
  await page.getByRole('button', { name: 'Play challenge' }).click();
  return games;
}

test('a world game counts a country streak round by round, says so on the result, and says when one of two or more is lost', async ({ page }) => {
  const games = await startWorldGame(page, 5);
  await guessAt(page, SIBERIA);
  await expect(streakLine(page)).toHaveText('Country streak: 1');
  // the streak's first round played: a run is begun for it on the server, and kept with it
  await expect.poll(() => games.starts).toEqual([{ action: 'start', kind: 'streak' }]);
  await expect.poll(async () => (await kept(page))?.begun?.run).toBe('run.1.streak');
  await page.getByRole('button', { name: 'Next round' }).click();
  await guessAt(page, SIBERIA);
  await expect(streakLine(page)).toHaveText('Country streak: 2');
  expect((await kept(page))?.rounds.map((round) => round.answer)).toEqual(['RU', 'RU']);
  expect(finishes(games)).toEqual([]);
  await page.getByRole('button', { name: 'Next round' }).click();

  // the wrong country: the streak is over, the result says how long it was, and its run is finished with every round, the losing one last
  await guessAt(page, BRAZIL);
  await expect(streakLine(page)).toHaveText('Your country streak ended at 2.');
  await expect.poll(() => finishes(games)).toHaveLength(1);
  const [first] = finishes(games);
  expect(first).toEqual({ kind: 'streak', run: 'run.1.streak', inPlay: true, rounds: [expect.objectContaining({ answer: 'RU' }), expect.objectContaining({ answer: 'RU' }), expect.objectContaining({ answer: 'BR' })] });
  expect(first!.rounds.every((round) => /^ru-\d\d$/.test(round.id))).toBe(true);
  expect(new Set(first!.rounds.map((round) => round.id)).size).toBe(3);
  expect(await kept(page)).toEqual({ rounds: [], begun: null });
  await page.getByRole('button', { name: 'Next round' }).click();

  // one right and then lost: a streak of one is not worth a line when it goes, and is a run of its own all the same
  await guessAt(page, SIBERIA);
  await expect(streakLine(page)).toHaveText('Country streak: 1');
  await page.getByRole('button', { name: 'Next round' }).click();
  await guessAt(page, BRAZIL);
  await expect(streakLine(page)).toBeHidden();
  await expect.poll(() => finishes(games).map((finish) => [finish.run, finish.rounds.length])).toEqual([
    ['run.1.streak', 3],
    ['run.2.streak', 2],
  ]);
  await page.getByRole('button', { name: 'See summary' }).click();
  await expect(page.getByRole('region', { name: 'Game summary' })).toContainText("Saved to neel's stats.");
  // the game itself is saved as it always was, once
  expect(games.saved.filter((body) => !('kind' in (body as object)))).toHaveLength(1);
  expect(games.starts).toHaveLength(2);
});

test('the streak runs on from one world game to the next on the run it began with, and is finished when it ends', async ({ page }) => {
  const games = await startWorldGame(page, 3);
  for (const last of [false, false, true]) {
    await guessAt(page, SIBERIA);
    await page.getByRole('button', { name: last ? 'See summary' : 'Next round' }).click();
  }
  await expect(page.getByRole('region', { name: 'Game summary' })).toBeVisible();
  // a game's end is not a streak's end: nothing is finished, and the streak waits in the browser with its run
  await expect.poll(async () => (await kept(page))?.rounds.length).toBe(3);
  expect((await kept(page))?.begun?.run).toBe('run.1.streak');
  expect(finishes(games)).toEqual([]);

  // another game, by the challenge's own link: still a world game, so the streak goes on from three
  await page.goto(WORLD_GAME(3));
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await guessAt(page, SIBERIA);
  await expect(streakLine(page)).toHaveText('Country streak: 4');
  await page.getByRole('button', { name: 'Next round' }).click();
  await guessAt(page, SIBERIA);
  await page.getByRole('button', { name: 'Next round' }).click();
  await guessAt(page, SIBERIA);
  await expect(streakLine(page)).toHaveText('Country streak: 6');
  await page.getByRole('button', { name: 'See summary' }).click();
  await expect(page.getByRole('region', { name: 'Game summary' })).toBeVisible();
  expect(finishes(games)).toEqual([]);

  // a third game ends it: one run for the whole streak, begun once, finished with its six rounds and the one that lost it
  await page.goto(WORLD_GAME(3));
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await guessAt(page, BRAZIL);
  await expect(streakLine(page)).toHaveText('Your country streak ended at 6.');
  await expect.poll(() => finishes(games).map((finish) => [finish.run, finish.inPlay, finish.rounds.map((round) => round.answer).join(' ')])).toEqual([['run.1.streak', true, 'RU RU RU RU RU RU BR']]);
  expect(games.starts).toHaveLength(1);
  expect(await kept(page)).toEqual({ rounds: [], begun: null });
});

test('a visitor’s streak is counted in the browser and sent nowhere', async ({ page }) => {
  const games = await startWorldGame(page, 3, null);
  await guessAt(page, SIBERIA);
  await expect(streakLine(page)).toHaveText('Country streak: 1');
  await page.getByRole('button', { name: 'Next round' }).click();
  await guessAt(page, SIBERIA);
  await page.getByRole('button', { name: 'Next round' }).click();
  await guessAt(page, BRAZIL);
  await expect(streakLine(page)).toHaveText('Your country streak ended at 2.');
  await page.getByRole('button', { name: 'See summary' }).click();
  await expect(page.getByRole('region', { name: 'Game summary' })).toBeVisible();
  expect(games.starts).toEqual([]);
  expect(finishes(games)).toEqual([]);
});

test('a streak lost sooner than the server allows a run to be is sent again once the time has passed', async ({ page }) => {
  const games = await startWorldGame(page, 3);
  games.bestStreak = 0;
  // the real rule is two seconds a round sent; the two rounds here are played in less than three
  games.roundMs = 1500;
  await guessAt(page, SIBERIA);
  await expect.poll(() => games.starts).toHaveLength(1);
  await page.getByRole('button', { name: 'Next round' }).click();
  await guessAt(page, BRAZIL);
  // refused the first time, taken the second: the account's best is the streak
  await expect.poll(() => finishes(games).length, { timeout: 10_000 }).toBe(2);
  await expect.poll(() => games.bestStreak).toBe(1);
});

test('a finish that does not get through is kept, and sent again as the next world game begins', async ({ page }) => {
  const unsent = async () => JSON.parse((await stored(page, 'plonk.world-streak.unsent')) ?? '[]') as Array<{ begun: { run: string }; rounds: unknown[] }>;
  const games = await startWorldGame(page, 3);
  games.bestStreak = 0;
  await guessAt(page, SIBERIA);
  await expect.poll(() => games.starts).toHaveLength(1);
  await page.getByRole('button', { name: 'Next round' }).click();

  // the server is too busy to take anything as the streak ends
  games.refuse = 'Too many games saved in the last hour. Try again later.';
  games.refuseStatus = 429;
  await guessAt(page, BRAZIL);
  await expect.poll(() => finishes(games)).toHaveLength(1);
  // the account's best has not heard of it, and the finish is kept in this browser
  expect(games.bestStreak).toBe(0);
  await expect.poll(async () => (await unsent()).map((each) => [each.begun.run, each.rounds.length])).toEqual([['run.1.streak', 2]]);

  // the next world game: the same run and rounds go again, the account's best learns of the streak, and nothing is left to send
  games.refuse = null;
  await page.goto(WORLD_GAME(3));
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await expect.poll(() => finishes(games)).toHaveLength(2);
  expect(finishes(games)[1]).toEqual(finishes(games)[0]);
  expect(finishes(games)[1]).toMatchObject({ run: 'run.1.streak', inPlay: true });
  await expect.poll(() => games.bestStreak).toBe(1);
  await expect.poll(unsent).toEqual([]);

  // a run counts once, and it is not sent a third time
  await page.reload();
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await page.waitForTimeout(300);
  expect(finishes(games)).toHaveLength(2);
});

test('a round with no guess is a miss', async ({ page }) => {
  await leaveFour(page);
  await mockServices(page);
  await mockPlaces(page, RUSSIA_ONLY);
  await page.goto('/?map=world&seed=e2e00001&t=10&mode=move&n=3');
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await expect(result(page)).toBeVisible({ timeout: 15_000 });
  await expect(result(page)).toContainText('Time ran out before you placed a pin.');
  await expect(streakLine(page)).toHaveText('Your country streak ended at 4.');
});

for (const [name, url] of [
  ['a country’s own map', WORLD_GAME(3, 'country:RU')],
  ['a region’s map', WORLD_GAME(3, 'europe')],
] as const) {
  test(`${name} counts no streak and leaves the one there is alone`, async ({ page }) => {
    await leaveFour(page);
    await mockServices(page);
    await mockPlaces(page);
    await page.goto(url);
    await page.getByRole('button', { name: 'Play challenge' }).click();
    await guessAt(page, { x: 150, y: 150 });
    await expect(page.locator('.streak-line')).toHaveCount(0);
    expect(await stored(page, STREAK_KEY)).toBe(FOUR);
  });
}

test('the tutorial counts no streak', async ({ page }) => {
  await leaveFour(page);
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('region', { name: 'How to play' }).getByRole('button', { name: 'Play the tutorial' }).click();
  await guessAt(page, { x: 150, y: 150 });
  await expect(page.locator('.streak-line')).toHaveCount(0);
  expect(await stored(page, STREAK_KEY)).toBe(FOUR);
});

for (const code of ['de', 'ru'] as const) {
  test(`the streak's line on a phone's result is in ${code}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await leaveFour(page);
    const say = CATALOGS[code]!;
    await useLanguage(page, code);
    await mockServices(page);
    await mockPlaces(page, RUSSIA_ONLY);
    await page.goto(WORLD_GAME(3));
    await page.getByRole('button', { name: say['singleplayer.playChallenge'] }).click();
    for (const [at, words] of [
      [{ x: 330, y: 150 }, say['result.streak']!.replace('{count}', '5')],
      [{ x: 100, y: 330 }, say['result.streakEnded']!.replace('{count}', '5')],
    ] as const) {
      await roundReady(page);
      await page.getByRole('button', { name: say['round.openMap'] }).click();
      await page.locator('.map-panel .maplibregl-canvas').click({ position: at });
      await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
      await expect(page.locator('.streak-line')).toHaveText(words);
      await expectTranslated(page, code);
      await page.getByRole('button', { name: say['result.next'] }).click();
    }
  });
}
