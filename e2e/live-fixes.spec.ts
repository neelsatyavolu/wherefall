import { expect, test, type Page } from '@playwright/test';
import type { Account } from '../src/account/client.ts';
import { AccountServer } from './account-server.ts';
import { DailyServer } from './daily-server.ts';
import { mockServices } from './fixtures.ts';
import { GamesServer } from './games-server.ts';
import { MapsServer, PARIS } from './maps-server.ts';
import { MatchServer } from './match-server.ts';
import { SocialServer, friend } from './social-server.ts';

// What a live run against the whole stack turned up: who may be asked about, by whom, and a choice
// of language that has to outlast a reload.

type Session = 'account' | 'guest' | 'none';

const GUEST = 'Guest #4821';
/** how often the friends pane asks again while it is open */
const FRIENDS_REFRESH_MS = 10_000;
/** the views that have no item in the sidebar: a profile, a map's page, the editor, a party link */
const LINKED_VIEWS = ['/?user=sam', `/?community=${PARIS.slug}`, '/?edit=new', '/?party=ABCD'];

const title = (page: Page) => page.locator('.pane-title');
const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

interface Asked {
  method: string;
  path: string;
  status: number;
}

/** Every request the page makes to the API, with what it was answered. */
function collect(page: Page): Asked[] {
  const asked: Asked[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) {
      asked.push({ method: response.request().method(), path: `${url.pathname}${url.search}`, status: response.status() });
    }
  });
  return asked;
}

/** Stands in for the whole API as it answers one kind of asker: each stand-in refuses what the server would. */
async function setUp(page: Page, session: Session, change: Partial<Account> = {}) {
  await mockServices(page);
  const account = await AccountServer.install(page, session === 'account' ? 'neel' : null, 1000, change);
  if (session === 'guest') {
    account.becomeGuest(GUEST);
  }
  const daily = await DailyServer.install(page, session);
  const servers = [await MatchServer.install(page), await SocialServer.install(page), await MapsServer.install(page), await GamesServer.install(page, daily)] as const;
  for (const server of servers) {
    server.session = session;
  }
  const [, social] = servers;
  return { account, social };
}

/** Opens every pane and linked view in turn, each as a fresh page, and gives back what was asked of the API on the way. */
async function visitEverything(page: Page): Promise<Asked[]> {
  const asked = collect(page);
  await page.goto('/');
  await expect(title(page)).toBeVisible();
  // the sidebar is what says which panes there are, the ones kept for moderators included
  const panes = await page.locator('a.nav-item').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(panes.length).toBeGreaterThan(10);
  expect(panes).toContain('#friends');
  for (const view of [...panes.map((hash) => `/${hash}`), ...LINKED_VIEWS]) {
    // a blank page between two views makes each of them a load of its own, not a change of hash
    await page.goto('about:blank');
    await page.goto(view);
    await expect(title(page)).toBeVisible();
    await page.waitForLoadState('networkidle');
  }
  return asked;
}

const refused = (asked: Asked[]) => asked.filter((each) => each.status === 401 || each.status === 403).map((each) => `${each.status} ${each.method} ${each.path}`);
const aboutFriends = (asked: Asked[]) => asked.filter((each) => each.path.startsWith('/api/social') && each.path.includes('friends')).map((each) => each.path);

for (const session of ['none', 'guest'] as const) {
  test(`${session === 'none' ? 'a visitor' : 'a guest'} opening every pane asks for nothing that needs an account`, async ({ page }) => {
    test.slow();
    await setUp(page, session);
    const asked = await visitEverything(page);
    // the panes did ask who is looking: this is not an empty list passing
    expect(asked.filter((each) => each.path === '/api/account').length).toBeGreaterThan(10);
    expect(aboutFriends(asked)).toEqual([]);
    expect(refused(asked)).toEqual([]);
  });
}

test('the friends pane stops asking once the session has ended, and says so', async ({ page }) => {
  const { account, social } = await setUp(page, 'account');
  social.friends = { friends: [friend('sam')], incoming: [], outgoing: [], invites: [] };
  await page.clock.install();
  const asked = collect(page);
  await page.goto('/#friends');
  await expect(section(page, 'Friends')).toContainText('sam');

  // signed out in another tab, or the account deleted from another browser: the next quiet refresh is refused
  account.signOut();
  social.session = 'none';
  await page.clock.fastForward(FRIENDS_REFRESH_MS);
  await expect(page.getByText('You are no longer signed in.')).toBeVisible();
  await expect(section(page, 'Friends')).toHaveCount(0);
  const before = aboutFriends(asked).length;

  await page.clock.fastForward(FRIENDS_REFRESH_MS * 3);
  await page.waitForLoadState('networkidle');
  expect(aboutFriends(asked).length).toBe(before);
  expect(refused(asked)).toEqual(['401 GET /api/social?friends=1']);
});

test('the moderation pane sends a visitor to sign in without asking for the reports', async ({ page }) => {
  await setUp(page, 'none');
  const asked = collect(page);
  await page.goto('/#moderation');
  await expect(title(page)).toHaveText('Moderation');
  await expect(page.locator('.pane-body').getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(asked.filter((each) => each.path.includes('moderation'))).toEqual([]);
  expect(refused(asked)).toEqual([]);
});

test('the moderation pane still shows a moderator the reports', async ({ page }) => {
  await setUp(page, 'account', { moderator: true });
  const asked = collect(page);
  await page.goto('/#moderation');
  await expect(section(page, 'Reported maps')).toContainText('Paris walk');
  await expect(section(page, 'Reported players')).toContainText('kit');
  expect(asked.filter((each) => each.path.includes('moderation')).map((each) => each.status)).toEqual([200]);
});

test('a language chosen on the account pane is still the language after a reload', async ({ page }) => {
  await setUp(page, 'account');
  await page.goto('/#account');
  await expect(title(page)).toHaveText('Account');
  await page.getByRole('radio', { name: 'Español' }).check();
  await expect(title(page)).toHaveText('Cuenta');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  await page.reload();
  // the page is loaded before its language is: the catalog is fetched first, and only then is anything drawn
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(title(page)).toHaveText('Cuenta');
  expect(await page.evaluate(() => localStorage.getItem('plonk.language'))).toBe('es');
});
