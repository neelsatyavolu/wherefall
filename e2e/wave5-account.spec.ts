import { expect, test, type Page } from '@playwright/test';
import type { Account } from '../src/account/client.ts';
import { COUNTRY_CODES } from '../src/account/countries.ts';
import { LANGUAGE_NAMES } from '../src/i18n/index.ts';
import { AccountServer } from './account-server.ts';
import { mockServices } from './fixtures.ts';
import { GamesServer, gameDetail, historyGame, historyGames } from './games-server.ts';
import { scrollsSideways } from './helpers.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { MatchServer } from './match-server.ts';
import { SocialServer } from './social-server.ts';

// Wave 5, the account and the history of games: the password, deleting and restoring, the country
// and its flag, the two switches saved with the account, the login streak and the duel record, and
// the list of every game played, a page at a time.

const PASSWORD = 'correct horse battery';
const DELETED = 'This account was deleted. Restore it to sign in.';
const WRONG_PASSWORD = 'That is not your current password.';
const UNREACHABLE = 'Could not reach the server. Check your connection and try again.';

/** an account with everything the pane has a place for */
const SEASONED: Partial<Account> = { country: 'IN', loginStreak: 5, bestCountry: 9000, bestContinent: 10_000, duels: { wins: 2, losses: 1, ties: 0, winRate: 66, rank: 12 } };

const title = (page: Page) => page.locator('.pane-title');
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const who = (page: Page) => page.locator('.account-who');
const historyRows = (page: Page) => page.locator('.history tbody tr');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
/** the form or section a field belongs to, so its own error is the one read */
const formOf = (page: Page, label: string) => page.locator('form').filter({ has: page.getByLabel(label, { exact: true }) });
const longDay = (iso: string) => new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso));

async function setUp(page: Page, username: string | null = 'neel', change: Partial<Account> = {}) {
  await mockServices(page);
  const account = await AccountServer.install(page, username, 1016, change);
  const games = await GamesServer.install(page);
  await SocialServer.install(page);
  await MatchServer.install(page);
  return { account, games };
}

async function openAccount(page: Page): Promise<void> {
  await page.goto('/#account');
  await expect(title(page)).toHaveText('Account');
}

// --- item 21: who is signed in, and the figures ------------------------------------------------------------

test('the pane shows the flag beside the name, the login streak, the duel record and the best of each guesser', async ({ page }) => {
  await setUp(page, 'neel', SEASONED);
  await openAccount(page);

  await expect(who(page)).toContainText('neel');
  await expect(who(page).getByRole('img', { name: 'India' })).toBeVisible();
  await expect(who(page).locator('.figure').filter({ hasText: 'Login streak' })).toContainText('5 days in a row');

  const stats = region(page, 'Your stats');
  await expect(stats.locator('.figure')).toHaveCount(12);
  await expect(stats.locator('.figure').filter({ hasText: 'Rating' })).toHaveText('Rating1,016rank 12');
  await expect(stats.locator('.figure').filter({ hasText: 'Country Guesser' })).toHaveText('Country Guesser9,000of 10,000');
  await expect(stats.locator('.figure').filter({ hasText: 'Continent Guesser' })).toHaveText('Continent Guesser10,000of 10,000');
  await expect(region(page, 'Duel record').locator('.figure')).toHaveText(['Wins2', 'Losses1', 'Ties0', 'Win rate66%']);
});

test('a new account has a streak of one day, no flag, and a rating with no place on the board yet', async ({ page }) => {
  await setUp(page);
  await openAccount(page);

  await expect(who(page).locator('.figure').filter({ hasText: 'Login streak' })).toContainText('1 day in a row');
  await expect(who(page).getByRole('img')).toHaveCount(0);
  await expect(region(page, 'Your stats').locator('.figure').filter({ hasText: 'Rating' })).toHaveText('Rating1,016');
  await expect(region(page, 'Duel record').locator('.figure')).toHaveText(['Wins0', 'Losses0', 'Ties0', 'Win rate0%']);
});

