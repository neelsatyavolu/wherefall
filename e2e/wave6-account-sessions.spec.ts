import { expect, test, type Page } from '@playwright/test';
import { FIVE_PLACES } from './match-server.ts';
import { matchState, outcome, player, viewer } from '../src/multiplayer/testing.ts';
import { endSession } from './fixtures.ts';
import { historyGames } from './games-server.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { MINE, PARIS } from './maps-server.ts';
import { friend } from './social-server.ts';
import { NAMES, PHONE, SPOTS, open, openEditor, section, setUp, upload, written } from './wave6-panes-scenes.ts';

// Wave 6, item 22: a session can end from somewhere else at any moment (the password was changed
// in another browser, a recovery code was used, the account was deleted or banned, or it signed
// out everywhere). Wherever a signed-in screen then meets "Sign in first." it says the player is
// no longer signed in and offers the way to sign in: never the bare refusal, never a "Try again"
// that cannot work. And the sidebar stops showing what was the account's.

const PASSWORD = 'correct horse battery';
const BARE = 'Sign in first.';
const ENDED = 'You are no longer signed in.';

type Servers = Awaited<ReturnType<typeof setUp>>;

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const historyRows = (page: Page) => page.locator('.history tbody tr');

/** The session ends elsewhere: from its next request on, every stand-in answers this browser as a visitor. */
function endEverywhere(servers: Servers): void {
  servers.account.endedElsewhere();
  endSession(servers.social, servers.games, servers.maps, servers.match, servers.daily);
}

/** A signed-in moderator with a friend request waiting: both show in the sidebar while the session lasts. */
async function signedIn(page: Page, language = 'en'): Promise<Servers> {
  const servers = await setUp(page, { language });
  servers.social.friends = { friends: [friend('ana')], incoming: ['sam'], outgoing: [], invites: [] };
  servers.games.history = historyGames(40);
  return servers;
}

async function expectAccountChrome(page: Page): Promise<void> {
  await expect(page.locator('.nav .badge')).toHaveText('1');
  await expect(page.locator('a.nav-item[href="#moderation"]')).toBeVisible();
}

