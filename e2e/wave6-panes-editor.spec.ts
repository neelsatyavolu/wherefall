import { expect, test, type Page } from '@playwright/test';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { DESKTOP, NAMES, PANO, PHONE, SPOTS, box, open, openEditor, section, setUp, upload, written } from './wave6-panes-scenes.ts';

// Wave 6's two browser-only items on the panes: a file of places for the map editor (item 13), and
// the soft click of a button (item 15).

// --- item 13: a file of places -----------------------------------------------------------------------------------

const filing = (page: Page) => section(page, 'Add places from a file');
const summary = (page: Page) => filing(page).locator('.paste-summary li');
const places = (page: Page) => section(page, 'Places').locator('.player-row');

test.describe('the editor reads a file of places', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await setUp(page);
  });

  test('says under its button what it takes, and opens the file chooser from it', async ({ page }) => {
    await openEditor(page);
    await expect(filing(page).locator('.fine')).toHaveText(
      'A .json or .csv file of coordinates, up to 2 MB and 5,000 places. JSON: a list of [latitude, longitude] pairs or of objects with lat and lng, a GeoJSON FeatureCollection of points, or an object with customCoordinates. CSV: columns named lat and lng, or latitude then longitude with no header.',
    );
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), filing(page).getByRole('button', { name: 'Choose a file' }).click()]);
    expect(chooser.isMultiple()).toBe(false);
    await expect(page.locator('#map-file')).toHaveAttribute('accept', /\.json.*\.csv/);
  });

  test('a JSON list of [latitude, longitude] pairs', async ({ page }) => {
    await openEditor(page);
    await upload(page, 'pairs.json', JSON.stringify(SPOTS), 'application/json');
    await expect(summary(page)).toHaveText(['Added 5 places.']);
    await expect(places(page)).toHaveCount(5);
    await expect(places(page).first()).toContainText('48.8570, 2.3520');
  });

  test('a JSON list of objects, with what is no place counted and what has no Street View said', async ({ page }) => {
    await openEditor(page);
    const list = [{ lat: 48.8566, lng: 2.3522 }, { latitude: 48.8606, longitude: 2.3376 }, { lat: 48.8738, lon: 2.295 }, { lat: 85, lng: 10 }, { lat: 48.8566, lng: 2.3522 }, { name: 'nowhere' }, 'words'];
    await upload(page, 'objects.json', JSON.stringify(list));
    await expect(summary(page)).toHaveText(['Added 3 places.', '1 was already in the map.', '1 had no Street View within 500 m.', '2 entries could not be read as places.']);
    await expect(places(page)).toHaveCount(3);
  });

  test('a GeoJSON FeatureCollection of points, longitude first', async ({ page }) => {
    await openEditor(page);
    const features = [...SPOTS.map(([lat, lng]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} })), { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} }];
    await upload(page, 'paris.geojson', JSON.stringify({ type: 'FeatureCollection', features }), 'application/geo+json');
    await expect(summary(page)).toHaveText(['Added 5 places.', '1 entry could not be read as a place.']);
    await expect(places(page).first()).toContainText('48.8570, 2.3520');
  });

  test("the map makers' export, customCoordinates", async ({ page }) => {
    await openEditor(page);
    const exported = { name: 'Paris', customCoordinates: SPOTS.map(([lat, lng], i) => ({ lat, lng, heading: 90, pitch: 0, zoom: 0, panoId: i === 0 ? PANO : null, countryCode: 'FR' })) };
    await upload(page, 'export.json', JSON.stringify(exported));
    await expect(summary(page)).toHaveText(['Added 5 places.']);
    await expect(places(page)).toHaveCount(5);
    // five places make a map: it can be published with what the file brought
    await page.getByLabel('Name', { exact: true }).fill('From a file');
    await page.getByLabel('Short description').fill('Five spots in Paris, read from a file.');
    await page.getByRole('button', { name: 'Publish map' }).click();
    await expect(page.locator('.pane-title')).toHaveText('From a file');
  });

  test('a CSV with a header, its columns in either order, and a CSV of two bare columns', async ({ page }) => {
    await openEditor(page);
    await upload(page, 'named.csv', ['name,lng,lat', ...SPOTS.slice(0, 3).map(([lat, lng], i) => `"Spot ${i}",${lng},${lat}`), 'broken,east,north'].join('\n'), 'text/csv');
    await expect(summary(page)).toHaveText(['Added 3 places.', '1 entry could not be read as a place.']);
    await expect(places(page).first()).toContainText('48.8570, 2.3520');

    await upload(page, 'bare.CSV', SPOTS.map(([lat, lng]) => `${lat};${lng}`).join('\r\n'));
    await expect(summary(page)).toHaveText(['Added 2 places.', '3 were already in the map.']);
    await expect(places(page)).toHaveCount(5);
  });

  test('refuses a file it cannot use, plainly, and takes the next one', async ({ page }) => {
    await openEditor(page);
    const refusal = filing(page).getByRole('alert');
    const cases: Array<[name: string, content: string | Buffer, says: string]> = [
      ['places.xlsx', 'PK', 'Choose a .json or .csv file.'],
      ['big.json', Buffer.alloc(2 * 1024 * 1024 + 1, 0x20), 'This file is larger than 2 MB. Split it and add the parts one after another.'],
      ['empty.csv', '', 'This file has no places in it.'],
      ['none.json', '[]', 'This file has no places in it.'],
      ['broken.json', '{ "lat": 48', 'This file is not valid JSON.'],
      ['other.json', '{"places":[[48,2]]}', 'No list of places was found in this file. The shapes that are read are listed above.'],
      ['columns.csv', 'name,x,y\nParis,2,48', 'The first row names no latitude and longitude columns. Name them lat and lng, or leave the header out and put latitude first.'],
      ['many.json', JSON.stringify(Array.from({ length: 5001 }, (_, i) => [i % 80, i % 170])), 'This file has 5,001 places. A file may hold up to 5,000.'],
    ];
    for (const [name, content, says] of cases) {
      await upload(page, name, content);
      await expect(refusal, name).toHaveText(says);
      await expect(summary(page)).toHaveCount(0);
    }
    await expect(places(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as Window & { mapsHarness?: { lookups: number } }).mapsHarness?.lookups)).toBe(0);
    // a good file after a refused one: the refusal goes, the places come
    await upload(page, 'pairs.json', JSON.stringify(SPOTS));
    await expect(summary(page)).toHaveText(['Added 5 places.']);
    await expect(refusal).toHaveCount(0);
  });

  test('a long file shows how far it has got, can be stopped, and holds the paste box meanwhile', async ({ page }) => {
    await openEditor(page, null, 400);
    await upload(page, 'long.csv', ['lat,lng', ...Array.from({ length: 40 }, (_, i) => `48.${String(100 + i)},2.35`)].join('\n'));
    await expect(filing(page).getByText(/^Looked up (4|8) of 40$/)).toBeVisible();
    await expect(filing(page).locator('progress')).toHaveAttribute('max', '40');
    await expect(filing(page).getByRole('button', { name: 'Choose a file' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Add pasted places' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Publish map' })).toBeDisabled();
    await filing(page).getByRole('button', { name: 'Stop' }).click();

    await expect(summary(page)).toHaveText([/^Added \d+ places\.$/, /^\d+ were not looked up\.$/]);
    const [added, left] = (await summary(page).allTextContents()).map((line) => Number(/\d+/.exec(line)?.[0]));
    expect(added! + left!).toBe(40);
    expect(added).toBeLessThan(40);
    await expect(places(page)).toHaveCount(added!);
    await expect(page.getByRole('button', { name: 'Add pasted places' })).toBeEnabled();
    await expect(filing(page).getByRole('button', { name: 'Choose a file' })).toBeVisible();
    await expect(filing(page).getByRole('button', { name: 'Stop' })).toBeHidden();

    // and the other way round: while a pasted list is added, a file waits
    await page.getByLabel('Street View links or coordinates').fill(Array.from({ length: 12 }, (_, i) => `47.${String(100 + i)}, 2.35`).join('\n'));
    await page.getByRole('button', { name: 'Add pasted places' }).click();
    await expect(filing(page).getByRole('button', { name: 'Choose a file' })).toBeDisabled();
    await section(page, 'Add places by pasting').getByRole('button', { name: 'Stop' }).click();
    await expect(filing(page).getByRole('button', { name: 'Choose a file' })).toBeEnabled();
  });
});

