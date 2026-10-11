import { expect, test, type Page } from '@playwright/test';
import { signIn } from './account-server.ts';
import { mockServices } from './fixtures.ts';
import { play, roundReady, scrollsSideways } from './helpers.ts';
import { CATALOGS, expectTranslated, type Catalog } from './language-checks.ts';
import { boxOf, boxesOf, clashes, smallTargets } from './match-boxes.ts';

// Wave 6, item 4, as it stands now that playing takes an account: the welcome a new visitor gets
// before the home screen, which leads to an account; and the tutorial a signed-in player is offered,
// with its line of fact at each result and the screen it ends on.

const EN = CATALOGS.en!;
const PHONE = { width: 390, height: 800 };
const DESKTOP = { width: 1360, height: 840 };
const CHALLENGE = '/?map=world&seed=e2e00001&t=0&mode=move&n=3';
const SEEN_KEY = 'plonk.welcome-seen';

const welcome = (page: Page, say: Catalog = EN) => page.getByRole('main', { name: say['welcome.label'] });
const howTo = (page: Page) => page.getByRole('region', { name: 'How to play' });
const title = (page: Page) => page.locator('.pane-title');
const summary = (page: Page, say: Catalog = EN) => page.getByRole('region', { name: say['summary.label'] });
const result = (page: Page, say: Catalog = EN) => page.getByRole('region', { name: say['result.label'] });
const stored = (page: Page, key: string) => page.evaluate((name) => localStorage.getItem(name), key);
/** what a visitor is shown on a pane that plays, in place of its controls */
const gate = (page: Page, say: Catalog = EN) => page.locator('.pane-section .notice').getByRole('link', { name: say['common.signIn'] });

/** A browser that has never been here, and nobody signed in. */
async function newVisitor(page: Page): Promise<void> {
  await mockServices(page, { welcome: 'show' });
  await signIn(page, null);
}

/** A signed-in player, on the pane that offers the tutorial again; then the tutorial, begun. */
async function startTutorial(page: Page, say: Catalog = EN): Promise<void> {
  await mockServices(page);
  await page.goto('/#account');
  await page.getByRole('button', { name: say['common.playTutorial'] }).click();
}

/** One guess in the round on screen, through to its result. */
async function guess(page: Page, say: Catalog = EN): Promise<void> {
  await roundReady(page);
  if (page.viewportSize()!.width <= 720) {
    await page.getByRole('button', { name: say['round.openMap'] }).click();
  } else {
    await page.locator('.map-panel').hover();
  }
  await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 150 } });
  await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
  await expect(play(page)).toHaveAttribute('data-phase', 'result');
}

/** Both of the tutorial's rounds, through to the screen it ends on. */
async function throughTutorial(page: Page, say: Catalog = EN): Promise<void> {
  await guess(page, say);
  await page.getByRole('button', { name: say['result.next'] }).click();
  await guess(page, say);
  await page.getByRole('button', { name: say['result.seeSummary'] }).click();
  await expect(play(page)).toHaveAttribute('data-phase', 'summary');
}

// --- the welcome ------------------------------------------------------------------------------------

test('a new visitor on the home page is welcomed first: what Wherefall is, that playing takes an account, and two choices', async ({ page }) => {
  await newVisitor(page);
  await page.goto('/');
  await expect(welcome(page)).toBeVisible();
  await expect(welcome(page).getByRole('heading', { name: 'Wherefall' })).toBeVisible();
  await expect(welcome(page)).toContainText('put a pin on the map');
  await expect(welcome(page)).toContainText('Playing takes a free account');
  // one accent action, the other a ghost
  await expect(welcome(page).getByRole('button')).toHaveText(['Sign in or create an account', 'Look around first']);
  await expect(welcome(page).locator('.button.accent')).toHaveText(['Sign in or create an account']);
  await expect(welcome(page).locator('.button.ghost')).toHaveText(['Look around first']);
  // it stands before the home screen, not over it
  await expect(page.locator('.shell')).toHaveCount(0);
});

test('a visitor the server cannot be asked about is welcomed all the same', async ({ page }) => {
  await mockServices(page, { welcome: 'show' });
  await page.route('**/api/account', (route) => route.abort());
  await page.goto('/');
  await expect(welcome(page)).toBeVisible();
});

