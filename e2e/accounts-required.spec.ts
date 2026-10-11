import { expect, test, type Page } from '@playwright/test';
import { AccountServer, guestReply, signIn } from './account-server.ts';
import { mockPlaces, mockServices } from './fixtures.ts';
import { MapsServer } from './maps-server.ts';
import { SocialServer } from './social-server.ts';

// Playing takes an account: what a visitor is shown on every pane that plays, what stays open to
// them, and that the link they followed is still there once they have signed in.

const CHALLENGE = '/?map=world&seed=e2e00001&t=0&mode=move&n=3';
const SIGN_IN = 'Sign in or create an account';
/** every button that starts or joins a game, on whichever pane */
const WAYS_TO_PLAY = /^(Start game|Start streak|Play today's challenge|Play challenge|Play the tutorial|Find a match|Create party|Join party|Play as a guest)$/;

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const nav = (page: Page, name: string) => mainNav(page).getByRole('link', { name, exact: true });
const title = (page: Page) => page.locator('.pane-title');
const notice = (page: Page) => page.locator('.pane-section .notice');

/** Nobody is signed in. */
async function visitor(page: Page): Promise<void> {
  await mockServices(page);
  await mockPlaces(page);
  await signIn(page, null);
}

const PLAY_PANES = [
  ['Singleplayer', '/', 'Playing needs an account'],
  ['Country streak', '/#streak', 'Playing needs an account'],
  ['Country Guesser', '/#country', 'Playing needs an account'],
  ['Continent Guesser', '/#continent', 'Playing needs an account'],
  ['Daily challenge', '/#daily', 'Playing needs an account'],
  ['Ranked duel', '/#ranked', 'Multiplayer needs an account'],
  ['Unranked match', '/#unranked', 'Multiplayer needs an account'],
  ['2v2 match', '/#team', 'Multiplayer needs an account'],
  ['Create party', '/#create', 'Multiplayer needs an account'],
  ['Join party', '/#join', 'Multiplayer needs an account'],
] as const;

for (const [name, address, why] of PLAY_PANES) {
  test(`a visitor on ${name} is told what it is and that it needs an account, with no way to play`, async ({ page }) => {
    await visitor(page);
    await page.goto(address);

    await expect(title(page)).toHaveText(name);
    await expect(notice(page)).toContainText(why);
    await expect(page.getByRole('button', { name: WAYS_TO_PLAY })).toHaveCount(0);

    await notice(page).getByRole('link', { name: SIGN_IN }).click();
    await expect(page).toHaveURL(/#account$/);
    await expect(page.getByLabel('Username')).toBeVisible();
    // the tutorial is a game too: the pane a visitor signs in on does not offer it
    await expect(page.getByRole('button', { name: WAYS_TO_PLAY })).toHaveCount(0);
  });
}

test('a guest session left from before is told a guest can no longer play, and is shown the way to an account', async ({ page }) => {
  await mockServices(page);
  await page.route('**/api/account', (route) => route.fulfill({ json: guestReply() }));
  for (const address of ['/', '/#daily', '/#unranked', '/#join']) {
    await page.goto(address);
    await expect(notice(page), address).toContainText('You are here as Guest #4821, a guest, and a guest can no longer play.');
    await expect(notice(page).getByRole('link', { name: 'Sign up' }), address).toHaveAttribute('href', '#account');
    await expect(page.getByRole('button', { name: WAYS_TO_PLAY }), address).toHaveCount(0);
  }
});

test('what is only read stays open to a visitor: the leaderboards and About', async ({ page }) => {
  await visitor(page);
  await SocialServer.install(page);

  await page.goto('/#leaderboards');
  await expect(title(page)).toHaveText('Leaderboards');
  await expect(page.getByRole('table').first()).toBeVisible();
  await expect(notice(page)).toHaveCount(0);

  await nav(page, 'About').click();
  await expect(page.getByRole('heading', { name: 'What Wherefall is' })).toBeVisible();
  await expect(page.locator('.pane-section')).toContainText('Do I need an account?');
  await expect(page.locator('.pane-section')).toContainText('Yes, to play.');
  await expect(notice(page)).toHaveCount(0);
});

for (const [what, address, pane, shows] of [
  ['a challenge link', CHALLENGE, 'Singleplayer', (page: Page) => expect(page.getByRole('button', { name: 'Play challenge' })).toBeVisible()],
  ['a party link', '/?party=ABC123', 'Join party', (page: Page) => expect(page.getByLabel('Party code')).toHaveValue('ABC123')],
] as const) {
  test(`${what} a visitor followed is still there once they have signed in`, async ({ page }) => {
    await mockServices(page);
    await mockPlaces(page);
    const account = await AccountServer.install(page, 'neel');
    account.signOut();
    await page.goto(address);
    await expect(title(page)).toHaveText(pane);
    await expect(page.getByRole('button', { name: WAYS_TO_PLAY })).toHaveCount(0);

    await notice(page).getByRole('link', { name: SIGN_IN }).click();
    await page.getByLabel('Username').fill('neel');
    await page.getByLabel('Password').fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.account-who')).toContainText('neel');

    // signing in changed the hash and nothing else of the address
    await nav(page, pane).click();
    await expect(title(page)).toHaveText(pane);
    await shows(page);
  });
}

test('a map chosen on the Maps pane by a visitor is the one Singleplayer opens on once they have signed in', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page);
  await MapsServer.install(page);
  const account = await AccountServer.install(page, 'neel');
  account.signOut();
  await page.goto('/#maps');
  await page.getByText('All 2 countries').click();
  await page.getByRole('button', { name: 'Choose Kenya' }).click();
  await expect(title(page)).toHaveText('Singleplayer');

  await notice(page).getByRole('link', { name: SIGN_IN }).click();
  await page.getByLabel('Username').fill('neel');
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.account-who')).toContainText('neel');

  await nav(page, 'Singleplayer').click();
  await expect(page.getByRole('radio', { name: 'Kenya 40 places' })).toBeChecked();
  // the choice was for that once: the form opens as usual the next time
  await nav(page, 'About').click();
  await nav(page, 'Singleplayer').click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Kenya 40 places' })).toHaveCount(0);
});