test('the map is the first thing in the editor: whole on the first screen of a desktop, under the lede on a phone', async ({ page }) => {
  await setUp(page);
  await page.setViewportSize(DESKTOP);
  await openEditor(page);
  const map = page.locator('.editor-map');
  const wide = await box(map);
  expect(wide.y + wide.height, 'the whole map is on the first screen').toBeLessThanOrEqual(DESKTOP.height);
  expect(wide.y).toBeLessThan((await box(page.locator('#map-name'))).y);
  // what a click did is said right above it
  await expect(page.locator('.account-section.wide > [role="status"]')).toHaveText('Click the map to add a place.');
  expect((await box(page.locator('.account-section.wide > [role="status"]'))).y).toBeLessThan(wide.y);

  await page.setViewportSize(PHONE);
  await openEditor(page);
  const narrow = await box(map);
  expect(narrow.y, 'the map starts on the first screen').toBeLessThan(PHONE.height / 2);
  expect(narrow.y).toBeLessThan((await box(page.locator('#map-name'))).y);
});

test('on a phone the editor keeps Publish in reach at the foot of the screen, with what stopped it beside it', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await setUp(page);
  await openEditor(page);
  const publish = page.getByRole('button', { name: 'Publish map' });
  await expect(publish).toBeInViewport();
  await publish.click();
  const refusal = page.locator('.action-bar [role="alert"]');
  await expect(refusal).toHaveText('Give the map a name of 3 to 30 characters.');
  await expect(refusal).toBeInViewport();
  expect((await box(publish)).height).toBeGreaterThanOrEqual(44);
});

