import { expect, test, type Page } from '@playwright/test';
import { starsFor } from '../src/game/marks.ts';
import { RUSSIA_ONLY, mockPlaces, mockServices } from './fixtures.ts';
import { placePin, play, roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';

// Wave 5, the round screen: the hint's budget, the clock's warnings, the guess map's new tools,
// the view's keys and compass, and what a result and a summary now show.

const game = (options = 't=0&mode=move') => `/?map=world&seed=e2e00001&${options}&n=3`;

/** Smallest PNG there is (one pixel): stands in for every satellite and terrain tile. */
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/**
 * The middle of the guess map as it opens on the world: with every place put exactly there, a pin
 * dropped on the middle of the map after zooming in is a perfect guess.
 */
const MERCATOR = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const MAP_MIDDLE = { lng: (-168 + 178) / 2, lat: (Math.atan(Math.exp((MERCATOR(-56) + MERCATOR(74)) / 2)) * 360) / Math.PI - 90 };

/** Stands in for the satellite and terrain tile hosts, and counts what was asked of each. */
async function mockTiles(page: Page): Promise<{ satellite: number; terrain: number }> {
  const asked = { satellite: 0, terrain: 0 };
  const tile = { body: PIXEL_PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } };
  await page.route('https://tiles.maps.eox.at/**', (route) => {
    asked.satellite += 1;
    return route.fulfill(tile);
  });
  await page.route(/^https:\/\/[abc]\.tile\.opentopomap\.org\//, (route) => {
    asked.terrain += 1;
    return route.fulfill(tile);
  });
  return asked;
}

/** Puts every picture of the game at one spot, in place of the fixtures' own. */
async function placeEverythingAt(page: Page, at: { lng: number; lat: number }): Promise<void> {
  await page.route('https://api.panoramax.xyz/api/search**', async (route) => {
    const id = new URL(route.request().url()).searchParams.get('ids') ?? 'none';
    const point = (lat: number) => ({ type: 'Point', coordinates: [at.lng, lat] });
    await route.fulfill({
      json: {
        features: [
          {
            id,
            collection: `seq-of-${id.split('~')[0]}`,
            geometry: point(at.lat),
            properties: {
              license: 'CC-BY-SA-4.0',
              'view:azimuth': 0,
              'geovisio:producer': 'e2e fixture',
              'pers:interior_orientation': { field_of_view: 360 },
              'tiles:tile_matrix_sets': { geovisio: { tileMatrix: [{ tileWidth: 512, tileHeight: 512, matrixWidth: 4, matrixHeight: 2 }] } },
            },
            assets: { hd: { href: `https://img.plonk.test/${id}/hd.jpg` }, sd: { href: `https://img.plonk.test/${id}/sd.jpg` } },
            asset_templates: { tiles: { href: `https://img.plonk.test/${id}/tiled/{TileCol}_{TileRow}.jpg` } },
            links: [
              { rel: 'license', href: 'https://creativecommons.org/licenses/by-sa/4.0/' },
              { rel: 'next', id: `${id}~n`, geometry: point(at.lat + 0.0001) },
              { rel: 'prev', id: `${id}~p`, geometry: point(at.lat - 0.0001) },
            ],
          },
        ],
      },
    });
  });
}

async function start(page: Page, url = game()): Promise<void> {
  await page.goto(url);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
}

async function guess(page: Page, at = { x: 150, y: 150 }): Promise<void> {
  await placePin(page, at);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(play(page)).toHaveAttribute('data-phase', 'result');
}

/** Opens the guess map and waits for it to finish growing. */
async function openMap(page: Page): Promise<void> {
  await page.locator('.map-panel').hover();
  await page.waitForTimeout(500);
}

