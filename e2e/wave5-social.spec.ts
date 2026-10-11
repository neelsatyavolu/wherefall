import { expect, test, type Page } from '@playwright/test';
import type { Profile } from '../src/social/client.ts';
import { mockServices } from './fixtures.ts';
import { scrollsSideways } from './helpers.ts';
import { expectTranslated } from './language-checks.ts';
import { MatchServer, signIn } from './match-server.ts';
import { SocialServer, boardEntries, friend, profile } from './social-server.ts';

// Wave 5, other players: profiles and their charts, the boards, friends' presence, who is online.

const NOW = '2026-10-11T12:00:00.000Z';
const title = (page: Page) => page.locator('.pane-title');
const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const figure = (page: Page, name: string) => page.locator('.figure').filter({ has: page.getByText(name, { exact: true }) });
const chart = (page: Page, name: string) => section(page, 'Progress').locator('.chart').filter({ has: page.locator('.chart-head .label').getByText(name, { exact: true }) });

async function setUp(page: Page, username: string | null = 'neel') {
  await mockServices(page);
  await signIn(page, username, 1016);
  await MatchServer.install(page);
  const social = await SocialServer.install(page);
  if (username === null) {
    social.session = 'none';
  }
  return social;
}

/** Forty days of history up to 10 October; the places on the boards were only kept from the 21st day on. */
const LONG_HISTORY: Profile['history'] = Array.from({ length: 40 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
  return { day, xp: 20_000 + i * 400, rating: 1400 + (i % 7) * 5 + i, xpRank: i < 20 ? null : 45 - i, ratingRank: i < 20 ? null : 12 - Math.floor(i / 5) };
});

const hidePage = (page: Page, hidden: boolean) =>
  page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden ? 'hidden' : 'visible');

test('a profile draws XP, XP rank, rating and rating rank, with a gap where no rank was kept', async ({ page }) => {
  const social = await setUp(page);
  await page.goto('/?user=sam');
  const progress = section(page, 'Progress');
  await expect(progress.getByRole('img')).toHaveCount(4);
  expect(social.asked).toEqual(['profile=sam&range=30']);
  await expect(progress.getByRole('img', { name: 'XP from Sep 20 to Oct 10: 30,000 at lowest, 36,000 at highest, now 36,000' })).toBeVisible();
  await expect(progress.getByRole('img', { name: 'Rating from Sep 20 to Oct 10: 1,455 at lowest, 1,540 at highest, now 1,540' })).toBeVisible();
  // a rank is only told from the first day it was kept
  await expect(progress.getByRole('img', { name: 'XP rank from Oct 4 to Oct 10: best place 2, lowest 3, now 2' })).toBeVisible();
  await expect(progress.getByRole('img', { name: 'Rating rank from Oct 4 to Oct 10: best place 1, lowest 2, now 1' })).toBeVisible();

  // XP runs the whole twenty days, low values at the bottom
  await expect(chart(page, 'XP').locator('.chart-path')).toHaveAttribute('d', /^M8 88 L129\.6 /);
  // the rank lines start on 4 October, fourteen of the twenty days across: nothing is drawn over the days before.
  // Lower is better, so going from third to second place is a line going up
  await expect(chart(page, 'XP rank').locator('.chart-path')).toHaveAttribute('d', 'M220.8 88 L312 8');
  await expect(chart(page, 'Rating rank').locator('.chart-path')).toHaveAttribute('d', 'M220.8 88 L312 8');
  await expect(chart(page, 'XP rank').locator('.chart-axis span')).toHaveText(['2', '3']);
  await expect(chart(page, 'Rating').locator('.chart-axis span')).toHaveText(['1,540', '1,455']);
  // every chart covers the same days, so the gap reads as a gap
  await expect(chart(page, 'XP rank').locator('.chart-range time')).toHaveText(['Sep 20', 'Oct 10']);
  await expect(progress.getByText('Ranks are recorded from Oct 4 on.')).toBeVisible();

  // the numbers are there to read as well, a dash where nothing was recorded
  await progress.getByText('Show the numbers').click();
  const rows = progress.locator('.chart-table tbody tr');
  await expect(progress.locator('.chart-table thead th')).toHaveText(['Date', 'XP', '#', 'Rating', '#']);
  await expect(progress.getByRole('columnheader', { name: 'Rating rank' })).toBeVisible();
  await expect(rows.first().locator('td')).toHaveText(['Oct 10', '36,000', '2', '1,540', '1']);
  await expect(rows.last().locator('td')).toHaveText(['Sep 20', '30,000', '—', '1,480', '—']);
});

