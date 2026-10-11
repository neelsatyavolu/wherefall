import { expect, test, type Page } from '@playwright/test';
import { matchState, player, viewer } from '../src/multiplayer/testing.ts';
import { mockServices } from './fixtures.ts';
import { scrollsSideways } from './helpers.ts';
import { MatchServer, signIn } from './match-server.ts';
import { SocialServer, friend } from './social-server.ts';

const title = (page: Page) => page.locator('.pane-title');
const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function setUp(page: Page, username: string | null = 'neel') {
  await mockServices(page);
  await signIn(page, username, 1016);
  const match = await MatchServer.install(page);
  const social = await SocialServer.install(page);
  return { match, social };
}

const GAME = {
  id: 'g1',
  playedAt: '2026-10-10T12:00:00.000Z',
  map: 'world',
  mode: 'move',
  timeLimit: 60,
  daily: null,
  score: 6200,
  maxScore: 10_000,
  kind: 'solo',
  result: null,
  ratingChange: null,
  players: 1,
  rounds: [
    { country: 'FR', distanceKm: 12.5, score: 4800, hinted: false, lng: 2.35, lat: 48.85, guessLng: 2.5, guessLat: 48.9 },
    { country: 'JP', distanceKm: 800, score: 1400, hinted: true, lng: 139.7, lat: 35.7, guessLng: 131, guessLat: 34 },
    { country: 'AR', distanceKm: null, score: 0, hinted: false, lng: -58.4, lat: -34.6, guessLng: null, guessLat: null },
  ],
};

test('the leaderboards show three boards, open to a visitor', async ({ page }) => {
  const { social } = await setUp(page, null);
  social.session = 'none';
  await page.goto('/#leaderboards');

  await expect(page.getByRole('radio', { name: 'Rating' })).toBeChecked();
  const rows = page.locator('.rounds tbody tr');
  // a player with a country has its flag before the name
  await expect(rows.nth(0).locator('td')).toHaveText(['1', /sam$/, 'Nomad', '12', '1,540']);
  await expect(rows).toHaveCount(3);
  // the board over all time is the one asked for
  expect(social.asked).toEqual(['leaderboard=rating&period=all']);
  await expect(page.locator('.rounds thead th').last()).toHaveText('Rating');

  await page.getByRole('radio', { name: 'XP' }).check();
  await expect(rows.nth(0).locator('td')).toHaveText(['1', /ana$/, 'Explorer', '15', '52,000']);
  // a visitor has no place of their own on a board
  await expect(page.getByText(/You are number/)).toHaveCount(0);
  await expect(page.locator('.rounds thead th').last()).toHaveText('XP');

  await page.getByRole('radio', { name: 'Best streak' }).check();
  await expect(page.getByText('No one is on this board yet.')).toBeVisible();
});

