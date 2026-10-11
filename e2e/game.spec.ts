import { expect, test, type Page } from '@playwright/test';
import { mockServices } from './fixtures.ts';
import { accountReply } from './match-server.ts';

const CHALLENGE = '/?map=world&seed=e2e00001&t=0&mode=move&n=5';

const play = (page: Page) => page.locator('.play');
const roundReady = async (page: Page) => {
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
  await expect(page.locator('.status')).toBeEmpty();
};

async function guess(page: Page, at: { x: number; y: number }) {
  await page.locator('.map-panel').hover();
  await page.locator('.map-panel .maplibregl-canvas').click({ position: at });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(play(page)).toHaveAttribute('data-phase', 'result');
}

test('a new game starts from the home screen with the chosen options', async ({ page }) => {
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('radio', { name: 'Europe' }).check();
  await page.getByRole('slider', { name: 'Time per round' }).fill('60');
  await expect(page.locator('.time-value')).toHaveText('1 min');
  await page.getByRole('radio', { name: '3', exact: true }).check();
  await page.getByRole('button', { name: 'Start game' }).click();

  await roundReady(page);
  await expect(page).toHaveURL(/map=europe&seed=[a-z0-9]{8}&t=60&mode=move&n=3/);
  await expect(page.locator('.hud')).toContainText('1 / 3');
  await expect(page.locator('.hud')).toContainText('Europe');
  await expect(page.locator('.hud')).toContainText(/0:5\d|1:00/);
});

test('a challenge link plays five rounds through to the summary', async ({ page }) => {
  await mockServices(page);
  await page.goto(CHALLENGE);
  await expect(page.getByText('You were sent a challenge')).toBeVisible();
  await page.getByRole('button', { name: 'Play challenge' }).click();

  const points: number[] = [];
  for (let round = 1; round <= 5; round++) {
    await roundReady(page);
    await expect(page.locator('.hud')).toContainText(`${round} / 5`);
    await expect(page.getByRole('button', { name: 'Place your pin' })).toBeDisabled();

    await guess(page, { x: 120 + round * 40, y: 150 });
    const result = page.getByRole('region', { name: 'Round result' });
    await expect(result).toContainText(/\d (km|m)/);
    const shownPoints = await result.locator('.figure').nth(1).locator('.figure-value').textContent();
    points.push(Number(shownPoints?.split('/')[0]?.replace(/\D/g, '')));

    await page.getByRole('button', { name: round === 5 ? 'See summary' : 'Next round' }).click();
  }

  const summary = page.getByRole('region', { name: 'Game summary' });
  await expect(summary.locator('tbody tr')).toHaveCount(5);
  const total = points.reduce((sum, p) => sum + p, 0);
  await expect(summary.locator('.figure-value').first()).toContainText(total.toLocaleString('en-US'));
  await expect(page.locator('.pin-actual')).toHaveCount(5);

  await summary.getByRole('button', { name: 'Play again' }).click();
  await roundReady(page);
  await expect(page).not.toHaveURL(/seed=e2e00001/);
});

test('the same challenge link gives the same places', async ({ page, browser }) => {
  const first = await mockServices(page);
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);

  const other = await browser.newPage();
  const second = await mockServices(other);
  await other.goto(CHALLENGE);
  await other.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(other);

  expect(first[0]).toBeTruthy();
  expect(second[0]).toBe(first[0]);
  await other.close();
});

test('the player can walk along the street and return to the start', async ({ page }) => {
  const shown = await mockServices(page);
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  const start = shown[0]!;
  await expect(page.getByRole('button', { name: 'Return to start' })).toBeDisabled();
  // arrows appear once a view has loaded; that is the cue that the player can move again
  const arrows = page.locator('.move-arrow');
  await expect(arrows).toHaveCount(2);

  await page.keyboard.press('ArrowUp');
  await expect.poll(() => shown.at(-1)).toBe(`${start}~n`);
  await expect(arrows).toHaveCount(2);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => shown.at(-1)).toBe(`${start}~n~n`);
  await expect(arrows).toHaveCount(2);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => shown.at(-1)).toBe(`${start}~n~n~p`);
  await expect(arrows).toHaveCount(2);

  await page.locator('.move-arrow.psv-marker--visible').first().click();
  await expect.poll(() => shown.length).toBe(5);
  await expect(arrows).toHaveCount(2);

  // back at the start the button has nothing left to do, so it switches off
  const returnButton = page.getByRole('button', { name: 'Return to start' });
  await expect(returnButton).toBeEnabled();
  await returnButton.click();
  await expect(returnButton).toBeDisabled();
  await expect(arrows).toHaveCount(2);
});

test('no-move mode shows no arrows', async ({ page }) => {
  await mockServices(page);
  await page.goto('/?map=world&seed=e2e00001&t=0&mode=no-move&n=5');
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await expect(page.locator('.move-arrow')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Return to start' })).toBeHidden();
});

test('a round ends with no points when the timer runs out', async ({ page }) => {
  await page.clock.install();
  await mockServices(page);
  await page.goto('/?map=world&seed=e2e00001&t=30&mode=move&n=5');
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);

  await page.clock.runFor(31_000);

  await expect(play(page)).toHaveAttribute('data-phase', 'result');
  const result = page.getByRole('region', { name: 'Round result' });
  await expect(result).toContainText('No guess');
  await expect(result).toContainText('Time ran out before you placed a pin.');
  await expect(result.locator('.figure').nth(1)).toContainText(/^Points0/);
});

test('a failed load offers a retry instead of a dead screen', async ({ page }) => {
  await mockServices(page);
  await page.route('https://api.panoramax.xyz/api/search**', (route) => route.fulfill({ status: 503, body: 'down' }));
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();

  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await page.unroute('https://api.panoramax.xyz/api/search**');
  await mockServices(page);
  await page.getByRole('button', { name: 'Try again' }).click();
  await roundReady(page);
});

