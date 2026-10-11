import { expect, test, type Locator } from '@playwright/test';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { boardEntries, friend } from './social-server.ts';
import { DESKTOP, PHONE, WIDE, box, open, section, setUp } from './wave6-panes-scenes.ts';

// The home screen's panes after the second design review, part two: its smaller findings.

test("the maps pane leads with a player's own maps, and a visitor's offer of an account comes last", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await setUp(page);
  await open(page, '/#maps');
  const headings = () => page.locator('.pane-section h3.label').allTextContents();
  expect(await headings()).toEqual(['My maps', 'Maps I like', 'Official maps', 'Popular community maps', 'Newest community maps']);

  const visitor = await page.context().newPage();
  await visitor.setViewportSize(DESKTOP);
  await setUp(visitor, { username: null });
  await open(visitor, '/#maps');
  expect(await visitor.locator('.pane-section h3.label').allTextContents()).toEqual(['Official maps', 'Popular community maps', 'Newest community maps', 'Maps I like']);
});

test("a player's own map offers no Report", async ({ page }) => {
  await setUp(page);
  await open(page, '/?community=my-coast-q1w2');
  await expect(page.getByRole('link', { name: 'Edit map' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Like', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Report' })).toHaveCount(0);
  await open(page, '/?community=paris-walk-x7k2');
  await expect(page.getByRole('button', { name: 'Report' })).toBeVisible();
});

test('the account pane keeps the country list and the password form closed until asked for', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { account } = await setUp(page);
  await open(page, '/#account');
  const before = await page.evaluate(() => document.documentElement.scrollHeight);
  await expect(page.getByLabel('Find a country')).toBeHidden();
  await expect(page.getByLabel('Current password')).toBeHidden();

  // the country: one button opens the list, picking one saves it and closes the list again
  const change = page.getByRole('button', { name: 'Change country' });
  await expect(change).toHaveAttribute('aria-expanded', 'false');
  await change.click();
  await expect(page.getByLabel('Find a country')).toBeFocused();
  await expect(change).toBeHidden();
  await page.getByLabel('Find a country').fill('fra');
  await page.getByRole('radio', { name: 'France' }).check({ force: true });
  await expect(page.locator('.country-now')).toHaveText(/France$/);
  await expect(page.getByLabel('Find a country')).toBeHidden();
  await expect(change).toBeFocused();
  expect(account.posted('country')).toHaveLength(1);
  // it can be closed without picking
  await change.click();
  await page.locator('.country-picker').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Find a country')).toBeHidden();

  // the password: one button opens the form; a refusal keeps it open, a change closes it and says so
  const section = page.locator('.account-section').filter({ has: page.getByRole('heading', { name: 'Change password' }) });
  await section.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByLabel('Current password')).toBeFocused();
  await section.getByRole('button', { name: 'Change password' }).click();
  await expect(section.getByRole('alert')).toHaveText('Enter your current password and a new one.');
  await page.getByLabel('Current password').fill('wrong');
  await page.getByLabel('New password', { exact: true }).fill('another horse staple');
  await section.getByRole('button', { name: 'Change password' }).click();
  await expect(section.getByRole('alert')).toHaveText('That is not your current password.');
  await page.getByLabel('Current password').fill(account.password);
  await section.getByRole('button', { name: 'Change password' }).click();
  await expect(section.getByText('Password changed.')).toBeVisible();
  await expect(page.getByLabel('Current password')).toBeHidden();
  // and closed by hand, it forgets what was typed
  await section.getByRole('button', { name: 'Change password' }).click();
  await page.getByLabel('Current password').fill('half typed');
  await section.getByRole('button', { name: 'Cancel' }).click();
  await section.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByLabel('Current password')).toHaveValue('');
  await section.getByRole('button', { name: 'Cancel' }).click();

  // closed, the pane is as long as it was: nothing was left open behind
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(before + 40);
});