/** Takes the pointer and the focus off the guess map, as a player looking back at the street does. */
async function leaveMap(page: Page): Promise<void> {
  await page.mouse.move(200, 300);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Zooms far in on the middle of the map and pins it: a perfect guess when the place is `MAP_MIDDLE`. */
async function guessTheMiddle(page: Page): Promise<void> {
  await openMap(page);
  for (let step = 0; step < 10; step++) {
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(450);
  }
  const box = (await page.locator('.map-panel .maplibregl-canvas').boundingBox())!;
  await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(play(page)).toHaveAttribute('data-phase', 'result');
}

const width = async (page: Page) => (await page.locator('.map-panel').boundingBox())!.width;
/** The compass bearing the view faces, read off the needle. */
const bearing = (page: Page) => page.locator('.compass-needle').evaluate((needle) => (360 - (parseFloat(needle.style.transform.replace('rotate(', '')) || 0)) % 360);

test('a game has two hints: the button counts them down and is gone when they are spent', async ({ page }) => {
  await mockServices(page);
  await start(page);

  await expect(page.getByRole('button', { name: /^Hint/ })).toHaveText('Hint (half points), 2 left');
  await page.getByRole('button', { name: /^Hint/ }).click();
  await expect(page.getByRole('button', { name: 'Hint shown' })).toBeDisabled();
  await guess(page);
  await expect(page.getByRole('region', { name: 'Round result' })).toContainText('You used the hint');
  await page.getByRole('button', { name: 'Next round' }).click();

  await roundReady(page);
  await expect(page.getByRole('button', { name: /^Hint/ })).toHaveText('Hint (half points), 1 left');
  await page.getByRole('button', { name: /^Hint/ }).click();
  await expect(page.getByRole('button', { name: 'Hint shown' })).toBeDisabled();
  await guess(page);
  await page.getByRole('button', { name: 'Next round' }).click();

  // both are spent: the last round has no hint to offer
  await roundReady(page);
  await expect(page.getByRole('button', { name: /^Hint/ })).toBeHidden();
  await guess(page);
  await expect(page.getByRole('region', { name: 'Round result' })).not.toContainText('hint');
});

test('a hint not taken is still there in the next round', async ({ page }) => {
  await mockServices(page);
  await start(page);
  await guess(page);
  await page.getByRole('button', { name: 'Next round' }).click();
  await roundReady(page);
  await expect(page.getByRole('button', { name: /^Hint/ })).toHaveText('Hint (half points), 2 left');
});

test('a country streak has no hint', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page, RUSSIA_ONLY);
  await page.goto('/#streak');
  await page.getByRole('button', { name: 'Start streak' }).click();
  await roundReady(page);
  await expect(page.getByRole('button', { name: 'Return to start' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Hint/ })).toBeHidden();
});

test('the clock warns under ten seconds and is urgent under five, with the number always there', async ({ page }) => {
  await mockServices(page);
  await page.clock.install();
  await start(page, game('t=30&mode=move'));
  const clock = page.locator('.hud-cell').filter({ hasText: 'Time' });
  await expect(clock).not.toHaveClass(/warn|urgent/);

  await page.clock.fastForward(20_500);
  await expect(clock).toHaveClass(/warn/);
  await expect(clock).not.toHaveClass(/urgent/);
  await expect(clock.locator('.value')).toHaveText(/^0:0[5-9]$/);

  await page.clock.fastForward(5000);
  await expect(clock).toHaveClass(/urgent/);
  await expect(clock).not.toHaveClass(/warn/);
  await expect(clock.locator('.value')).toHaveText(/^0:0[0-4]$/);
  expect(await clock.locator('.value').evaluate((value) => getComputedStyle(value).animationName)).toBe('timer-pulse');
});

test('the urgent clock stands still for a player who asked for less motion', async ({ page }) => {
  await mockServices(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await start(page, game('t=30&mode=move'));
  await page.clock.fastForward(26_000);
  const clock = page.locator('.hud-cell').filter({ hasText: 'Time' });
  await expect(clock).toHaveClass(/urgent/);
  await expect(clock.locator('.value')).toHaveText(/^0:0[0-4]$/);
  expect(await clock.locator('.value').evaluate((value) => getComputedStyle(value).animationName)).toBe('none');
});

test('the guess map can be kept open, and the choice is remembered', async ({ page }) => {
  await mockServices(page);
  await start(page, game('t=0&mode=no-move'));
  const keep = page.getByRole('button', { name: 'Keep the map open' });
  await expect(keep).toHaveAttribute('aria-pressed', 'false');
  expect(await width(page)).toBeLessThan(330);

  await openMap(page);
  await keep.click();
  await expect(keep).toHaveAttribute('aria-pressed', 'true');
  await leaveMap(page);
  await page.waitForTimeout(400);
  expect(await width(page)).toBeGreaterThan(500);

  // kept for the next game
  await start(page, game('t=0&mode=no-move'));
  await expect(keep).toHaveAttribute('aria-pressed', 'true');
  expect(await width(page)).toBeGreaterThan(500);

  // switched off, the map closes again when the pointer leaves
  await keep.click();
  await expect(keep).toHaveAttribute('aria-pressed', 'false');
  await leaveMap(page);
  await expect.poll(() => width(page)).toBeLessThan(330);
});

test('the guess map fills the screen from its button, until the button, Escape or the next round', async ({ page }) => {
  await mockServices(page);
  await start(page);
  const full = page.getByRole('button', { name: 'Full-screen map' });
  const screen = page.viewportSize()!;
  await openMap(page);

  await full.click();
  await expect(full).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => width(page)).toBe(screen.width);
  expect((await page.locator('.map-panel').boundingBox())!.height).toBe(screen.height);
  // the HUD and the tools stay in reach over the map
  await expect(page.getByRole('button', { name: 'Exit' })).toBeVisible();
  const tools = (await page.locator('.map-sizes').boundingBox())!;
  const hud = (await page.locator('.hud').boundingBox())!;
  expect(tools.y).toBeGreaterThan(hud.y + hud.height);

  await full.click();
  await expect(full).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => width(page)).toBeLessThan(screen.width);

  await full.click();
  await expect.poll(() => width(page)).toBe(screen.width);
  await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 600, y: 400 } });
  await page.keyboard.press('Escape');
  await expect(full).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => width(page)).toBeLessThan(screen.width);

  // a new round starts with the street in view, not the map
  await full.click();
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await page.getByRole('button', { name: 'Next round' }).click();
  await roundReady(page);
  await expect(full).toHaveAttribute('aria-pressed', 'false');
});