for (const [name, address, start] of [
  ['Singleplayer', '/', 'Start game'],
  ['Country streak', '/#streak', 'Start streak'],
  ['Country Guesser', '/#country', 'Start game'],
] as const) {
  test(`${name} does not start once the session has ended somewhere else: the pane asks for an account again`, async ({ page }) => {
    await mockServices(page);
    await mockPlaces(page);
    const account = await AccountServer.install(page, 'neel');
    await page.goto(address);
    await expect(page.getByRole('button', { name: start })).toBeVisible();

    // signed out in another tab
    account.signOut();
    await page.getByRole('button', { name: start }).click();
    await expect(notice(page)).toContainText('Playing needs an account');
    await expect(title(page)).toHaveText(name);
    await expect(page.locator('.play')).toHaveCount(0);
    await expect(page.getByRole('button', { name: WAYS_TO_PLAY })).toHaveCount(0);
  });
}

test('a banned account still plays alone, and is told why it cannot play online', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page);
  await signIn(page, 'neel', 1000, { banned: true });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await page.goto('/#streak');
  await expect(page.getByRole('button', { name: 'Start streak' })).toBeVisible();

  await page.goto('/#unranked');
  await expect(page.locator('.pane-section')).toContainText('This account is banned from online play');
  await expect(page.getByRole('button', { name: WAYS_TO_PLAY })).toHaveCount(0);
});

test('a pane that plays says so when the server cannot be asked who is looking, and asks again', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page);
  let down = true;
  await page.route('**/api/account', (route) => (down ? route.abort() : route.fallback()));
  await page.goto('/');
  await expect(title(page)).toHaveText('Singleplayer');
  await expect(page.getByRole('button', { name: 'Start game' })).toHaveCount(0);

  down = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});

test('a party is for accounts: its form has no setting for guests', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page);
  await page.goto('/#create');
  await expect(page.getByRole('group', { name: 'Teams' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Allow guests' })).toHaveCount(0);
  await expect(page.getByText('guest', { exact: false })).toHaveCount(0);
});