/** The sidebar no longer shows what was the account's, and nowhere is the bare refusal or a button that cannot help. */
async function expectNoAccountChrome(page: Page): Promise<void> {
  await expect(page.locator('a.nav-item[href="#moderation"]')).toBeHidden();
  await expect(page.locator('.nav .badge')).toBeHidden();
  await expect(page.getByText(BARE)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
}

/** The line a control keeps for a refusal, saying the session is over, with the link to sign in. */
async function expectEndedLine(page: Page, line = page.getByRole('alert')): Promise<void> {
  await expect(line).toHaveText(`${ENDED} Sign in`);
  await expect(line.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '#account');
}

// --- the account pane: the way to sign in is the pane itself ------------------------------------------------

const ON_THE_ACCOUNT_PANE: Array<[what: string, act: (page: Page) => Promise<void>]> = [
  ['changing a switch', (page) => page.getByRole('group', { name: 'Hide chat' }).getByRole('radio', { name: 'Yes' }).click()],
  [
    'choosing a country',
    async (page) => {
      await button(page, 'Change country').click();
      await page.getByLabel('Find a country').fill('fran');
      await page.getByRole('radio', { name: 'France', exact: true }).click();
    },
  ],
  [
    'changing the password',
    async (page) => {
      await button(page, 'Change password').click();
      await page.getByLabel('Current password').fill(PASSWORD);
      await page.getByLabel('New password', { exact: true }).fill('another horse staple');
      await button(page, 'Change password').click();
    },
  ],
  [
    'changing the username',
    async (page) => {
      await page.getByLabel('New username').fill('neel_two');
      await button(page, 'Change username').click();
    },
  ],
  [
    'deleting the account',
    async (page) => {
      await button(page, 'Delete account').click();
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await button(page, 'Delete my account').click();
    },
  ],
  [
    'asking for a new recovery code',
    async (page) => {
      await button(page, 'New recovery code').click();
      await section(page, 'Recovery code').getByLabel('Current password').fill(PASSWORD);
      await button(page, 'New recovery code').click();
    },
  ],
  ['signing out everywhere', (page) => button(page, 'Sign out everywhere').click()],
  ['opening My reports', (page) => button(page, 'Show my reports').click()],
  ['asking for more of the history', (page) => button(page, 'Show more').click()],
  ['opening a game from the history', (page) => historyRows(page).first().getByRole('button').click()],
];

for (const [what, act] of ON_THE_ACCOUNT_PANE) {
  test(`on the account pane, ${what} after the session ended elsewhere turns the pane into the sign-in form, with the reason`, async ({ page }) => {
    const servers = await signedIn(page);
    await open(page, '/#account');
    await expect(historyRows(page)).toHaveCount(20);
    await expectAccountChrome(page);

    endEverywhere(servers);
    await act(page);

    // the pane is a visitor's: the reason, once, over the form that signs in
    const note = page.locator('.account-body > .status-box');
    await expect(note).toHaveCount(1);
    await expect(note).toHaveText(`Signed out${ENDED}`);
    await expect(note.locator('~ .sign-in')).toHaveCount(1);
    await expect(button(page, 'Forgot password')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your account' })).toHaveCount(0);
    await expect(page.locator('.account-who')).toHaveCount(0);
    await expect(page.locator('.pane-title')).toHaveText('Account');
    // the settings of this browser are still there, as they are for any visitor
    await expect(page.getByRole('heading', { name: 'This browser' })).toBeVisible();
    await expectNoAccountChrome(page);
  });
}

test('a player who signs in again after the notice gets the pane back, and a later end of the session is said again', async ({ page }) => {
  const servers = await signedIn(page);
  await open(page, '/#account');
  endEverywhere(servers);
  await button(page, 'Show my reports').click();
  await expect(page.locator('.account-body > .status-box')).toHaveText(`Signed out${ENDED}`);

  await page.getByLabel('Username').fill('neel');
  await page.getByLabel('Password').fill(PASSWORD);
  servers.social.session = 'account';
  servers.games.session = 'account';
  await button(page, 'Sign in').click();
  await expect(page.locator('.account-who')).toContainText('neel');
  await expect(page.locator('.account-body > .status-box')).toHaveCount(0);
  await expectAccountChrome(page);

  endEverywhere(servers);
  await page.getByRole('group', { name: 'Hide chat' }).getByRole('radio', { name: 'Yes' }).click();
  await expect(page.locator('.account-body > .status-box')).toHaveText(`Signed out${ENDED}`);
  await expectNoAccountChrome(page);
});

// --- other players ------------------------------------------------------------------------------------------

test('on a profile, a friend request and a report that meet the end of the session say so, and the link leads to signing in', async ({ page }) => {
  const servers = await signedIn(page);
  await open(page, '/?user=sam');
  await expectAccountChrome(page);
  endEverywhere(servers);

  await button(page, 'Send friend request').click();
  await expectEndedLine(page, page.locator('.friend-offer').getByRole('alert'));
  await expect(button(page, 'Send friend request')).toBeEnabled();
  await expectNoAccountChrome(page);

  await button(page, 'Report player').click();
  await page.locator('.report-form').getByRole('radio', { name: 'Cheating' }).click();
  await button(page, 'Send report').click();
  await expectEndedLine(page, page.locator('.report-form').getByRole('alert'));
  await expect(page.getByText('Reported. A moderator will look at it.')).toHaveCount(0);

  await page.locator('.report-form').getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.pane-title')).toHaveText('Account');
  await expect(button(page, 'Forgot password')).toBeVisible();
});

test('the friends pane closes behind the notice when a party cannot be joined for want of a session', async ({ page }) => {
  const servers = await signedIn(page);
  servers.social.friends = { friends: [friend('ana', { party: 'ABC123' })], incoming: ['sam'], outgoing: [], invites: [] };
  await open(page, '/#friends');
  await expectAccountChrome(page);
  endEverywhere(servers);
  await page.getByRole('button', { name: "Join ana's party" }).click();
  await expect(page.locator('.pane-body .notice')).toContainText(ENDED);
  await expect(page.locator('.pane-body').getByRole('link', { name: 'Sign in or create an account' })).toHaveAttribute('href', '#account');
  await expect(section(page, 'Friends')).toHaveCount(0);
  await expectNoAccountChrome(page);
});

test('the moderation pane says the session is over, at its first load and when a decision is refused', async ({ page }) => {
  const servers = await signedIn(page);
  await open(page, '/#moderation');
  endEverywhere(servers);
  await page.getByRole('button', { name: 'Dismiss the reports on lee' }).click();
  await expectEndedLine(page);
  await expectNoAccountChrome(page);

  // and for a moderator whose reports are refused outright: the notice in the pane's place, with the way to sign in
  const fresh = await page.context().newPage();
  const again = await signedIn(fresh);
  endSession(again.social);
  await open(fresh, '/#moderation');
  const box = fresh.locator('.pane-body .status-box');
  await expect(box).toHaveText(`Signed out${ENDED}Sign in`);
  await expect(box.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '#account');
  await expect(fresh.getByText(BARE)).toHaveCount(0);
  await expect(fresh.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

// --- maps ---------------------------------------------------------------------------------------------------

test("on a map's page, liking, reporting and deleting say the session is over instead of the bare refusal", async ({ page }) => {
  const servers = await signedIn(page);
  await open(page, `/?community=${PARIS.slug}`);
  endEverywhere(servers);
  await button(page, 'Like').click();
  await expectEndedLine(page);
  await expect(button(page, 'Like')).toBeEnabled();
  await expectNoAccountChrome(page);

  await button(page, 'Report').click();
  await button(page, 'Send report').click();
  await expectEndedLine(page, page.locator('.report-form').getByRole('alert'));

  // the maker's own page: the session ended after it was read
  const fresh = await page.context().newPage();
  const again = await signedIn(fresh);
  await open(fresh, `/?community=${MINE.slug}`);
  endEverywhere(again);
  await button(fresh, 'Delete map').click();
  await button(fresh, 'Yes, delete it').click();
  await expectEndedLine(fresh);
  await expect(fresh.locator('.pane-title')).toHaveText('My coast');
});

test('on the maps pane, lists that need an account say the session is over, with no "Try again" that cannot work', async ({ page }) => {
  const servers = await signedIn(page);
  // the account is still read as signed in when the pane opens; the lists are refused a moment later
  endSession(servers.maps);
  await open(page, '/#maps');
  for (const name of ['My maps', 'Maps I like']) {
    const list = section(page, name);
    await expectEndedLine(page, list.getByRole('alert'));
    await expect(list.getByRole('button')).toHaveCount(0);
  }
  await expect(page.getByText(BARE)).toHaveCount(0);
  // the lists anyone may read are untouched
  await expect(section(page, 'Popular community maps')).toContainText('Paris walk');

  // a list that fails for another reason still offers to ask again
  const fresh = await page.context().newPage();
  await signedIn(fresh);
  await fresh.route('**/api/maps?list=mine**', (route) => route.abort(), { times: 1 });
  await open(fresh, '/#maps');
  await section(fresh, 'My maps').getByRole('button', { name: 'Try again' }).click();
  await expect(section(fresh, 'My maps')).toContainText('My coast');
});

test('in the map editor a save that meets the end of the session keeps the draft, and saves once signed in again in another tab', async ({ page }) => {
  const servers = await signedIn(page);
  await openEditor(page);
  await page.getByLabel('Name', { exact: true }).fill('Draft map');
  await page.getByLabel('Short description').fill('Five spots in Paris, kept through a sign-out.');
  await upload(page, 'pairs.json', JSON.stringify(SPOTS), 'application/json');
  const places = section(page, 'Places').locator('.player-row');
  await expect(places).toHaveCount(5);

  endEverywhere(servers);
  await button(page, 'Publish map').click();
  const line = page.locator('.action-bar').getByRole('alert');
  await expect(line).toHaveText(`${ENDED} Your map is still here: sign in in a new tab, then save again. Sign in in a new tab`);
  // signing in must not take the editor away: the link opens beside it
  const link = line.getByRole('link', { name: 'Sign in in a new tab' });
  await expect(link).toHaveAttribute('href', '#account');
  await expect(link).toHaveAttribute('target', '_blank');
  // nothing of the draft is lost, and the editor is still the editor
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Draft map');
  await expect(page.getByLabel('Short description')).toHaveValue('Five spots in Paris, kept through a sign-out.');
  await expect(places).toHaveCount(5);
  await expect(button(page, 'Publish map')).toBeEnabled();
  await expectNoAccountChrome(page);
  expect(servers.maps.maps).toHaveLength(2);

  // the player signs in in the other tab: this one shares its session, and the same button now saves
  await page.evaluate((password) => fetch('/api/account/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'neel', password }) }), PASSWORD);
  servers.maps.session = 'account';
  await button(page, 'Publish map').click();
  await expect(page.locator('.pane-title')).toHaveText('Draft map');
  expect(servers.maps.maps).toHaveLength(3);
});

// --- parties and matches ------------------------------------------------------------------------------------

test('creating a party after the session ended closes the form behind the notice and the way to sign in', async ({ page }) => {
  const servers = await signedIn(page);
  await open(page, '/#create');
  await expectAccountChrome(page);
  endEverywhere(servers);
  await button(page, 'Create party').click();
  const notice = page.locator('.pane-body .notice');
  await expect(notice).toContainText(ENDED);
  await expect(notice.getByRole('link', { name: 'Sign in or create an account' })).toHaveAttribute('href', '#account');
  await expect(button(page, 'Create party')).toHaveCount(0);
  await expectNoAccountChrome(page);
});

test("in a party's lobby an invite that is refused for want of a session says so", async ({ page }) => {
  const servers = await signedIn(page);
  servers.match.state = matchState({ players: [player('neel'), player('sam')] });
  await open(page, '/#create');
  await button(page, 'Create party').click();
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();
  // the lobby's own poll would say so a moment later: here only the invite has met it yet
  endSession(servers.social);
  await page.getByRole('button', { name: 'Invite ana' }).click();
  const invites = page.locator('.account-section').filter({ has: page.getByRole('heading', { name: 'Invite friends' }) });
  await expect(invites.locator('.fine')).toHaveText(`${ENDED} Sign in`);
  await expect(invites.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '#account');
  await expect(page.getByText(BARE)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Invite ana' })).toBeEnabled();
});

test("a report from a match's final standing that meets the end of the session says the player is no longer signed in", async ({ page }) => {
  const servers = await signedIn(page);
  servers.match.state = matchState({ you: viewer(), players: [player('sam'), player('neel')], phase: 'finished', places: FIVE_PLACES.slice(0, 3), outcome: outcome(['sam']) });
  servers.match.matchFound('m1');
  await page.goto('/');
  await page.getByRole('button', { name: 'Rejoin match' }).click();
  const final = page.getByRole('region', { name: 'Final standing' });
  await expect(final.getByRole('button', { name: 'Report sam' })).toBeVisible();
  // the match's own poll would shut the player out, with the way to sign in, a moment later: here only the report has met it yet
  endSession(servers.social);
  await final.getByRole('button', { name: 'Report sam' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'Cheating' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Report', exact: true }).click();
  await expect(final.getByRole('status').filter({ hasText: ENDED })).toHaveText(ENDED);
  await expect(page.getByText(BARE)).toHaveCount(0);
  await expect(final.getByRole('button', { name: 'Report sam' })).toBeEnabled();
});

// --- the languages -----------------------------------------------------------------------------------------

for (const code of ['de', 'ru'] as const) {
  const say = CATALOGS[code]!;

  test.describe(`${code} on a phone`, () => {
    test.use({ viewport: PHONE });

    test('the notice over the sign-in form, and the one that takes a pane\'s place, are in the language', async ({ page }) => {
      const servers = await signedIn(page, code);
      await open(page, '/#account');
      endEverywhere(servers);
      await page.getByRole('button', { name: say['reports.mine.show'], exact: true }).click();
      await expect(page.locator('.account-body > .status-box')).toHaveText(`${say['session.ended.label']}${say['session.ended']}`);
      await page.waitForLoadState('networkidle');
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);

      // a pane that needs an account, closed by its gate
      await open(page, '/#friends');
      await expect(page.locator('.pane-body .notice')).toBeVisible();
      await expectTranslated(page, code, NAMES);
    });

    test('the line a control says it in, the box that stands for a pane, and the editor\'s line that keeps the draft are in the language', async ({ page }) => {
      const servers = await signedIn(page, code);
      await open(page, '/?user=sam');
      endEverywhere(servers);
      await page.getByRole('button', { name: say['profile.friend.request'], exact: true }).click();
      await expect(page.locator('.friend-offer').getByRole('alert')).toHaveText(`${say['session.ended']} ${say['account.login.name']}`);
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);

      const box = await page.context().newPage();
      const moderator = await signedIn(box, code);
      endSession(moderator.social);
      await open(box, '/#moderation');
      await expect(box.locator('.pane-body .status-box')).toContainText(say['session.ended']);
      await expectTranslated(box, code, NAMES);

      const editor = await page.context().newPage();
      const maker = await signedIn(editor, code);
      await openEditor(editor);
      endEverywhere(maker);
      await editor.getByRole('button', { name: say['editor.publish'], exact: true }).click();
      // with nothing in the draft the editor says what it lacks before it asks the server
      await editor.locator('#map-name').fill('Draft map');
      await editor.getByLabel(say['editor.description']).fill('Five spots in Paris, kept through a sign-out.');
      await upload(editor, 'pairs.json', JSON.stringify(SPOTS), 'application/json');
      await expect(editor.locator('.player-row')).toHaveCount(5);
      await editor.getByRole('button', { name: say['editor.publish'], exact: true }).click();
      await expect(editor.locator('.action-bar').getByRole('alert')).toHaveText(`${say['session.ended.draft']} ${say['session.signInNewTab']}`);
      await expectTranslated(editor, code, [...NAMES, 'Draft map', 'Five spots in Paris, kept through a sign-out.', ...(await written(editor)), ...(await editor.locator('.player-row .player-name, .player-row .tag').allTextContents())]);
    });
  });
}
