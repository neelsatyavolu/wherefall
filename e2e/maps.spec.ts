import { expect, test, type Page } from '@playwright/test';
import { matchState, settings } from '../src/multiplayer/testing.ts';
import { mockPlaces, mockServices } from './fixtures.ts';
import { roundReady, scrollsSideways } from './helpers.ts';
import { MINE, MapsServer, PARIS } from './maps-server.ts';
import { MatchServer, accountReply, signIn } from './match-server.ts';
import { SocialServer } from './social-server.ts';

const UNAVAILABLE = 'This map is made of Google Street View places, which cannot be shown right now, so it cannot be played.';

const title = (page: Page) => page.locator('.pane-title');
const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const rowsOf = (page: Page, name: string) => section(page, name).locator('.player-row');

async function setUp(page: Page, username: string | null = 'neel') {
  await mockServices(page);
  await mockPlaces(page);
  await signIn(page, username);
  const match = await MatchServer.install(page);
  await SocialServer.install(page);
  const maps = await MapsServer.install(page);
  return { maps, match };
}

/** Sends the page to a form with a map already chosen, as the Maps pane and a map's page do. */
async function openWithPreset(page: Page, hash: string, preset: { map: string; name: string; places: number | null }): Promise<void> {
  await page.evaluate(
    ([target, chosen]) => {
      history.pushState({ preset: chosen }, '', target as string);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    [hash, preset] as const,
  );
}

test('the Maps pane lists the official maps and the community ones, popular first and newest first', async ({ page }) => {
  await setUp(page);
  await page.goto('/#maps');

  await expect(title(page)).toHaveText('Maps');
  await expect(rowsOf(page, 'Official maps').filter({ visible: true })).toHaveText([/World\s*97 places/, /Europe\s*45 places/, /Africa\s*40 places/]);
  await page.getByText('All 2 countries').click();
  await expect(rowsOf(page, 'Official maps')).toHaveCount(5);

  await expect(rowsOf(page, 'Popular community maps')).toHaveText([/Paris walk\s*by sam\s*6 places · 41 plays · 3 likes/, /My coast\s*by neel\s*5 places · 2 plays · 0 likes/]);
  await expect(rowsOf(page, 'Newest community maps').first()).toContainText('My coast');
  await expect(rowsOf(page, 'My maps')).toHaveText([/My coast\s*5 places · 2 plays · 0 likes\s*Edit/]);
  await expect(page.getByRole('link', { name: 'Make a map' })).toHaveAttribute('href', '?edit=new');
});

test('the popular list goes by likes before plays', async ({ page }) => {
  const { maps } = await setUp(page);
  // played once and liked by nine: ahead of a map played forty-one times and liked by three
  maps.maps = [...maps.maps, { ...PARIS, slug: 'loved-lanes-k3k3', name: 'Loved lanes', plays: 1, likes: 9 }];
  await page.goto('/#maps');
  await expect(rowsOf(page, 'Popular community maps')).toHaveText([/Loved lanes/, /Paris walk/, /My coast/]);
  expect(maps.asked.some((query) => query.startsWith('list=popular'))).toBe(true);
});

test('an official map chosen on the Maps pane opens Singleplayer on it', async ({ page }) => {
  await setUp(page);
  await page.goto('/#maps');
  await page.getByText('All 2 countries').click();
  await page.getByRole('button', { name: 'Choose Kenya' }).click();

  await expect(title(page)).toHaveText('Singleplayer');
  await expect(page.getByRole('radio', { name: 'A country' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Kenya 40 places' })).toBeChecked();
  await page.getByRole('button', { name: 'Start game' }).click();
  await roundReady(page);
  await expect(page.locator('.hud')).toContainText('Kenya');

  // a region lands on its own cell
  await page.goto('/#maps');
  await page.getByRole('button', { name: 'Choose Africa' }).click();
  await expect(page.getByRole('radio', { name: 'Africa' })).toBeChecked();
  await page.goBack();
  await expect(title(page)).toHaveText('Maps');
});

test('search narrows both kinds of map, and a long list comes a page at a time', async ({ page }) => {
  const { maps } = await setUp(page, null);
  maps.addMany(30);
  await page.goto('/#maps');

  await expect(rowsOf(page, 'Popular community maps')).toHaveCount(24);
  await expect(section(page, 'My maps')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show more of Popular community maps' }).click();
  await expect(rowsOf(page, 'Popular community maps')).toHaveCount(32);
  await expect(page.getByRole('button', { name: 'Show more of Popular community maps' })).toHaveCount(0);

  await page.getByLabel('Search maps').fill('coast');
  await expect(rowsOf(page, 'Community maps matching "coast"')).toHaveText([/My coast/]);
  await expect(section(page, 'Official maps')).toContainText('No official map by that name.');
  await page.getByLabel('Search maps').fill('ken');
  await expect(rowsOf(page, 'Official maps')).toHaveText([/Kenya\s*40 places/]);
  await expect(section(page, 'Community maps matching "ken"')).toContainText('No community map matches that.');
  // a community map is also found by its description and by its maker
  await page.getByLabel('Search maps').fill('on foot');
  await expect(rowsOf(page, 'Community maps matching "on foot"').first()).toContainText('Paris walk');
  await page.getByLabel('Search maps').fill('neel');
  await expect(rowsOf(page, 'Community maps matching "neel"')).toHaveText([/My coast/]);
});

test('with no community maps yet, the lists say so', async ({ page }) => {
  const { maps } = await setUp(page);
  maps.maps = [];
  await page.goto('/#maps');
  await expect(section(page, 'Popular community maps')).toContainText('No one has made a map yet. Yours could be the first.');
  await expect(section(page, 'My maps')).toContainText('You have not made a map yet.');
});

test("a map's page shows what it is, and it can be liked and reported", async ({ page }) => {
  const { maps } = await setUp(page);
  await page.goto('/#maps');
  await section(page, 'Popular community maps').getByRole('link', { name: 'Paris walk' }).click();

  await expect(page).toHaveURL(/\?community=paris-walk-x7k2$/);
  await expect(title(page)).toHaveText('Paris walk');
  await expect(page.locator('.nav-item[aria-current]')).toHaveText('Maps');
  await expect(page.getByText('made October 9, 2026')).toHaveText('Community map by sam · made October 9, 2026');
  await expect(page.getByText('Left bank and right, all on foot.')).toBeVisible();
  const numbers = section(page, 'Paris walk in numbers').locator('.figure');
  await expect(numbers).toHaveText(['Places6', 'Plays41', 'Likes3']);
  await expect(page.locator('.history-map .maplibregl-canvas')).toBeVisible();
  // nobody else's map can be edited or deleted
  await expect(page.getByRole('link', { name: 'Edit map' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(numbers).toHaveText(['Places6', 'Plays41', 'Likes4']);
  await page.getByRole('button', { name: 'Unlike' }).click();
  await expect(numbers.nth(2)).toHaveText('Likes3');
  expect(maps.posted('like')).toEqual([
    { action: 'like', slug: 'paris-walk-x7k2', liked: true },
    { action: 'like', slug: 'paris-walk-x7k2', liked: false },
  ]);

  await expect(page.getByLabel('Report this map')).toBeHidden();
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await page.getByLabel('Report this map').fill('half of it is indoors');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Reported. Someone will look at it.')).toBeVisible();
  expect(maps.posted('report')).toEqual([{ action: 'report', slug: 'paris-walk-x7k2', reason: 'half of it is indoors' }]);

  await page.getByRole('link', { name: 'sam', exact: true }).click();
  await expect(page).toHaveURL(/\?user=sam$/);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(title(page)).toHaveText('Paris walk');
});

test('a refused like is explained, and a map that is not there says so', async ({ page }) => {
  const { maps } = await setUp(page, null);
  maps.session = 'none';
  await page.goto('/?community=paris-walk-x7k2');
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  // a like refused because the session ended elsewhere says so, with the way back in
  await expect(page.getByRole('alert')).toHaveText('You are no longer signed in. Sign in');

  await page.goto('/?community=gone-map');
  await expect(page.getByRole('alert')).toContainText('There is no such map.');
});

test('without Google imagery a community map is explained, not offered for play', async ({ page }) => {
  await setUp(page);
  await page.goto('/?community=paris-walk-x7k2');
  await expect(page.getByText('This site has no Google imagery set up right now, so the map cannot be played or previewed here.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play this map' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Start a party on it' })).toBeDisabled();
});

test('the maker can delete their map, after being asked once more', async ({ page }) => {
  const { maps } = await setUp(page);
  await page.goto('/?community=my-coast-q1w2');
  const mine = section(page, 'Your map');
  await expect(mine.getByRole('link', { name: 'Edit map' })).toHaveAttribute('href', '?edit=my-coast-q1w2');

  await mine.getByRole('button', { name: 'Delete map' }).click();
  await expect(mine).toContainText('Delete it for good?');
  await mine.getByRole('button', { name: 'Keep it' }).click();
  expect(maps.posted('delete')).toHaveLength(0);

  await mine.getByRole('button', { name: 'Delete map' }).click();
  await mine.getByRole('button', { name: 'Yes, delete it' }).click();
  await expect(title(page)).toHaveText('Maps');
  expect(maps.posted('delete')).toEqual([{ action: 'delete', slug: 'my-coast-q1w2' }]);
  await expect(section(page, 'My maps')).toContainText('You have not made a map yet.');
});

test('the editor needs an account, and Google imagery to find the places with', async ({ page }) => {
  await setUp(page, null);
  await page.goto('/?edit=new');
  await expect(title(page)).toHaveText('Make a map');
  await expect(page.getByText('Making a map needs an account')).toBeVisible();

  await signIn(page, 'neel');
  await page.reload();
  await expect(page.getByText('Map making needs Google Street View imagery')).toBeVisible();
  await expect(page.getByText('so maps cannot be made or changed here')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish map' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to maps' }).click();
  await expect(title(page)).toHaveText('Maps');

  await page.goto('/?edit=my-coast-q1w2');
  await expect(title(page)).toHaveText('Edit map');
  await expect(page.getByText('Map making needs Google Street View imagery')).toBeVisible();
});

test('a community map link names the map, and says it cannot be played when Google is not there', async ({ page }) => {
  const { maps } = await setUp(page);
  await page.goto('/?map=community:paris-walk-x7k2&seed=e2e00001&t=0&mode=move&n=5');
  await expect(page.getByText('Community map · 5 rounds · No limit · move')).toBeVisible();
  await page.getByRole('button', { name: 'Play challenge' }).click();

  await expect(page.getByRole('alert')).toContainText(UNAVAILABLE);
  await expect(page.locator('.hud')).toContainText('Paris walk');
  // a game that never started is not a play
  expect(maps.posted('play')).toHaveLength(0);
  await page.getByRole('button', { name: 'Exit', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();

  await page.goto('/?map=community:gone-map&seed=e2e00001&t=0&mode=move&n=5');
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await expect(page.getByRole('alert')).toContainText('There is no such map.');

  await page.goto('/?map=community:paris-walk-x7k2&seed=e2e00001&t=0&mode=move&n=10');
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await expect(page.getByRole('alert')).toContainText('Paris walk has 6 places, too few for 10 rounds.');
});

test('a community map chosen for a game or a party has its own cell, and too many rounds is caught', async ({ page }) => {
  const { match } = await setUp(page);
  match.state = matchState({ settings: settings({ map: 'community:paris-walk-x7k2', timeLimit: 60, rounds: 5 }) });
  await page.goto('/#maps');
  await openWithPreset(page, '#singleplayer', { map: 'community:paris-walk-x7k2', name: 'Paris walk', places: 6 });

  await expect(page.getByRole('radio', { name: 'Paris walk' })).toBeChecked();
  await page.getByRole('radio', { name: '10', exact: true }).check();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('alert')).toHaveText('Paris walk has 6 places. Choose fewer rounds.');
  await page.getByRole('radio', { name: '5', exact: true }).check();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page).toHaveURL(/map=community%3Aparis-walk-x7k2/);
  await expect(page.getByRole('alert')).toContainText(UNAVAILABLE);

  await page.goto('/#maps');
  await openWithPreset(page, '#create', { map: 'community:paris-walk-x7k2', name: 'Paris walk', places: 6 });
  await expect(page.getByRole('radio', { name: 'Paris walk' })).toBeChecked();
  await page.getByRole('button', { name: 'Create party', exact: true }).click();
  expect(match.posted('create')).toEqual([{ action: 'create', settings: { map: 'community:paris-walk-x7k2', mode: 'move', timeLimit: 60, rounds: 5, communication: 'chat', teams: 'none', guests: true } }]);
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();
  await expect(page.getByText('Community map · 5 rounds · 1 min · move')).toBeVisible();

  // started here, this page would have to find the places, and without Google it cannot
  match.addPlayer('sam');
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.getByRole('alert')).toContainText(UNAVAILABLE);
  expect(match.posted('places')).toHaveLength(0);
});

test('a game on a community map in the recent games leads to the map', async ({ page }) => {
  await setUp(page);
  const reply = accountReply('neel');
  const games = [{ ...reply.data.recentGames[0]!, map: 'community:paris-walk-x7k2' }];
  await page.route('**/api/account', (route) => route.fulfill({ json: { ...reply, data: { ...reply.data, recentGames: games } } }));
  await page.goto('/#account');

  await expect(page.getByText('Signed in as')).toBeVisible();
  await page.locator('.account-table').getByRole('link', { name: 'Community map' }).click();
  await expect(title(page)).toHaveText('Paris walk');
});

test('the map panes fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const { maps } = await setUp(page);
  // a name of thirty characters, the longest a map can have
  maps.maps = [{ ...PARIS, name: 'A map with a rather long name.' }, MINE];
  for (const address of ['/#maps', '/?community=paris-walk-x7k2', '/?community=my-coast-q1w2', '/?edit=new']) {
    await page.goto(address);
    await expect(title(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(await scrollsSideways(page), `${address} scrolls sideways`).toBe(false);
  }
});
