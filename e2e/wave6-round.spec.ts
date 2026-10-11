import { expect, test, type Page } from '@playwright/test';
import { RUSSIA_ONLY, mockPlaces, mockServices } from './fixtures.ts';
import { GamesServer } from './games-server.ts';
import { play, roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated, type Catalog } from './language-checks.ts';
import { guessInScene, openScene, revealScene } from './match-scenes.ts';
import { signIn } from './match-server.ts';
import { DESKTOPS, EDGE, LANGUAGES, PHONE, box, boxesOf, clashes, stored, useLanguage, type Box } from './round-boxes.ts';

// The round screen after the second design review: the guessers laid out as every other round is,
// the summary's foot and its country column on a phone, and names on a crowded reveal. The hybrid
// map is in `wave6-map.spec.ts`, the country streak of ordinary play in `wave6-streak.spec.ts`.

// --- N1: a guesser's round is laid out as every other round is ---------------------------------------

type Row = [id: string, lng: number, lat: number, country: string];

/**
 * Six countries of one continent, so every round's six buttons are these: the ones with the longest
 * names there are in German and Russian (the British Indian Ocean Territory, the Central African
 * Republic, South Africa as Russian has it), and two short ones beside them.
 */
const LONG_NAMED = ['IO', 'CF', 'CD', 'GQ', 'ST', 'ZA'];
const LONG_NAMES = {
  version: 1,
  regions: Object.fromEntries(LONG_NAMED.map((code) => [code, 'africa'])),
  locations: LONG_NAMED.flatMap((country, c) => Array.from({ length: 6 }, (_, i): Row => [`${country.toLowerCase()}-${i}`, 20 + c + i * 0.1, -5 + i * 0.1, country])),
};

/** what stands over the view of a guesser's round while it is played */
const OVER_GUESSER = ['.hud', '.compass', '.pano-tools .return', '.credit', '.panel-host > *', '.move-arrow', '.map-panel', '.map-toggle'];
/** what stands over the map once the answer is in */
const OVER_ANSWER = ['.hud', '.panel-host > *', '.map-zoom', '.maplibregl-ctrl-attrib-button'];

async function openGuesser(page: Page, kind: 'country' | 'continent', code: string): Promise<Catalog> {
  const say = CATALOGS[code]!;
  await useLanguage(page, code);
  await mockServices(page);
  await mockPlaces(page, LONG_NAMES);
  await page.goto(`/#${kind}`);
  await page.getByRole('button', { name: say['singleplayer.start'] }).click();
  await roundReady(page);
  await expect(page.locator('.guesser-option:enabled')).toHaveCount(6);
  await expect(page.locator('.move-arrow').first()).toBeVisible();
  return say;
}

/** The compass and the way back as a round with the same tools has them at this size: a country streak's, which has no hint either. */
async function toolsOfAnotherRound(page: Page): Promise<Box[]> {
  await mockServices(page);
  await mockPlaces(page, LONG_NAMES);
  await page.goto('/#streak');
  await page.getByRole('button', { name: 'Start streak' }).click();
  await roundReady(page);
  await expect(page.locator('.pano-tools .return')).toBeVisible();
  return boxesOf(page, ['.compass', '.pano-tools .return', '.credit']);
}