test('the signed-in player is marked on a board, and a name opens that profile and comes back', async ({ page }) => {
  const { social } = await setUp(page);
  await page.goto('/#leaderboards');
  // the row says whose it is in a word, not by its fill alone
  await expect(page.locator('.rounds tbody tr.own td').nth(1)).toHaveText('neelyou');
  await expect(page.getByText(/You are number/)).toHaveCount(0);
  // a player outside the rows shown is told where they stand
  await page.getByRole('radio', { name: 'XP' }).check();
  await expect(page.getByText('You are number 74 with 1,200.')).toBeVisible();
  await page.getByRole('radio', { name: 'Rating' }).check();

  await page.getByRole('link', { name: 'sam', exact: true }).click();
  await expect(page).toHaveURL(/\?user=sam$/);
  await expect(title(page)).toHaveText(/sam$/);
  await expect(page.getByText('Playing since September 2026')).toBeVisible();
  const stats = section(page, "sam's stats");
  await expect(stats.locator('.figure').filter({ hasText: 'League' })).toContainText('Nomad');
  await expect(stats.locator('.figure').filter({ has: page.getByText('Rating', { exact: true }) })).toContainText('1,540');
  await expect(stats.locator('.figure').filter({ hasText: 'Best streak' })).toContainText('23');
  await expect(section(page, 'Level')).toContainText('13');
  // the last thirty days of progress, which is what a profile is asked for, as four small line charts: XP, rating, and the place on each board
  expect(social.asked.at(-1)).toBe('profile=sam&range=30');
  const progress = section(page, 'Progress');
  await expect(progress.getByRole('img')).toHaveCount(4);
  await expect(progress.getByRole('img', { name: /^XP from Sep 20 to Oct 10: 30,000 at lowest, 36,000 at highest, now 36,000$/ })).toBeVisible();
  await expect(progress.getByRole('img', { name: /^Rating from Sep 20 to Oct 10: 1,455 at lowest, 1,540 at highest, now 1,540$/ })).toBeVisible();
  await expect(progress.locator('.chart-path').first()).toHaveAttribute('d', /^M8 88 L/);
  await expect(page.locator('.rounds tbody tr').first()).toContainText('Japan');
  // someone else's games cannot be opened
  await expect(page.getByRole('button', { name: /Rounds/ })).toHaveCount(0);
  await expect(page.locator('.nav-item[aria-current]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(title(page)).toHaveText('Leaderboards');
});

test('a profile link opens directly, and a name nobody has says so', async ({ page }) => {
  await setUp(page, null);
  await page.goto('/?user=sam');
  await expect(title(page)).toHaveText(/sam$/);
  await expect(section(page, "sam's stats")).toBeVisible();

  await page.goto('/?user=nobody_here');
  await expect(page.getByRole('alert')).toContainText('No player has that name.');
  await page.getByRole('link', { name: 'Singleplayer' }).click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});

test('friends: a request is sent, one is accepted, one declined, one removed', async ({ page }) => {
  const { social } = await setUp(page);
  social.friends = { friends: [friend('ana', { level: 2, league: 'Explorer', country: 'BR' })], incoming: ['kit', 'lee'], outgoing: [], invites: [] };
  await page.goto('/');
  // two requests are waiting
  await expect(page.locator('.badge')).toHaveText('2');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Friends/ }).click();

  await expect(section(page, 'Requests').locator('.player-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Accept kit' }).click();
  await expect(section(page, 'Friends').locator('.player-row')).toHaveText([/ana\s*level 2 · Explorer/, /kit/]);
  await page.getByRole('button', { name: 'Decline lee' }).click();
  await expect(section(page, 'Requests')).toHaveCount(0);
  await expect(page.locator('.badge')).toBeHidden();

  await page.getByLabel('Add a friend by username').fill('sam');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(section(page, 'Sent, waiting for an answer')).toContainText('sam');
  // a request can be taken back
  await page.getByLabel('Add a friend by username').fill('kim');
  await page.getByRole('button', { name: 'Send request' }).click();
  await page.getByRole('button', { name: 'Cancel the request to kim' }).click();
  await expect(section(page, 'Sent, waiting for an answer').locator('.player-row')).toHaveText([/sam/]);
  // removing a friend is asked once more in the row
  await page.getByRole('button', { name: 'Remove ana' }).click();
  await expect(section(page, 'Friends').getByRole('alert')).toHaveText('Remove ana from your friends?');
  await section(page, 'Friends').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(section(page, 'Friends').locator('.player-row')).toHaveCount(1);
  expect(social.posts).toEqual([
    { action: 'accept', username: 'kit' },
    { action: 'decline', username: 'lee' },
    { action: 'request', username: 'sam' },
    { action: 'request', username: 'kim' },
    { action: 'remove', username: 'kim' },
    { action: 'remove', username: 'ana' },
  ]);

  social.refuse = 'No player has that name.';
  await page.getByLabel('Add a friend by username').fill('ghost');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('alert')).toHaveText('No player has that name.');
});

test('friends: an empty list says how to start, and a visitor is asked to sign in', async ({ page }) => {
  await setUp(page);
  await page.goto('/#friends');
  await expect(page.getByText('No friends yet.')).toBeVisible();
  await expect(page.locator('.badge')).toBeHidden();

  await signIn(page, null);
  await page.reload();
  await expect(page.getByText('A friends list needs an account')).toBeVisible();
});

test("friends: an invite, or a friend's open party, can be joined from the pane", async ({ page }) => {
  const { social, match } = await setUp(page);
  match.state = matchState({ you: viewer(), players: [player('sam'), player('neel')] });
  social.friends = { friends: [friend('sam', { level: 13, league: 'Nomad', party: 'ABC123', online: true, lastSeenAt: '2026-10-11T11:59:00.000Z' })], incoming: [], outgoing: [], invites: [{ from: 'sam', code: 'ABC123' }] };
  await page.goto('/#friends');

  await expect(page.locator('.badge')).toHaveText('1');
  await expect(section(page, 'Party invites')).toContainText('sam');
  await expect(section(page, 'Friends').getByRole('button', { name: "Join sam's party" })).toBeVisible();
  await section(page, 'Party invites').getByRole('button', { name: "Join sam's party" }).click();
  expect(match.posted('join')).toEqual([{ action: 'join', code: 'ABC123' }]);
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();
});