test('"Look around first" goes to the home screen, where playing asks for an account, and the welcome never returns', async ({ page }) => {
  await newVisitor(page);
  await page.goto('/');
  await welcome(page).getByRole('button', { name: 'Look around first' }).click();
  await expect(title(page)).toHaveText('Singleplayer');
  await expect(welcome(page)).toHaveCount(0);
  await expect(gate(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start game' })).toHaveCount(0);

  await page.reload();
  await expect(gate(page)).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
});

test('"Sign in or create an account" goes to the account pane, and the welcome never returns', async ({ page }) => {
  await newVisitor(page);
  await page.goto('/');
  await welcome(page).getByRole('button', { name: 'Sign in or create an account' }).click();
  await expect(page).toHaveURL(/#account$/);
  await expect(page.getByLabel('Username')).toBeVisible();
  // the tutorial is a game: it is not offered to someone with no account
  await expect(page.getByRole('button', { name: 'Play the tutorial' })).toHaveCount(0);

  await page.goto('/');
  await expect(gate(page)).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
});

// --- the tutorial, for a signed-in player: a fact a result, and the ways on --------------------------

const WAYS = [
  { name: 'Singleplayer', address: /\/$/, lands: (page: Page) => expect(title(page)).toHaveText('Singleplayer') },
  { name: 'Daily challenge', address: /#daily$/, lands: (page: Page) => expect(title(page)).toHaveText('Daily challenge') },
] as const;

for (const way of WAYS) {
  test(`the how-to box runs the tutorial, each result has its fact, and ${way.name} leads where it says`, async ({ page }) => {
    await mockServices(page);
    await page.goto('/');
    await howTo(page).getByRole('button', { name: 'Play the tutorial' }).click();
    await expect(page.getByRole('complementary', { name: 'Tutorial' })).toContainText('Look around');

    await guess(page);
    await expect(result(page).locator('.place-fact')).toHaveText(EN['tutorial.fact.eiffel']);
    await expect(result(page)).toContainText('France');
    await page.getByRole('button', { name: 'Next round' }).click();
    await guess(page);
    await expect(result(page).locator('.place-fact')).toHaveText(EN['tutorial.fact.colosseum']);
    await expect(result(page)).toContainText('Italy');
    await page.getByRole('button', { name: 'See summary' }).click();

    // the tutorial's own end: its two rounds, that it is not saved, and two ways on in place of Play again
    await expect(summary(page).locator('tbody tr')).toHaveCount(2);
    await expect(summary(page)).toContainText('That was the tutorial. It is not saved and does not count for stats.');
    await expect(summary(page).getByRole('button')).toHaveText(['Singleplayer', 'Daily challenge']);
    await expect(summary(page).locator('.button.accent')).toHaveText(['Singleplayer']);
    await expect(summary(page).locator('.button.ghost')).toHaveText(['Daily challenge']);

    await summary(page).getByRole('button', { name: way.name }).click();
    await expect(page).toHaveURL(way.address);
    await way.lands(page);

    // played through: the how-to box is done with
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
    await expect(howTo(page)).toHaveCount(0);
  });
}

test('leaving the tutorial part way leaves the how-to box where it was', async ({ page }) => {
  await mockServices(page);
  await page.goto('/');
  await howTo(page).getByRole('button', { name: 'Play the tutorial' }).click();
  await roundReady(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  // the tutorial was not played through, so the how-to box is still there
  await expect(howTo(page)).toBeVisible();
});

// --- who is not welcomed ---------------------------------------------------------------------------

const LINKS = [
  { what: 'a challenge link', address: CHALLENGE, shows: (page: Page) => expect(title(page)).toHaveText(EN['nav.item.singleplayer']) },
  { what: 'a party link', address: '/?party=ABC123', shows: (page: Page) => expect(title(page)).toHaveText(EN['nav.item.join']) },
  { what: 'a profile', address: '/?user=sam', shows: (page: Page) => expect(page.locator('.menu-current')).toHaveText(EN['home.profile']) },
  { what: 'a community map', address: '/?community=paris-walks', shows: (page: Page) => expect(page.locator('.nav-item[aria-current="page"]')).toHaveText(EN['nav.item.maps']) },
  { what: 'a nav link', address: '/#leaderboards', shows: (page: Page) => expect(title(page)).toHaveText(EN['nav.item.leaderboards']) },
] as const;

for (const link of LINKS) {
  test(`a new visitor arriving on ${link.what} goes where it leads, without the welcome`, async ({ page }) => {
    await newVisitor(page);
    await page.goto(link.address);
    await link.shows(page);
    await expect(page.locator('.shell')).toBeVisible();
    await expect(welcome(page)).toHaveCount(0);
    // nothing was answered: the welcome is still to come on the plain home page
    expect(await stored(page, SEEN_KEY)).toBeNull();
  });
}

test('a signed-in player is never welcomed, signed out later or not', async ({ page }) => {
  await mockServices(page, { welcome: 'show' });
  await signIn(page, 'neel');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  expect(await stored(page, SEEN_KEY)).toBe('1');

  await signIn(page, null);
  await page.reload();
  await expect(gate(page)).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
});

for (const [what, key, value] of [
  ['dismissed the how-to box', 'plonk.intro-seen', '1'],
  ['has been shown a place', 'plonk.seen-places', '["ru-00"]'],
] as const) {
  test(`a returning visitor who ${what} before there was a welcome does not get one`, async ({ page }) => {
    await page.addInitScript(([name, kept]) => localStorage.setItem(name, kept), [key, value] as const);
    await newVisitor(page);
    await page.goto('/');
    await expect(gate(page)).toBeVisible();
    await expect(welcome(page)).toHaveCount(0);
  });
}

// --- replayed from the account pane -----------------------------------------------------------------

test('a signed-in player replaying it from the account pane is offered Singleplayer and the daily challenge', async ({ page }) => {
  await startTutorial(page);
  await throughTutorial(page);
  await expect(summary(page)).toContainText('That was the tutorial. It is not saved and does not count for stats.');
  await expect(summary(page).getByRole('button')).toHaveText(['Singleplayer', 'Daily challenge']);
  await expect(summary(page).locator('.button.accent')).toHaveText(['Singleplayer']);
  await summary(page).getByRole('button', { name: 'Daily challenge' }).click();
  await expect(page).toHaveURL(/#daily$/);
});

// --- layout ----------------------------------------------------------------------------------------

/** The parts of `selector`'s box that reach past `within`'s. */
async function outside(page: Page, selector: string, within: string): Promise<string[]> {
  const frame = await boxOf(page, within);
  return (await boxesOf(page, [selector])).filter((box) => box.left < frame.left - 0.5 || box.right > frame.right + 0.5 || box.top < frame.top - 0.5 || box.bottom > frame.bottom + 0.5).map((box) => `${box.name} reaches past ${within}`);
}

for (const viewport of [PHONE, DESKTOP]) {
  const phone = viewport.width <= 720;
  const size = `${viewport.width}x${viewport.height}`;

  test(`the welcome holds at ${size}: nothing overlaps, nothing leaves the screen`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await newVisitor(page);
    await page.goto('/');
    await expect(welcome(page)).toBeVisible();
    expect(await clashes(page, ['.welcome .wordmark', '.welcome .lede', '.welcome .actions', '.welcome .fine'])).toEqual([]);
    expect(await clashes(page, ['.welcome .button'])).toEqual([]);
    expect(await scrollsSideways(page)).toBe(false);
    // the whole of it is on the first screen: nothing to scroll for
    expect((await boxOf(page, '.welcome .fine')).bottom).toBeLessThanOrEqual(viewport.height);
    if (phone) {
      expect(await smallTargets(page, '.welcome')).toEqual([]);
    }
  });

  test(`over a tutorial result at ${size} the tip, the fact and the panel keep clear of one another`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await startTutorial(page);
    await guess(page);
    await expect(page.locator('.coach')).toBeVisible();
    const fact = result(page).locator('.place-fact');
    await expect(fact).toHaveText(EN['tutorial.fact.eiffel']);
    // the panel has come to rest
    await page.waitForTimeout(400);
    expect(await clashes(page, ['.coach', '.hud', '.panel-host > *', '.map-zoom'])).toEqual([]);
    // the fact is a line of the panel like its others: inside it, on none of them, and in sight without scrolling
    expect(await clashes(page, ['.result-panel > *'])).toEqual([]);
    expect(await outside(page, '.place-fact', '.result-panel')).toEqual([]);
    await expect(fact).toBeInViewport({ ratio: 1 });
    await expect(result(page).getByRole('button', { name: 'Next round' })).toBeInViewport({ ratio: 1 });
    expect(await scrollsSideways(page)).toBe(false);
    if (phone) {
      expect(await smallTargets(page)).toEqual([]);
    }
  });

  test(`the tutorial's end at ${size}: two ways on, each whole, on one line and in reach`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await startTutorial(page);
    await throughTutorial(page);
    await expect(summary(page).getByRole('button')).toHaveCount(2);
    await page.waitForTimeout(400);
    expect(await clashes(page, ['.hud', '.panel-host > *'])).toEqual([]);
    expect(await clashes(page, ['.tutorial-ways .button'])).toEqual([]);
    expect(await outside(page, '.tutorial-ways .button', '.summary-panel')).toEqual([]);
    for (const button of await summary(page).getByRole('button').all()) {
      await expect(button).toBeInViewport({ ratio: 1 });
    }
    // a label on one line is as tall as any other button's
    const heights = (await boxesOf(page, ['.tutorial-ways .button'])).map((box) => Math.round(box.bottom - box.top));
    expect(new Set(heights).size).toBe(1);
    expect(await scrollsSideways(page)).toBe(false);
    if (phone) {
      expect(await smallTargets(page, '.panel-host')).toEqual([]);
    }
  });
}

test('on a short phone a tutorial result still leaves the map room for the place and the guess, between the tip and the sheet', async ({ page }) => {
  // a phone's browser with its bars showing
  await page.setViewportSize({ width: 390, height: 664 });
  await startTutorial(page);
  await guess(page);
  await expect(page.locator('.coach')).toBeVisible();
  // the fit comes to rest
  await page.waitForTimeout(1200);
  expect(await clashes(page, ['.coach', '.hud', '.panel-host > *', '.map-zoom', '.map .pin-actual', '.map .pin-guess'])).toEqual([]);
  expect(await boxesOf(page, ['.map .pin-actual', '.map .pin-guess'])).toHaveLength(2);
  // the sheet gave up its last lines, not the fact or the way on
  await expect(result(page).locator('.place-fact')).toBeInViewport({ ratio: 1 });
  await expect(result(page).getByRole('button', { name: 'Next round' })).toBeInViewport({ ratio: 1 });
});

// --- languages ---------------------------------------------------------------------------------------

for (const code of ['de', 'ru'] as const) {
  test(`${code}: the welcome is in the language on a phone`, async ({ page }) => {
    const say = CATALOGS[code]!;
    await page.setViewportSize(PHONE);
    await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
    await newVisitor(page);
    await page.goto('/');
    await expect(welcome(page, say).getByRole('button')).toHaveText([say['common.signIn']!, say['welcome.look']!]);
    await expectTranslated(page, code);
    expect(await clashes(page, ['.welcome .button'])).toEqual([]);
    expect(await smallTargets(page, '.welcome')).toEqual([]);

    await welcome(page, say).getByRole('button', { name: say['welcome.look'] }).click();
    await expect(gate(page, say)).toBeVisible();
    await expectTranslated(page, code);
  });

  test(`${code}: a tutorial result and the tutorial's end are in the language on a phone`, async ({ page }) => {
    const say = CATALOGS[code]!;
    await page.setViewportSize(PHONE);
    await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
    await startTutorial(page, say);
    await guess(page, say);
    await expect(result(page, say).locator('.place-fact')).toHaveText(say['tutorial.fact.eiffel']);
    await expectTranslated(page, code);
    expect(await clashes(page, ['.coach', '.hud', '.panel-host > *', '.map-zoom'])).toEqual([]);

    await page.getByRole('button', { name: say['result.next'] }).click();
    await guess(page, say);
    await expect(result(page, say).locator('.place-fact')).toHaveText(say['tutorial.fact.colosseum']);
    await page.getByRole('button', { name: say['result.seeSummary'] }).click();
    await expect(summary(page, say).getByRole('button')).toHaveText([say['nav.item.singleplayer']!, say['nav.item.daily']!]);
    await expectTranslated(page, code);
    const heights = (await boxesOf(page, ['.tutorial-ways .button'])).map((box) => Math.round(box.bottom - box.top));
    expect(new Set(heights).size).toBe(1);
  });
}
