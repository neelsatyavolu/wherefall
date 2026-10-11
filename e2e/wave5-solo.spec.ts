import { expect, test, type Page } from '@playwright/test';
import { LANGUAGE_NAMES } from '../src/i18n/index.ts';
import { signIn } from './account-server.ts';
import { mockPlaces, mockServices } from './fixtures.ts';
import { GamesServer } from './games-server.ts';
import { play, playLocalGame, roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';

// Wave 5, playing alone: the round timer and road names, the two guessers, the volume and the
// units a browser starts with, repeat avoidance, and the About pane.

type Row = [id: string, lng: number, lat: number, country: string];

const rows = (country: string, count: number, lng: number, lat: number): Row[] =>
  Array.from({ length: count }, (_, i) => [`${country.toLowerCase()}-${String(i).padStart(2, '0')}`, lng + (i % 9) * 0.2, lat + Math.floor(i / 9) * 0.2, country]);

/** Only Kenyan places, so every round of a guesser has the same right answer: Kenya, in Africa. */
const KENYA_ONLY = { version: 1, regions: { KE: 'africa' }, locations: rows('KE', 40, 35, -2) };
/** Twelve places: small enough that two games of three would often share one, were nothing steering them apart. */
const TWELVE_PLACES = { version: 1, regions: { KE: 'africa' }, locations: rows('KE', 12, 35, -2) };

const GUESSER_ROUNDS = 10;

const timeSlider = (page: Page, name = 'Time per round') => page.getByRole('slider', { name });
const timeShown = (page: Page) => page.locator('.time-value');
const guesserPanel = (page: Page, question: string) => page.getByRole('region', { name: question });
const stored = (page: Page, key: string) => page.evaluate((name) => localStorage.getItem(name), key);

test('the round timer goes from no limit to five minutes in steps of ten seconds, by slider, button or key', async ({ page }) => {
  await mockServices(page);
  await page.goto('/');
  const slider = timeSlider(page);
  await expect(slider).toHaveValue('0');
  await expect(timeShown(page)).toHaveText('No limit');
  await expect(page.getByRole('button', { name: 'Less time' })).toBeDisabled();
  // one control, not a button for each of the thirty-one times
  await expect(page.getByRole('radio', { name: /sec|min/ })).toHaveCount(0);

  await slider.fill('90');
  await expect(timeShown(page)).toHaveText('1 min 30 sec');
  await expect(slider).toHaveAttribute('aria-valuetext', '1 min 30 sec');
  await page.getByRole('button', { name: 'More time' }).click();
  await expect(timeShown(page)).toHaveText('1 min 40 sec');
  await page.getByRole('button', { name: 'Less time' }).click();
  await page.getByRole('button', { name: 'Less time' }).click();
  await expect(timeShown(page)).toHaveText('1 min 20 sec');

  await slider.focus();
  await page.keyboard.press('Home');
  await expect(timeShown(page)).toHaveText('No limit');
  await page.keyboard.press('ArrowRight');
  await expect(timeShown(page)).toHaveText('10 sec');
  await page.keyboard.press('End');
  await expect(timeShown(page)).toHaveText('5 min');
  await expect(page.getByRole('button', { name: 'More time' })).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expect(timeShown(page)).toHaveText('4 min 50 sec');

  await page.getByRole('radio', { name: '3', exact: true }).check();
  await page.getByRole('button', { name: 'Start game' }).click();
  await roundReady(page);
  await expect(page).toHaveURL(/seed=[a-z0-9]{8}&t=290&mode=move&n=3/);
  await expect(page.locator('.hud')).toContainText(/4:(50|4\d)/);
});

test('a challenge link opens with any of the new times, and with the three older ones', async ({ page }) => {
  await mockServices(page);
  await page.goto('/?map=world&seed=e2e00001&t=250&mode=move&n=3');
  await expect(page.getByText('World · 3 rounds · 4 min 10 sec · move')).toBeVisible();
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await expect(page.locator('.hud')).toContainText(/4:(10|0\d)/);
  await expect(page).toHaveURL(/seed=e2e00001&t=250&mode=move&n=3/);

  for (const [seconds, words] of [
    [30, '30 sec'],
    [60, '1 min'],
    [120, '2 min'],
    [10, '10 sec'],
  ] as const) {
    await page.goto(`/?map=world&seed=e2e00001&t=${seconds}&mode=move&n=5`);
    await expect(page.getByText(`World · 5 rounds · ${words} · move`)).toBeVisible();
  }
  // a time that is not one of them is read as no limit, as before
  await page.goto('/?map=world&seed=e2e00001&t=45&mode=move&n=5');
  await expect(page.getByText('World · 5 rounds · No limit · move')).toBeVisible();
});

test('the streak takes the same times', async ({ page }) => {
  await mockServices(page);
  await signIn(page, null);
  await page.goto('/#streak');
  await timeSlider(page).fill('20');
  await expect(timeShown(page)).toHaveText('20 sec');
  await page.getByRole('button', { name: 'Start streak' }).click();
  await roundReady(page);
  await expect(page.locator('.hud')).toContainText(/0:(20|1\d)/);
});

test('road names are hidden until switched on, and the choice is remembered', async ({ page }) => {
  await mockServices(page);
  await page.goto('/');
  const row = page.getByRole('group', { name: 'Road names on the map' });
  await expect(row.getByRole('radio', { name: 'Hidden' })).toBeChecked();
  expect(await stored(page, 'plonk.road-names')).toBeNull();

  await row.getByRole('radio', { name: 'Shown' }).check();
  expect(await stored(page, 'plonk.road-names')).toBe('1');
  await page.reload();
  await expect(page.getByRole('group', { name: 'Road names on the map' }).getByRole('radio', { name: 'Shown' })).toBeChecked();

  await page.getByRole('group', { name: 'Road names on the map' }).getByRole('radio', { name: 'Hidden' }).check();
  expect(await stored(page, 'plonk.road-names')).toBe('0');
  // it is this player's map, not part of the game: a link does not carry it
  await page.getByRole('button', { name: 'Start game' }).click();
  await roundReady(page);
  expect(page.url()).not.toContain('road');
});

/** Answers the round on screen with the button called `pick`, checks how it was marked, and moves on. */
async function answer(page: Page, question: string, pick: string, right: string, round: number): Promise<void> {
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
  const panel = guesserPanel(page, question);
  await expect(panel.locator('.guesser-option')).toHaveCount(6);
  await expect(page.locator('.hud')).toContainText(`${round} / ${GUESSER_ROUNDS}`);
  await panel.locator('.guesser-option').filter({ hasText: pick }).first().click();

  await expect(play(page)).toHaveAttribute('data-phase', 'result');
  // the right one is marked at once, whatever was pressed, and no button takes a second answer
  await expect(panel.locator('.guesser-option[data-state="right"]')).toHaveText(new RegExp(`${right}\\s*Correct`));
  await expect(panel.locator('.guesser-option:enabled')).toHaveCount(0);
  if (pick === right) {
    await expect(panel.getByRole('status')).toHaveText(`Correct: ${right}`);
    await expect(panel.locator('.guesser-option[data-state="wrong"]')).toHaveCount(0);
  } else {
    await expect(panel.getByRole('status')).toHaveText(`Wrong. It was ${right}.`);
    await expect(panel.locator('.guesser-option[data-state="wrong"]')).toHaveText(new RegExp(`${pick}\\s*Wrong`));
  }
  await expect(page.locator('.pin-actual')).toHaveCount(1);
  await panel.getByRole('button', { name: round === GUESSER_ROUNDS ? 'See summary' : 'Next round' }).click();
}

/** The name on a wrong button of the round on screen: any country but the right one. */
async function wrongOption(page: Page, question: string, right: string): Promise<string> {
  const names = await guesserPanel(page, question).locator('.guesser-name').allTextContents();
  return names.find((name) => name !== right)!;
}

test('a Country Guesser run: ten rounds of six countries, 1,000 points a right answer, saved at the end', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page, KENYA_ONLY);
  await signIn(page, 'neel', 1000, { bestCountry: 4000 });
  const games = await GamesServer.install(page);
  games.best = { country: 4000, continent: 0 };

  await page.goto('/');
  await page.getByRole('link', { name: 'Country Guesser' }).click();
  await expect(page).toHaveURL(/#country$/);
  await expect(page.locator('.pane-title')).toHaveText('Country Guesser');
  await expect(page.getByText('Your best score: 4,000 of 10,000')).toBeVisible();
  await page.getByRole('button', { name: 'Start game' }).click();

  const question = 'Which country is this?';
  await expect(guesserPanel(page, question)).toBeVisible();
  // no pin map in this game, and no hint
  await expect(page.locator('.map-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: /^Hint/ })).toBeHidden();
  // each button is a flag and a country, the wrong ones from the same continent
  const options = guesserPanel(page, question).locator('.guesser-option');
  await expect(options.filter({ hasText: 'Kenya' })).toHaveCount(1);
  await expect(options.locator('.flag')).toHaveCount(6);
  expect(new Set(await options.locator('.guesser-name').allTextContents()).size).toBe(6);

  for (let round = 1; round <= GUESSER_ROUNDS; round++) {
    await expect(guesserPanel(page, question).locator('.guesser-option:enabled')).toHaveCount(6);
    // three wrong answers, then seven right ones
    await answer(page, question, round <= 3 ? await wrongOption(page, question, 'Kenya') : 'Kenya', 'Kenya', round);
    if (round < GUESSER_ROUNDS) {
      await expect(page.locator('.hud-score')).toContainText((Math.max(0, round - 3) * 1000).toLocaleString('en-US'));
    }
  }

  const summary = page.getByRole('region', { name: 'Game summary' });
  await expect(summary.locator('.figure-value')).toHaveText('7,000 / 10,000');
  await expect(summary.locator('tbody tr')).toHaveCount(10);
  await expect(summary.locator('tbody tr[data-correct="true"]')).toHaveCount(7);
  await expect(summary.locator('tbody tr').nth(9).locator('td')).toHaveText(['10', /Kenya/, 'Correct']);
  await expect(summary).toContainText('Your best score is 7,000. +140 XP.');
  await expect(page.locator('.pin-actual')).toHaveCount(10);
  // the run was begun on the server as the game began, and is finished with what was played: the place of each round and the
  // country chosen. The server does the counting
  expect(games.starts).toEqual([{ action: 'start', kind: 'country' }]);
  expect(games.saved).toEqual([{ kind: 'country', run: 'run.1.country', rounds: expect.any(Array) }]);
  const sent = games.saved[0]!.rounds as Array<{ id: string; answer: string }>;
  expect(sent).toHaveLength(GUESSER_ROUNDS);
  expect(sent.every((round) => /^ke-\d\d$/.test(round.id))).toBe(true);
  expect(new Set(sent.map((round) => round.id)).size).toBe(GUESSER_ROUNDS);
  // three wrong countries, then Kenya seven times
  expect(sent.slice(0, 3).every((round) => /^[A-Z]{2}$/.test(round.answer) && round.answer !== 'KE')).toBe(true);
  expect(sent.slice(3).map((round) => round.answer)).toEqual(Array.from({ length: 7 }, () => 'KE'));

  // another run is another seed, and Home goes back to the game's own pane
  await summary.getByRole('button', { name: 'Play again' }).click();
  await expect(guesserPanel(page, question)).toBeVisible();
  await expect(page.locator('.hud')).toContainText('1 / 10');
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.locator('.pane-title')).toHaveText('Country Guesser');
  expect(games.saved).toHaveLength(1);
});

test('a Continent Guesser run: the six continents every round, and a perfect score saved', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page, KENYA_ONLY);
  await signIn(page, 'neel');
  const games = await GamesServer.install(page);

  await page.goto('/#continent');
  await expect(page.locator('.pane-title')).toHaveText('Continent Guesser');
  await expect(page.getByText('Your best score: 0 of 10,000')).toBeVisible();
  await page.getByRole('button', { name: 'Start game' }).click();

  const question = 'Which continent is this?';
  await expect(guesserPanel(page, question).locator('.guesser-name')).toHaveText(['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America']);
  for (let round = 1; round <= GUESSER_ROUNDS; round++) {
    await answer(page, question, 'Africa', 'Africa', round);
  }

  const summary = page.getByRole('region', { name: 'Game summary' });
  await expect(summary.locator('.figure-value')).toHaveText('10,000 / 10,000');
  await expect(summary).toContainText('Your best score is 10,000. +200 XP.');
  // begun on the server, and finished with each round's place and the continent chosen
  expect(games.starts).toEqual([{ action: 'start', kind: 'continent' }]);
  expect(games.saved).toEqual([{ kind: 'continent', run: 'run.1.continent', rounds: Array.from({ length: GUESSER_ROUNDS }, () => ({ id: expect.stringMatching(/^ke-\d\d$/), answer: 'africa' })) }]);
});