for (const viewport of [PHONE, ...DESKTOPS]) {
  const phone = viewport.width <= 720;
  const size = `${viewport.width}x${viewport.height}`;

  test.describe(`a guesser at ${size}`, () => {
    test.use({ viewport });

    for (const kind of ['country', 'continent'] as const) {
      for (const code of LANGUAGES) {
        test(`the ${kind} guesser's round in ${code}: nothing lies on anything, the walk arrow is in reach, and the buttons hold their names`, async ({ page }) => {
          const say = await openGuesser(page, kind, code);
          const screen = page.viewportSize()!;
          // (the view takes a frame or two to redraw its arrow at the size the buttons leave it)
          await expect.poll(() => clashes(page, OVER_GUESSER)).toEqual([]);

          // the six buttons: inside their panel, big enough for a finger, and none cutting its name short
          const [panel, options] = [await box(page, '.panel-host > *'), await boxesOf(page, ['.guesser-option'])];
          expect(options).toHaveLength(6);
          for (const option of options) {
            expect(option.bottom - option.top).toBeGreaterThanOrEqual(44);
            expect(option.left).toBeGreaterThanOrEqual(panel.left);
            expect(option.right).toBeLessThanOrEqual(panel.right);
          }
          expect(await page.locator('.guesser-option').evaluateAll((buttons) => buttons.filter((button) => button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1).length)).toBe(0);

          const [compass, back, arrow] = [await box(page, '.compass'), await box(page, '.pano-tools .return'), await box(page, '.move-arrow')];
          if (phone) {
            // the view ends where the buttons begin, and they run from edge to edge under it, as the map's sheet does
            expect([panel.left, panel.right, panel.bottom]).toEqual([0, screen.width, screen.height]);
            // the compass and the way back: the column of two 44px buttons at the left edge, at the foot of the view
            for (const tool of [compass, back]) {
              expect([tool.left, tool.right - tool.left, tool.bottom - tool.top]).toEqual([EDGE, 44, 44]);
            }
            expect(compass.bottom).toBeLessThanOrEqual(back.top);
            expect(Math.abs(panel.top - EDGE - back.bottom)).toBeLessThanOrEqual(1);
            // the walk arrow is whole, and above the buttons
            expect(arrow.bottom).toBeLessThanOrEqual(panel.top);
          } else {
            // the buttons stand where the guess map does in other games: at the foot of the screen on the right, the closed map's width
            expect([panel.right, panel.bottom, panel.right - panel.left]).toEqual([screen.width - EDGE, screen.height - EDGE, 320]);
            expect(panel.top).toBeGreaterThanOrEqual(88);
            // the compass and the way back are at the foot of the rail, clear of them
            expect(compass.left).toBe(EDGE);
            expect(back.right).toBeLessThan(panel.left);
            expect(compass.top).toBeGreaterThan(screen.height / 2);
          }

          // in reach: nothing is over the arrow, and a press on it walks (the way back then has somewhere to go back to)
          const middle = { x: (arrow.left + arrow.right) / 2, y: (arrow.top + arrow.bottom) / 2 };
          expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.move-arrow') !== null, middle)).toBe(true);
          await expect(page.locator('.pano-tools .return')).toBeDisabled();
          await page.mouse.click(middle.x, middle.y);
          await expect(page.locator('.pano-tools .return')).toBeEnabled();
          await expectTranslated(page, code);

          // the answer in: the buttons stay where they were, with the way on under them, clear of the map's own buttons
          await page.locator('.guesser-option').nth(1).click();
          await expect(play(page)).toHaveAttribute('data-phase', 'result');
          await expect(page.getByRole('button', { name: say['result.next'] })).toBeVisible();
          await page.waitForTimeout(300);
          expect(await clashes(page, OVER_ANSWER)).toEqual([]);
          const answered = await box(page, '.panel-host > *');
          expect([answered.left, answered.right, answered.bottom]).toEqual([panel.left, panel.right, panel.bottom]);
          await expect(page.locator('.panel-host .button.accent')).toHaveCount(1);
          expect(await page.locator('.guesser-option').evaluateAll((buttons) => buttons.filter((button) => button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1).length)).toBe(0);
          await expectTranslated(page, code);
        });
      }
    }

    if (!phone) {
      test('the compass, the way back and the credit are exactly where a round of another game has them', async ({ page }) => {
        const other = await toolsOfAnotherRound(page);
        expect(other).toHaveLength(3);
        await page.goto('/#country');
        await page.getByRole('button', { name: 'Start game' }).click();
        await roundReady(page);
        expect(await boxesOf(page, ['.compass', '.pano-tools .return', '.credit'])).toEqual(other);
      });
    }
  });
}

test('a guesser’s buttons are on screen while the view loads, and take no press until it has', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page, LONG_NAMES);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('https://api.panoramax.xyz/api/search**', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/#country');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.status')).not.toBeEmpty();
  release();
  await roundReady(page);
  await expect(page.locator('.guesser-option:enabled')).toHaveCount(6);
  // the next round: the buttons are there, and dead, while its picture is on its way
  await page.locator('.guesser-option').first().click();
  await page.route('https://img.plonk.test/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Next round' }).click();
  await expect(page.locator('.guesser-option:disabled')).toHaveCount(6);
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
  await expect(page.locator('.guesser-option:enabled')).toHaveCount(6);
});

// --- the summary on a phone ------------------------------------------------------------------------

