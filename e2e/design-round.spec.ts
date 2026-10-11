import { expect, test, type Page } from '@playwright/test';
import { PLACES, matchState, player, viewer } from '../src/multiplayer/testing.ts';
import { RUSSIA_ONLY, mockPlaces, mockServices } from './fixtures.ts';
import { play, roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated, type Catalog } from './language-checks.ts';
import { MatchServer, signIn } from './match-server.ts';

// The round screen's layout, measured: at a phone's size and two desktop sizes, in the two
// languages with the longest words, no control lies on another and none leaves the screen, with
// the guess map at every size, kept open and not, full screen and not, with and without a clock, a
// hint and a chat button. And the rules the panels keep to: one slot, and the action that moves
// play on first, in the accent.

const PHONE = { width: 390, height: 800 };
const DESKTOPS = [
  { width: 1360, height: 840 },
  { width: 1440, height: 900 },
] as const;
const LANGUAGES = ['de', 'ru'] as const;
/** where the left column ends and the guess map may begin: see `--rail` in play.css */
const RAIL_END = 16 + 296 + 16;

/** Smallest PNG there is (one pixel): stands in for every satellite tile. */
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const game = (options: string) => `/?map=world&seed=e2e00001&${options}&n=3`;

/** what stands over the street view while a round is played */
const OVER_VIEW = ['.hud', '.compass', '.pano-tools .return', '.pano-tools .hint', '.credit', '.map-panel', '.map-toggle', '.chat-toggle', '.roster', '.move-arrow'];
/** what stands over the guess map, and the bar under it */
const OVER_MAP = ['.map-sizes', '.map-hold', '.map-types', '.map-zoom', '.guess-bar .guess', '.map-close', '.map-credit', '.maplibregl-ctrl-attrib-button'];
/** what is on screen with the map over all of it */
const FULL_SCREEN = ['.hud', '.chat-toggle', ...OVER_MAP];
/** what stands over the map once a round or a game is over */
const OVER_RESULT = ['.hud', '.panel-host > *', '.map-zoom', '.maplibregl-ctrl-attrib-button', '.chat-toggle'];