test('on a phone the map opens from a button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockServices(page);
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);

  await expect(page.locator('.map-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Open map' }).click();
  await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 200 } });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Round result' })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('space submits the guess and does not skip past the result', async ({ page }) => {
  await mockServices(page);
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);

  await page.locator('.map-panel').hover();
  await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 150 } });
  await page.keyboard.press('Space');
  await expect(play(page)).toHaveAttribute('data-phase', 'result');
  // give a stray second activation time to happen, then confirm we are still on the result
  await page.waitForTimeout(300);
  await expect(page.getByRole('region', { name: 'Round result' })).toBeVisible();
  await expect(page.locator('.hud')).toContainText('1 / 5');

  await page.keyboard.press('Space');
  await roundReady(page);
  await expect(page.locator('.hud')).toContainText('2 / 5');
});

test('retrying a view that failed mid-game keeps the score and the round', async ({ page }) => {
  await mockServices(page);
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await guess(page, { x: 160, y: 150 });

  // the second round's image fails once, then recovers
  let failures = 1;
  await page.route('https://img.plonk.test/**/sd.jpg', async (route) => {
    if (failures-- > 0) {
      await route.abort();
    } else {
      await route.fallback();
    }
  });
  await page.getByRole('button', { name: 'Next round' }).click();
  await expect(page.getByRole('alert')).toContainText('This view would not load');
  await page.getByRole('button', { name: 'Try again' }).click();

  await roundReady(page);
  await expect(page.locator('.hud')).toContainText('2 / 5');
  await expect(page.locator('.hud .hud-cell').nth(2)).not.toHaveText('Score0');
});

test('no move, pan or zoom locks the view completely', async ({ page }) => {
  await mockServices(page);
  await page.goto('/?map=world&seed=e2e00001&t=0&mode=nmpz&n=3');
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);

  await expect(page.locator('.move-arrow')).toHaveCount(0);
  await expect(page.locator('.pano')).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.hud')).toContainText('1 / 3');
});

test('a three-round game ends after three rounds', async ({ page }) => {
  await mockServices(page);
  await page.goto('/?map=world&seed=e2e00001&t=0&mode=move&n=3');
  await page.getByRole('button', { name: 'Play challenge' }).click();
  for (let round = 1; round <= 3; round++) {
    await roundReady(page);
    await guess(page, { x: 150, y: 150 });
    await page.getByRole('button', { name: round === 3 ? 'See summary' : 'Next round' }).click();
  }
  const summary = page.getByRole('region', { name: 'Game summary' });
  await expect(summary.locator('tbody tr')).toHaveCount(3);
  await expect(summary).toContainText('/ 15,000');
});

async function finishThreeRounds(page: Page) {
  await page.goto('/?map=world&seed=e2e00001&t=0&mode=no-move&n=3');
  await page.getByRole('button', { name: 'Play challenge' }).click();
  for (let round = 1; round <= 3; round++) {
    await roundReady(page);
    await guess(page, { x: 150, y: 150 });
    await page.getByRole('button', { name: round === 3 ? 'See summary' : 'Next round' }).click();
  }
}

test('a signed-in player has the finished game saved to their stats', async ({ page }) => {
  await mockServices(page);
  await page.route('**/api/account', (route) => route.fulfill({ json: accountReply('neel') }));
  const saved: unknown[] = [];
  await page.route('**/api/games', async (route) => {
    saved.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      json: { success: true, data: { playedAt: '2026-10-10T00:00:00.000Z', map: 'world', mode: 'no-move', rounds: 3, score: 100, maxScore: 15000, xpEarned: 2, xpCapped: false } },
    });
  });

  await finishThreeRounds(page);

  await expect(page.getByRole('region', { name: 'Game summary' })).toContainText("Saved to neel's stats.");
  // a world game may also tell the account of the country streak it keeps in the background, as a run of its own (a save with a `kind`): the game is saved once
  const games = saved.filter((body) => !('kind' in (body as object)));
  expect(games).toHaveLength(1);
  expect(games[0]).toMatchObject({ map: 'world', mode: 'no-move', timeLimit: 0, seed: 'e2e00001' });
  const rounds = (games[0] as { rounds: Array<{ id: string; country: string; score: number; distanceKm: number }> }).rounds;
  expect(rounds).toHaveLength(3);
  // each round says which place it was: the server takes a game only on places it knows
  expect(rounds.every((round) => typeof round.id === 'string' && round.id.length > 0)).toBe(true);
  expect(rounds[0]!.country).toMatch(/^[A-Z]{2}$/);
  expect(rounds[0]!.score).toBeGreaterThanOrEqual(0);
});

test('a visitor is told how to keep stats and nothing is saved', async ({ page }) => {
  await mockServices(page);
  await page.route('**/api/account', (route) => route.fulfill({ json: accountReply(null) }));
  let saves = 0;
  await page.route('**/api/games', (route) => {
    saves++;
    return route.fulfill({ status: 401, json: { success: false, error: 'Sign in first.' } });
  });

  await finishThreeRounds(page);

  await expect(page.getByRole('region', { name: 'Game summary' })).toContainText('Sign in from the home screen to keep your stats.');
  expect(saves).toBe(0);
});

test('the account screen opens from home and goes back', async ({ page }) => {
  await mockServices(page);
  await page.route('**/api/account', (route) => route.fulfill({ json: accountReply(null) }));
  await page.goto('/');
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  // the account is a pane of the home screen now: the browser's own Back leaves it
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByLabel('Username')).toBeHidden();
});