test('a chart is read day by day with the pointer or the arrow keys', async ({ page }) => {
  await setUp(page);
  await page.goto('/?user=sam');
  const ranks = chart(page, 'XP rank');
  await expect(ranks.locator('.chart-now')).toHaveText('2');
  // the headline says which day its figure is of: the latest one recorded
  await expect(ranks.locator('.chart-when')).toHaveText('Oct 10');

  await ranks.locator('.chart-line').scrollIntoViewIfNeeded();
  const box = (await ranks.locator('.chart-line').boundingBox())!;
  // the left edge is 20 September, from before ranks were kept
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await expect(ranks.locator('.chart-when')).toHaveText('Sep 20');
  await expect(ranks.locator('.chart-now')).toHaveText('not recorded');
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await expect(ranks.locator('.chart-when')).toHaveText('Oct 4');
  await expect(ranks.locator('.chart-now')).toHaveText('3');
  // moving away brings back where it stands now
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 60);
  await expect(ranks.locator('.chart-when')).toHaveText('Oct 10');
  await expect(ranks.locator('.chart-now')).toHaveText('2');

  const xp = chart(page, 'XP');
  await xp.locator('.chart-line').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(xp.locator('.chart-when')).toHaveText('Oct 10');
  await page.keyboard.press('ArrowLeft');
  await expect(xp.locator('.chart-when')).toHaveText('Oct 4');
  await expect(xp.locator('.chart-now')).toHaveText('34,200');
  await page.keyboard.press('Home');
  await expect(xp.locator('.chart-now')).toHaveText('30,000');
  await page.keyboard.press('Escape');
  await expect(xp.locator('.chart-now')).toHaveText('36,000');
});

test('the charts cover 7 days, 30 days or all time, and a range that fails keeps what was drawn', async ({ page }) => {
  const social = await setUp(page);
  social.profiles = { ...social.profiles, sam: { ...social.profiles.sam!, history: LONG_HISTORY } };
  await page.goto('/?user=sam');
  const progress = section(page, 'Progress');
  const days = chart(page, 'XP').locator('.chart-range time');
  await expect(progress.getByRole('radio', { name: '30 days' })).toBeChecked();
  await expect(days).toHaveText(['Sep 11', 'Oct 10']);
  // the first twenty of the forty days have no rank: ten of those are in the last thirty
  await expect(progress.getByText('Ranks are recorded from Sep 21 on.')).toBeVisible();

  await progress.getByRole('radio', { name: '7 days' }).check();
  await expect(days).toHaveText(['Oct 4', 'Oct 10']);
  await expect(progress.getByText(/Ranks are recorded from/)).toHaveCount(0);
  await expect(progress.getByRole('img')).toHaveCount(4);

  await progress.getByRole('radio', { name: 'All time' }).check();
  await expect(days).toHaveText(['Sep 1', 'Oct 10']);
  await expect(chart(page, 'Rating rank').locator('.chart-axis span')).toHaveText(['5', '8']);
  expect(social.asked).toEqual(['profile=sam&range=30', 'profile=sam&range=7', 'profile=sam&range=all']);
  // only the charts change: the profile's own figures are not drawn again
  await expect(page.getByText('Viewed 118 times')).toBeVisible();

  await page.route((url) => url.search === '?profile=sam&range=7', (route) => route.fulfill({ status: 500, json: { success: false, error: 'The server could not answer. Try again.' } }));
  await progress.getByRole('radio', { name: '7 days' }).check();
  await expect(progress.getByRole('alert')).toHaveText('The server could not answer. Try again.');
  await expect(days).toHaveText(['Sep 1', 'Oct 10']);
  await expect(progress.locator('.chart-body')).not.toHaveClass(/stale/);
  await progress.getByRole('radio', { name: '30 days' }).check();
  await expect(days).toHaveText(['Sep 11', 'Oct 10']);
  await expect(progress.locator('.account-error')).toBeEmpty();
});