test.describe('the summary on a phone', () => {
  test.use({ viewport: PHONE });

  for (const code of LANGUAGES) {
    test(`in ${code}: two buttons on one row at the foot, the rest above them, and a country by its flag and two letters`, async ({ page }) => {
      test.setTimeout(60_000);
      const say = CATALOGS[code]!;
      await useLanguage(page, code);
      await mockServices(page);
      await mockPlaces(page, RUSSIA_ONLY);
      // a visitor: what became of the score is then one sentence of the catalog, with no name in it
      await signIn(page, null);
      await page.goto('/?map=world&seed=e2e00001&t=120&mode=move&n=5');
      await page.getByRole('button', { name: say['singleplayer.playChallenge'] }).click();
      for (let round = 1; round <= 5; round++) {
        await roundReady(page);
        await page.getByRole('button', { name: say['round.openMap'] }).click();
        await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 200 } });
        await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
        await page.getByRole('button', { name: round === 5 ? say['result.seeSummary'] : say['result.next'] }).click();
      }
      const summary = page.getByRole('region', { name: say['summary.label'] });
      await expect(summary.locator('.status-note')).toBeVisible();

      // the foot: the way on, in the accent, and the way home, side by side, each on one line
      const foot = summary.locator('.panel-actions > *');
      await expect(foot).toHaveText([say['play.again']!, say['common.home']!]);
      await expect(foot.first()).toHaveClass(/\baccent\b/);
      const buttons = await boxesOf(page, ['.panel-actions > *']);
      expect(new Set(buttons.map((button) => Math.round(button.top))).size).toBe(1);
      expect(await foot.evaluateAll((all) => all.map((button) => button.getClientRects().length && Math.round(button.getBoundingClientRect().height)))).toEqual([44, 44]);

      // sharing is in the panel's own part: each button on one line, big enough for a finger
      const share = summary.locator('.share-actions > *');
      await expect(share).toHaveText([say['summary.shareResult']!, say['summary.copyLink']!]);
      expect(await share.evaluateAll((all) => all.map((button) => Math.round(button.getBoundingClientRect().height)))).toEqual([44, 44]);
      expect(await share.evaluateAll((all) => all.filter((button) => button.scrollWidth > button.clientWidth + 1).length)).toBe(0);

      // what became of the score is whole at rest, and scrolls with the rest above the bar
      const [bar, note] = [await box(page, '.panel-actions'), await box(page, '.summary-panel .status-note')];
      expect(note.bottom).toBeLessThanOrEqual(bar.top);
      await summary.evaluate((panel) => panel.scrollTo(0, panel.scrollHeight));
      const [barAfter, last] = [await box(page, '.panel-actions'), (await boxesOf(page, ['.share-actions > *'])).at(-1)!];
      expect(barAfter.top - last.bottom).toBeGreaterThanOrEqual(12);
      expect(Math.abs(barAfter.bottom - (PHONE.height - EDGE))).toBeLessThanOrEqual(1);

      // the country column: the flag, and the two letters a reader who does not know the flag can go by
      const country = summary.locator('tbody .country').first();
      await expect(country.locator('.country-name')).toBeHidden();
      expect(await country.evaluate((cell) => getComputedStyle(cell, '::after').content)).toBe('"RU"');
      await expectTranslated(page, code);
    });
  }

  test('a wide screen names the country in full, with no letters after it', async ({ page }) => {
    await page.setViewportSize(DESKTOPS[0]);
    await mockServices(page);
    await mockPlaces(page, RUSSIA_ONLY);
    await page.goto('/?map=world&seed=e2e00001&t=0&mode=move&n=3');
    await page.getByRole('button', { name: 'Play challenge' }).click();
    await roundReady(page);
    await page.locator('.map-panel').hover();
    await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 150 } });
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
    const country = page.getByRole('region', { name: 'Round result' }).locator('.country');
    await expect(country.locator('.country-name')).toHaveText('Russia');
    expect(await country.evaluate((cell) => getComputedStyle(cell, '::after').content)).toBe('none');
  });
});

