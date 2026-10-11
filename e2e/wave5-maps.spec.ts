import { expect, test, type Page } from '@playwright/test';
import { guestReply, signIn } from './account-server.ts';
import { mockPlaces, mockServices } from './fixtures.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import type { EditorOptions, HarnessRecord, PageOptions } from './maps-harness.ts';
import { MINE, MapsServer, PARIS } from './maps-server.ts';
import { SocialServer } from './social-server.ts';

const BAD_MAP = 'A map needs a name of 3 to 30 characters, a description of 20 to 100, and 5 to 5000 places.';
const NEEDS_ACCOUNT = 'With an account you can like maps and find them here again, and make maps of your own.';
const SEARCH_HINT = 'Type at least 3 characters. Community maps are searched by name, description and maker.';
const PANO = 'AbCdEfGhIjKlMnOpQrSt-_';

const title = (page: Page) => page.locator('.pane-title');
const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const rowsOf = (page: Page, name: string) => section(page, name).locator('.player-row');
const count = (page: Page, field: string) => page.locator(`#${field}-count`);

async function setUp(page: Page, username: string | null = 'neel') {
  await mockServices(page);
  await mockPlaces(page);
  await signIn(page, username);
  await SocialServer.install(page);
  return MapsServer.install(page);
}

// Google is not there in these tests, so the editor and the Street View preview are opened by
// `maps-harness.ts`, in the page, with stand-ins for the lookup and the view.
const harness = (page: Page, call: string) => page.evaluate(`import('/e2e/maps-harness.ts').then((harness) => harness.${call})`);
const read = (page: Page) => page.evaluate(() => (window as Window & { mapsHarness?: HarnessRecord }).mapsHarness);

async function openEditor(page: Page, slug: string | null, options: EditorOptions = {}): Promise<void> {
  await page.goto(`/?edit=${slug ?? 'new'}`);
  await expect(page.getByRole('link', { name: 'Back to maps' })).toBeVisible();
  await harness(page, `mountEditor(${JSON.stringify(slug)}, ${JSON.stringify(options)})`);
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
}

async function openMapPage(page: Page, slug: string, options: PageOptions = {}): Promise<void> {
  await page.goto(`/?community=${slug}`);
  await expect(page.getByRole('button', { name: 'Play this map' })).toBeVisible();
  await harness(page, `mountMapPage(${JSON.stringify(slug)}, ${JSON.stringify(options)})`);
  await expect(section(page, 'Street View preview')).toBeVisible();
}

async function paste(page: Page, lines: readonly string[]): Promise<void> {
  await page.getByLabel('Street View links or coordinates').fill(lines.join('\n'));
  await page.getByRole('button', { name: 'Add pasted places' }).click();
}

/** Five spots in Paris, as a maker would paste them. */
const PARIS_SPOTS = ['48.8566, 2.3522', '48.8606 2.3376', '48.8738, 2.2950', '48.8530, 2.3499', '48.8462, 2.3464'];