test('a profile with no rank kept yet says so in place of the two rank charts, and one with no history draws nothing', async ({ page }) => {
  const social = await setUp(page);
  social.profiles = { ...social.profiles, sam: { ...social.profiles.sam!, history: social.profiles.sam!.history.slice(0, 2) } };
  await page.goto('/?user=sam');
  const progress = section(page, 'Progress');
  await expect(progress.getByRole('img')).toHaveCount(2);
  await expect(progress.getByText('No rank was recorded on these days.')).toHaveCount(2);

  await page.goto('/?user=neel');
  await expect(section(page, 'Progress')).toContainText('Not enough history to draw yet.');
  await expect(section(page, 'Progress').getByRole('img')).toHaveCount(0);
});

test('a profile shows the flag, views, presence, the duel record and the two guesser bests', async ({ page }) => {
  const social = await setUp(page);
  await page.clock.setFixedTime(new Date(NOW));
  social.profiles = {
    ...social.profiles,
    kit: profile('kit', { views: 1, lastSeenAt: '2026-10-11T09:00:00.000Z' }),
    lee: profile('lee', { country: 'JP', lastSeenAt: '2026-10-10T08:00:00.000Z' }),
  };
  await page.goto('/?user=sam');
  await expect(title(page)).toHaveText(/sam$/);
  await expect(title(page).getByRole('img', { name: 'United Kingdom' })).toBeVisible();
  await expect(page.locator('.profile-who .presence')).toHaveText('Online');
  await expect(page.locator('.profile-who .presence')).toHaveClass(/online/);
  await expect(page.getByText('Viewed 118 times')).toBeVisible();
  // the player's own figures: the 2v2 record under them has a win rate of its own
  const stats = section(page, "sam's stats");
  for (const [name, value] of [['Ranked duels', '40'], ['Duels won', '24'], ['Duels lost', '14'], ['Duels tied', '2'], ['Win rate', '60%'], ['Rating rank', '1'], ['Country Guesser', '9,000'], ['Continent Guesser', '10,000']]) {
    await expect(stats.locator('.figure').filter({ has: page.getByText(name!, { exact: true }) }).locator('.figure-value'), name).toHaveText(value!);
  }

  await page.goto('/?user=kit');
  await expect(title(page)).toHaveText('kit');
  await expect(title(page).getByRole('img')).toHaveCount(0);
  await expect(page.locator('.profile-who .presence')).toHaveText('Last seen 3 hours ago');
  await expect(page.locator('.profile-who .presence')).not.toHaveClass(/online/);
  await expect(page.getByText('Viewed 1 time', { exact: true })).toBeVisible();
  // a player who is on no board has no place on it
  await expect(figure(page, 'Rating rank').locator('.figure-value')).toHaveText('—');

  await page.goto('/?user=lee');
  await expect(title(page).getByRole('img', { name: 'Japan' })).toBeVisible();
  await expect(page.locator('.profile-who .presence')).toHaveText('Last seen yesterday');
  // the signed-in player's own account is from before anyone was seen: with no time to give, it is only offline
  await page.goto('/?user=neel');
  await expect(page.locator('.profile-who .presence')).toHaveText('Offline');
});