// --- item 15: the click of a button ------------------------------------------------------------------------------

/** Stands in for Web Audio, and keeps the pitch of every tone started: 330 is the click. */
async function listen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const heard = { contexts: 0, tones: [] as number[] };
    (window as unknown as { heard: typeof heard }).heard = heard;
    class FakeAudio {
      currentTime = 0;
      state = 'running';
      destination = {};
      constructor() {
        heard.contexts += 1;
      }
      resume = async () => undefined;
      createOscillator() {
        let pitch = 0;
        return { type: '', frequency: { setValueAtTime: (value: number) => (pitch = value), exponentialRampToValueAtTime: () => undefined }, connect: () => undefined, start: () => void heard.tones.push(pitch), stop: () => undefined };
      }
      createGain() {
        return { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => undefined };
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudio;
  });
}

const heard = (page: Page) => page.evaluate(() => (window as unknown as { heard: { contexts: number; tones: number[] } }).heard);
const CLICK = 330;

test('a button makes one soft click, a field makes none, and nothing is made before the first touch', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await listen(page);
  await setUp(page);
  await open(page, '/#friends');
  expect(await heard(page)).toEqual({ contexts: 0, tones: [] });

  // typing in a field is not a click, however many keys
  await page.getByLabel('Add a friend by username').click();
  await page.keyboard.type('zoe');
  expect((await heard(page)).tones).toEqual([]);
  // Enter in the field presses the form's button, once
  await page.keyboard.press('Enter');
  await expect(section(page, 'Sent, waiting for an answer')).toBeVisible();
  expect((await heard(page)).tones).toEqual([CLICK]);
  // a button, and an item of the menu
  await page.getByRole('button', { name: 'Cancel the request to zoe' }).click();
  await page.getByRole('link', { name: 'Leaderboards' }).click();
  await expect(page.locator('.pane-title')).toHaveText('Leaderboards');
  expect((await heard(page)).tones).toEqual([CLICK, CLICK, CLICK]);
  // a choice pressed on its name is one click, not one for the name and one for the choice under it
  await page.locator('label').filter({ hasText: /^XP$/ }).click();
  expect((await heard(page)).tones).toEqual([CLICK, CLICK, CLICK, CLICK]);
  // plain text is not a button
  await page.locator('.pane-title').click();
  expect((await heard(page)).tones).toHaveLength(4);
  expect((await heard(page)).contexts).toBe(1);
});

test('the click follows the Sound setting, and a sound a control makes itself is not doubled', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await listen(page);
  await setUp(page);
  await open(page, '/#account');
  // the volume slider plays its own sound when let go: that one sound and no click with it
  const volume = page.getByRole('slider', { name: 'Volume' });
  await volume.focus();
  await page.keyboard.press('ArrowRight');
  const afterSlider = (await heard(page)).tones;
  expect(afterSlider.filter((pitch) => pitch === CLICK)).toEqual([]);

  // sound off: buttons are silent
  await page.locator('label').filter({ hasText: /^Off$/ }).click();
  const quiet = (await heard(page)).tones.length;
  await page.getByRole('button', { name: 'Change country' }).click();
  await page.locator('.country-picker').getByRole('button', { name: 'Cancel' }).click();
  expect((await heard(page)).tones).toHaveLength(quiet);
  // and on again: they click
  await page.locator('label').filter({ hasText: /^On$/ }).click();
  await page.getByRole('button', { name: 'Change country' }).click();
  expect((await heard(page)).tones.at(-1)).toBe(CLICK);
});

// --- in German and Russian, on a phone ---------------------------------------------------------------------------

for (const code of ['de', 'ru'] as const) {
  test.describe(`${code} on a phone`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(PHONE);
    });

    test('the editor with a file read, a file refused and nothing leaving the screen', async ({ page }) => {
      await setUp(page, { language: code });
      const say = CATALOGS[code]!;
      await openEditor(page);
      await expect(page.getByLabel(say['editor.name'], { exact: true })).toBeVisible();
      await upload(page, 'objects.json', JSON.stringify([...SPOTS, [85, 10], 'words', [48.8566, 2.3522]]));
      await expect(page.getByRole('region', { name: say['editor.file'], exact: true }).locator('.paste-summary li')).toHaveCount(4);
      await upload(page, 'columns.csv', 'name,x,y\nParis,2,48');
      await expect(page.getByText(say['editor.file.noColumns'])).toBeVisible();
      await page.getByRole('button', { name: say['editor.publish'] }).click();
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
    });
  });
}
