import { expect, test, type Page } from '@playwright/test';
import { matchState, player, viewer } from '../src/multiplayer/testing.ts';
import { DailyServer } from './daily-server.ts';
import { mockServices } from './fixtures.ts';
import { scrollsSideways } from './helpers.ts';
import { MatchServer, signIn } from './match-server.ts';
import { SocialServer } from './social-server.ts';

const CHALLENGE = '/?map=world&seed=e2e00001&t=0&mode=move&n=5';
const NAV = [
  'Singleplayer',
  'Country streak',
  'Country Guesser',
  'Continent Guesser',
  'Daily challenge',
  'Ranked duel',
  'Unranked match',
  '2v2 match',
  'Create party',
  'Join party',
  'Maps',
  'Leaderboards',
  'Friends',
  'Account',
  'About',
];
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const nav = (page: Page, name: string) => mainNav(page).getByRole('link', { name, exact: true });
const title = (page: Page) => page.locator('.pane-title');

async function mockApis(page: Page, username: string | null) {
  await mockServices(page);
  await signIn(page, username);
  const match = await MatchServer.install(page);
  const social = await SocialServer.install(page);
  // today's daily, not yet played; a visitor is sent only what is public
  await DailyServer.install(page, username === null ? 'none' : 'account');
  return { match, social };
}