test('the friend button follows how the two players stand', async ({ page }) => {
  const social = await setUp(page);
  const offer = page.locator('.friend-offer');
  const stands = (friendship: Profile['friend']) => {
    social.profiles = { ...social.profiles, sam: { ...social.profiles.sam!, friend: friendship } };
  };

  // a stranger: a request is offered, and once sent it says so
  await page.goto('/?user=sam');
  await offer.getByRole('button', { name: 'Send friend request' }).click();
  await expect(offer.getByRole('status')).toHaveText('Friend request sent');
  await expect(offer.getByRole('button')).toHaveCount(0);
  expect(social.posted('request')).toEqual([{ action: 'request', username: 'sam' }]);

  stands('outgoing');
  await page.reload();
  await expect(offer.getByRole('status')).toHaveText('Friend request sent');
  await expect(offer.getByRole('button')).toHaveCount(0);

  // they asked first: accepting makes the two friends
  stands('incoming');
  await page.reload();
  await offer.getByRole('button', { name: 'Accept friend request' }).click();
  await expect(offer.getByRole('status')).toHaveText('You are friends');
  expect(social.posted('accept')).toEqual([{ action: 'accept', username: 'sam' }]);

  stands('friends');
  await page.reload();
  await expect(offer.getByRole('status')).toHaveText('You are friends');
  await expect(offer.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Report player' })).toBeVisible();

  // nothing on the player's own profile, which cannot be reported either
  await page.goto('/?user=neel');
  await expect(page.locator('.profile-who .presence')).toBeVisible();
  await expect(offer).toBeEmpty();
  await expect(page.getByRole('button', { name: 'Report player' })).toHaveCount(0);
});

test('a visitor and a guest get no friend button, and a player who takes no requests refuses in the server\'s words', async ({ page }) => {
  const social = await setUp(page, null);
  await page.goto('/?user=sam');
  await expect(page.getByText('Viewed 118 times')).toBeVisible();
  await expect(page.locator('.friend-offer')).toBeEmpty();
  await expect(page.getByRole('button', { name: 'Report player' })).toHaveCount(0);

  social.session = 'guest';
  await page.reload();
  await expect(page.getByText('Viewed 118 times')).toBeVisible();
  await expect(page.locator('.friend-offer')).toBeEmpty();

  social.session = 'account';
  social.requestsOff = ['sam'];
  await signIn(page, 'neel', 1016);
  await page.reload();
  const ask = page.getByRole('button', { name: 'Send friend request' });
  await ask.click();
  await expect(page.locator('.friend-offer').getByRole('alert')).toHaveText('That player is not accepting friend requests.');
  // the way on: the button is there to try again
  await expect(ask).toBeEnabled();
});

test('a board shows the top hundred, twenty to a page, with flags and medals, and the player\'s own place when outside them', async ({ page }) => {
  const social = await setUp(page);
  social.boards.all.xp = { entries: boardEntries(140), you: { rank: 120, value: 1881 } };
  await page.goto('/#leaderboards');
  const rows = page.locator('.board tbody:not(.board-own-row) tr');
  await expect(rows).toHaveCount(3);
  // the top three wear a medal that is named, not only coloured
  await expect(rows.nth(0).getByRole('img', { name: 'First place' })).toHaveText('1');
  await expect(rows.nth(1).getByRole('img', { name: 'Second place' })).toHaveText('2');
  await expect(rows.nth(2).getByRole('img', { name: 'Third place' })).toHaveText('3');
  await expect(rows.nth(0).getByRole('img', { name: 'United Kingdom' })).toBeVisible();
  await expect(rows.nth(2).getByRole('img', { name: 'Brazil' })).toBeVisible();
  // a player with no country has no flag
  await expect(rows.nth(1).locator('.flag')).toHaveCount(0);
  await expect(page.getByText('All time. Inactive players, not seen for 14 days, are left out.')).toBeVisible();

  await page.getByRole('radio', { name: 'XP' }).check();
  await expect(rows).toHaveCount(20);
  await expect(rows.nth(3).locator('td').first()).toHaveText('4');
  await expect(rows.nth(3).locator('.medal')).toHaveCount(0);
  await expect(page.locator('.board .medal')).toHaveCount(3);
  // every fourth of the stand-in players is German
  await expect(page.locator('.board').getByRole('img', { name: 'Germany' })).toHaveCount(5);
  // the hundred the server sends, and no more, over five pages
  for (const turn of [2, 3, 4, 5]) {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('.pager-page')).toHaveText(`Page ${turn}`);
  }
  await expect(rows.last().locator('td').first()).toHaveText('100');
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await expect(page.getByText('You are number 120 with 1,881.')).toBeVisible();
  await expect(page.locator('.board tr.own')).toHaveCount(0);

  // (the last page: its second row is the 82nd player)
  await rows.nth(1).getByRole('link', { name: 'player082' }).click();
  await expect(page).toHaveURL(/\?user=player082$/);
});