// --- item 21: the password ---------------------------------------------------------------------------------

test("the password is changed, and each refusal is shown in the server's words", async ({ page }) => {
  const { account } = await setUp(page);
  await openAccount(page);
  const form = formOf(page, 'Current password');
  const current = page.getByLabel('Current password');
  const next = page.getByLabel('New password', { exact: true });
  // the form is closed until asked for; the button that opens it gives way to the one that sends it
  const change = button(page, 'Change password');
  const status = page.locator('.account-section').filter({ has: page.getByRole('heading', { name: 'Change password' }) }).getByRole('status');
  await expect(current).toBeHidden();
  await change.click();
  // since wave 6 a change of password signs every other browser out
  await expect(form).toContainText('8 to 200 characters. Every other browser is signed out.');

  await change.click();
  await expect(form.getByRole('alert')).toHaveText('Enter your current password and a new one.');
  expect(account.posted('password')).toHaveLength(0);

  await current.fill('not it');
  await next.fill('a new password');
  await change.click();
  await expect(form.getByRole('alert')).toHaveText(WRONG_PASSWORD);

  await current.fill(PASSWORD);
  await next.fill('short');
  await change.click();
  await expect(form.getByRole('alert')).toHaveText('Choose a new password of 8 to 200 characters.');
  await expect(change).toBeEnabled();

  await next.fill('a new password');
  await change.click();
  // changed: the form closes and says so, and opens again empty
  await expect(status).toHaveText('Password changed.');
  await expect(current).toBeHidden();
  await change.click();
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(current).toHaveValue('');
  await expect(next).toHaveValue('');
  expect(account.password).toBe('a new password');
  expect(account.posted('password').at(-1)).toMatchObject({ action: 'password', current: PASSWORD, next: 'a new password' });

  // ten tries an hour, and then the server says so
  account.refuse = 'Too many tries at your password in the last hour. Try again later.';
  account.refuseStatus = 429;
  await current.fill('a new password');
  await next.fill('another password');
  await change.click();
  await expect(form.getByRole('alert')).toHaveText('Too many tries at your password in the last hour. Try again later.');
  await expect(status).toHaveText('');
});

// --- item 21: deleting and restoring -----------------------------------------------------------------------