test('signed out, a guesser is playable and the end screen says the score is not kept', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page, KENYA_ONLY);
  await signIn(page, null);
  const games = await GamesServer.install(page);
  games.session = 'none';

  await page.goto('/#country');
  await expect(page.getByText(/Your best score/)).toBeHidden();
  await page.getByRole('button', { name: 'Start game' }).click();
  const question = 'Which country is this?';
  for (let round = 1; round <= GUESSER_ROUNDS; round++) {
    await answer(page, question, 'Kenya', 'Kenya', round);
  }
  const summary = page.getByRole('region', { name: 'Game summary' });
  await expect(summary.locator('.figure-value')).toHaveText('10,000 / 10,000');
  await expect(summary).toContainText('You are not signed in, so this score is not kept.');
  expect(games.saved).toEqual([]);
});

test('a guesser place that will not load can be tried again or skipped, and the round stays the same', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page, KENYA_ONLY);
  await signIn(page, null);
  let failures = 2;
  await page.route('https://img.plonk.test/**/sd.jpg', (route) => (failures-- > 0 ? route.abort() : route.fallback()));

  await page.goto('/#country');
  await page.getByRole('button', { name: 'Start game' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('This view would not load.');
  await expect(alert.getByRole('button')).toHaveText(['Try again', 'Skip this place', 'Exit']);
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(alert).toContainText('This view would not load.');
  await alert.getByRole('button', { name: 'Skip this place' }).click();

  // the place after it takes the round: still the first of ten, nothing scored
  await answer(page, 'Which country is this?', 'Kenya', 'Kenya', 1);
  await expect(page.locator('.hud-score')).toContainText('1,000');
});