interface Box {
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The boxes of everything on the page that matches and can be seen. A walk arrow off the edge of the view is not on screen at all. */
const boxesOf = (page: Page, selectors: readonly string[]): Promise<Box[]> =>
  page.evaluate(
    (list) =>
      list.flatMap((name) =>
        [...document.querySelectorAll(name)]
          .filter((node) => node.checkVisibility({ visibilityProperty: true }))
          .map((node) => node.getBoundingClientRect())
          .filter((box) => box.width > 1 && box.height > 1)
          .filter((box) => name !== '.move-arrow' || (box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight))
          .map((box) => ({ name, left: box.left, top: box.top, right: box.right, bottom: box.bottom })),
      ),
    [...selectors],
  );

/** Every pair of boxes that lie on one another, and every box that reaches past the screen. Empty when the layout holds. */
async function clashes(page: Page, selectors: readonly string[]): Promise<string[]> {
  const boxes = await boxesOf(page, selectors);
  const screen = page.viewportSize()!;
  const slack = 0.5;
  const outside = boxes.filter((box) => box.left < -slack || box.top < -slack || box.right > screen.width + slack || box.bottom > screen.height + slack).map((box) => `${box.name} leaves the screen`);
  const pairs = boxes.flatMap((one, index) =>
    boxes
      .slice(index + 1)
      .filter((other) => one.left < other.right - slack && other.left < one.right - slack && one.top < other.bottom - slack && other.top < one.bottom - slack)
      .map((other) => `${one.name} lies on ${other.name}`),
  );
  return [...outside, ...pairs];
}

const box = async (page: Page, selector: string): Promise<Box> => (await boxesOf(page, [selector]))[0]!;

async function open(page: Page, code: string, url: string): Promise<Catalog> {
  const say = CATALOGS[code]!;
  await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
  await mockServices(page);
  await page.route('https://tiles.maps.eox.at/**', (route) => route.fulfill({ body: PIXEL_PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }));
  await page.goto(url);
  await page.getByRole('button', { name: say['singleplayer.playChallenge'] }).click();
  await roundReady(page);
  return say;
}

/** Takes the pointer and the focus off the guess map, and lets the map finish changing size. */
async function leaveMap(page: Page): Promise<void> {
  await page.mouse.move(250, 400);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(400);
}

async function overMap(page: Page): Promise<void> {
  await page.locator('.map-panel').hover();
  await page.waitForTimeout(400);
}

/** The panel in the slot: where it is, and that its first action is the one accent button, at its foot on the left. */
async function expectPanelRules(page: Page, phone: boolean): Promise<void> {
  const panel = page.locator('.panel-host > *');
  const screen = page.viewportSize()!;
  const [at, hud] = [await box(page, '.panel-host > *'), await box(page, '.hud')];
  if (phone) {
    // a sheet at the foot of the screen, a margin in from each edge
    expect(at.left).toBe(16);
    expect(at.right).toBe(screen.width - 16);
    expect(at.bottom).toBe(screen.height - 16);
  } else {
    // the rail under the HUD, 440 wide
    expect(at.left).toBe(16);
    expect(at.top).toBe(88);
    expect(at.right - at.left).toBe(440);
    expect(at.bottom).toBeLessThanOrEqual(screen.height - 16);
  }
  expect(at.top).toBeGreaterThanOrEqual(hud.bottom);
  const buttons = panel.locator('.panel-actions > *');
  await expect(buttons.first()).toHaveClass(/\baccent\b/);
  await expect(panel.locator('.button.accent')).toHaveCount(1);
  await expect(panel.locator('.button.primary')).toHaveCount(0);
  const [actions, first] = [await box(page, '.panel-actions'), await box(page, '.panel-actions > :first-child')];
  expect(Math.abs(actions.bottom - at.bottom)).toBeLessThanOrEqual(1.5);
  expect(first.left - at.left).toBeLessThanOrEqual(22);
  // no button is left alone beside an empty cell
  const rows = await page.evaluate(() => {
    const tops = [...document.querySelectorAll('.panel-actions > *')].map((node) => Math.round(node.getBoundingClientRect().top));
    return [...new Set(tops)].map((top) => tops.filter((each) => each === top).length);
  });
  const last = (await boxesOf(page, ['.panel-actions > *'])).at(-1)!;
  if (rows.at(-1) === 1 && rows.length > 1) {
    expect(last.right - last.left).toBeGreaterThan((actions.right - actions.left) * 0.8);
  }
}

async function guess(page: Page, say: Catalog, at = { x: 150, y: 200 }): Promise<void> {
  if (!(await page.locator('.map-panel .maplibregl-canvas').isVisible())) {
    await page.getByRole('button', { name: say['round.openMap'] }).click();
  }
  await page.locator('.map-panel').hover();
  await page.locator('.map-panel .maplibregl-canvas').click({ position: at });
  await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
  await expect(play(page)).toHaveAttribute('data-phase', 'result');
}

for (const code of LANGUAGES) {
  for (const viewport of DESKTOPS) {
    test.describe(`${code} at ${viewport.width}x${viewport.height}`, () => {
      test.use({ viewport });

      test('nothing lies on anything with the map at each size, kept open, full screen, and over a result', async ({ page }) => {
        test.setTimeout(90_000);
        const say = await open(page, code, game('t=120&mode=move'));
        // a clock, a hint, the way back to the start and the pictures' credit are all there
        await expect(page.locator('.hud-cell').filter({ hasText: say['round.time']! })).toBeVisible();
        await expect(page.locator('.pano-tools .hint')).toBeVisible();
        await expect(page.locator('.pano-tools .return')).toBeVisible();
        await expect(page.locator('.credit')).toBeVisible();
        await expect(page.locator('.move-arrow').first()).toBeVisible();
        expect(await clashes(page, OVER_VIEW)).toEqual([]);

        for (const size of ['small', 'medium', 'large'] as const) {
          await overMap(page);
          await page.getByRole('button', { name: say[`guessMap.size.${size}`] }).click();
          await page.waitForTimeout(400);
          // open under the pointer: clear of the rail and of the HUD, and its own buttons clear of each other
          expect(await clashes(page, OVER_VIEW.filter((each) => each !== '.move-arrow'))).toEqual([]);
          expect(await clashes(page, OVER_MAP)).toEqual([]);
          const map = await box(page, '.map-panel');
          expect(map.left).toBeGreaterThanOrEqual(RAIL_END);
          expect(map.top).toBeGreaterThanOrEqual(88);

          // kept open, with the pointer away
          await page.getByRole('button', { name: say['guessMap.keepOpen'] }).click();
          await leaveMap(page);
          expect((await box(page, '.map-panel')).left).toBe(map.left);
          expect(await clashes(page, OVER_VIEW.filter((each) => each !== '.move-arrow'))).toEqual([]);
          await overMap(page);
          await page.getByRole('button', { name: say['guessMap.keepOpen'] }).click();
          await leaveMap(page);
          expect(await clashes(page, OVER_VIEW)).toEqual([]);
        }
        // the large map is still the largest
        await overMap(page);
        expect((await box(page, '.map-panel')).right - (await box(page, '.map-panel')).left).toBeGreaterThan(900);

        // with the hint spent and satellite pictures, whose credit takes a row of the panel
        await page.locator('.pano-tools .hint').click();
        await overMap(page);
        await page.getByRole('group', { name: say['guessMap.type'] }).getByRole('button', { name: say['guessMap.type.satellite'] }).click();
        await expect(page.locator('.map-credit')).toBeVisible();
        expect(await clashes(page, OVER_MAP)).toEqual([]);
        expect(await clashes(page, OVER_VIEW.filter((each) => each !== '.move-arrow'))).toEqual([]);

        // full screen: the HUD stays over the map and the map's buttons stand under it
        await page.getByRole('button', { name: say['guessMap.fullScreen'] }).click();
        await page.waitForTimeout(300);
        expect(await clashes(page, FULL_SCREEN)).toEqual([]);
        await page.getByRole('button', { name: say['guessMap.fullScreen'] }).click();
        await page.getByRole('group', { name: say['guessMap.type'] }).getByRole('button', { name: say['guessMap.type.streets'] }).click();

        // a result, then the summary: one slot, and the way on first
        for (const last of [false, false, true]) {
          await guess(page, say);
          await page.waitForTimeout(300);
          expect(await clashes(page, OVER_RESULT)).toEqual([]);
          await expectPanelRules(page, false);
          await page.getByRole('button', { name: last ? say['result.seeSummary'] : say['result.next'] }).click();
          if (!last) {
            await roundReady(page);
          }
        }
        await expect(page.getByRole('region', { name: say['summary.label'] })).toBeVisible();
        expect(await clashes(page, OVER_RESULT)).toEqual([]);
        await expectPanelRules(page, false);
        await expectTranslated(page, code);
      });

      test('with no clock and a view that cannot be walked, the HUD has no empty cell and the rail still holds', async ({ page }) => {
        const say = await open(page, code, game('t=0&mode=nmpz'));
        await expect(page.locator('.hud-cell').filter({ hasText: say['round.time']! })).toBeHidden();
        await expect(page.locator('.pano-tools .return')).toBeHidden();
        expect(await page.locator('.hud-cell:visible .value').evaluateAll((values) => values.filter((value) => !value.textContent?.trim()).length)).toBe(0);
        expect(await clashes(page, OVER_VIEW)).toEqual([]);
        await overMap(page);
        await page.getByRole('button', { name: say['guessMap.size.large'] }).click();
        await page.waitForTimeout(400);
        expect(await clashes(page, OVER_VIEW)).toEqual([]);
      });
    });
  }

  test.describe(`${code} on a phone`, () => {
    test.use({ viewport: PHONE });

    test('the walk arrow is clear of every control, and Guess is a button in a bar under the map', async ({ page }) => {
      test.setTimeout(90_000);
      const say = await open(page, code, game('t=120&mode=move'));
      await expect(page.locator('.move-arrow').first()).toBeVisible();
      await expect(page.locator('.pano-tools .hint')).toBeVisible();
      await expect(page.getByRole('button', { name: say['round.returnToStart'] })).toBeVisible();
      expect(await clashes(page, OVER_VIEW)).toEqual([]);
      // the compass and the way back are a column of 44px buttons at the left edge
      for (const selector of ['.compass', '.pano-tools .return']) {
        const tool = await box(page, selector);
        expect([tool.left, tool.right - tool.left, tool.bottom - tool.top]).toEqual([16, 44, 44]);
      }
      await expectTranslated(page, code);

      // the map open: a sheet, with a bar under the map holding Close map and Guess
      await page.getByRole('button', { name: say['round.openMap'] }).click();
      await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 220 } });
      expect(await clashes(page, ['.hud', '.pano-tools .hint', '.map-panel'])).toEqual([]);
      expect(await clashes(page, OVER_MAP)).toEqual([]);
      const [map, bar, guessButton, close] = [await box(page, '.map-panel .map'), await box(page, '.guess-bar'), await box(page, '.guess-bar .guess'), await box(page, '.map-close')];
      expect(bar.top).toBeGreaterThanOrEqual(map.bottom);
      expect(bar.bottom).toBe(PHONE.height);
      // Guess is in the bar, not the bar: clear of the map above it and of the screen's edges, and big enough for a thumb
      expect(guessButton.top - map.bottom).toBeGreaterThanOrEqual(6);
      expect(guessButton.right).toBe(PHONE.width - 16);
      expect(guessButton.bottom - guessButton.top).toBeGreaterThanOrEqual(44);
      expect(close.left).toBe(16);
      expect(close.right).toBeLessThan(guessButton.left);
      // the accent is a small mark: under 3% of the screen
      expect(((guessButton.right - guessButton.left) * (guessButton.bottom - guessButton.top)) / (PHONE.width * PHONE.height)).toBeLessThan(0.03);
      // a drag on the map that ends on the bar does not guess
      await page.mouse.move(200, map.bottom - 60);
      await page.mouse.down();
      await page.mouse.move(200, map.bottom + 4, { steps: 5 });
      await page.mouse.up();
      await expect(play(page)).toHaveAttribute('data-phase', 'guessing');

      // satellite pictures add their credit as a row of the sheet
      await page.getByRole('group', { name: say['guessMap.type'] }).getByRole('button', { name: say['guessMap.type.satellite'] }).click();
      await expect(page.locator('.map-credit')).toBeVisible();
      expect(await clashes(page, OVER_MAP)).toEqual([]);
      await page.getByRole('group', { name: say['guessMap.type'] }).getByRole('button', { name: say['guessMap.type.streets'] }).click();

      // closing the map is in the bar; the button over the view opens it again
      await page.getByRole('button', { name: say['round.closeMap'] }).click();
      await expect(page.locator('.map-panel')).toBeHidden();
      await expect(page.getByRole('button', { name: say['round.openMap'] })).toBeVisible();

      for (const last of [false, false, true]) {
        await guess(page, say);
        await page.waitForTimeout(300);
        expect(await clashes(page, OVER_RESULT)).toEqual([]);
        await expectPanelRules(page, true);
        // big enough to touch (the map's own credit button is too, but the stand-in style has no credit to show)
        const link = await box(page, '.place-link');
        expect(link.bottom - link.top).toBeGreaterThanOrEqual(44);
        // "1,094 / 5,000" is on one line
        expect(await page.locator('.result-panel .figure').nth(1).locator('.figure-value').evaluate((value) => value.getClientRects().length)).toBe(1);
        await page.getByRole('button', { name: last ? say['result.seeSummary'] : say['result.next'] }).click();
        if (!last) {
          await roundReady(page);
        }
      }
      await expect(page.getByRole('region', { name: say['summary.label'] })).toBeVisible();
      expect(await clashes(page, OVER_RESULT)).toEqual([]);
      await expectPanelRules(page, true);
      await expectTranslated(page, code);
    });

