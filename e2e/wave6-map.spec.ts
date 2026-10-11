import { expect, test, type Page } from '@playwright/test';
import { tonesFor } from '../src/ui/basemap-theme.ts';
import { mockServices } from './fixtures.ts';
import { roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated, type Catalog } from './language-checks.ts';
import { DESKTOPS, LANGUAGES, PHONE, PIXEL_PNG, SATELLITE_TILES, box, boxesOf, clashes, stored, useLanguage } from './round-boxes.ts';

// Wave 6, item 12: the hybrid map, a fourth type of guess map. Satellite pictures with the street
// map's names and borders drawn over them, pale whatever the page's scheme, and both credits shown.

/** what stands over the guess map, and the bar under it */
const OVER_MAP = ['.map-sizes', '.map-hold', '.map-types', '.map-zoom', '.guess-bar .guess', '.map-close', '.map-credit', '.maplibregl-ctrl-attrib-button'];

async function openRound(page: Page, code: string): Promise<Catalog> {
  const say = CATALOGS[code]!;
  await useLanguage(page, code);
  await mockServices(page);
  await page.goto('/?map=world&seed=e2e00001&t=0&mode=move&n=3');
  await page.getByRole('button', { name: say['singleplayer.playChallenge'] }).click();
  await roundReady(page);
  return say;
}

const typeButton = (page: Page, say: Catalog, type: 'streets' | 'satellite' | 'hybrid' | 'terrain') =>
  page.getByRole('group', { name: say['guessMap.type'] }).getByRole('button', { name: say[`guessMap.type.${type}`]!, exact: true });

for (const code of LANGUAGES) {
  test(`the four map types fit a phone's map in ${code}, and the hybrid map credits its pictures and its names`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    let tiles = 0;
    await page.route(SATELLITE_TILES, (route) => {
      tiles += 1;
      return route.fulfill({ body: PIXEL_PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } });
    });
    const say = await openRound(page, code);
    await page.getByRole('button', { name: say['round.openMap'] }).click();
    const types = page.getByRole('group', { name: say['guessMap.type'] }).getByRole('button');
    await expect(types).toHaveText([say['guessMap.type.streets']!, say['guessMap.type.satellite']!, say['guessMap.type.hybrid']!, say['guessMap.type.terrain']!]);
    // one row of four, each 44px for a finger, clear of the zoom buttons across from them
    const boxes = await boxesOf(page, ['.map-type']);
    expect(new Set(boxes.map((each) => Math.round(each.top))).size).toBe(1);
    expect(boxes.every((each) => each.bottom - each.top >= 44)).toBe(true);
    expect(await clashes(page, OVER_MAP)).toEqual([]);
    expect(tiles).toBe(0);

    await typeButton(page, say, 'hybrid').click();
    await expect(typeButton(page, say, 'hybrid')).toHaveAttribute('aria-pressed', 'true');
    await expect(typeButton(page, say, 'streets')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.map-panel')).toHaveAttribute('data-type', 'hybrid');
    // the pictures' credit, and the street map's, whose names are over them: both in full view
    const credit = page.locator('.map-credit');
    await expect(credit).toBeVisible();
    await expect(credit).toContainText('EOxCloudless');
    await expect(credit).toContainText('Contains modified Copernicus Sentinel data');
    await expect(credit.getByRole('link', { name: 'OpenFreeMap' })).toHaveAttribute('href', 'https://openfreemap.org');
    await expect(credit.getByRole('link', { name: 'OpenMapTiles' })).toBeVisible();
    await expect(credit.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    expect(await clashes(page, OVER_MAP)).toEqual([]);
    // what is drawn on pictures is drawn pale, whatever the page's scheme
    await expect(page.locator('.map-panel .map')).toHaveAttribute('data-ground', 'dark');
    await expect.poll(() => tiles).toBeGreaterThan(0);
    expect(await stored(page, 'plonk.map-type')).toBe('hybrid');
    await expectTranslated(page, code);
  });
}

for (const code of ['de', 'ru'] as const) {
  test(`the four map types fit the small map of a wide screen in ${code}`, async ({ page }) => {
    await page.setViewportSize(DESKTOPS[0]);
    await page.route(SATELLITE_TILES, (route) => route.fulfill({ body: PIXEL_PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }));
    const say = await openRound(page, code);
    await page.locator('.map-panel').hover();
    await page.getByRole('button', { name: say['guessMap.size.small'] }).click();
    await page.waitForTimeout(400);
    await typeButton(page, say, 'hybrid').click();
    await expect(page.locator('.map-credit')).toBeVisible();
    expect(await clashes(page, OVER_MAP)).toEqual([]);
    const [types, zoom] = [await box(page, '.map-types'), await box(page, '.map-zoom')];
    expect(types.right).toBeLessThan(zoom.left);
  });
}