test('deleting says what happens and asks for the password, then shows the day the account can be restored until; signing in offers to restore it', async ({ page }) => {
  const { account } = await setUp(page, 'neel', SEASONED);
  await openAccount(page);

  await button(page, 'Delete account').click();
  const confirm = formOf(page, 'Password');
  await expect(confirm).toContainText('Your account disappears everywhere at once');
  await expect(confirm).toContainText('For 30 days you can restore it by signing in with your username and password. After that it is gone for good.');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();

  await button(page, 'Delete my account').click();
  await expect(confirm.getByRole('alert')).toHaveText('Enter your password to delete the account.');
  await page.getByLabel('Password', { exact: true }).fill('not it');
  await button(page, 'Delete my account').click();
  await expect(confirm.getByRole('alert')).toHaveText(WRONG_PASSWORD);
  expect(account.deleted).toBeNull();

  // it can be backed out of
  await button(page, 'Cancel').click();
  await expect(button(page, 'Delete my account')).toHaveCount(0);
  await expect(who(page)).toContainText('neel');

  await button(page, 'Delete account').click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await button(page, 'Delete my account').click();
  await expect(page.getByRole('alert')).toContainText('Your account is deleted.');
  expect(account.posted('delete').at(-1)).toMatchObject({ action: 'delete', password: PASSWORD });
  await expect(page.getByRole('alert')).toContainText(`Until ${longDay(account.deleted!.restoreUntil)} you can restore it by signing in.`);
  await expect(who(page)).toHaveCount(0);

  await button(page, 'Go to sign in').click();
  await page.getByLabel('Username').fill('neel');
  await page.getByLabel('Password').fill(PASSWORD);
  await button(page, 'Sign in').click();
  await expect(page.getByRole('alert')).toHaveText(DELETED);
  await expect(who(page)).toHaveCount(0);
  // restoring is for signing in, not for making an account
  await page.getByRole('radio', { name: 'Create account' }).check();
  await expect(button(page, 'Restore it and sign in')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Sign in', exact: true }).check();
  await button(page, 'Sign in').click();
  await expect(page.getByRole('alert')).toHaveText(DELETED);

  await button(page, 'Restore it and sign in').click();
  await expect(who(page)).toContainText('neel');
  await expect(who(page).getByRole('img', { name: 'India' })).toBeVisible();
  expect(account.posts.at(-1)).toMatchObject({ path: '/api/account/login', username: 'neel', password: PASSWORD, restore: true });
  expect(account.deleted).toBeNull();
});

test("a moderator's account cannot be deleted, and the server's refusal is shown as sent", async ({ page }) => {
  const { account } = await setUp(page, 'mod', { moderator: true });
  await openAccount(page);

  await button(page, 'Delete account').click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await button(page, 'Delete my account').click();
  await expect(formOf(page, 'Password').getByRole('alert')).toHaveText("A moderator's account cannot be deleted.");
  await expect(button(page, 'Delete my account')).toBeEnabled();
  expect(account.deleted).toBeNull();
});

// --- item 21: the username rule and the country ------------------------------------------------------------

test("registering states the username rule and sends the country of the browser's language, and the pane changes it", async ({ page }) => {
  const { account } = await setUp(page, null);
  await openAccount(page);

  await page.getByRole('radio', { name: 'Create account' }).check();
  await expect(page.getByText('3 to 20 letters, numbers or single underscores, not starting or ending with one.')).toBeVisible();
  await page.getByLabel('Username').fill('_neel');
  await page.getByLabel('Password').fill(PASSWORD);
  await button(page, 'Create account').click();
  await expect(page.getByRole('alert')).toHaveText('Choose a username of 3 to 20 letters, numbers or single underscores, not starting or ending with one.');

  await page.getByLabel('Username').fill('neel_s');
  await button(page, 'Create account').click();
  // a new account is shown its recovery code first (wave 6); the pane follows once it is acknowledged
  await button(page, 'I have saved it').click();
  await expect(who(page)).toContainText('neel_s');
  // the test browser is set to US English
  expect(account.posts.at(-1)).toMatchObject({ path: '/api/account/register', username: 'neel_s', country: 'US' });
  await expect(who(page).getByRole('img', { name: 'United States' })).toBeVisible();
  await expect(page.locator('.country-now')).toHaveText(/United States$/);
  // the list of countries opens when asked for
  await button(page, 'Change country').click();
  await expect(page.getByRole('radio', { name: 'United States', exact: true })).toBeChecked();

  // the list is narrowed by what is typed, with or without accents
  const find = page.getByLabel('Find a country');
  const countries = page.getByRole('radiogroup', { name: 'Countries' }).getByRole('radio');
  await find.fill('fran');
  await expect(countries).toHaveCount(1);
  await find.fill('cote');
  await expect(countries).toHaveCount(1);
  await expect(page.getByRole('radio', { name: /^Côte d.Ivoire$/ })).toBeVisible();
  await find.fill('atlantis');
  await expect(countries).toHaveCount(0);
  await expect(page.getByText('No country by that name.')).toBeVisible();

  await find.fill('fran');
  await page.getByRole('radio', { name: 'France', exact: true }).check();
  await expect(page.locator('.country-now')).toHaveText(/France$/);
  await expect(who(page).getByRole('img', { name: 'France' })).toBeVisible();
  expect(account.posted('country').at(-1)).toMatchObject({ action: 'country', country: 'FR' });
  expect(account.state.account?.country).toBe('FR');

  // a refusal leaves the country as it was
  // (the list closed when France was saved)
  account.refuse = 'Choose a country by its two-letter code, or none.';
  await expect(find).toBeHidden();
  await button(page, 'Change country').click();
  await find.fill('japan');
  await page.getByRole('radio', { name: 'Japan', exact: true }).check();
  await expect(page.getByRole('alert')).toHaveText('Choose a country by its two-letter code, or none.');
  await expect(page.locator('.country-now')).toHaveText(/France$/);
  await expect(page.getByRole('radio', { name: 'Japan', exact: true })).not.toBeChecked();
  account.refuse = null;

  // and none at all can be chosen
  await find.fill('');
  await page.getByRole('radio', { name: 'No country' }).check();
  await expect(page.locator('.country-now')).toHaveText('No country');
  await expect(who(page).getByRole('img')).toHaveCount(0);
  expect(account.posted('country').at(-1)).toMatchObject({ action: 'country', country: null });
});

// --- items 24 and 25: the two switches saved with the account ----------------------------------------------

test('friend requests and hidden chat are switched on the account, apart from the settings of this browser', async ({ page }) => {
  const { account } = await setUp(page);
  await openAccount(page);
  const requests = page.getByRole('group', { name: 'Allow friend requests' });
  const chat = page.getByRole('group', { name: 'Hide chat' });
  const yes = (group: typeof requests) => group.getByRole('radio', { name: 'Yes' });
  const no = (group: typeof requests) => group.getByRole('radio', { name: 'No' });

  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This browser' })).toBeVisible();
  await expect(page.getByText('Saved with your account, so it is the same wherever you sign in.')).toBeVisible();
  await expect(yes(requests)).toBeChecked();
  await expect(no(chat)).toBeChecked();

  await no(requests).check();
  await expect.poll(() => account.state.account?.allowFriendRequests).toBe(false);
  expect(account.posted('settings').at(-1)).toEqual({ action: 'settings', allowFriendRequests: false, path: '/api/account' });
  await yes(chat).check();
  await expect.poll(() => account.state.account?.hideChat).toBe(true);
  expect(account.posted('settings').at(-1)).toEqual({ action: 'settings', hideChat: true, path: '/api/account' });

  // a switch the server will not save goes back to what the account has
  account.refuse = 'A setting is either on or off.';
  await no(chat).check();
  await expect(page.getByRole('alert')).toHaveText('A setting is either on or off.');
  await expect(yes(chat)).toBeChecked();
  account.refuse = null;

  // they are the account's: there again when the page is opened again
  await page.reload();
  await expect(no(requests)).toBeChecked();
  await expect(yes(chat)).toBeChecked();
});

test('a visitor is shown the settings of this browser only', async ({ page }) => {
  await setUp(page, null);
  await openAccount(page);

  await expect(page.getByRole('heading', { name: 'This browser' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Kilometres' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your account' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Hide chat' })).toHaveCount(0);
});

// --- item 22: the history ----------------------------------------------------------------------------------

test('the history lists every kind of game a page at a time, and a match opens round by round', async ({ page }) => {
  const { games } = await setUp(page);
  games.history = historyGames(40);
  await openAccount(page);
  const more = button(page, 'Show more');
  const day = /^[A-Z][a-z]{2} \d{1,2}$/;

  await expect(page.locator('.history th')).toHaveText(['Date', 'Type', 'Map', 'Points', 'Rating', 'XP', 'Players', '']);
  await expect(historyRows(page)).toHaveCount(20);
  const cells = (row: number) => historyRows(page).nth(row).locator('td');
  await expect(cells(0)).toHaveText([day, 'Rankedwin', 'World', '12,400 / 25,000', '+18', '496', '2', 'Rounds']);
  await expect(cells(1)).toHaveText([day, '2v2loss', 'World', '9,800 / 25,000', '', '196', '4', 'Rounds']);
  await expect(cells(2)).toHaveText([day, 'Unrankeddraw', 'World', '15,100 / 25,000', '', '302', '7', 'Rounds']);
  await expect(cells(3)).toHaveText([day, 'Partywin', 'Community map', '30,000 / 60,000', '', '0', '14', 'Rounds']);
  await expect(cells(4)).toHaveText([day, 'Daily', 'World', '11,250 / 15,000', '', '225', '1', 'Rounds']);
  await expect(cells(5)).toHaveText([day, 'Solo', 'World', '19,000 / 25,000', '', '380', '1', 'Rounds']);
  // a community map's name is not in the game, so it leads to the map's page
  await expect(cells(3).getByRole('link', { name: 'Community map' })).toHaveAttribute('href', '?community=paris-walk-x7k2');
  expect(games.pages).toEqual([1]);

  await more.click();
  await expect(historyRows(page)).toHaveCount(40);
  await more.click();
  await expect(historyRows(page)).toHaveCount(46);
  await expect(more).toHaveCount(0);
  expect(games.pages).toEqual([1, 2, 3]);

  // the ranked duel: its rounds are the player's own guesses
  await page.getByRole('button', { name: /^Rounds of the game on .+, 12,400 points$/ }).click();
  await expect(title(page)).toHaveText('Game');
  await expect(page.getByText(/ · World · 2 rounds · 1 min · move$/)).toBeVisible();
  await expect(page.getByText('Ranked · win · rating +18 · 2 players')).toBeVisible();
  const rounds = page.locator('.rounds tbody tr');
  await expect(rounds.nth(0).locator('td')).toHaveText(['1', 'France', '12.5 km', '12,400']);
  await expect(rounds.nth(1).locator('td')).toHaveText(['2', 'Japan', 'No guess', '0']);
  await expect(page.locator('.history-map .pin-actual')).toHaveCount(2);
  await expect(page.locator('.history-map .pin-guess')).toHaveCount(1);

  // back in the list, the pages read are still there
  await button(page, 'Back to account').click();
  await expect(title(page)).toHaveText('Account');
  await expect(historyRows(page)).toHaveCount(46);
});

test('a game opens with whatever time its rounds had, and a game played alone says nothing of a match', async ({ page }) => {
  await setUp(page);
  await page.route('**/api/games?id=g1', (route) => route.fulfill({ json: { success: true, data: gameDetail(historyGame('g1'), { timeLimit: 90 }) } }));
  await openAccount(page);

  await page.getByRole('button', { name: /^Rounds of the game on .+, 19,000 points$/ }).click();
  await expect(page.getByText(/ · World · 2 rounds · 1 min 30 sec · move$/)).toBeVisible();
  await expect(page.locator('.facts .settings-line')).toHaveCount(1);
});

test('an account with no games says so, and a history that will not load falls back on the recent games until it does', async ({ page }) => {
  const { games } = await setUp(page);
  games.history = [];
  await openAccount(page);
  const list = page.locator('.account-section').filter({ has: page.getByRole('heading', { name: 'Your games' }) });
  await expect(list).toContainText('No games yet. Finish a game while signed in and it is saved here.');
  await expect(button(page, 'Show more')).toHaveCount(0);

  let down = true;
  await page.route('**/api/games?page=*', (route) => (down ? route.abort() : route.fallback()));
  games.history = historyGames();
  await page.reload();
  await expect(list.locator('.account-error')).toHaveText(UNREACHABLE);
  // the handful of games that came with the account stand in
  await expect(list.locator('.account-table tbody tr')).toHaveCount(1);
  await expect(historyRows(page)).toHaveCount(0);

  down = false;
  await list.getByRole('button', { name: 'Try again' }).click();
  await expect(historyRows(page)).toHaveCount(6);
  await expect(list.locator('.account-error')).toBeHidden();
  await expect(list.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('on a phone the history gives up its least needed columns rather than scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const { games } = await setUp(page, 'a_very_long_username', SEASONED);
  games.history = historyGames(40);
  await openAccount(page);

  await expect(historyRows(page)).toHaveCount(20);
  await expect(page.locator('.history th:visible')).toHaveText(['Date', 'Type', 'Points', '']);
  // the maximum after the score is one of the parts given up
  await expect(historyRows(page).first().locator('td:visible')).toHaveText([/\d/, 'Rankedwin', /^12,400/, 'Rounds']);
  await expect(historyRows(page).first().locator('.account-of')).toBeHidden();
  const table = await page.locator('.history').boundingBox();
  expect(table!.x + table!.width).toBeLessThanOrEqual(390);
  expect(await scrollsSideways(page)).toBe(false);

  // the forms and the confirmation fit too
  await button(page, 'Delete account').click();
  await expect(button(page, 'Delete my account')).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);

  await historyRows(page).first().getByRole('button').click();
  await expect(page.locator('.history-map .pin-actual')).toHaveCount(2);
  expect(await scrollsSideways(page)).toBe(false);
});

// --- every language, on a phone ----------------------------------------------------------------------------

for (const code of ['es', 'fr', 'de', 'ru']) {
  const say = CATALOGS[code]!;
  /** what players typed, the names languages give themselves, and what the server says in its own words */
  const NAMES = ['neel', ...Object.values(LANGUAGE_NAMES), DELETED];
  /** dates are written by the browser for the language, not taken from a catalog */
  const dates = (page: Page) => page.locator('time').allTextContents();
  /**
   * So are the countries of the list. The check names them as this process does, and the browser
   * has its own names for a few (Hong Kong, Macao, Palestine, the Falklands).
   */
  const countries = (page: Page) =>
    page.evaluate(
      ({ codes, language }) => {
        const names = new Intl.DisplayNames([language], { type: 'region' });
        return codes.map((country) => names.of(country) ?? country);
      },
      { codes: [...COUNTRY_CODES], language: code },
    );

  test.describe(`${code} on a phone`, () => {
    test.use({ viewport: { width: 390, height: 800 } });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
    });

    test('the account pane of a player, the delete confirmation and what follows it are in the language', async ({ page }) => {
      const { games } = await setUp(page, 'neel', SEASONED);
      games.history = historyGames(40);
      await page.goto('/#account');
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(title(page)).toHaveText(say['nav.item.account']);
      await expect(historyRows(page)).toHaveCount(20);
      await page.waitForLoadState('networkidle');
      const names = [...NAMES, ...(await dates(page)), ...(await countries(page))];
      await expectTranslated(page, code, names);

      await page.getByRole('button', { name: say['account.delete'], exact: true }).click();
      await expect(page.getByRole('button', { name: say['account.delete.confirm'], exact: true })).toBeVisible();
      await expectTranslated(page, code, names);

      await page.getByLabel(say['account.password'], { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: say['account.delete.confirm'], exact: true }).click();
      await expect(page.getByRole('button', { name: say['account.deleted.signIn'], exact: true })).toBeVisible();
      await expectTranslated(page, code, NAMES);
    });

    test('the sign-in form of a visitor, and the offer to restore a deleted account, are in the language', async ({ page }) => {
      const { account } = await setUp(page, null);
      account.deleted = { state: new AccountServer('neel').state, restoreUntil: '2026-11-10T12:00:00.000Z' };
      await page.goto('/#account');
      await expect(title(page)).toHaveText(say['nav.item.account']);
      await page.getByRole('radio', { name: say['account.register.name'] }).check();
      await expectTranslated(page, code, NAMES);

      await page.getByRole('radio', { name: say['account.login.name'], exact: true }).check();
      await page.getByLabel(say['account.username']).fill('neel');
      await page.getByLabel(say['account.password']).fill(PASSWORD);
      await page.getByRole('button', { name: say['account.login.name'], exact: true }).click();
      await expect(page.getByRole('button', { name: say['account.restore'], exact: true })).toBeVisible();
      await expectTranslated(page, code, NAMES);
    });

    test('a match opened from the history is in the language', async ({ page }) => {
      await setUp(page, 'neel', SEASONED);
      await page.goto('/#account');
      await historyRows(page).first().getByRole('button').click();
      await expect(title(page)).toHaveText(say['history.title']);
      await expect(page.locator('.history-map .pin-actual')).toHaveCount(2);
      // the day and the settings are one line, put together from the date and the catalog's words
      const settings = await page.locator('.facts .settings-line').first().textContent();
      await expectTranslated(page, code, [...NAMES, settings ?? '']);
    });
  });
}