test('leaving a guesser run part way asks first, and saves nothing', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page, KENYA_ONLY);
  await signIn(page, 'neel');
  const games = await GamesServer.install(page);

  await page.goto('/#continent');
  await page.getByRole('button', { name: 'Start game' }).click();
  await answer(page, 'Which continent is this?', 'Asia', 'Africa', 1);
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.getByRole('dialog')).toContainText('Leave this game?');
  await page.getByRole('button', { name: 'Leave game' }).click();
  await expect(page.locator('.pane-title')).toHaveText('Continent Guesser');
  expect(games.saved).toEqual([]);
});

test('the volume slider is remembered, and gives way to the sound switch', async ({ page }) => {
  await mockServices(page);
  await signIn(page, null);
  await page.goto('/#account');
  const volume = page.getByRole('slider', { name: 'Volume' });
  await expect(volume).toHaveValue('50');
  await expect(page.locator('.volume-value')).toHaveText('50%');

  await volume.fill('80');
  await expect(page.locator('.volume-value')).toHaveText('80%');
  await expect(volume).toHaveAttribute('aria-valuetext', '80%');
  expect(await stored(page, 'plonk.volume')).toBe('80');
  await volume.focus();
  await page.keyboard.press('ArrowLeft');
  expect(await stored(page, 'plonk.volume')).toBe('75');

  await page.reload();
  await expect(page.getByRole('slider', { name: 'Volume' })).toHaveValue('75');
  await expect(page.locator('.volume-value')).toHaveText('75%');

  // muting keeps the level
  await page.getByRole('radio', { name: 'Off', exact: true }).check();
  await expect(page.getByRole('slider', { name: 'Volume' })).toBeDisabled();
  await page.getByRole('radio', { name: 'On', exact: true }).check();
  await expect(page.getByRole('slider', { name: 'Volume' })).toBeEnabled();
  await expect(page.getByRole('slider', { name: 'Volume' })).toHaveValue('75');
});

