import { expect, test, type Page } from '@playwright/test';
import type { MatchState } from '../src/multiplayer/client.ts';
import { mockServices } from './fixtures.ts';
import { play, roundReady } from './helpers.ts';
import { CATALOGS } from './language-checks.ts';
import { hiddenPins } from './match-boxes.ts';
import * as rules from './match-rules.ts';
import { openScene, type SceneName } from './match-scenes.ts';

// A result on the map, measured: wherever on Earth the guess and the place are, the player's own
// pin and the place are both on the part of the map that nothing covers, on a phone (where the
// panel is a sheet over the lower half of the map) and on a wide screen. Three pairs no ordinary
// fit holds: half the world apart along the equator, either side of the date line, and a guess at
// the pole with the place at the far end of the other hemisphere. For a game alone, and for a
// match's reveal with two, eight and twenty players, whose pins are all over the world.

const PHONE = { width: 390, height: 800 };
const DESKTOP = { width: 1360, height: 840 };
const SIZES = [PHONE, DESKTOP] as const;
const say = CATALOGS.en!;

interface Point {
  lng: number;
  lat: number;
}

interface Pair {
  name: string;
  guess: Point;
  place: Point;
  /** how far apart the two are, in kilometres: what the result panel has to say, give or take a twentieth */
  km: number;
}

const PAIRS: readonly Pair[] = [
  { name: 'opposite sides of the world along the equator', guess: { lng: 5, lat: 0 }, place: { lng: -175, lat: 0 }, km: 20_015 },
  { name: 'either side of the date line', guess: { lng: 130, lat: 20 }, place: { lng: -160, lat: 25 }, km: 7135 },
  { name: 'a guess at the pole and a place far in the south', guess: { lng: 5, lat: 90 }, place: { lng: 166.7, lat: -77.8 }, km: 19_170 },
];

const REVEALS: ReadonlyArray<{ scene: SceneName; players: number }> = [
  { scene: 'ranked', players: 2 },
  { scene: 'eight', players: 8 },
  { scene: 'twenty', players: 20 },
];

/** what a pin must not be under: the HUD and a match's health above, the panel, and the buttons that stand over the map */
const COVERS = ['.hud', '.health', '.panel-host > *', '.map-zoom', '.chat-toggle', '.host-toggle'];
const PINS = ['.map .pin-guess', '.map .pin-actual'];
/** the longitude in the middle of the guess map as a round opens */
const HOME_LNG = 5;
/** how long the map takes to come to rest on a result */
const FIT_MS = 900;

/** How far down the map a latitude is drawn, from 0 at its top edge to 1 at its bottom one. */
const mercatorY = (lat: number) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 360)) / (2 * Math.PI);

const IMAGE_HOST = 'https://img.plonk.test';

/**
 * Every panorama is one taken at `place`: a round's place is where its picture was taken. The
 * picture is the one `mockServices` serves (see `picture` in fixtures.ts), but for where it is.
 */
async function picturesAt(page: Page, place: Point): Promise<void> {
  const picture = (id: string) => ({
    id,
    collection: `seq-of-${id.split('~')[0]}`,
    geometry: { type: 'Point', coordinates: [place.lng, place.lat] },
    properties: {
      license: 'CC-BY-SA-4.0',
      'view:azimuth': 0,
      'geovisio:producer': 'e2e fixture',
      'pers:interior_orientation': { field_of_view: 360 },
      'tiles:tile_matrix_sets': { geovisio: { tileMatrix: [{ tileWidth: 512, tileHeight: 512, matrixWidth: 4, matrixHeight: 2 }] } },
    },
    assets: { hd: { href: `${IMAGE_HOST}/${id}/hd.jpg` }, sd: { href: `${IMAGE_HOST}/${id}/sd.jpg` } },
    asset_templates: { tiles: { href: `${IMAGE_HOST}/${id}/tiled/{TileCol}_{TileRow}.jpg` } },
    links: [{ rel: 'license', href: 'https://creativecommons.org/licenses/by-sa/4.0/' }],
  });
  await page.route('https://api.panoramax.xyz/api/search**', async (route) => {
    const ids = new URL(route.request().url()).searchParams.get('ids');
    await route.fulfill({ json: { features: ids ? [picture(ids)] : [] } });
  });
}

/**
 * Places the pin at `point`. The guess map is zoomed out as far as it goes first: the world is
 * then exactly as tall as the map, with the equator across its middle, so where a point is drawn
 * follows from the map's size alone. A latitude past the map's edge is pinned on the edge.
 */