test('the account pane shows level, league and stats, and a game opens round by round', async ({ page }) => {
  await setUp(page);
  await page.route('**/api/games?id=g1', (route) => route.fulfill({ json: { success: true, data: GAME } }));
  await page.goto('/#account');

  const level = section(page, 'Level');
  await expect(level).toContainText('3');
  await expect(level).toContainText('1,200 XP · 1,050 to level 4');
  await expect(level.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '16');
  const stats = section(page, 'Your stats');
  for (const [name, value] of [['League', 'Voyager'], ['Rating', '1,016'], ['Ranked duels', '3'], ['Best streak', '7'], ['Games', '4']]) {
    await expect(stats.locator('.figure').filter({ hasText: name! }).first()).toContainText(value!);
  }
  await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
  // an account from before history was kept has nothing to draw, and says so
  await expect(section(page, 'Progress')).toContainText('Not enough history to draw yet.');
  await expect(section(page, 'Progress').getByRole('img')).toHaveCount(0);

  await page.getByRole('button', { name: /Rounds of the game on Oct 10/ }).click();
  await expect(title(page)).toHaveText('Game');
  await expect(page.getByText('October 10, 2026 · World · 3 rounds · 1 min · move')).toBeVisible();
  const rows = page.locator('.rounds tbody tr');
  await expect(rows.nth(0).locator('td')).toHaveText(['1', 'France', '12.5 km', '4,800']);
  await expect(rows.nth(1).locator('td')).toHaveText(['2', 'Japan', '800 km', '1,400hint']);
  await expect(rows.nth(2).locator('td')).toHaveText(['3', 'Argentina', 'No guess', '0']);
  // each round's place, and a pin for each guess that was made
  await expect(page.locator('.history-map .pin-actual')).toHaveCount(3);
  await expect(page.locator('.history-map .pin-guess')).toHaveCount(2);

  await page.getByRole('button', { name: 'Back to account' }).click();
  await expect(title(page)).toHaveText('Account');
  await expect(section(page, 'Your stats')).toBeVisible();
});

test('a username can be changed, and a refusal is explained', async ({ page }) => {
  const { social } = await setUp(page);
  await page.goto('/#account');

  await page.getByRole('button', { name: 'Change username' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter the username you want.');
  social.refuse = 'You can change your name once every 30 days.';
  await page.getByLabel('New username').fill('Neel2');
  await page.getByRole('button', { name: 'Change username' }).click();
  await expect(page.getByRole('alert')).toHaveText('You can change your name once every 30 days.');
  await expect(page.getByRole('button', { name: 'Change username' })).toBeEnabled();

  social.refuse = null;
  await signIn(page, 'neel2', 1016);
  await page.getByRole('button', { name: 'Change username' }).click();
  expect(social.posted('rename').at(-1)).toEqual({ action: 'rename', username: 'Neel2' });
  await expect(page.locator('.account-who')).toContainText('neel2');
});

test('the new panes fit a phone without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const { social } = await setUp(page);
  social.friends = { friends: [friend('a_very_long_username', { level: 13, league: 'Voyager', party: 'ABC123' })], incoming: ['kit'], outgoing: ['lee'], invites: [{ from: 'sam', code: 'ABC123' }] };
  await page.route('**/api/games?id=g1', (route) => route.fulfill({ json: { success: true, data: GAME } }));
  for (const address of ['/#leaderboards', '/#friends', '/#account', '/?user=sam', '/#streak']) {
    await page.goto(address);
    await expect(title(page)).toBeVisible();
    await page.waitForTimeout(200);
    expect(await scrollsSideways(page), `${address} scrolls sideways`).toBe(false);
  }
  await page.goto('/#account');
  await page.getByRole('button', { name: /Rounds of the game/ }).click();
  await expect(page.locator('.history-map .pin-actual')).toHaveCount(3);
  expect(await scrollsSideways(page)).toBe(false);
});

test('a request to a player who has turned friend requests off is refused in the server\'s words', async ({ page }) => {
  const { social } = await setUp(page);
  social.requestsOff = ['kit'];
  await page.goto('/#friends');
  await page.getByLabel('Add a friend by username').fill('kit');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('alert')).toHaveText('That player is not accepting friend requests.');
  expect(social.posted('request')).toEqual([{ action: 'request', username: 'kit' }]);
  await expect(section(page, 'Sent, waiting for an answer')).toHaveCount(0);
});