test.describe('in a browser set to US English', () => {
  test.use({ locale: 'en-US' });

  test('distances are in miles until the player chooses otherwise', async ({ page }) => {
    await mockServices(page, { units: 'browser' });
    await signIn(page, null);
    await page.goto('/#account');
    await expect(page.getByRole('radio', { name: 'Miles' })).toBeChecked();
    expect(await stored(page, 'plonk.units')).toBeNull();

    await page.goto('/?map=world&seed=e2e00001&t=0&mode=move&n=3');
    await page.getByRole('button', { name: 'Play challenge' }).click();
    await roundReady(page);
    await page.locator('.map-panel').hover();
    await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 150 } });
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Round result' })).toContainText(/\d (mi|ft)/);

    await page.goto('/#account');
    await page.getByRole('radio', { name: 'Kilometres' }).check();
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Kilometres' })).toBeChecked();
  });
});

test.describe('in a browser set to UK English', () => {
  test.use({ locale: 'en-GB' });

  test('distances start in miles too', async ({ page }) => {
    await mockServices(page, { units: 'browser' });
    await signIn(page, null);
    await page.goto('/#account');
    await expect(page.getByRole('radio', { name: 'Miles' })).toBeChecked();
  });
});

test.describe('in a browser set to anything else', () => {
  test.use({ locale: 'en-AU' });

  test('distances start in kilometres', async ({ page }) => {
    await mockServices(page, { units: 'browser' });
    await signIn(page, null);
    await page.goto('/#account');
    await expect(page.getByRole('radio', { name: 'Kilometres' })).toBeChecked();
  });
});