test('the sidebar lists every mode in labelled groups and opens on singleplayer', async ({ page }) => {
  await mockApis(page, 'neel');
  await page.goto('/');

  await expect(mainNav(page).getByRole('link')).toHaveText(NAV);
  await expect(page.locator('.nav-label')).toHaveText(['Solo', 'Online', 'Party', 'Community']);
  await expect(nav(page, 'Singleplayer')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.nav-item[aria-current]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Wherefall' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'World' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
});

test('each item shows its own pane and puts itself in the address', async ({ page }) => {
  await mockApis(page, 'neel');
  await page.goto('/');

  const panes: Array<[string, RegExp, string]> = [
    ['Country streak', /#streak$/, 'Start streak'],
    ['Country Guesser', /#country$/, 'Start game'],
    ['Continent Guesser', /#continent$/, 'Start game'],
    ['Daily challenge', /#daily$/, "Play today's challenge"],
    ['Ranked duel', /#ranked$/, 'Find a match'],
    ['Unranked match', /#unranked$/, 'Find a match'],
    ['2v2 match', /#team$/, 'Find a match'],
    ['Create party', /#create$/, 'Create party'],
    ['Join party', /#join$/, 'Join party'],
    ['Maps', /#maps$/, ''],
    ['Leaderboards', /#leaderboards$/, ''],
    ['Friends', /#friends$/, 'Send request'],
    ['Account', /#account$/, 'Sign out everywhere'],
    ['About', /#about$/, ''],
    ['Singleplayer', /#singleplayer$/, 'Start game'],
  ];
  for (const [name, address, button] of panes) {
    await nav(page, name).click();
    await expect(page).toHaveURL(address);
    await expect(title(page)).toHaveText(name);
    await expect(nav(page, name)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.nav-item[aria-current]')).toHaveCount(1);
    if (button) {
      await expect(page.getByRole('button', { name: button })).toBeVisible();
    }
  }
});

test('every pane opens the same way: a title, then a line on what it is', async ({ page }) => {
  await mockApis(page, 'neel');
  await page.goto('/');
  const lefts = new Set<number>();
  const tops = new Set<number>();
  for (const name of NAV) {
    await nav(page, name).click();
    await expect(title(page)).toHaveText(name);
    await expect(page.locator('.pane-head .lede')).toBeVisible();
    // a pane that plays is drawn again once the server has said who is looking
    await expect(page.getByText('Checking your account')).toHaveCount(0);
    const box = (await title(page).boundingBox())!;
    lefts.add(Math.round(box.x));
    tops.add(Math.round(box.y));
  }
  expect([...lefts]).toHaveLength(1);
  expect([...tops]).toHaveLength(1);
});

test('reload, back and forward keep to the address', async ({ page }) => {
  await mockApis(page, 'neel');
  await page.goto('/');
  await nav(page, 'Daily challenge').click();
  await nav(page, 'Create party').click();
  await expect(title(page)).toHaveText('Create party');

  await page.reload();
  await expect(title(page)).toHaveText('Create party');
  await expect(nav(page, 'Create party')).toHaveAttribute('aria-current', 'page');

  await page.goBack();
  await expect(title(page)).toHaveText('Daily challenge');
  await expect(page).toHaveURL(/#daily$/);
  await page.goBack();
  await expect(title(page)).toHaveText('Singleplayer');
  await page.goForward();
  await expect(title(page)).toHaveText('Daily challenge');

  await page.goto('/#team');
  await expect(title(page)).toHaveText('2v2 match');
});

test('a challenge link keeps its card on singleplayer while the player looks around', async ({ page }) => {
  await mockApis(page, 'neel');
  await page.goto(CHALLENGE);
  await expect(nav(page, 'Singleplayer')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('You were sent a challenge')).toBeVisible();

  await nav(page, 'Account').click();
  await expect(page.getByText('You were sent a challenge')).toBeHidden();
  await nav(page, 'Singleplayer').click();
  await expect(page.getByText('World · 5 rounds · No limit · move')).toBeVisible();
  await expect(page).toHaveURL(/seed=e2e00001/);
  await expect(page.getByRole('button', { name: 'Play challenge' })).toBeVisible();
});

test('on a phone the nav folds behind a row that names the pane, and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockApis(page, 'neel');
  await page.goto('/');

  // the row names the pane and says what a tap does: "Menu" while the list is folded away, "Close" while it is open
  const menu = page.getByRole('button', { name: /Menu|Close/ });
  await expect(menu).toHaveText('SingleplayerMenu');
  await expect(mainNav(page)).toBeHidden();
  // the pane starts on the first screen, not under a wall of links
  expect((await title(page).boundingBox())!.y).toBeLessThan(220);

  for (const name of NAV) {
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toContainText('Close');
    const link = nav(page, name);
    expect((await link.boundingBox())!.height, `${name} is tall enough to tap`).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(title(page)).toHaveText(name);
    await expect(mainNav(page)).toBeHidden();
    await expect(menu).toContainText(name);
    expect(await scrollsSideways(page), `${name} scrolls sideways`).toBe(false);
  }

  const sidebar = (await page.locator('.sidebar').boundingBox())!;
  const pane = (await page.locator('.pane').boundingBox())!;
  expect(sidebar.y + sidebar.height).toBeLessThanOrEqual(pane.y + 1);
});

test('on a wide screen the sidebar is a comfortable column to the left of the pane', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 840 });
  await mockApis(page, 'neel');
  await page.goto('/');
  const sidebar = (await page.locator('.sidebar').boundingBox())!;
  const pane = (await page.locator('.pane').boundingBox())!;
  expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(pane.x + 1);
  expect(sidebar.width).toBeGreaterThanOrEqual(220);
  expect(sidebar.width).toBeLessThanOrEqual(240);

  const item = nav(page, 'Ranked duel');
  expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(36);
  expect(await item.evaluate((node) => getComputedStyle(node).fontSize)).toBe('14px');
  const cell = page.locator('.choice span').first();
  expect((await cell.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  expect(await cell.evaluate((node) => getComputedStyle(node).fontSize)).toBe('14px');
  expect(Number.parseFloat(await page.locator('.fine').first().evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
  // forms keep a readable measure instead of running the width of the screen
  expect((await page.locator('.setup').boundingBox())!.width).toBeLessThanOrEqual(640);
});

// every way to play online needs an account
for (const [name, hash, fact] of [
  ['Ranked duel', 'ranked', '1 v 1 · World · moving · up to 5 rounds · 1 min a round · rated'],
  ['Unranked match', 'unranked', '2 to 10 players · World · moving · 5 rounds · 45 sec a round · not rated'],
  ['2v2 match', 'team', '2 v 2 · World · moving · up to 5 rounds · 1 min a round · not rated'],
  ['Create party', 'create', '2 to 40 players · any map · your rules · not rated'],
  ['Join party', 'join', "A friend's private match · their rules · not rated"],
] as const) {
  test(`a visitor who picks ${name} is told what it is, then that an account is needed`, async ({ page }) => {
    await mockApis(page, null);
    await page.goto(`/#${hash}`);

    await expect(title(page)).toHaveText(name);
    const facts = page.getByText(fact);
    const notice = page.getByText('Multiplayer needs an account');
    await expect(facts).toBeVisible();
    await expect(notice).toBeVisible();
    expect((await facts.boundingBox())!.y).toBeLessThan((await notice.boundingBox())!.y);
    await expect(page.getByRole('button', { name: /Find a match|Create party|Join party|Play as a guest/ })).toHaveCount(0);

    await page.getByRole('link', { name: 'Sign in or create an account' }).click();
    await expect(page).toHaveURL(/#account$/);
    await expect(page.getByLabel('Username')).toBeVisible();
    await page.goBack();
    await expect(title(page)).toHaveText(name);
  });
}

test('a first visit gets a short introduction that stays dismissed', async ({ page }) => {
  await mockApis(page, 'neel');
  await page.goto('/');
  const intro = page.getByRole('region', { name: 'How to play' });
  await expect(intro.locator('li')).toHaveCount(3);
  await expect(intro).toContainText('put a pin on the map');

  await intro.getByRole('button', { name: 'Got it' }).click();
  await expect(intro).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(intro).toHaveCount(0);
});

test('a player with an unfinished match is offered to rejoin it or leave it', async ({ page }) => {
  const { match } = await mockApis(page, 'neel');
  match.state = matchState({ you: viewer(), players: [player('sam'), player('neel')] });
  // not queued, and in a match that has not finished: that is how a reload finds it
  match.matchFound('m1');
  await page.goto('/');

  const banner = page.getByRole('region', { name: 'Unfinished match' });
  await expect(banner).toContainText('You are in a match that has not finished.');
  await banner.getByRole('button', { name: 'Rejoin match' }).click();
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();
  await expect(page.locator('.player-row').first()).toContainText('sam');
  expect(match.posted('leave')).toHaveLength(0);

  // a reload finds it again; this time the player lets it go
  await page.goto('/');
  await banner.getByRole('button', { name: 'Leave it' }).click();
  await expect(banner).toHaveCount(0);
  expect(match.posted('leave')).toEqual([{ action: 'leave', matchId: 'm1' }]);
});

test('a visitor, or a player with nothing open, sees no rejoin offer', async ({ page }) => {
  await mockApis(page, 'neel');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Unfinished match' })).toHaveCount(0);
});