test('every board turns its pages the same way: twenty players, Previous, the page, Next', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const { social, daily } = await setUp(page);
  daily.rounds = [4800, 3950, 2500];
  social.boards.all.xp = { entries: boardEntries(100).map((entry, i) => (i === 33 ? { ...entry, username: 'neel', country: 'IN' } : entry)), you: { rank: 34, value: 1967 } };
  await open(page, '/#leaderboards');
  await page.getByRole('radio', { name: 'XP', exact: true }).check({ force: true });
  const rows = page.locator('.board tbody:not(.board-own-row) tr');
  await expect(rows).toHaveCount(20);
  await expect(page.locator('.pager-page')).toHaveText('Page 1');
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
  // the player's own row is under a page they are not on, as on the daily's board
  await expect(page.locator('.board tbody.board-own-row tr')).toHaveText(/^34.*neel\s*you/);
  await expect(page.locator('.board .tag')).toHaveCount(1);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.pager-page')).toHaveText('Page 2');
  await expect(rows.first().locator('td').first()).toHaveText('21');
  await expect(rows).toHaveCount(20);
  await expect(page.locator('.board tbody.board-own-row')).toHaveCount(0);
  await expect(page.locator('.board tr.own')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
  for (const turn of [3, 4, 5]) {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('.pager-page')).toHaveText(`Page ${turn}`);
  }
  await expect(rows.last().locator('td').first()).toHaveText('100');
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous' })).toBeFocused();
  // a board that fits one page has no pager; another board starts at its first page
  await page.getByRole('radio', { name: 'Rating', exact: true }).check({ force: true });
  await expect(rows).toHaveCount(3);
  await expect(page.locator('.pager')).toBeHidden();

  // the daily's board is the same pager, twenty to a page
  await open(page, '/#daily');
  await expect(page.locator('.daily-board tbody:not(.daily-own-row) tr')).toHaveCount(20);
  await expect(page.locator('.daily-board .pager .pager-page')).toHaveText('Page 1');
  await expect(page.locator('.daily-board .pager .button')).toHaveText(['Previous', 'Next']);
});

/** How a button is drawn: filled (the canvas's ink behind it), in the danger colour, or a plain ghost. */
const drawn = (locator: Locator) =>
  locator.evaluateAll((buttons) => buttons.map((button) => (button.classList.contains('danger') ? 'danger' : button.classList.contains('primary') || button.classList.contains('accent') ? 'filled' : 'ghost')));

test('the moderation pane has plain buttons at rest, and asks in the row before a removal or a ban', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const { social } = await setUp(page);
  await open(page, '/#moderation');
  expect(new Set(await drawn(page.locator('.player-row .button')))).toEqual(new Set(['ghost']));

  const kit = page.locator('.player-row').filter({ hasText: 'kit' });
  await kit.getByRole('button', { name: 'Ban kit from online play' }).click();
  await expect(kit.getByRole('alert')).toHaveText('Ban kit? They can no longer play online. Playing alone still works.');
  // the safe answer is the filled one and has the keyboard; the ban is the only red on the pane
  await expect(kit.getByRole('button', { name: 'Cancel' })).toBeFocused();
  expect(await drawn(kit.locator('.button'))).toEqual(['filled', 'danger']);
  expect((await drawn(page.locator('.pane .button'))).filter((each) => each !== 'ghost')).toHaveLength(2);
  await kit.getByRole('button', { name: 'Cancel' }).click();
  await expect(kit.getByRole('button', { name: 'Ban kit from online play' })).toBeFocused();
  expect(social.posted('moderate')).toHaveLength(0);

  await kit.getByRole('button', { name: 'Ban kit from online play' }).click();
  await kit.getByRole('button', { name: 'Ban', exact: true }).click();
  // the row's own tag: each open report under it has a tag for its category
  await expect(kit.locator('> .tag')).toContainText('banned');
  expect(social.posted('moderate')).toEqual([expect.objectContaining({ username: 'kit', decision: 'ban' })]);

  const map = page.locator('.player-row').filter({ hasText: 'Paris walk' });
  await map.getByRole('button', { name: 'Remove the map Paris walk' }).click();
  await expect(map.getByRole('alert')).toHaveText('Remove the map Paris walk? It is deleted for everyone and cannot be brought back.');
  await map.getByRole('button', { name: 'Remove map' }).click();
  await expect(page.getByText('No map is waiting for a decision.')).toBeVisible();
  // dismissing reports loses nothing, and is not asked about
  await page.locator('.player-row').filter({ hasText: 'lee' }).getByRole('button', { name: 'Dismiss the reports on lee' }).click();
  await expect(page.locator('.player-row').filter({ hasText: 'lee' })).toHaveCount(0);
});

