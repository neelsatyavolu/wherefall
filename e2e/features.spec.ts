import { expect, test, type Page } from '@playwright/test';
import { DailyServer } from './daily-server.ts';
import { PLACES_FIXTURE, RUSSIA_ONLY, mockPlaces, mockServices } from './fixtures.ts';
import { GamesServer } from './games-server.ts';
import { placePin, play, roundReady } from './helpers.ts';
import { signIn } from './match-server.ts';

const CHALLENGE = '/?map=world&seed=e2e00001&t=0&mode=move&n=3';

/** Spots on the guess map at its medium size, in a 1280 x 720 window, that are well inside a country (or the sea). */
const SIBERIA = { x: 556, y: 94 };
const BRAZIL = { x: 254, y: 278 };
const ATLANTIC = { x: 279, y: 193 };

async function startChallenge(page: Page, url = CHALLENGE): Promise<void> {
  await page.goto(url);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
}

/** Opens the guess map and waits for it to finish growing, so a click lands where it is aimed. */
async function openMap(page: Page): Promise<void> {
  await page.locator('.map-panel').hover();
  await page.waitForTimeout(500);
}

test('the hint draws a circle, halves the round, and is saved with the game', async ({ page }) => {
  await mockServices(page);
  // a list this test knows, so it can say where each saved place is by its list
  await mockPlaces(page);
  await signIn(page, 'neel');
  const saved: Array<{ rounds: Array<Record<string, unknown>> }> = [];
  await page.route('**/api/games', async (route) => {
    const body = route.request().postDataJSON() as { kind?: string; rounds: Array<Record<string, unknown>> };
    // the game itself: the country streak a world game keeps in the background posts runs of its own, each with a `kind`
    if (body.kind === undefined) {
      saved.push(body);
    }
    await route.fulfill({
      status: 201,
      json: { success: true, data: { playedAt: '2026-10-11T09:00:00.000Z', map: 'world', mode: 'move', rounds: 3, score: 100, maxScore: 15_000, xpEarned: 2, xpCapped: false } },
    });
  });
  await startChallenge(page);

  const hint = page.getByRole('button', { name: 'Hint (half points)' });
  await hint.click();
  await expect(page.getByRole('button', { name: 'Hint shown' })).toBeDisabled();
  await placePin(page, { x: 150, y: 150 });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();

  const result = page.getByRole('region', { name: 'Round result' });
  await expect(result).toContainText('You used the hint, so this round scored half.');
  const points = Number((await result.locator('.figure').nth(1).locator('.figure-value').textContent())?.split('/')[0]?.replace(/\D/g, ''));
  expect(points).toBeLessThanOrEqual(2500);

  // the next round starts with the hint unused
  await page.getByRole('button', { name: 'Next round' }).click();
  await roundReady(page);
  await expect(hint).toBeEnabled();
  await placePin(page, { x: 150, y: 150 });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(result).not.toContainText('hint');
  await page.getByRole('button', { name: 'Next round' }).click();
  await roundReady(page);
  await placePin(page, { x: 150, y: 150 });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await page.getByRole('button', { name: 'See summary' }).click();

  const summary = page.getByRole('region', { name: 'Game summary' });
  await expect(summary).toContainText("Saved to neel's stats. +2 XP.");
  await expect(summary.locator('tbody tr').first()).toContainText('hint');
  expect(saved).toHaveLength(1);
  const [first, second] = saved[0]!.rounds;
  // each round names its place and is sent on the coordinates its list has, not on where the picture stands (2.345, 48.86 here)
  const listed = (id: unknown) => {
    const [, lng, lat] = PLACES_FIXTURE.locations.find(([each]) => each === id)!;
    return { id, lng, lat };
  };
  expect(first).toMatchObject({ ...listed(first!.id), hinted: true, guessLng: expect.any(Number), guessLat: expect.any(Number), score: points });
  expect(second).toMatchObject({ ...listed(second!.id), hinted: false });
  expect(first!.id).not.toBe(second!.id);
});