test('each board has a view of today beside all time, and an empty one says what that means', async ({ page }) => {
  const social = await setUp(page);
  await page.goto('/#leaderboards');
  const rows = page.locator('.board tbody tr');
  const lastHead = page.locator('.board thead th').last();
  await expect(page.getByRole('radio', { name: 'All time' })).toBeChecked();
  await expect(rows.nth(0).locator('td')).toHaveText(['1', /sam$/, 'Nomad', '12', '1,540']);

  // today is what was gained today: written with its sign, under a heading that says so
  await page.getByRole('radio', { name: 'Today' }).check();
  await expect(rows.nth(0).locator('td')).toHaveText(['1', /ana$/, 'Explorer', '2', '+31']);
  await expect(rows.nth(1)).toHaveClass(/own/);
  await expect(lastHead).toHaveText('Gain');
  await expect(page.getByText('Rating gained in ranked duels today. The day changes at midnight UTC.')).toBeVisible();

  // the period stays as the board changes
  await page.getByRole('radio', { name: 'XP' }).check();
  await expect(rows.nth(0).locator('td')).toHaveText(['1', /sam$/, 'Nomad', '13', '+640']);
  await expect(page.getByText('XP earned today.')).toBeVisible();

  await page.getByRole('radio', { name: 'Best streak' }).check();
  await expect(page.getByText('No one is on this board yet today. It lists only players who gained something since midnight UTC, and starts empty each day.')).toBeVisible();
  await expect(page.getByText('The longest streak run made today.')).toBeVisible();

  await page.getByRole('radio', { name: 'All time' }).check();
  await expect(page.getByText('No one is on this board yet.', { exact: true })).toBeVisible();
  expect(social.asked).toEqual(['leaderboard=rating&period=all', 'leaderboard=rating&period=day', 'leaderboard=xp&period=day', 'leaderboard=streak&period=day', 'leaderboard=streak&period=all']);

  // a streak run made today is a count, not a gain
  social.boards.day.streak = { entries: boardEntries(2, 9), you: null };
  await page.getByRole('radio', { name: 'Today' }).check();
  await expect(rows.nth(0).locator('td').last()).toHaveText('9');
  await expect(lastHead).toHaveText('Streak');
});

test('a board fits a phone: place, player and value, with nothing running off the side', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const social = await setUp(page);
  social.boards.all.rating = { entries: boardEntries(100).map((entry, i) => (i === 6 ? { ...entry, username: 'a_very_long_username' } : entry)), you: { rank: 7, value: 1994 } };
  await page.goto('/#leaderboards');
  const rows = page.locator('.board tbody:not(.board-own-row) tr');
  await expect(rows).toHaveCount(20);
  await expect(rows.nth(0).locator('td:visible')).toHaveCount(3);
  await expect(page.locator('.board thead th:visible')).toHaveText(['#', 'Player', 'Rating']);
  expect(await scrollsSideways(page)).toBe(false);
  for (const turn of [2, 3, 4, 5]) {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('.pager-page')).toHaveText(`Page ${turn}`);
  }
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last().locator('td:visible')).toHaveText(['100', 'player100', '1,901']);
  expect(await scrollsSideways(page)).toBe(false);
});