test('the friends list has no red at rest: removing a friend is asked once more in the row', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { social } = await setUp(page);
  social.friends = { friends: [friend('sam', { party: 'ABC123', online: true }), friend('ana'), friend('kit'), friend('lee')], incoming: [], outgoing: [], invites: [] };
  await open(page, '/#friends');
  const list = section(page, 'Friends');
  expect((await drawn(list.locator('.button'))).filter((each) => each === 'danger')).toEqual([]);

  const ana = list.locator('.player-row').filter({ hasText: 'ana' });
  await ana.getByRole('button', { name: 'Remove ana' }).click();
  await expect(ana.getByRole('alert')).toHaveText('Remove ana from your friends?');
  expect(await drawn(ana.locator('.button'))).toEqual(['filled', 'danger']);
  // both answers are a finger wide and tall, and the question does not leave the screen
  const answers = await ana.locator('.button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect()).map((rect) => [Math.round(rect.width), Math.round(rect.height), Math.round(rect.right)]));
  expect(answers.filter(([width, height, right]) => width! < 44 || height! < 44 || right! > 390)).toEqual([]);
  await ana.getByRole('button', { name: 'Cancel' }).click();
  await expect(list.locator('.player-row')).toHaveCount(4);
  expect(social.posted('remove')).toHaveLength(0);

  await ana.getByRole('button', { name: 'Remove ana' }).click();
  await ana.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(list.locator('.player-row')).toHaveCount(3);
  expect(social.posted('remove')).toEqual([expect.objectContaining({ username: 'ana' })]);
});

test('a profile has one right edge: its period control and its games table are as wide as its charts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setUp(page);
  await open(page, '/?user=sam');
  await expect(page.locator('.chart')).toHaveCount(4);
  const left = (await box(page.locator('.pane-title'))).x;
  const right = async (locator: Locator) => Math.round((await box(locator)).x + (await box(locator)).width - left);
  expect(await right(page.locator('.account-stats').first())).toBe(WIDE);
  expect(await right(page.locator('.charts'))).toBe(WIDE);
  expect(await right(page.getByRole('group', { name: 'Period' }))).toBe(WIDE);
  expect(await right(page.locator('.pane-stack > .wide .account-table').last())).toBe(WIDE);
});


// --- the moderation pane is a moderator's ------------------------------------------------------------------------

test('anyone but a moderator is told the moderation pane is for moderators, with the way home, and the reports are not asked for', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { account } = await setUp(page, { account: { moderator: false } });
  const asked: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/.*moderation/.test(request.url())) {
      asked.push(request.url());
    }
  });
  const notice = page.locator('.pane-body .notice');

  // a player who is no moderator: not the sentence about what an account adds, and nothing to sign in to
  await open(page, '/#moderation');
  await expect(page.locator('.pane-title')).toHaveText('Moderation');
  await expect(notice.locator('.prose')).toHaveText('This pane is for moderators.');
  await expect(notice.getByRole('link')).toHaveText(['Home']);
  await expect(page.locator('.player-row')).toHaveCount(0);

  // a guest is told the same
  account.becomeGuest('Guest #4821');
  await page.reload();
  await expect(page.locator('.guest-badge, .nav').first()).toBeVisible();
  await expect(notice.locator('.prose')).toHaveText('This pane is for moderators.');
  await expect(notice.getByRole('link')).toHaveText(['Home']);

  // a visitor may be a moderator who has not signed in: home is still the filled way on, signing in beside it
  account.signOut();
  await page.reload();
  await expect(notice.locator('.prose')).toHaveText('This pane is for moderators. If you are one, sign in first.');
  await expect(notice.getByRole('link')).toHaveText(['Home', 'Sign in or create an account']);
  expect(await drawn(notice.locator('.button'))).toEqual(['filled', 'ghost']);
  expect(asked).toEqual([]);
  await notice.getByRole('link', { name: 'Home' }).click();
  await expect(page.locator('.pane-title')).toHaveText('Singleplayer');
});

for (const code of ['de', 'ru'] as const) {
  test(`${code}: the moderators-only notice is in the language and fits a phone`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await setUp(page, { language: code, username: null });
    await open(page, '/#moderation');
    await expect(page.locator('.pane-body .notice .prose')).toHaveText(CATALOGS[code]!['moderation.forModerators.visitor']);
    await expectTranslated(page, code);
  });
}