test('Exit asks before leaving a game that is under way', async ({ page }) => {
  await mockServices(page);
  await startChallenge(page);

  await page.getByRole('button', { name: 'Exit' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Leave this game? The rounds you have played will not be saved.');
  await dialog.getByRole('button', { name: 'Keep playing' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');

  await page.getByRole('button', { name: 'Exit' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(play(page)).toBeVisible();

  await page.getByRole('button', { name: 'Exit' }).click();
  await dialog.getByRole('button', { name: 'Leave game' }).click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page).not.toHaveURL(/seed=/);
});

for (const [name, width, height] of [
  ['a wide screen', 1280, 720],
  ['a phone', 390, 800],
] as const) {
  test(`Exit works while a round's result is showing, on ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockServices(page);
    await startChallenge(page);
    if (width < 720) {
      await page.getByRole('button', { name: 'Open map' }).click();
    }
    await placePin(page, { x: 150, y: 150 });
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
    await expect(play(page)).toHaveAttribute('data-phase', 'result');

    // a real click: it fails if the map, which fills the screen now, were lying over the button
    await page.getByRole('button', { name: 'Exit' }).click({ timeout: 3000 });
    await page.getByRole('dialog').getByRole('button', { name: 'Leave game' }).click();
    await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  });
}

test('every phase of a game has a way out', async ({ page }) => {
  await mockServices(page);
  await DailyServer.install(page);
  // the daily: guessing, then the result
  await page.goto('/#daily');
  await page.getByRole('button', { name: "Play today's challenge" }).click();
  await roundReady(page);
  await expect(page.getByRole('button', { name: 'Exit' })).toBeVisible();
  await placePin(page, { x: 150, y: 150 });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await page.getByRole('button', { name: 'Exit' }).click({ timeout: 3000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Leave game' }).click();
  await expect(page.locator('.pane-title')).toHaveText('Daily challenge');

  // a game through to its summary, which has Home
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  for (let round = 1; round <= 3; round++) {
    await roundReady(page);
    await placePin(page, { x: 150, y: 150 });
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
    await page.getByRole('button', { name: round === 3 ? 'See summary' : 'Next round' }).click();
  }
  await page.getByRole('region', { name: 'Game summary' }).getByRole('button', { name: 'Home' }).click({ timeout: 3000 });
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});

test('a finished round links to its place on Google Maps, and a round in play does not', async ({ page }) => {
  await mockServices(page);
  await startChallenge(page);
  await expect(page.getByRole('link', { name: 'Open in Google Maps' })).toHaveCount(0);
  await placePin(page, { x: 150, y: 150 });
  await expect(page.getByRole('link', { name: 'Open in Google Maps' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();

  const link = page.getByRole('region', { name: 'Round result' }).getByRole('link', { name: 'Open in Google Maps' });
  await expect(link).toHaveAttribute('href', 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=48.86%2C2.345');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener');
  await page.getByRole('button', { name: 'Next round' }).click();
  await roundReady(page);
  await expect(page.getByRole('link', { name: 'Open in Google Maps' })).toHaveCount(0);
});

test('on a phone the Google Maps link leaves the result panel room for its button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockServices(page);
  await startChallenge(page);
  await page.getByRole('button', { name: 'Open map' }).click();
  await placePin(page, { x: 150, y: 220 });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();

  const link = (await page.getByRole('link', { name: 'Open in Google Maps' }).boundingBox())!;
  const next = (await page.getByRole('button', { name: 'Next round' }).boundingBox())!;
  const panel = (await page.getByRole('region', { name: 'Round result' }).boundingBox())!;
  // the link sits above the button, not beside it, and both are inside the panel and the screen
  expect(link.y + link.height).toBeLessThanOrEqual(next.y);
  expect(next.height).toBeGreaterThanOrEqual(44);
  expect(next.width).toBeGreaterThan(280);
  expect(panel.y + panel.height).toBeLessThanOrEqual(800);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test('the maps on offer come from the list of places: its regions, and a country found by searching', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page);
  await page.goto('/');

  // the stand-in list has enough places in Europe and Africa only, and in two countries
  await expect(page.getByRole('group', { name: 'Map', exact: true }).getByRole('radio')).toHaveCount(4);
  await expect(page.getByRole('radio', { name: 'Africa' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Americas' })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Country' })).toBeHidden();

  await page.getByRole('radio', { name: 'A country' }).check();
  const countries = page.getByRole('radiogroup', { name: 'Countries' }).getByRole('radio');
  await expect(countries).toHaveCount(2);
  await expect(page.getByRole('radio', { name: /Kenya/ })).toBeChecked();
  await page.getByRole('searchbox', { name: 'Country' }).fill('rus');
  await expect(countries).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'Russia 45 places' })).toBeChecked();
  await page.getByRole('searchbox', { name: 'Country' }).fill('atlantis');
  await expect(page.getByText('No country by that name has enough places yet.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Country' }).fill('rus');

  await page.getByRole('radio', { name: '3', exact: true }).check();
  await page.getByRole('button', { name: 'Start game' }).click();
  await roundReady(page);
  await expect(page).toHaveURL(/map=country%3ARU&seed=[a-z0-9]{8}/);
  await expect(page.locator('.hud')).toContainText('Russia');
});

test('Africa is a map, and a country challenge link opens named', async ({ page }) => {
  const shown = await mockServices(page);
  await mockPlaces(page);
  await page.goto('/');
  await page.getByRole('radio', { name: 'Africa' }).check();
  await page.getByRole('button', { name: 'Start game' }).click();
  await roundReady(page);
  await expect(page).toHaveURL(/map=africa/);
  await expect(page.locator('.hud')).toContainText('Africa');
  expect(shown[0]).toMatch(/^ke-/);

  await page.goto('/?map=country:KE&seed=e2e00001&t=0&mode=move&n=3');
  await expect(page.getByText('Kenya · 3 rounds · No limit · move')).toBeVisible();
});

test('the guess map has zoom buttons, a crosshair pin and three sizes it remembers', async ({ page }) => {
  await mockServices(page);
  await startChallenge(page);
  const panel = page.locator('.map-panel');
  await openMap(page);
  const medium = (await panel.boundingBox())!;
  await expect(page.getByRole('button', { name: 'Medium map' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Large map' }).click();
  await expect(page.getByRole('button', { name: 'Large map' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(medium.width + 150);
  await page.getByRole('button', { name: 'Small map' }).click();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThan(medium.width - 150);
  await page.getByRole('button', { name: 'Large map' }).click();

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.waitForTimeout(400);
  await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 300, y: 300 } });
  await expect(page.locator('.aim')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Guess', exact: true })).toBeEnabled();

  // the size is kept for the next game
  await startChallenge(page);
  await expect(page.getByRole('button', { name: 'Large map' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toHaveAttribute('data-size', 'large');
});

test('a country streak counts right countries and ends on the first wrong one', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page, RUSSIA_ONLY);
  await signIn(page, 'neel');
  const games = await GamesServer.install(page);
  games.bestStreak = 9;

  await page.goto('/#streak');
  await expect(page.getByText('Your best streak: 7')).toBeVisible();
  await page.getByRole('radio', { name: 'No move', exact: true }).check();
  await page.getByRole('button', { name: 'Start streak' }).click();
  await roundReady(page);
  await expect(page).toHaveURL(/#streak$/);
  const streak = page.locator('.hud .hud-cell').filter({ hasText: 'Streak' });
  await expect(streak).toHaveText('Streak0');
  await expect(page.locator('.hud-score')).toBeHidden();
  await expect(page.getByRole('button', { name: /^Hint/ })).toBeHidden();

  // the sea is not a country
  await openMap(page);
  await page.locator('.map-panel .maplibregl-canvas').click({ position: ATLANTIC });
  await expect(page.getByRole('button', { name: 'That is not in a country' })).toBeDisabled();

  await page.locator('.map-panel .maplibregl-canvas').click({ position: SIBERIA });
  await page.getByRole('button', { name: 'Guess Russia' }).click();
  // a right answer is said so, and stays on screen long enough to read before the next place takes over
  await expect(page.locator('.status')).toHaveText('Correct: Russia');
  await expect(streak).toHaveText('Streak1');
  await page.waitForTimeout(500);
  await expect(page.locator('.status')).toHaveText('Correct: Russia');
  await roundReady(page);

  await openMap(page);
  await page.locator('.map-panel .maplibregl-canvas').click({ position: BRAZIL });
  await page.getByRole('button', { name: 'Guess Brazil' }).click();
  const over = page.getByRole('region', { name: 'Streak over' });
  await expect(over).toContainText('1 country');
  await expect(over).toContainText('It was Russia. You said Brazil.');
  await expect(over).toContainText('Your best streak is 9. +20 XP.');
  // the run was begun on the server as the game began, and is finished with what was played: each place and the country chosen, the losing round last
  expect(games.starts).toEqual([{ action: 'start', kind: 'streak' }]);
  const place = expect.stringMatching(/^ru-\d\d$/);
  expect(games.saved).toEqual([{ kind: 'streak', run: 'run.1.streak', rounds: [{ id: place, answer: 'RU' }, { id: place, answer: 'BR' }] }]);
  await expect(over.getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', /viewpoint=48\.86%2C2\.345$/);
  await expect(page.locator('.pin-actual')).toHaveCount(1);

  await over.getByRole('button', { name: 'Play again' }).click();
  await roundReady(page);
  await expect(streak).toHaveText('Streak0');
  // nothing to lose yet, so Exit does not ask
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.locator('.pane-title')).toHaveText('Country streak');
  // the second run was begun too, and left with nothing to finish it with
  expect(games.starts).toHaveLength(2);
  expect(games.saved).toHaveLength(1);
});

test('ending a streak run by Exit keeps the streak', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page, RUSSIA_ONLY);
  await signIn(page, 'neel');
  const games = await GamesServer.install(page);
  await page.goto('/#streak');
  await page.getByRole('button', { name: 'Start streak' }).click();
  await roundReady(page);
  await openMap(page);
  await page.locator('.map-panel .maplibregl-canvas').click({ position: SIBERIA });
  await page.getByRole('button', { name: 'Guess Russia' }).click();
  await roundReady(page);

  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.getByRole('dialog')).toContainText('End this run? Your streak of 1 is kept.');
  await page.getByRole('button', { name: 'End run' }).click();
  await expect(page.locator('.pane-title')).toHaveText('Country streak');
  // the run is finished with the round that made the streak: there is no losing one
  await expect.poll(() => games.saved).toEqual([{ kind: 'streak', run: 'run.1.streak', rounds: [{ id: expect.stringMatching(/^ru-\d\d$/), answer: 'RU' }] }]);
});

test('a US browser starts in miles, and distances follow the units chosen on the account pane', async ({ page }) => {
  // nothing stored: the page starts as a new browser does
  await mockServices(page, { units: 'browser' });
  await page.goto('/#account');
  // the test browser is set to US English, and a US or UK browser starts in miles
  await expect(page.getByRole('radio', { name: 'Miles' })).toBeChecked();

  await startChallenge(page);
  await placePin(page, { x: 150, y: 150 });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Round result' }).locator('.figure').first()).toContainText(/\d (mi|ft)$/);

  // a choice made on the account pane is kept and followed
  await page.goto('/#account');
  await page.getByRole('radio', { name: 'Kilometres' }).check();
  await startChallenge(page);
  await placePin(page, { x: 150, y: 150 });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Round result' }).locator('.figure').first()).toContainText(/\d (km|m)$/);

  // the stored choice wins over the browser's locale from then on
  await page.goto('/#account');
  await expect(page.getByRole('radio', { name: 'Kilometres' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Miles' })).not.toBeChecked();
});

test('a whole game still plays through with the new controls on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockServices(page);
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await expect(page.getByRole('button', { name: 'Exit' })).toBeVisible();
  expect((await page.getByRole('button', { name: 'Exit' }).boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Open map' }).click();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  expect((await page.getByRole('button', { name: 'Zoom in' }).boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 220 } });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Round result' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test('without a Google key the game plays from the Panoramax list and never asks for the Google one', async ({ page }) => {
  const shown = await mockServices(page);
  const lists: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/locations')) {
      lists.push(pathname);
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start game' }).click();
  await roundReady(page);

  expect(new Set(lists)).toEqual(new Set(['/locations.json']));
  await expect(play(page)).toHaveAttribute('data-imagery', 'panoramax');
  // a Panoramax place id is a UUID; a Google panorama id is not
  expect(shown[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
});