test('the daily’s summary has one way on at its foot, and sharing above it', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await mockServices(page);
  const { DailyServer } = await import('./daily-server.ts');
  await signIn(page, 'neel');
  const daily = await DailyServer.install(page, 'account');
  await GamesServer.install(page, daily);
  await page.goto('/#daily');
  await page.getByRole('button', { name: "Play today's challenge" }).click();
  for (let round = 1; round <= 3; round++) {
    await roundReady(page);
    await page.getByRole('button', { name: 'Open map' }).click();
    await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 200 } });
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
    // the daily counts no country streak
    await expect(page.locator('.streak-line')).toHaveCount(0);
    await page.getByRole('button', { name: round === 3 ? 'See summary' : 'Next round' }).click();
  }
  const summary = page.getByRole('region', { name: 'Game summary' });
  await expect(summary.locator('.panel-actions > *')).toHaveText(['Home']);
  await expect(summary.locator('.panel-actions .button.accent')).toHaveCount(1);
  await expect(summary.locator('.share-actions > *')).toHaveText(['Share result']);
  expect(await stored(page, 'plonk.world-streak')).toBeNull();
});

// --- names on a crowded reveal ----------------------------------------------------------------------

for (const viewport of [PHONE, DESKTOPS[0]]) {
  test(`twenty players' names on a reveal do not lie on one another at ${viewport.width}x${viewport.height}, and a bare pin gives its name when asked`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { server, scene, say } = await openScene(page, 'twenty', 'en');
    await guessInScene(page, say);
    await revealScene(page, server, scene);
    await expect(page.locator('.pin-guess')).toHaveCount(1);
    // the fit comes to rest, and the names are sorted out for where the pins then are
    await page.waitForTimeout(1200);

    const others = page.locator('.pin-other');
    expect(await others.count()).toBeGreaterThan(5);
    // the viewer's own pin always has its name
    await expect(page.locator('.pin-guess .pin-name')).toBeVisible();
    await expect(page.locator('.pin-guess')).not.toHaveClass(/\bbare\b/);
    // no name lies on another, on the place or on the viewer's pin
    const named = await page.evaluate(() =>
      [...document.querySelectorAll('.pin-actual, .pin-guess, .pin-other:not(.bare)')].map((pin) => {
        const at = pin.getBoundingClientRect();
        return { left: at.left, top: at.top, right: at.right, bottom: at.bottom };
      }),
    );
    const lying = named.flatMap((one, index) => named.slice(index + 1).filter((other) => one.left < other.right && other.left < one.right && one.top < other.bottom && other.top < one.bottom));
    expect(lying).toEqual([]);
    // every name is still on the page for whoever asks, and no pin is an empty bar: a bare one is a small square
    expect(await others.evaluateAll((pins) => pins.every((pin) => (pin.textContent ?? '').trim().length > 0))).toBe(true);
    const bare = page.locator('.pin-other.bare');
    if ((await bare.count()) > 0) {
      const pin = bare.last();
      const mark = (await pin.boundingBox())!;
      expect([mark.width, mark.height]).toEqual([16, 16]);
      await expect(pin.locator('.pin-name')).toBeHidden();
      // a tap puts its name on, over its neighbours; another takes it off
      await pin.dispatchEvent('click');
      await expect(pin).toHaveClass(/\bnamed\b/);
      await expect(pin.locator('.pin-name')).toBeVisible();
      await pin.dispatchEvent('click');
      await expect(pin.locator('.pin-name')).toBeHidden();
    }
  });
}

// --- the tutorial's tip over a result ----------------------------------------------------------------

for (const viewport of [PHONE, DESKTOPS[0]]) {
  test(`the tutorial's tip lies on neither the place nor the guess over a result at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockServices(page);
    await page.goto('/');
    await page.getByRole('region', { name: 'How to play' }).getByRole('button', { name: 'Play the tutorial' }).click();
    await roundReady(page);
    if (viewport.width <= 720) {
      await page.getByRole('button', { name: 'Open map' }).click();
    } else {
      await page.locator('.map-panel').hover();
    }
    // a guess far to the north-west of the place: the pair runs up toward the tip
    await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 60, y: 140 } });
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
    await expect(play(page)).toHaveAttribute('data-phase', 'result');
    await expect(page.locator('.coach')).toBeVisible();
    // the fit comes to rest
    await page.waitForTimeout(1200);
    expect(await clashes(page, ['.coach', '.map .pin-actual', '.map .pin-guess', '.hud', '.panel-host > *', '.map-zoom'])).toEqual([]);
  });
}