test('a second game from the pane avoids the places of the first, and a challenge link still repeats them', async ({ page }) => {
  const shown = await mockServices(page);
  await mockPlaces(page, TWELVE_PLACES);
  await signIn(page, null);

  const playFromPane = async (): Promise<{ places: string[]; address: string }> => {
    const before = shown.length;
    await page.goto('/');
    await page.getByRole('radio', { name: '3', exact: true }).check();
    await page.getByRole('button', { name: 'Start game' }).click();
    await roundReady(page);
    const address = page.url();
    await playLocalGame(page, 3);
    return { places: shown.slice(before), address };
  };

  const first = await playFromPane();
  expect(new Set(first.places).size).toBe(3);
  // what was shown is remembered in this browser, by id
  expect(JSON.parse((await stored(page, 'plonk.seen-places')) ?? '[]').sort()).toEqual([...first.places].sort());

  const second = await playFromPane();
  expect(new Set(second.places).size).toBe(3);
  expect(second.places.filter((id) => first.places.includes(id))).toEqual([]);

  // the first game's own link: the same three places in the same order, seen or not
  const before = shown.length;
  await page.goto(first.address);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await playLocalGame(page, 3);
  expect(shown.slice(before)).toEqual(first.places);
});

test('a guesser run steers clear of places already shown', async ({ page }) => {
  const shown = await mockServices(page);
  // twenty places: one run shows ten of them, so the next has exactly the other ten to take
  await mockPlaces(page, { ...KENYA_ONLY, locations: KENYA_ONLY.locations.slice(0, 20) });
  await signIn(page, null);

  const run = async (): Promise<string[]> => {
    const before = shown.length;
    await page.goto('/#continent');
    await page.getByRole('button', { name: 'Start game' }).click();
    for (let round = 1; round <= GUESSER_ROUNDS; round++) {
      await answer(page, 'Which continent is this?', 'Africa', 'Africa', round);
    }
    await expect(page.getByRole('region', { name: 'Game summary' })).toBeVisible();
    return shown.slice(before);
  };

  const first = await run();
  const second = await run();
  expect(new Set(first).size).toBe(10);
  expect(new Set([...first, ...second]).size).toBe(20);
});