test('friends show their flag, and who is online or when they were last seen', async ({ page }) => {
  const social = await setUp(page);
  await page.clock.install({ time: new Date(NOW) });
  social.friends = {
    friends: [
      friend('sam', { country: 'GB', level: 13, league: 'Nomad', online: true, lastSeenAt: '2026-10-11T11:59:30.000Z' }),
      friend('ana', { country: 'BR', level: 2, league: 'Explorer', lastSeenAt: '2026-10-11T09:00:00.000Z' }),
      friend('kit'),
    ],
    incoming: [],
    outgoing: [],
    invites: [],
  };
  await page.goto('/#friends');
  const rows = section(page, 'Friends').locator('.player-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('.presence')).toHaveText('Online');
  await expect(rows.nth(0).locator('.presence')).toHaveClass(/online/);
  await expect(rows.nth(0).getByRole('img', { name: 'United Kingdom' })).toBeVisible();
  await expect(rows.nth(1).locator('.presence')).toHaveText('Last seen 3 hours ago');
  await expect(rows.nth(1).locator('.presence')).not.toHaveClass(/online/);
  await expect(rows.nth(1).getByRole('img', { name: 'Brazil' })).toBeVisible();
  await expect(rows.nth(2).locator('.presence')).toHaveText('Offline');
  await expect(rows.nth(2).locator('.flag')).toHaveCount(0);

  // on a page left open the wording keeps up with the clock, though nothing new came from the server
  await page.clock.fastForward('01:00:00');
  await expect(rows.nth(1).locator('.presence')).toHaveText('Last seen 4 hours ago');
  // and a friend who has gone is shown as gone
  social.friends = { ...social.friends, friends: social.friends.friends.map((each) => (each.username === 'sam' ? { ...each, online: false } : each)) };
  await page.clock.fastForward(10_000);
  await expect(rows.nth(0).locator('.presence')).toHaveText('Last seen 1 hour ago');
});

test('the sidebar counts the players online, asking once a minute and never while the page is hidden', async ({ page }) => {
  const social = await setUp(page);
  await page.clock.install({ time: new Date(NOW) });
  await page.goto('/');
  const count = page.locator('.sidebar .online-count');
  await expect(count).toHaveText('37 online');
  await expect(count).toHaveAttribute('title', '37 players online');
  expect(social.heartbeats).toBe(1);

  // moving about the home screen is no reason to ask again
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Leaderboards' }).click();
  await expect(title(page)).toHaveText('Leaderboards');
  await page.clock.fastForward(59_000);
  expect(social.heartbeats).toBe(1);

  social.online = 1;
  await page.clock.fastForward(1000);
  await expect(count).toHaveText('1 online');
  await expect(count).toHaveAttribute('title', '1 player online');
  expect(social.heartbeats).toBe(2);

  // a hidden page is not a player who is here: it stops asking
  await hidePage(page, true);
  await page.clock.fastForward('10:00');
  expect(social.heartbeats).toBe(2);

  // and asks at once when it is looked at again, then every minute from there
  social.online = 52;
  await hidePage(page, false);
  await expect(count).toHaveText('52 online');
  expect(social.heartbeats).toBe(3);
  await page.clock.fastForward(60_000);
  await expect.poll(() => social.heartbeats).toBe(4);
});

test('a failed count shows nothing and is asked for again at the next minute; a visitor sees the count too', async ({ page }) => {
  const social = await setUp(page, null);
  await page.clock.install({ time: new Date(NOW) });
  let down = true;
  await page.route((url) => url.pathname === '/api/social' && url.searchParams.has('online'), (route) => (down ? route.fulfill({ status: 500, json: { success: false, error: 'Something went wrong.' } }) : route.fallback()));
  await page.goto('/');
  await expect(title(page)).toBeVisible();
  const count = page.locator('.sidebar .online-count');
  await expect(count).toBeHidden();
  await expect(page.getByRole('alert')).toHaveCount(0);

  down = false;
  await page.clock.fastForward(60_000);
  await expect(count).toHaveText('37 online');
  expect(social.heartbeats).toBe(1);

  down = true;
  await page.clock.fastForward(60_000);
  await expect(count).toBeHidden();
});

test('the count sits above the wordmark, or beside it on a phone, and the sidebar still fits a laptop screen', async ({ page }) => {
  await setUp(page);
  await page.setViewportSize({ width: 1360, height: 840 });
  await page.goto('/');
  const count = page.locator('.sidebar .online-count');
  await expect(count).toHaveText('37 online');
  expect(await page.locator('.sidebar').evaluate((sidebar) => sidebar.scrollHeight <= sidebar.clientHeight)).toBe(true);
  const [wide, above] = [(await page.locator('.wordmark').boundingBox())!, (await count.boundingBox())!];
  expect(above.y + above.height).toBeLessThanOrEqual(wide.y);

  await page.setViewportSize({ width: 390, height: 800 });
  const [mark, line] = [(await page.locator('.wordmark').boundingBox())!, (await count.boundingBox())!];
  expect(line.y).toBeGreaterThanOrEqual(mark.y - 1);
  expect(line.y + line.height).toBeLessThanOrEqual(mark.y + mark.height + 1);
  // clear of the word itself, at the far end of its line
  const caret = (await page.locator('.wordmark .caret').boundingBox())!;
  expect(line.x).toBeGreaterThan(caret.x + caret.width);
  expect(line.x + line.width).toBeLessThanOrEqual(mark.x + mark.width + 1);
  expect(await scrollsSideways(page)).toBe(false);
});

/** what the players typed, and a flag's letters where the platform draws no flags */
const NAMES = ['neel', 'sam', 'ana', 'kit', 'lee', 'GB', 'BR', 'DE', ...boardEntries(100).map((entry) => entry.username)];
/** dates are written by the browser for the language, not taken from a catalog */
const dates = (page: Page) => page.locator('time').allTextContents();

for (const code of ['es', 'fr', 'de', 'ru']) {
  test(`${code}: a profile, a board and the friends pane are in the language and fit a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const social = await setUp(page);
    await page.clock.setFixedTime(new Date(NOW));
    await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
    social.profiles = { ...social.profiles, sam: { ...social.profiles.sam!, history: LONG_HISTORY }, kit: profile('kit', { friend: 'incoming', lastSeenAt: '2026-10-09T09:00:00.000Z' }) };
    social.boards.all.rating = { entries: boardEntries(100), you: { rank: 120, value: 1500 } };
    social.friends = {
      friends: [friend('sam', { country: 'GB', level: 13, league: 'Nomad', online: true, lastSeenAt: NOW }), friend('ana', { country: 'BR', lastSeenAt: '2026-10-11T09:00:00.000Z' }), friend('kit')],
      incoming: ['lee'],
      outgoing: [],
      invites: [],
    };

    await page.goto('/?user=sam');
    await expect(page.locator('.chart-line')).toHaveCount(4);
    await page.locator('.chart-table summary').click();
    await expect(page.locator('.chart-table tbody tr')).toHaveCount(30);
    // an English date would be a sign the language was not followed
    expect(await dates(page)).not.toContain('Oct 10');
    await expectTranslated(page, code, [...NAMES, ...(await dates(page))]);
    // each standing of the friend button, as a button and as a line
    await page.locator('.friend-offer button').click();
    await expect(page.locator('.friend-offer [role=status]')).toBeVisible();
    await expectTranslated(page, code, [...NAMES, ...(await dates(page))]);
    await page.goto('/?user=kit');
    await expect(page.locator('.friend-offer button')).toBeVisible();
    await expectTranslated(page, code, NAMES);

    await page.goto('/#leaderboards');
    await expect(page.locator('.board tbody tr')).toHaveCount(20);
    await expectTranslated(page, code, NAMES);
    // today's board, full and empty
    await page.locator('input[name=period][value=day]').check();
    await expect(page.locator('.board tbody tr')).toHaveCount(2);
    await expectTranslated(page, code, NAMES);
    await page.locator('input[name=board][value=streak]').check();
    await expect(page.locator('.board')).toHaveCount(0);
    await expect(page.locator('.pane-stack .prose')).toBeVisible();
    await expectTranslated(page, code, NAMES);

    await page.goto('/#friends');
    await expect(page.locator('.player-row .presence')).toHaveCount(3);
    await expectTranslated(page, code, NAMES);
  });
}