    test('a streak names the country on the Guess button, and the button stays inside its bar', async ({ page }) => {
      const say = CATALOGS[code]!;
      await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
      await mockServices(page);
      await mockPlaces(page, RUSSIA_ONLY);
      await page.goto('/#streak');
      await page.getByRole('button', { name: say['streak.start'] }).click();
      await roundReady(page);
      // no hint, no score, no clock: the HUD has no empty cell
      await expect(page.locator('.pano-tools .hint')).toBeHidden();
      expect(await page.locator('.hud-cell:visible .value').evaluateAll((values) => values.filter((value) => !value.textContent?.trim()).length)).toBe(0);
      expect(await clashes(page, OVER_VIEW)).toEqual([]);
      await page.getByRole('button', { name: say['round.openMap'] }).click();
      for (const at of [
        { x: 279, y: 320 },
        { x: 330, y: 150 },
      ]) {
        await page.locator('.map-panel .maplibregl-canvas').click({ position: at });
        await expect(page.locator('.guess-bar .guess')).not.toHaveText(say['round.placePin']!);
        expect(await clashes(page, OVER_MAP)).toEqual([]);
        await expectTranslated(page, code);
      }
    });
  });
}

// --- a match: the chat button ---------------------------------------------------------------------

for (const viewport of [PHONE, DESKTOPS[0]]) {
  test(`a match's chat button and roster are clear of the round's controls at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const phone = viewport.width < 720;
    const say = CATALOGS.de!;
    const server = await MatchServer.install(page);
    server.state = matchState({ you: viewer(), players: [player('sam'), player('neel')], phase: 'playing', places: PLACES });
    server.startRound(0);
    server.matchFound(server.state.id);
    await signIn(page, 'neel');
    await page.addInitScript(() => localStorage.setItem('plonk.language', 'de'));
    await mockServices(page);
    await page.goto('/');
    await page.getByRole('button', { name: say['home.resume.rejoin'] }).click();
    await roundReady(page);
    await expect(page.locator('.chat-toggle')).toBeVisible();
    expect(await clashes(page, OVER_VIEW)).toEqual([]);

    if (phone) {
      await page.getByRole('button', { name: say['round.openMap'] }).click();
    } else {
      await overMap(page);
      await page.getByRole('button', { name: say['guessMap.size.large'] }).click();
      await page.waitForTimeout(400);
    }
    await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 220 } });
    expect(await clashes(page, [...OVER_MAP, '.chat-toggle'])).toEqual([]);
    expect(await clashes(page, ['.hud', '.chat-toggle', '.compass', '.pano-tools .return', '.roster', ...(phone ? [] : ['.map-panel'])])).toEqual([]);

    // the guess sent: the roster comes up in the rail, clear of the map and of the compass
    await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
    await expect(page.locator('.roster')).toBeVisible();
    if (phone) {
      await page.getByRole('button', { name: say['round.closeMap'] }).click();
    }
    expect(await clashes(page, OVER_VIEW.filter((each) => phone || each !== '.move-arrow'))).toEqual([]);
  });
}

// --- the leave dialog -----------------------------------------------------------------------------

test('leaving asks first: staying is the filled choice, leaving the quiet one in the colour of danger', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await mockServices(page);
  await page.goto(game('t=0&mode=move'));
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await page.getByRole('button', { name: 'Open map' }).click();
  await page.getByRole('button', { name: 'Exit' }).click();
  const dialog = page.getByRole('dialog');
  const [stay, leave] = [dialog.getByRole('button', { name: 'Keep playing' }), dialog.getByRole('button', { name: 'Leave game' })];
  await expect(dialog.getByRole('button')).toHaveText(['Keep playing', 'Leave game']);
  await expect(stay).toBeFocused();
  await expect(stay).toHaveClass(/primary/);
  await expect(leave).toHaveClass(/ghost/);
  const danger = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--danger)';
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  expect(await leave.evaluate((button) => [getComputedStyle(button).color, getComputedStyle(button).borderTopColor])).toEqual([danger, danger]);
  // nothing of the map's stands at the dialog's edge
  await expect(page.locator('.map-tools')).toBeHidden();
  await stay.click();
  await expect(page.locator('.map-tools')).toBeVisible();
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
});

// --- status: what became of a score, and a failure ------------------------------------------------

test('what became of the score is a line of status under the summary: a dot, a word in mono, the sentence', async ({ page }) => {
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('region', { name: 'How to play' }).getByRole('button', { name: 'Play the tutorial' }).click();
  for (const last of [false, true]) {
    await roundReady(page);
    await guess(page, CATALOGS.en!);
    await page.getByRole('button', { name: last ? 'See summary' : 'Next round' }).click();
  }
  const note = page.getByRole('region', { name: 'Game summary' }).locator('.status-note');
  await expect(note).toBeVisible();
  await expect(note.locator('.status-word')).toHaveText('Note');
  await expect(note.getByRole('status')).toHaveText('That was the tutorial. It is not saved and does not count for stats.');
  // readable: 14px in the second ink, with a 6px dot, not 12px in label grey
  const [size, colour, second] = await note.evaluate((line) => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--fg-2)';
    const fg2 = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(line).fontSize, getComputedStyle(line).color, fg2];
  });
  expect(size).toBe('14px');
  expect(colour).toBe(second);
  const dot = (await note.locator('.status-dot').boundingBox())!;
  expect([dot.width, dot.height]).toEqual([6, 6]);
});

test('a view that will not load is marked as a failure: a red dot and the word, over the message and its ways on', async ({ page }) => {
  await mockServices(page);
  await page.route('https://img.plonk.test/**', (route) => route.abort());
  await page.goto(game('t=60&mode=move'));
  await page.getByRole('button', { name: 'Play challenge' }).click();
  const notice = page.getByRole('alert');
  await expect(notice).toContainText('This view would not load.');
  const mark = notice.locator('.status-note');
  await expect(mark).toHaveAttribute('data-state', 'error');
  await expect(mark.locator('.status-word')).toHaveText('Error');
  const [dot, danger] = await mark.locator('.status-dot').evaluate((node) => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--danger)';
    const red = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(node).backgroundColor, red];
  });
  expect(dot).toBe(danger);
  await expect(notice.getByRole('button')).toHaveText(['Try again', 'Skip this place', 'Exit']);
  // no clock is running, so the HUD shows none
  await expect(page.locator('.hud-cell').filter({ hasText: 'Time' })).toBeHidden();
});