test('the About pane says what Wherefall is, how it scores, who to credit and what changed', async ({ page }) => {
  await mockServices(page);
  await signIn(page, null);
  await page.goto('/');
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await expect(page).toHaveURL(/#about$/);
  await expect(page.locator('.pane-title')).toHaveText('About');
  await expect(page.getByRole('link', { name: 'About', exact: true })).toHaveAttribute('aria-current', 'page');

  const about = page.locator('.about');
  await expect(about.getByRole('heading', { level: 3 })).toHaveText(['What Wherefall is', 'How scoring works', 'Questions', 'Credits', 'What is new']);
  // the rule as it is played: 5,000 a round, perfect within 30 m, a 20,000 km world scale, a map's own size otherwise, hints halve
  const scoring = about.locator('.about-section').nth(1);
  await expect(scoring).toContainText('up to 5,000 points');
  await expect(scoring).toContainText('within 30 m');
  await expect(scoring).toContainText('20,000 km');
  await expect(scoring).toContainText('scored on its own size');
  await expect(scoring).toContainText('halves that round');
  await expect(about.locator('.about-question')).toHaveCount(5);

  const credits = about.locator('.about-section').nth(3);
  await expect(credits).toContainText('Google Street View');
  await expect(credits).toContainText('OpenStreetMap');
  await expect(credits.getByRole('link', { name: 'Panoramax' })).toHaveAttribute('href', 'https://panoramax.fr');
  await expect(credits.getByRole('link', { name: 'OpenFreeMap' })).toHaveAttribute('href', 'https://openfreemap.org');
  await expect(credits.locator('li')).toHaveCount(4);
  await expect(about.locator('.about-change dt')).toHaveText(['Update 5', 'Update 4', 'Update 3', 'Update 2', 'Update 1']);

  await page.reload();
  await expect(page.locator('.pane-title')).toHaveText('About');
});

for (const size of [
  { width: 1360, height: 840 },
  { width: 390, height: 800 },
]) {
  test(`at ${size.width}x${size.height} the six buttons sit clear of the HUD and fit the screen`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockServices(page);
    await mockPlaces(page, KENYA_ONLY);
    await signIn(page, null);
    await page.goto('/#country');
    await page.getByRole('button', { name: 'Start game' }).click();
    const panel = guesserPanel(page, 'Which country is this?');
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    const hud = (await page.locator('.hud').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    expect(box.y).toBeGreaterThan(hud.y + hud.height);
    // the compass and its buttons are not under the panel: beside it at the foot of the rail on a wide screen, above it at the foot of the view on a phone
    const tools = (await page.locator('.pano-tools').boundingBox())!;
    if (size.width > 720) {
      expect(tools.x + tools.width).toBeLessThanOrEqual(box.x);
    } else {
      expect(tools.y + tools.height).toBeLessThanOrEqual(box.y);
    }
    for (const option of await panel.locator('.guesser-option').all()) {
      expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
}

// Each new pane and a guesser round, in German and Russian on a phone: every text from the
// language's catalog, nothing wider than its control, nothing past the edge of the screen.
for (const code of ['de', 'ru']) {
  const say = CATALOGS[code]!;

  test.describe(`${code} on a phone`, () => {
    test.use({ viewport: { width: 390, height: 800 } });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
      await mockServices(page);
      await mockPlaces(page, KENYA_ONLY);
    });

    for (const [address, title] of [
      ['/', 'nav.item.singleplayer'],
      ['/#streak', 'nav.item.streak'],
      ['/#country', 'nav.item.country'],
      ['/#continent', 'nav.item.continent'],
      ['/#about', 'nav.item.about'],
    ] as const) {
      test(`${address} is in the language, with nothing spilling`, async ({ page }) => {
        await signIn(page, 'neel', 1000, { bestCountry: 9000, bestContinent: 10_000 });
        await page.goto(address);
        await expect(page.locator('html')).toHaveAttribute('lang', code);
        await expect(page.locator('.pane-title')).toHaveText(say[title]);
        if (address === '/' || address === '/#streak') {
          // the longest a time is written
          await timeSlider(page, say['label.timePerRound']).fill('290');
        }
        await expectTranslated(page, code);
        // and with the menu open, where the new items are
        await page.getByRole('button', { name: say['home.menu'] }).click();
        await expect(page.getByRole('link', { name: say['nav.item.about'], exact: true })).toBeVisible();
        await expectTranslated(page, code);
      });
    }

    test('the settings a visitor sees are in the language', async ({ page }) => {
      await signIn(page, null);
      await page.goto('/#account');
      await expect(page.getByRole('slider', { name: say['prefs.volume'] })).toBeVisible();
      // each language is listed under its own name, whatever the language in use
      await expectTranslated(page, code, Object.values(LANGUAGE_NAMES));
    });

    for (const kind of ['country', 'continent'] as const) {
      test(`a ${kind} guesser round, its answer and its end are in the language`, async ({ page }) => {
        await signIn(page, null);
        await page.goto(`/#${kind}`);
        await page.getByRole('button', { name: say['singleplayer.start'] }).click();
        const panel = guesserPanel(page, say[`guesser.${kind}.ask`]);
        await expect(panel.locator('.guesser-option')).toHaveCount(6);
        await expect(page.locator('.status')).toBeEmpty();
        await expectTranslated(page, code);

        // a wrong answer marks two buttons, which is the most a round has to fit
        await panel.locator('.guesser-option').nth(kind === 'continent' ? 1 : 0).click();
        await expect(play(page)).toHaveAttribute('data-phase', 'result');
        await expectTranslated(page, code);
        await panel.locator('[data-action="next"]').click();

        for (let round = 2; round <= GUESSER_ROUNDS; round++) {
          const next = guesserPanel(page, say[`guesser.${kind}.ask`]);
          await expect(next.locator('.guesser-option:enabled')).toHaveCount(6);
          await next.locator('.guesser-option').first().click();
          await next.locator('[data-action="next"]').click();
        }
        await expect(page.getByRole('region', { name: say['summary.label'] })).toContainText(say['guesser.save.signedOut']);
        await expectTranslated(page, code);
      });
    }
  });
}