test('the map type switches between streets, satellite and terrain, each with its credit on the map', async ({ page }) => {
  await mockServices(page);
  const asked = await mockTiles(page);
  await start(page);
  const credit = page.locator('.map-credit');
  const type = (name: string) => page.getByRole('group', { name: 'Map type' }).getByRole('button', { name });
  await openMap(page);
  await expect(type('Streets')).toHaveAttribute('aria-pressed', 'true');
  await expect(credit).toBeHidden();
  expect(asked).toEqual({ satellite: 0, terrain: 0 });

  await type('Satellite').click();
  await expect(type('Satellite')).toHaveAttribute('aria-pressed', 'true');
  await expect(type('Streets')).toHaveAttribute('aria-pressed', 'false');
  await expect(credit).toHaveText('EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024) CC BY-NC-SA 4.0');
  await expect(credit.getByRole('link', { name: 'https://cloudless.eox.at' })).toHaveAttribute('href', 'https://cloudless.eox.at');
  await expect(credit.getByRole('link', { name: 'EOX IT Services GmbH' })).toHaveAttribute('href', 'https://eox.at');
  await expect.poll(() => asked.satellite).toBeGreaterThan(0);
  expect(asked.terrain).toBe(0);

  await type('Terrain').click();
  await expect(credit).toHaveText('Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)');
  await expect(credit.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  await expect(credit.getByRole('link', { name: 'OpenTopoMap' })).toHaveAttribute('href', 'https://opentopomap.org');
  await expect.poll(() => asked.terrain).toBeGreaterThan(0);

  // the credit stays with the map over the result, and the type is kept for the next game
  await guess(page, { x: 300, y: 300 });
  await expect(credit).toBeVisible();
  await expect(credit).toContainText('OpenTopoMap');
  await start(page);
  await openMap(page);
  await expect(type('Terrain')).toHaveAttribute('aria-pressed', 'true');
  await expect(credit).toContainText('OpenTopoMap');

  await type('Streets').click();
  await expect(credit).toBeHidden();
});

test('A and D turn the view, plus and minus zoom it', async ({ page }) => {
  await mockServices(page);
  await start(page, game('t=0&mode=no-move'));
  expect(await bearing(page)).toBeCloseTo(0, 3);

  await page.keyboard.press('d');
  await page.keyboard.press('d');
  await expect.poll(() => bearing(page)).toBeCloseTo(12, 3);
  await page.keyboard.press('a');
  await expect.poll(() => bearing(page)).toBeCloseTo(6, 3);
  await page.keyboard.press('a');
  await page.keyboard.press('a');
  await expect.poll(() => bearing(page)).toBeCloseTo(354, 3);

  const pano = page.locator('.pano');
  await page.keyboard.press('+');
  await expect(pano).toHaveAttribute('data-zoom', '35');
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect(pano).toHaveAttribute('data-zoom', '15');

  // the keys still work with a button of the screen in focus, and do nothing once the round is over
  await page.getByRole('button', { name: 'Zoom in' }).focus();
  await page.keyboard.press('d');
  await expect.poll(() => bearing(page)).toBeCloseTo(0, 3);
  await guess(page);
  await page.keyboard.press('+');
  await expect(pano).toHaveAttribute('data-zoom', '15');
});

test('the keys do nothing to a view that is locked', async ({ page }) => {
  await mockServices(page);
  await start(page, game('t=0&mode=nmpz'));
  await page.keyboard.press('d');
  await page.keyboard.press('+');
  await page.waitForTimeout(200);
  expect(await bearing(page)).toBeCloseTo(0, 3);
  await expect(page.locator('.pano')).not.toHaveAttribute('data-zoom', '35');
  await expect(page.getByRole('button', { name: 'Face north' })).toBeDisabled();
});

test('a click on the compass faces the view north', async ({ page }) => {
  await mockServices(page);
  await start(page, game('t=0&mode=no-move'));
  for (let turn = 0; turn < 5; turn++) {
    await page.keyboard.press('d');
  }
  await expect.poll(() => bearing(page)).toBeCloseTo(30, 3);
  await page.getByRole('button', { name: 'Face north' }).click();
  await expect.poll(() => bearing(page)).toBeCloseTo(0, 3);
});

test('a perfect round says Perfect, throws confetti, and shows the flag beside the country', async ({ page }) => {
  await mockServices(page);
  await placeEverythingAt(page, MAP_MIDDLE);
  await start(page);
  await guessTheMiddle(page);

  await expect(page.locator('.confetti .confetti-piece')).toHaveCount(40);
  const result = page.getByRole('region', { name: 'Round result' });
  const points = result.locator('.figure').nth(1);
  await expect(points).toContainText('5,000 / 5,000');
  await expect(points.locator('.tag.perfect')).toHaveText('Perfect');
  const country = result.locator('.figure').nth(2);
  const name = await country.locator('.country-name').textContent();
  expect(name).toBeTruthy();

  // on a phone the mark takes the next line rather than run out of the panel
  await page.setViewportSize({ width: 390, height: 800 });
  const edges = async (target: typeof result) => (await target.boundingBox())!;
  const [panel, mark] = [await edges(result), await edges(points.locator('.tag.perfect'))];
  expect(mark.x).toBeGreaterThanOrEqual(panel.x);
  expect(mark.x + mark.width).toBeLessThanOrEqual(panel.x + panel.width);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(country.locator('.flag')).toHaveAttribute('title', name!);
  // the burst clears itself away
  await expect(page.locator('.confetti')).toHaveCount(0);

  // a round that is nowhere near has neither
  await page.getByRole('button', { name: 'Next round' }).click();
  await roundReady(page);
  await guess(page, { x: 30, y: 200 });
  await expect(result.locator('.tag.perfect')).toHaveCount(0);
  await expect(page.locator('.confetti')).toHaveCount(0);
});

test('with less motion asked for there is no confetti, and the final score is simply there', async ({ page }) => {
  await mockServices(page);
  await placeEverythingAt(page, MAP_MIDDLE);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  await guessTheMiddle(page);
  await expect(page.getByRole('region', { name: 'Round result' }).locator('.tag.perfect')).toHaveText('Perfect');
  await expect(page.locator('.confetti')).toHaveCount(0);

  for (const then of ['Next round', 'See summary']) {
    await page.getByRole('button', { name: 'Next round' }).click();
    await roundReady(page);
    await guess(page, { x: 30, y: 200 });
    if (then === 'See summary') {
      await page.getByRole('button', { name: 'See summary' }).click();
    }
  }
  // read at once, with no waiting: a score still counting up would be short of the perfect round alone
  const summary = page.getByRole('region', { name: 'Game summary' });
  const total = Number((await summary.locator('.figure-value').first().textContent())?.split('/')[0]?.replace(/\D/g, ''));
  expect(total).toBeGreaterThanOrEqual(5000);
});

test('the summary has stars, counts the score up, and gives each round its time and XP', async ({ page }) => {
  await mockServices(page);
  await start(page);
  const points: number[] = [];
  for (const last of [false, false, true]) {
    await roundReady(page);
    await guess(page, { x: 100 + points.length * 60, y: 150 });
    const shown = await page.getByRole('region', { name: 'Round result' }).locator('.figure').nth(1).locator('.figure-value').textContent();
    points.push(Number(shown?.split('/')[0]?.replace(/\D/g, '')));
    await page.getByRole('button', { name: last ? 'See summary' : 'Next round' }).click();
  }

  const summary = page.getByRole('region', { name: 'Game summary' });
  const total = points.reduce((sum, each) => sum + each, 0);
  await expect(summary.locator('.figure-value').first()).toContainText(`${total.toLocaleString('en-US')} / 15,000`);
  const stars = starsFor(total, 15_000);
  await expect(summary.locator('.stars')).toHaveAttribute('data-stars', String(stars));
  await expect(summary.getByRole('img', { name: stars === 1 ? '1 star out of 3' : `${stars} stars out of 3` })).toBeVisible();
  await expect(summary.locator('.stars .earned')).toHaveCount(stars);

  await expect(summary.locator('thead th')).toHaveText(['#', 'Country', 'Distance', 'Time', 'Points', 'XP']);
  const rows = summary.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  for (const [index, score] of points.entries()) {
    const cells = rows.nth(index).locator('td');
    await expect(cells.nth(1).locator('.flag')).toBeVisible();
    await expect(cells.nth(3)).toHaveText(/^\d:\d\d$/);
    await expect(cells.nth(4)).toHaveText(score.toLocaleString('en-US'));
    await expect(cells.nth(5)).toHaveText(String(Math.round(score / 50)));
  }
});

test('Share result copies the score, a square a round, the map and the link, and says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockServices(page);
  await start(page);
  for (const last of [false, false, true]) {
    await roundReady(page);
    await guess(page);
    await page.getByRole('button', { name: last ? 'See summary' : 'Next round' }).click();
  }
  const summary = page.getByRole('region', { name: 'Game summary' });
  await summary.getByRole('button', { name: 'Share result' }).click();
  await expect(summary.getByRole('button', { name: 'Result copied' })).toBeVisible();

  const copied = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
  expect(copied).toHaveLength(4);
  expect(copied[0]).toBe('Wherefall · World');
  expect(copied[1]).toMatch(/^[\d,]+ \/ 15,000$/);
  expect(copied[2]).toMatch(/^(🟩|🟨|🟧|🟥){3}$/u);
  expect(copied[3]).toMatch(/^http:\/\/localhost:\d+\/\?map=world&seed=e2e00001&t=0&mode=move&n=3$/);
  await expect(summary.getByRole('button', { name: 'Share result' })).toBeVisible({ timeout: 4000 });
});