async function pinAt(page: Page, point: Point): Promise<void> {
  if (page.viewportSize()!.width <= 720) {
    await page.getByRole('button', { name: say['round.openMap'] }).click();
  } else {
    await page.locator('.map-panel').hover();
  }
  await page.waitForTimeout(400);
  for (let step = 0; step < 3; step++) {
    await page.getByRole('button', { name: say['guessMap.zoomOut'] }).click();
    await page.waitForTimeout(450);
  }
  const canvas = page.locator('.map-panel .maplibregl-canvas');
  const size = (await canvas.boundingBox())!;
  const x = size.width / 2 + ((point.lng - HOME_LNG) * size.height) / 360;
  const y = Math.max(2, Math.min(size.height - 2, mercatorY(point.lat) * size.height));
  expect(x).toBeGreaterThan(0);
  expect(x).toBeLessThan(size.width);
  await canvas.click({ position: { x, y } });
}

/** A game alone, with the round's result on screen. */
async function localResult(page: Page, pair: Pair): Promise<void> {
  await mockServices(page);
  await picturesAt(page, pair.place);
  await page.goto('/?map=world&seed=e2e00001&n=3');
  await page.getByRole('button', { name: say['singleplayer.playChallenge'] }).click();
  await roundReady(page);
  await pinAt(page, pair.guess);
  await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
  await expect(play(page)).toHaveAttribute('data-phase', 'result');
  // the pair is the one meant: the panel gives the distance between the pin and the place
  const shown = Number((await page.locator('.result-panel .figure-value').first().innerText()).replace(/[^\d]/g, ''));
  expect(Math.abs(shown - pair.km)).toBeLessThan(pair.km * 0.05);
}

/** The other players' guesses, all over the world: no map holds them all and the player's own pair too. */
const scattered = (state: MatchState): MatchState => ({
  ...state,
  results: state.results.map((result) => ({
    ...result,
    guesses: result.guesses.map((guess, index) => (guess.username === state.you.username || guess.lng === null ? guess : { ...guess, lng: -170 + ((index * 67) % 340), lat: -60 + ((index * 37) % 130) })),
  })),
});

/** A match's first round revealed, with the page's player at `pair.guess` and the place at `pair.place`. */
async function matchReveal(page: Page, name: SceneName, pair: Pair): Promise<void> {
  const { server, scene } = await openScene(page, name, 'en');
  const [first, ...rest] = server.state.places ?? [];
  const playing: MatchState = { ...server.state, places: [{ ...first!, ...pair.place }, ...rest] };
  const revealed = scattered(rules.reveal(playing, scene.scores, pair.guess, Date.now()));
  // the reveal stays up for as long as the test looks at it
  server.state = { ...revealed, revealEndsAt: new Date(Date.now() + 300_000).toISOString() };
  await expect(play(page)).toHaveAttribute('data-phase', 'result');
}

/** The player's own pin and the place are both drawn, on the screen and under nothing, once the map has come to rest. */
async function expectPairInSight(page: Page): Promise<void> {
  await expect.poll(() => hiddenPins(page, PINS, COVERS), { timeout: 5000 }).toEqual([]);
  await page.waitForTimeout(FIT_MS);
  expect(await hiddenPins(page, PINS, COVERS)).toEqual([]);
  await expect(page.locator(PINS[0]!)).toHaveCount(1);
  await expect(page.locator(PINS[1]!)).toHaveCount(1);
}

for (const size of SIZES) {
  test.describe(`at ${size.width}x${size.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size);
    });

    for (const pair of PAIRS) {
      test(`a game alone, ${pair.name}: the guess and the place are both in sight over the result`, async ({ page }) => {
        await localResult(page, pair);
        await expectPairInSight(page);
      });

      for (const { scene, players } of REVEALS) {
        test(`a reveal with ${players} players, ${pair.name}: the player's own guess and the place are both in sight`, async ({ page }) => {
          test.setTimeout(60_000);
          await matchReveal(page, scene, pair);
          await expect(page.locator('.map .pin')).toHaveCount(players + 1);
          await expectPairInSight(page);
        });
      }
    }
  });
}

test("a sheet that grows after the result is up takes the map's fit with it", async ({ page }) => {
  await page.setViewportSize(PHONE);
  // the pair that runs the height of the map: the place is as near the sheet as the fit lets a pin be
  await localResult(page, PAIRS[2]!);
  await expectPairInSight(page);
  // what a panel does when a line is added to it (a score that was saved, a report that was sent): it gets taller
  await page.locator('.panel-host > *').evaluate((panel) => {
    const filler = document.createElement('div');
    filler.style.height = '120px';
    panel.prepend(filler);
  });
  await page.waitForTimeout(FIT_MS);
  expect(await hiddenPins(page, PINS, COVERS)).toEqual([]);
});