test.describe('the lists', () => {
  test('the Liked list is empty until a map is liked, then holds it', async ({ page }) => {
    const maps = await setUp(page);
    await page.goto('/#maps');
    await expect(section(page, 'Maps I like')).toContainText('You have not liked a map yet. Like one on its page and it is kept here.');
    expect(maps.asked.some((query) => query.startsWith('list=liked'))).toBe(true);

    await section(page, 'Popular community maps').getByRole('link', { name: 'Paris walk' }).click();
    await page.getByRole('button', { name: 'Like', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unlike' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(rowsOf(page, 'Maps I like')).toHaveText([/Paris walk\s*by sam\s*6 places · 41 plays · 4 likes/]);
  });

  test('the Liked list has the newest map first, and comes a page at a time', async ({ page }) => {
    const maps = await setUp(page);
    maps.maps = [{ ...PARIS, liked: true }, MINE, { ...PARIS, slug: 'loved-lanes-k3k3', name: 'Loved lanes', liked: true, createdAt: '2026-10-10T12:00:00.000Z' }];
    await page.goto('/#maps');
    await expect(rowsOf(page, 'Maps I like')).toHaveText([/Loved lanes/, /Paris walk/]);
    await expect(rowsOf(page, 'My maps')).toHaveText([/My coast/]);
  });

  for (const who of ['visitor', 'guest'] as const) {
    test(`a ${who} is told what an account adds, where the liked maps would be`, async ({ page }) => {
      const maps = await setUp(page, null);
      maps.session = who === 'guest' ? 'guest' : 'none';
      if (who === 'guest') {
        await page.route('**/api/account', (route) => route.fulfill({ json: guestReply() }));
      }
      await page.goto('/#maps');

      const liked = section(page, 'Maps I like');
      await expect(liked).toContainText(NEEDS_ACCOUNT);
      await expect(liked.locator('.player-row')).toHaveCount(0);
      await expect(section(page, 'My maps')).toHaveCount(0);
      await expect(rowsOf(page, 'Popular community maps')).toHaveCount(2);
      // neither list that needs an account was asked for
      expect(maps.asked.filter((query) => /list=(liked|mine)/.test(query))).toEqual([]);
      await liked.getByRole('link', { name: 'Sign in or create an account' }).click();
      await expect(title(page)).toHaveText('Account');
    });
  }

  test('each community map shows its short description, when it has one', async ({ page }) => {
    await setUp(page);
    await page.goto('/#maps');
    const rows = rowsOf(page, 'Popular community maps');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.map-about')).toHaveText('Left bank and right, all on foot.');
    // saved before a description was required
    await expect(rows.nth(1)).toContainText('My coast');
    await expect(rows.nth(1).locator('.map-about')).toHaveCount(0);
  });

  test('search starts at three characters, and looks in names, descriptions and makers', async ({ page }) => {
    const maps = await setUp(page);
    await page.goto('/#maps');
    const search = page.getByLabel('Search maps');
    await expect(search).toHaveAccessibleDescription(SEARCH_HINT);
    await expect(rowsOf(page, 'Popular community maps')).toHaveCount(2);
    await expect(rowsOf(page, 'Maps I like')).toHaveCount(0);
    const before = maps.asked.length;

    // two characters do nothing: no question to the server, and every list stays as it was
    await search.fill('on');
    await page.waitForTimeout(600);
    expect(maps.asked).toHaveLength(before);
    await expect(section(page, 'Popular community maps')).toBeVisible();
    await expect(rowsOf(page, 'Official maps').first()).toContainText('World');

    await search.fill('on foot');
    await expect(rowsOf(page, 'Community maps matching "on foot"')).toHaveText([/Paris walk/]);
    await expect(section(page, 'Popular community maps')).toHaveCount(0);
    await expect(section(page, 'Maps I like')).toHaveCount(0);
    expect(maps.asked.at(-1)).toContain('q=on+foot');

    await search.fill('sam');
    await expect(rowsOf(page, 'Community maps matching "sam"')).toHaveText([/Paris walk\s*by sam/]);
    await search.fill('zzz');
    await expect(section(page, 'Community maps matching "zzz"')).toContainText('No community map matches that.');

    // back under three characters, the lists return
    await search.fill('sa');
    await expect(rowsOf(page, 'Popular community maps')).toHaveCount(2);
    await expect(section(page, 'My maps')).toBeVisible();
  });
});

test.describe("a map's page", () => {
  test('shows the short description and the long one, as plain text with its line breaks', async ({ page }) => {
    const maps = await setUp(page);
    const details = 'Start at the river.\n<b>Every</b> place is within a mile of it.';
    maps.maps = [{ ...PARIS, details }, MINE];
    await page.goto('/?community=paris-walk-x7k2');

    await expect(page.getByText('Left bank and right, all on foot.')).toBeVisible();
    const long = section(page, 'About this map').locator('.map-details');
    expect(await long.evaluate((node) => node.textContent)).toBe(details);
    await expect(long.locator('b')).toHaveCount(0);
    await expect(long).toHaveCSS('white-space', 'pre-line');

    // a map with no long description has no place for one
    await page.goto('/?community=my-coast-q1w2');
    await expect(title(page)).toHaveText('My coast');
    await expect(section(page, 'About this map')).toHaveCount(0);
  });

  test('without Google imagery the preview is left out, and the page says why', async ({ page }) => {
    await setUp(page);
    await page.goto('/?community=paris-walk-x7k2');
    await expect(page.getByText('This site has no Google imagery set up right now, so the map cannot be played or previewed here.')).toBeVisible();
    await expect(section(page, 'Street View preview')).toHaveCount(0);
    await expect(page.locator('.history-map .maplibregl-canvas')).toBeVisible();
  });
});

test.describe('the Street View preview, with a stand-in view', () => {
  const view = (page: Page) => page.locator('.street-view');
  const place = (number: number) => `Place ${number} of 5`;
  const CYCLE_MS = 8000;

  test('starts only when asked, and shows five places in one view, one after another', async ({ page }) => {
    await page.clock.install();
    await setUp(page);
    await openMapPage(page, 'paris-walk-x7k2');
    const preview = section(page, 'Street View preview');
    await expect(preview).toContainText('Look around up to 5 of its places before you play.');
    // nothing is made, and so nothing is spent, until the player asks
    await expect(view(page)).toHaveCount(0);
    expect(await read(page)).toMatchObject({ views: 0, shown: [] });

    await preview.getByRole('button', { name: 'Start preview' }).click();
    await expect(view(page)).toHaveAttribute('data-place', PARIS.locations[0]![0]);
    await expect(view(page)).toHaveAccessibleName('Street View of a place on Paris walk');
    await expect(preview.getByText(place(1))).toBeVisible();

    // six places in the map, five in the preview, and round again
    for (const number of [2, 3, 4, 5, 1]) {
      await page.clock.fastForward(CYCLE_MS);
      await expect(preview.getByText(place(number))).toBeVisible();
      await expect(view(page)).toHaveAttribute('data-place', PARIS.locations[number - 1]![0]);
    }
    expect(await read(page)).toMatchObject({ views: 1 });
  });

  test('can be stopped on a place, stepped by hand, and set going again', async ({ page }) => {
    await page.clock.install();
    await setUp(page);
    await openMapPage(page, 'paris-walk-x7k2');
    const preview = section(page, 'Street View preview');
    await preview.getByRole('button', { name: 'Start preview' }).click();
    await expect(preview.getByText(place(1))).toBeVisible();

    await preview.getByRole('button', { name: 'Pause' }).click();
    await page.clock.fastForward(CYCLE_MS * 3);
    await expect(preview.getByText(place(1))).toBeVisible();

    await preview.getByRole('button', { name: 'Next place' }).click();
    await expect(preview.getByText(place(2))).toBeVisible();
    await preview.getByRole('button', { name: 'Previous place' }).click();
    await preview.getByRole('button', { name: 'Previous place' }).click();
    await expect(preview.getByText(place(5))).toBeVisible();
    await expect(view(page)).toHaveAttribute('data-place', PARIS.locations[4]![0]);
    // stepping does not set it going
    await page.clock.fastForward(CYCLE_MS * 2);
    await expect(preview.getByText(place(5))).toBeVisible();

    await preview.getByRole('button', { name: 'Resume' }).click();
    await page.clock.fastForward(CYCLE_MS);
    await expect(preview.getByText(place(1))).toBeVisible();

    // taking hold of the view to look around stops it there
    await view(page).dispatchEvent('pointerdown');
    await expect(preview.getByRole('button', { name: 'Resume' })).toBeVisible();
    await page.clock.fastForward(CYCLE_MS * 2);
    await expect(preview.getByText(place(1))).toBeVisible();
  });

  test('under reduced motion nothing changes but by the player', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install();
    await setUp(page);
    await openMapPage(page, 'paris-walk-x7k2');
    const preview = section(page, 'Street View preview');
    await preview.getByRole('button', { name: 'Start preview' }).click();
    await expect(preview.getByText(place(1))).toBeVisible();
    await expect(preview).toContainText('The place changes only when you step to another.');
    await expect(preview.getByRole('button', { name: 'Pause' })).toHaveCount(0);
    await expect(preview.getByRole('button', { name: 'Resume' })).toHaveCount(0);

    await page.clock.fastForward(CYCLE_MS * 3);
    await expect(preview.getByText(place(1))).toBeVisible();
    await preview.getByRole('button', { name: 'Next place' }).click();
    await expect(preview.getByText(place(2))).toBeVisible();
    expect((await read(page))?.shown).toHaveLength(2);
  });

  test('a place that cannot be shown says so, and a view that cannot be made offers another try', async ({ page }) => {
    await setUp(page);
    await openMapPage(page, 'paris-walk-x7k2', { gone: [PARIS.locations[1]![0]] });
    const preview = section(page, 'Street View preview');
    await page.evaluate(() => ((window as Window & { mapsHarness?: HarnessRecord }).mapsHarness!.down = true));
    await preview.getByRole('button', { name: 'Start preview' }).click();
    await expect(preview.getByRole('alert')).toHaveText('Street View cannot be shown right now. The Google imagery for today may be used up. Try again later.');
    await expect(page.locator('.street-view')).toHaveCount(0);

    await page.evaluate(() => ((window as Window & { mapsHarness?: HarnessRecord }).mapsHarness!.down = false));
    await preview.getByRole('button', { name: 'Try again' }).click();
    await expect(preview.getByText(place(1))).toBeVisible();
    await preview.getByRole('button', { name: 'Next place' }).click();
    await expect(preview.getByRole('alert')).toHaveText('This place could not be shown. Step to another.');
    await preview.getByRole('button', { name: 'Next place' }).click();
    await expect(preview.getByText(place(3))).toBeVisible();
    await expect(preview.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('the editor, with a stand-in for the Street View lookup', () => {
  test('holds a map to its limits, with a live count on each field', async ({ page }) => {
    const maps = await setUp(page);
    await openEditor(page, null);
    await expect(page.locator('.lede')).toContainText('five thousand is the most');
    const name = page.getByLabel('Name', { exact: true });
    const short = page.getByLabel('Short description');
    const long = page.getByLabel('Long description (optional)');
    const publish = page.getByRole('button', { name: 'Publish map' });

    await expect(name).toHaveAttribute('maxlength', '30');
    await expect(short).toHaveAttribute('maxlength', '100');
    await expect(long).toHaveAttribute('maxlength', '1000');
    await expect(name).toHaveAccessibleDescription('3 to 30 characters. 0 / 30');
    await expect(short).toHaveAccessibleDescription('Shown beside the map in lists. 20 to 100 characters. 0 / 100');
    await expect(long).toHaveAccessibleDescription('Shown on the map page. Up to 1,000 characters. Line breaks are kept. 0 / 1,000');
    await expect(section(page, 'Places').locator('h3')).toHaveText('Places · 0 of 5,000');

    await publish.click();
    await expect(page.getByRole('alert')).toHaveText('Give the map a name of 3 to 30 characters.');
    await name.fill('ab');
    await expect(count(page, 'map-name')).toHaveText('2 / 30');
    await expect(count(page, 'map-name')).toHaveAttribute('data-state', 'out');
    await name.fill('  Paris walk  ');
    await expect(count(page, 'map-name')).toHaveText('10 / 30');
    await expect(count(page, 'map-name')).toHaveAttribute('data-state', 'in');

    await publish.click();
    await expect(page.getByRole('alert')).toHaveText('Give the map a short description of 20 to 100 characters.');
    await short.fill('Nineteen characters');
    await expect(count(page, 'map-description')).toHaveText('19 / 100');
    await expect(count(page, 'map-description')).toHaveAttribute('data-state', 'out');
    await short.fill('Now twenty character');
    await expect(count(page, 'map-description')).toHaveAttribute('data-state', 'in');
    await long.fill('One line.\nAnd another.');
    await expect(count(page, 'map-details')).toHaveText('22 / 1,000');
    // the long one may be left empty
    await expect(count(page, 'map-details')).toHaveAttribute('data-state', 'in');

    await publish.click();
    await expect(page.getByRole('alert')).toHaveText('A map needs at least 5 places. Add 5 more.');
    expect(maps.posted('save')).toHaveLength(0);
  });

  test('saves a new map with both descriptions, and opens its page', async ({ page }) => {
    const maps = await setUp(page);
    await openEditor(page, null);
    await page.getByLabel('Name', { exact: true }).fill('Paris on foot');
    await page.getByLabel('Short description').fill('Five corners of the old town.');
    await page.getByLabel('Long description (optional)').fill('Start at the river.\nEvery place is within a mile of it.\n');
    await paste(page, PARIS_SPOTS);
    await expect(section(page, 'Add places by pasting')).toContainText('Added 5 places.');
    await page.getByRole('button', { name: 'Publish map' }).click();

    await expect(title(page)).toHaveText('Paris on foot');
    await expect(page).toHaveURL(/\?community=paris-on-foot-new1$/);
    const [saved] = maps.posted('save');
    expect(saved).toMatchObject({ action: 'save', name: 'Paris on foot', description: 'Five corners of the old town.', details: 'Start at the river.\nEvery place is within a mile of it.' });
    expect(saved).not.toHaveProperty('slug');
    expect(saved!.locations).toEqual([
      ['pano:48.857,2.352', 2.352, 48.857, 'FR'],
      ['pano:48.861,2.338', 2.338, 48.861, 'FR'],
      ['pano:48.874,2.295', 2.295, 48.874, 'FR'],
      ['pano:48.853,2.35', 2.35, 48.853, 'FR'],
      ['pano:48.846,2.346', 2.346, 48.846, 'FR'],
    ]);
    await expect(page.getByText('Five corners of the old town.')).toBeVisible();
    await expect(section(page, 'About this map')).toContainText('Every place is within a mile of it.');
  });

  test("shows the server's refusal as it was sent, and lets the map be saved again", async ({ page }) => {
    const maps = await setUp(page);
    await openEditor(page, null);
    await page.getByLabel('Name', { exact: true }).fill('Paris on foot');
    await page.getByLabel('Short description').fill('Five corners of the old town.');
    await paste(page, PARIS_SPOTS);
    await expect(rowsOf(page, 'Places')).toHaveCount(5);

    maps.refuse = BAD_MAP;
    await page.getByRole('button', { name: 'Publish map' }).click();
    await expect(page.getByRole('alert')).toHaveText(BAD_MAP);
    await expect(title(page)).toHaveText('Make a map');

    maps.refuse = null;
    await page.getByRole('button', { name: 'Publish map' }).click();
    await expect(title(page)).toHaveText('Paris on foot');
    expect(maps.posted('save')).toHaveLength(2);
  });

  test('adds pasted coordinates and Street View links, and says what could not be added', async ({ page }) => {
    await setUp(page);
    await openEditor(page, null);
    const pasting = section(page, 'Add places by pasting');
    await expect(page.getByLabel('Street View links or coordinates')).toHaveAccessibleDescription(/One per line: a Street View link from Google Maps, or coordinates as latitude, longitude\./);

    await pasting.getByRole('button', { name: 'Add pasted places' }).click();
    await expect(pasting.getByRole('alert')).toHaveText('Paste at least one link or pair of coordinates first.');

    await paste(page, [
      '48.8566, 2.3522',
      '48.8606 2.3376',
      `https://www.google.com/maps/@48.8583701,2.2944813,3a,75y,90t/data=!3m6!1e1!3m4!1s${PANO}!2e0!7i16384!8i8192`,
      `https://www.google.com/maps/@?api=1&map_action=pano&pano=${PANO}&viewpoint=-1.2921,36.8219`,
      '',
      '48.8566, 2.3522',
      '85.0, 10.0',
      // the middle of the Atlantic
      '30, -40',
      `https://www.google.com/maps/@?api=1&map_action=pano&pano=${PANO}`,
      'somewhere nice',
    ]);
    await expect(pasting.locator('.paste-summary li')).toHaveText([
      'Added 4 places.',
      '1 was already in the map.',
      '1 had no Street View within 500 m.',
      '1 was not in any country.',
      '1 link had no coordinates to look near.',
      '1 line could not be read.',
    ]);
    await expect(pasting.getByRole('alert')).toHaveCount(0);
    await expect(rowsOf(page, 'Places')).toHaveText([/1\s*France\s*48\.8570, 2\.3520\s*Remove/, /2\s*France\s*48\.8610, 2\.3380/, /3\s*France\s*48\.8580, 2\.2940/, /4\s*Kenya\s*-1\.2920, 36\.8220/]);
    await expect(section(page, 'Places').locator('h3')).toHaveText('Places · 4 of 5,000');
    // everything was dealt with, so the box is ready for the next list
    await expect(page.getByLabel('Street View links or coordinates')).toHaveValue('');

    await page.getByRole('button', { name: 'Remove place 2, France' }).click();
    await expect(rowsOf(page, 'Places')).toHaveText([/France/, /France/, /Kenya/]);
  });

  test('a long pasted list shows how far it has got, and can be stopped', async ({ page }) => {
    await setUp(page);
    await openEditor(page, null, { delayMs: 400 });
    const pasting = section(page, 'Add places by pasting');
    await paste(page, Array.from({ length: 40 }, (_, i) => `48.${String(100 + i)}, 2.35`));

    await expect(pasting.getByText(/^Looked up (4|8) of 40$/)).toBeVisible();
    await expect(pasting.locator('progress')).toHaveAttribute('max', '40');
    // while the list is being added, the map cannot be published from under it
    await expect(page.getByRole('button', { name: 'Publish map' })).toBeDisabled();
    await expect(pasting.getByRole('button', { name: 'Add pasted places' })).toBeHidden();
    await pasting.getByRole('button', { name: 'Stop' }).click();

    const lines = pasting.locator('.paste-summary li');
    await expect(lines).toHaveText([/^Added \d+ places\.$/, /^\d+ were not looked up\.$/]);
    const [added, left] = (await lines.allTextContents()).map((line) => Number(/\d+/.exec(line)?.[0]));
    expect(added! + left!).toBe(40);
    expect(added).toBeLessThan(40);
    await expect(rowsOf(page, 'Places')).toHaveCount(added!);
    await expect(page.getByRole('button', { name: 'Publish map' })).toBeEnabled();
    await expect(pasting.getByRole('button', { name: 'Stop' })).toBeHidden();
    // what was not looked up is still in the box, to be tried again
    await expect(page.getByLabel('Street View links or coordinates')).not.toHaveValue('');
  });

  test('a click on the map adds the place found there', async ({ page }) => {
    await setUp(page);
    await openEditor(page, null);
    const map = page.locator('.editor-map .maplibregl-canvas');
    await expect(map).toBeVisible();
    await expect(page.getByText('Click the map to add a place.')).toBeVisible();
    const box = (await map.boundingBox())!;
    // the stand-in finds a panorama wherever it is asked, so what is said depends only on whether the spot is land
    await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.locator('.account-section > [role="status"]').first()).toHaveText(/^(Added a place in .+\.|That Street View is not in any country, so it cannot be added\.)$/);
    expect((await read(page))?.lookups).toBe(1);
  });

  test('a map of five thousand places is listed a page at a time, and takes no more', async ({ page }) => {
    const maps = await setUp(page);
    const locations = Array.from({ length: 4999 }, (_, i): [string, number, number, string] => [`many-${i}`, 2 + (i % 100) * 0.001, 48 + Math.floor(i / 100) * 0.001, 'FR']);
    maps.maps = [PARIS, { ...MINE, description: 'Every corner of one small town.', places: locations.length, locations }];
    await openEditor(page, 'my-coast-q1w2');

    const places = section(page, 'Places');
    await expect(places.locator('h3')).toHaveText('Places · 4,999 of 5,000');
    await expect(rowsOf(page, 'Places')).toHaveCount(50);
    await expect(places.getByText('Showing 1 to 50')).toBeVisible();
    await expect(places.getByRole('button', { name: 'Earlier places' })).toBeDisabled();
    await places.getByRole('button', { name: 'Later places' }).click();
    await expect(places.getByText('Showing 51 to 100')).toBeVisible();
    await expect(rowsOf(page, 'Places').first()).toContainText('51');

    // one more fits; the place after it does not, and the list turns to where the new one is
    await paste(page, ['40.4168, -3.7038', '41.3874, 2.1686']);
    await expect(section(page, 'Add places by pasting').locator('.paste-summary li')).toHaveText(['Added 1 place.', '1 did not fit: the map is full.']);
    await expect(places.locator('h3')).toHaveText('Places · 5,000 of 5,000');
    await expect(places.getByText('Showing 4,951 to 5,000')).toBeVisible();
    await expect(places.getByRole('button', { name: 'Later places' })).toBeDisabled();
    await expect(rowsOf(page, 'Places').last()).toHaveText(/5,000\s*Spain\s*40\.4170, -3\.7040/);
    await expect(rowsOf(page, 'Places')).toHaveCount(50);
  });

  test('a map from before the limits opens with its short description asked for, not refused', async ({ page }) => {
    const maps = await setUp(page);
    await openEditor(page, 'my-coast-q1w2');
    const short = page.getByLabel('Short description');
    const ask = 'This map was saved before maps needed a short description. Write one to save your changes.';

    await expect(title(page)).toHaveText('Edit map');
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('My coast');
    await expect(short).toHaveValue('');
    await expect(page.getByText(ask)).toBeVisible();
    await expect(short).toHaveAccessibleDescription(new RegExp(`0 / 100 ${ask.replace(/\./g, '\\.')}$`));
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(rowsOf(page, 'Places')).toHaveCount(5);

    // saving without one is caught here, in words, before anything is sent
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('alert')).toHaveText('Give the map a short description of 20 to 100 characters.');
    expect(maps.posted('save')).toHaveLength(0);

    await short.fill('The west coast, north to south.');
    await expect(page.getByText(ask)).toBeHidden();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\?community=my-coast-q1w2$/);
    await expect(page.getByText('The west coast, north to south.')).toBeVisible();
    expect(maps.posted('save')).toEqual([{ action: 'save', slug: 'my-coast-q1w2', name: 'My coast', description: 'The west coast, north to south.', details: '', locations: MINE.locations }]);
  });
});

// The maps pane, a map's page and the editor, in each other language on a phone: every text from
// the language's catalog, nothing wider than its control, nothing past the edge of the screen.
for (const code of ['es', 'fr', 'de', 'ru']) {
  const say = CATALOGS[code]!;
  /** the end of a map's byline, after its maker's name: the day it was made, written out in the language */
  const made = say['mapPage.byline']
    .split('{maker}')[1]!
    .replace('{date}', new Intl.DateTimeFormat(code, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(PARIS.createdAt)))
    .trim();
  /** what players typed: names of maps and of their makers, and what they wrote about the maps */
  const TYPED = ['Paris walk', 'My coast', 'sam', 'neel', PARIS.description, PARIS.details.replace(/\s+/g, ' '), 'The west coast, north to south.', 'Notes on the coast.'];

  test.describe(`${code} on a phone`, () => {
    test.use({ viewport: { width: 390, height: 800 } });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
    });

    test('the maps pane is in the language, with nothing spilling', async ({ page }) => {
      const maps = await setUp(page);
      maps.maps = [{ ...PARIS, liked: true }, MINE];
      await page.goto('/#maps');
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(section(page, say['maps.liked']).locator('.player-row')).toHaveCount(1);
      await expect(section(page, say['maps.mine']).locator('.player-row')).toHaveCount(1);
      await expectTranslated(page, code, TYPED);

      await page.getByLabel(say['maps.search']).fill('zzz');
      await expect(page.getByText(say['maps.noCommunity'])).toBeVisible();
      await expectTranslated(page, code, [...TYPED, 'zzz']);
    });

    test('what a visitor is told about liked maps is in the language', async ({ page }) => {
      const maps = await setUp(page, null);
      maps.session = 'none';
      await page.goto('/#maps');
      await expect(page.getByText(say['maps.likedNeedsAccount'])).toBeVisible();
      await expectTranslated(page, code, TYPED);
    });

    test("a map's page and its preview are in the language, with nothing spilling", async ({ page }) => {
      await setUp(page);
      await page.goto('/?community=paris-walk-x7k2');
      await expect(page.getByRole('button', { name: say['mapPage.play'] })).toBeVisible();
      await harness(page, 'mountMapPage("paris-walk-x7k2")');
      const preview = section(page, say['mapPage.street']);
      await expect(preview).toBeVisible();
      await expect(page.getByText(made)).toBeVisible();
      await expectTranslated(page, code, [...TYPED, made]);

      await preview.getByRole('button', { name: say['mapPage.streetStart'] }).click();
      await expect(preview.getByRole('button', { name: say['mapPage.streetNext'] })).toBeVisible();
      await expect(preview.getByRole('button', { name: say['mapPage.streetPause'] })).toBeVisible();
      await expectTranslated(page, code, [...TYPED, made]);
    });

    test('the editor is in the language, with nothing spilling', async ({ page }) => {
      const maps = await setUp(page);
      const locations = Array.from({ length: 60 }, (_, i): [string, number, number, string] => [`many-${i}`, 2 + i * 0.001, 48, 'FR']);
      maps.maps = [PARIS, { ...MINE, details: 'Notes on the coast.', places: locations.length, locations }];
      await page.goto('/?edit=my-coast-q1w2');
      await expect(page.getByRole('link', { name: say['editor.backToMaps'] })).toBeVisible();
      await harness(page, 'mountEditor("my-coast-q1w2")');
      // an older map: the short description is asked for, and sixty places need the pager
      await expect(page.getByText(say['editor.descriptionMissing'])).toBeVisible();
      await expect(page.getByRole('button', { name: say['editor.later'] })).toBeVisible();
      await expectTranslated(page, code, TYPED);

      // every line a pasted list can end with
      await page.getByLabel(say['editor.pasteLabel']).fill(['40.4168, -3.7038', '40.4168, -3.7038', '85, 10', '30, -40', `https://www.google.com/maps/@?api=1&map_action=pano&pano=${PANO}`, 'junk'].join('\n'));
      await page.getByRole('button', { name: say['editor.pasteAdd'] }).click();
      await expect(page.locator('.paste-summary li')).toHaveCount(6);
      await page.getByRole('button', { name: say['editor.save'] }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expectTranslated(page, code, TYPED);
    });
  });
}