/** A street map of one line, a border along the equator, and nothing else: enough to see what is drawn over what. */
const ONE_BORDER = {
  version: 8,
  sources: { border: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-179, 0], [179, 0]] } } } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
    { id: 'boundary_2', type: 'line', source: 'border', paint: { 'line-color': '#ff00ff', 'line-width': 14 } },
  ],
};

type Rgb = [number, number, number];
const hexOf = ([r, g, b]: Rgb) => `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

/** The colours down a column of the screen, top to bottom, read off a picture of it. */
async function column(page: Page, x: number, top: number, height: number): Promise<Rgb[]> {
  const shot = await page.screenshot({ clip: { x, y: top, width: 1, height } });
  return page.evaluate(
    async ({ data, rows }) => {
      const picture = new Image();
      picture.src = `data:image/png;base64,${data}`;
      await picture.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = rows;
      const context = canvas.getContext('2d')!;
      context.drawImage(picture, 0, 0, 1, rows);
      const pixels = context.getImageData(0, 0, 1, rows).data;
      return Array.from({ length: rows }, (_, row): [number, number, number] => [pixels[row * 4]!, pixels[row * 4 + 1]!, pixels[row * 4 + 2]!]);
    },
    { data: shot.toString('base64'), rows: height },
  );
}

const near = (one: Rgb, other: Rgb, by = 6) => one.every((channel, index) => Math.abs(channel - other[index]!) <= by);
const rgbOf = (hex: string): Rgb => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;

test('the hybrid map draws the street map’s borders over the pictures, pale; satellite is the pictures alone', async ({ page }) => {
  await page.setViewportSize(DESKTOPS[0]);
  await mockServices(page);
  await page.route('https://tiles.openfreemap.org/styles/liberty', (route) => route.fulfill({ json: ONE_BORDER }));
  await page.route(SATELLITE_TILES, (route) => route.fulfill({ body: PIXEL_PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/?map=world&seed=e2e00001&t=0&mode=move&n=3');
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await page.locator('.map-panel').hover();
  await page.getByRole('button', { name: 'Keep the map open' }).click();
  await page.waitForTimeout(500);
  const say = CATALOGS.en!;
  const map = await box(page, '.map-panel .map');
  // a column of the map clear of its buttons, which are at its left and right
  const x = Math.round((map.left + map.right) / 2);
  const [top, height] = [Math.round(map.top) + 4, Math.round(map.bottom - map.top) - 8];
  const rowsOf = async (colour: Rgb) => (await column(page, x, top, height)).filter((pixel) => near(pixel, colour)).length;
  const border = { light: rgbOf(tonesFor('light').border), dark: rgbOf(tonesFor('dark').border) };
  expect(hexOf(border.light)).not.toBe(hexOf(border.dark));

  // streets, on a page in the light scheme: the border in the light map's own tone
  await expect.poll(() => rowsOf(border.light)).toBeGreaterThan(8);
  expect(await rowsOf(border.dark)).toBe(0);

  // hybrid: the same border, over the pictures now, in the dark map's pale tone though the page is light
  await typeButton(page, say, 'hybrid').click();
  await expect.poll(() => rowsOf(border.dark)).toBeGreaterThan(8);
  expect(await rowsOf(border.light)).toBe(0);
  const pictures = (await column(page, x, top, 3))[0]!;
  expect(near(pictures, [255, 255, 255])).toBe(false);

  // satellite: the pictures cover the street map whole, border and all
  await typeButton(page, say, 'satellite').click();
  await expect.poll(() => rowsOf(border.dark)).toBe(0);
  expect(await rowsOf(border.light)).toBe(0);
  // (the pictures stop short of the poles, where the map's own ground shows)
  expect(await rowsOf(pictures)).toBeGreaterThan(height / 2);

  // and back to streets: the border is the page's own again
  await typeButton(page, say, 'streets').click();
  await expect.poll(() => rowsOf(border.light)).toBeGreaterThan(8);
  expect(await rowsOf(pictures)).toBe(0);
});