test('when the browser will not copy, the result is shown to be copied by hand', async ({ page }) => {
  await mockServices(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) } });
  });
  await start(page);
  for (const last of [false, false, true]) {
    await roundReady(page);
    await guess(page);
    await page.getByRole('button', { name: last ? 'See summary' : 'Next round' }).click();
  }
  const summary = page.getByRole('region', { name: 'Game summary' });
  await summary.getByRole('button', { name: 'Share result' }).click();
  await expect(summary.getByRole('textbox', { name: 'Result to share' })).toHaveValue(/^Wherefall · World\n[\d,]+ \/ 15,000\n.+\nhttp/u);
});

for (const code of ['de', 'ru']) {
  test.describe(`${code} on a phone`, () => {
    test.use({ viewport: { width: 390, height: 800 } });

    test(`the round, its map tools, the result and the summary are in ${code}`, async ({ page }) => {
      const say = CATALOGS[code]!;
      await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
      await mockServices(page);
      await page.goto(game());
      await page.getByRole('button', { name: say['singleplayer.playChallenge'] }).click();
      await roundReady(page);
      await expect(page.getByRole('button', { name: say['round.faceNorth'] })).toBeVisible();
      await expectTranslated(page, code);

      // the hint, then the map open with its type choice
      await page.getByRole('button', { name: say['round.hintLeft.other']!.replace('{count}', '2') }).click();
      await expect(page.getByRole('button', { name: say['round.hintShown'] })).toBeDisabled();
      await page.getByRole('button', { name: say['round.openMap'] }).click();
      await expect(page.getByRole('group', { name: say['guessMap.type'] }).getByRole('button')).toHaveText([
        say['guessMap.type.streets'],
        say['guessMap.type.satellite'],
        say['guessMap.type.hybrid'],
        say['guessMap.type.terrain'],
      ]);
      await expectTranslated(page, code);

      for (const last of [false, false, true]) {
        if (!(await page.locator('.map-panel').isVisible())) {
          await page.getByRole('button', { name: say['round.openMap'] }).click();
        }
        await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 260 } });
        await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
        await expect(play(page)).toHaveAttribute('data-phase', 'result');
        await expectTranslated(page, code);
        await page.getByRole('button', { name: last ? say['result.seeSummary'] : say['result.next'] }).click();
        if (!last) {
          await roundReady(page);
        }
      }

      const summary = page.getByRole('region', { name: say['summary.label'] });
      await expect(summary.getByRole('button', { name: say['summary.shareResult'] })).toBeVisible();
      await expect(summary.locator('thead th')).toHaveCount(6);
      await expectTranslated(page, code);
    });
  });
}
