import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Account } from '../src/account/client.ts';
import { COUNTRY_CODES } from '../src/account/countries.ts';
import { LANGUAGE_NAMES } from '../src/i18n/index.ts';
import { matchState, player, viewer } from '../src/multiplayer/testing.ts';
import { AccountServer } from './account-server.ts';
import { DailyServer, dailyEntries } from './daily-server.ts';
import { mockPlaces, mockServices } from './fixtures.ts';
import { GamesServer } from './games-server.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { MapsServer } from './maps-server.ts';
import { MatchServer } from './match-server.ts';
import { SocialServer, boardEntries, friend, profile } from './social-server.ts';

// The design pass over the home screen's panes: the start button always in reach on a phone, tap
// targets a finger can hit, two content widths and no others, destructive actions in one style,
// status shown as a dot and a label, and the small things a review of screenshots found.

const PHONE = { width: 390, height: 800 };
const DESKTOP = { width: 1440, height: 900 };
/** what a finger needs, either way */
const TAP = 44;
const NARROW = 640;
const WIDE = 880;
/** what players typed themselves, which no catalog has */
const NAMES = ['neel', 'sam', 'ana', 'kit', 'lee', 'zoe', 'Paris walk', 'My coast', 'Left bank and right, all on foot.', 'half of it is indoors', 'rude in chat', 'left every game', ...Array.from({ length: 12 }, (_, i) => `player${String(i + 1).padStart(3, '0')}`)];

interface Options {
  username?: string | null;
  firstVisit?: boolean;
  language?: string;
  account?: Partial<Account>;
  /** true when the day's challenge is already played */
  dailyDone?: boolean;
}

async function setUp(page: Page, options: Options = {}) {
  const username = options.username === undefined ? 'neel' : options.username;
  const session = username === null ? 'none' : 'account';
  await mockServices(page);
  await mockPlaces(page);
  const account = await AccountServer.install(page, username, 1016, { moderator: true, country: 'IN', ...options.account });
  const daily = await DailyServer.install(page, session);
  daily.entries = dailyEntries(12);
  daily.rounds = options.dailyDone ? [4800, 3950, 2500] : null;
  const games = await GamesServer.install(page, daily);
  games.session = session;
  const social = await SocialServer.install(page);
  social.session = session;
  const match = await MatchServer.install(page);
  match.session = session;
  const maps = await MapsServer.install(page);
  maps.session = session;
  await page.addInitScript(
    ([language, seen]) => {
      localStorage.setItem('plonk.language', language as string);
      if (seen) {
        localStorage.setItem('plonk.intro-seen', '1');
      }
    },
    [options.language ?? 'en', !options.firstVisit] as const,
  );
  return { account, daily, games, social, match, maps };
}

/**
 * What is written for the language by the browser or put together from parts, not taken whole from
 * a catalog: days, a game's settings in one line, the countries of the list (the browser has its
 * own names for a few), the languages by their own names, a country shown by its code, and the
 * line under a map's name.
 */
async function written(page: Page): Promise<string[]> {
  const drawn = await page.locator('time, .daily-facts .figure-value, .daily-facts .settings-line, .flag-code').allTextContents();
  const countries = await page.evaluate((codes) => {
    const names = new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'region' });
    return codes.map((country) => names.of(country) ?? country);
  }, [...COUNTRY_CODES]);
  // a map's byline is a sentence with the day in it, drawn in pieces around its maker's name
  const bylines = await page.locator('.pane-stack > .settings-line').evaluateAll((lines) => lines.flatMap((line) => [...line.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())));
  return [...Object.values(LANGUAGE_NAMES), ...drawn.map((text) => text.trim()), ...countries, ...bylines];
}

async function open(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await expect(page.locator('.pane-title')).toBeVisible();
  // what the pane asks the server for has arrived and been drawn
  await page.waitForLoadState('networkidle');
}

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** Every one of them is at least 44px high and wide. */
async function expectTappable(locator: Locator, what: string): Promise<void> {
  const boxes = await locator.evaluateAll((nodes) => nodes.filter((node) => (node as HTMLElement).checkVisibility()).map((node) => node.getBoundingClientRect()).map((r) => [Math.round(r.width), Math.round(r.height)]));
  expect(boxes.length, `${what}: none on the page`).toBeGreaterThan(0);
  expect(boxes.filter(([w, h]) => w! < TAP || h! < TAP), what).toEqual([]);
}

const friendsWaiting = (social: SocialServer) => {
  social.friends = {
    friends: [friend('sam', { level: 13, league: 'Nomad', party: 'ABC123', online: true, country: 'GB', lastSeenAt: '2026-10-11T11:59:00.000Z' }), friend('ana', { level: 2, league: 'Explorer', country: 'BR' })],
    incoming: ['kit', 'lee'],
    outgoing: ['zoe'],
    invites: [{ from: 'sam', code: 'ABC123' }],
  };
};

/** A board of eight players with the signed-in one ninth. */
const boardWithNeel = (social: SocialServer) => {
  social.boards = { ...social.boards, all: { ...social.boards.all, rating: { entries: [...boardEntries(8), { rank: 9, username: 'neel', country: 'IN', value: 1016, level: 3, league: 'Voyager' }], you: { rank: 9, value: 1016 } } } };
};

// --- M4: the start button is in reach on a phone ---------------------------------------------------------------

const SOLO: Array<{ name: string; address: string; start: 'singleplayer.start' | 'streak.start' | 'daily.play'; firstVisit?: boolean }> = [
  { name: 'Singleplayer on a first visit', address: '/', start: 'singleplayer.start', firstVisit: true },
  { name: 'Singleplayer', address: '/', start: 'singleplayer.start' },
  { name: 'Country streak', address: '/#streak', start: 'streak.start' },
  { name: 'Country Guesser', address: '/#country', start: 'singleplayer.start' },
  { name: 'Continent Guesser', address: '/#continent', start: 'singleplayer.start' },
  { name: 'Daily challenge', address: '/#daily', start: 'daily.play' },
];

for (const code of ['en', 'de', 'ru']) {
  const say = CATALOGS[code]!;

  test(`${code}: every solo pane's start button is on a phone's screen without scrolling`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    for (const pane of SOLO) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.goto('about:blank');
      await setUp(page, { language: code, firstVisit: pane.firstVisit });
      await open(page, pane.address);
      const start = page.getByRole('button', { name: say[pane.start], exact: true });
      await expect(start, pane.name).toBeVisible();
      const at = await box(start);
      expect(await page.evaluate(() => scrollY), pane.name).toBe(0);
      expect(at.y, pane.name).toBeGreaterThanOrEqual(0);
      expect(at.y + at.height, pane.name).toBeLessThanOrEqual(PHONE.height);
      expect(at.height, pane.name).toBeGreaterThanOrEqual(TAP);
      // the bar it stands in is 56px of canvas with the button inside it, not a band of the accent
      const bar = await box(page.locator('.action-bar'));
      expect(bar.y + bar.height, pane.name).toBe(PHONE.height);
      expect(bar.height, pane.name).toBeGreaterThanOrEqual(56);
      expect(at.width, pane.name).toBeLessThan(PHONE.width - 40);
      if (code !== 'en') {
        await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
      }
    }
  });

  test(`${code}: the phone's menu says what a tap does, and the start bar gets out of its way`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await setUp(page, { language: code });
    await open(page, '/');
    const toggle = page.locator('.menu-toggle');
    await expect(toggle).toHaveText(`${say['nav.item.singleplayer']}${say['home.menu']}`);
    await expectTappable(toggle, 'the menu row');

    await toggle.click();
    await expect(toggle).toHaveText(`${say['nav.item.singleplayer']}${say['home.menuClose']}`);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // the bar is back in the page, under the list, and covers none of it
    await expect(page.locator('.action-bar')).toHaveCSS('position', 'static');
    await expectTappable(page.locator('.nav .nav-item'), 'the menu items');
    if (code !== 'en') {
      await expectTranslated(page, code, NAMES);
    }

    await toggle.click();
    await expect(toggle).toHaveText(`${say['nav.item.singleplayer']}${say['home.menu']}`);
    await expect(page.locator('.action-bar')).toHaveCSS('position', 'fixed');
  });
}

test('on a first visit the how-to offers the tutorial quietly: the one filled button is Start game', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await setUp(page, { firstVisit: true });
  await open(page, '/');
  const intro = page.getByRole('region', { name: 'How to play' });
  await expect(intro.getByRole('button')).toHaveText(['Play the tutorial', 'Got it']);
  await expect(intro.locator('.button.ghost')).toHaveCount(2);
  await expect(page.locator('.pane .button.accent, .pane .button.primary')).toHaveText(['Start game']);
  // side by side, so the box is no taller than it must be
  const [tutorial, gotIt] = [await box(intro.getByRole('button', { name: 'Play the tutorial' })), await box(intro.getByRole('button', { name: 'Got it' }))];
  expect(tutorial.y).toBe(gotIt.y);
  await expectTappable(intro.getByRole('button'), 'the how-to buttons');
});

test('on a wide screen the start button is an ordinary row at the end of the options', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await setUp(page);
  await open(page, '/');
  await expect(page.locator('.action-bar')).toHaveCSS('position', 'static');
  const [form, start] = [await box(page.locator('form.setup')), await box(page.getByRole('button', { name: 'Start game' }))];
  expect(start.x).toBe(form.x);
  expect(start.y + start.height).toBe(form.y + form.height);
});

// --- minors: options ---------------------------------------------------------------------------------------------

test('Singleplayer and Country streak put their options in the same order', async ({ page }) => {
  await setUp(page);
  await open(page, '/');
  await expect(page.locator('form.setup legend')).toHaveText(['Map', 'Mode', 'Rounds', 'Time per round', 'Road names on the map']);
  await open(page, '/#streak');
  await expect(page.locator('form.setup legend')).toHaveText(['Mode', 'Time per round']);
});

test('on a phone, options with long names are rows of their own and an odd one out takes the whole last row', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { social } = await setUp(page);
  boardWithNeel(social);
  await open(page, '/');
  const mode =page.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Mode' }) });
  const cells = await mode.locator('.choice').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()).map((r) => ({ x: r.x, w: r.width, h: r.height })));
  expect(cells).toHaveLength(3);
  // one under the other, each the width of the row and one line high
  expect(new Set(cells.map((cell) => cell.x)).size).toBe(1);
  // (a hairline between two rows is part of the lower one)
  expect(cells.every((cell) => cell.w > 300 && cell.h >= TAP && cell.h <= TAP + 1)).toBe(true);
  // three short names still sit side by side
  const rounds = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Rounds' }) });
  expect(new Set(await rounds.locator('.choice').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().y))).size).toBe(1);
  await expectTappable(page.locator('.pane .choice'), 'the option cells');

  await open(page, '/#leaderboards');
  const board = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Board' }) });
  await expect(board.locator('.choices')).toHaveClass(/stack/);
  expect(new Set(await board.locator('.choice').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().x))).size).toBe(1);

  // five languages in two columns: the fifth is as wide as the grid, so no cell is left empty with half a hairline
  await open(page, '/#account');
  const languages = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Language' }) });
  const grid = await box(languages.locator('.choices'));
  const last = await box(languages.locator('.choice').last());
  expect(Math.round(last.width)).toBe(Math.round(grid.width) - 2);
});

// --- minors: tap targets on a phone ----------------------------------------------------------------------------

test('on a phone the small controls of the panes take a finger', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { social } = await setUp(page, { dailyDone: true });
  friendsWaiting(social);
  boardWithNeel(social);

  await open(page, '/#account');
  await expect(page.locator('.history tbody tr').first()).toBeVisible();
  await expectTappable(page.locator('.history .link-button'), 'Rounds, in the list of games');
  await page.getByRole('button', { name: 'Change country' }).click();
  await expectTappable(page.locator('.country-option'), 'the countries');
  await expectTappable(page.locator('.pane .button'), 'the account buttons');

  await open(page, '/#leaderboards');
  await expectTappable(page.locator('.board .profile-link'), 'names on a board');

  await open(page, '/#daily');
  await expectTappable(page.locator('.daily-board .profile-link'), "names on the day's board");

  await open(page, '/#friends');
  await expectTappable(page.locator('.player-row .profile-link'), 'names of friends');
  await expectTappable(page.locator('.player-row .button'), 'the buttons of a friend');

  await open(page, '/#maps');
  await expectTappable(page.locator('.player-row .profile-link'), 'names of maps and their makers');

  await open(page, '/#moderation');
  await expectTappable(page.locator('.player-row .profile-link, .player-row .button'), 'what a moderator can press');
});

test("on a phone a map's Report button shares its row with Like", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await setUp(page);
  await open(page, '/?community=paris-walk-x7k2');
  const [like, report] = [await box(page.getByRole('button', { name: 'Like', exact: true })), await box(page.getByRole('button', { name: 'Report', exact: true }))];
  expect(report.y).toBe(like.y);
  expect(report.x).toBeGreaterThan(like.x);
});

// --- M10: two content widths ----------------------------------------------------------------------------------------

/** every pane a signed-in moderator can open, and the views reached from them */
const PANES = ['/', '/#streak', '/#country', '/#continent', '/#daily', '/#ranked', '/#unranked', '/#team', '/#create', '/#join', '/#maps', '/?community=paris-walk-x7k2', '/?community=my-coast-q1w2', '/?edit=new', '/#leaderboards', '/#friends', '/#account', '/?user=sam', '/#moderation', '/#about'];
/** the panes with a chart or a table of many columns in them */
const WIDE_PANES = ['/#account', '/?user=sam'];

/**
 * The right edges of a pane's blocks, measured from its left edge. A block is what the pane's
 * stacks hold: the stacks themselves are passed through.
 */
const blockWidths = (page: Page) =>
  page.evaluate(() => {
    const STACKS = ['pane-section', 'pane-stack', 'pane-body', 'account-body', 'account', 'pane-host', 'resume-host'];
    const column = document.querySelector('.pane-column')!.getBoundingClientRect();
    const blocks: Array<{ what: string; right: number }> = [];
    const walk = (node: Element) => {
      for (const child of node.children) {
        if (!(child as HTMLElement).checkVisibility()) {
          continue;
        }
        if (STACKS.some((name) => child.classList.contains(name))) {
          walk(child);
        } else {
          blocks.push({ what: `${child.tagName.toLowerCase()}.${child.className}`, right: Math.round(child.getBoundingClientRect().right - column.left) });
        }
      }
    };
    walk(document.querySelector('.pane-column')!);
    return { left: Math.round(column.left), blocks, title: getComputedStyle(document.querySelector('.pane-title')!).fontSize };
  });

test('every pane is 640 wide, or 880 where it has a chart or a wide table, and starts at the left', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  for (const address of PANES) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.goto('about:blank');
    const { social, match } = await setUp(page, { dailyDone: true });
    friendsWaiting(social);
    boardWithNeel(social);
    // the offer to rejoin stands over the pane, and keeps the narrow measure too
    match.state = matchState({ you: viewer(), players: [player('sam'), player('neel')] });
    match.matchFound('m1');
    await open(page, address);
    const measured = await blockWidths(page);
    // beside the sidebar and its own padding, not in the middle of the room that is left
    expect(measured.left, address).toBe(232 + 48);
    expect(measured.title, address).toBe('28px');
    expect(measured.blocks.filter((block) => block.right > NARROW && block.right !== WIDE), address).toEqual([]);
    const widest = Math.max(...measured.blocks.map((block) => block.right));
    expect(widest, address).toBe(WIDE_PANES.includes(address) ? WIDE : NARROW);
  }
});

test("a wide pane's forms and sentences keep the narrow measure", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await setUp(page);
  await open(page, '/#account');
  const widths = (selector: string) => page.locator(selector).evaluateAll((nodes) => nodes.filter((node) => (node as HTMLElement).checkVisibility()).map((node) => Math.round(node.getBoundingClientRect().width)));
  expect(new Set(await widths('.account-stats, .level, .account-who, .history'))).toEqual(new Set([WIDE]));
  await page.getByRole('button', { name: 'Change country' }).click();
  await page.getByRole('button', { name: 'Change password' }).click();
  expect(new Set(await widths('.account-body .choice-row, .account-body .account-field .account-input, .account-body .country-picker .account-input, .account-body .inline-form'))).toEqual(new Set([NARROW]));
  expect(Math.max(...(await widths('.pane .lede, .pane .prose, .pane .fine')))).toBeLessThanOrEqual(NARROW);

  await open(page, '/?user=sam');
  expect(new Set(await widths('.account-stats, .level, .charts, .pane-head'))).toEqual(new Set([WIDE]));
  // the choice of period scopes the charts under it, and keeps their measure: the profile has one right edge
  expect(new Set(await widths('.pane .choice-row'))).toEqual(new Set([WIDE]));
});

// --- M7: destructive actions --------------------------------------------------------------------------------------

/** The destructive button is a ghost in the danger colour, and the safe one beside it is filled. */
async function expectDanger(page: Page, danger: Locator, safe: Locator | null): Promise<void> {
  await expect(danger).toHaveClass(/\bdanger\b/);
  const colours = await danger.evaluate((node) => {
    const style = getComputedStyle(node);
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.color = 'var(--danger)';
    probe.style.backgroundColor = 'var(--bg)';
    const want = getComputedStyle(probe);
    const result = { color: style.color, border: style.borderTopColor, background: style.backgroundColor, danger: want.color, bg: want.backgroundColor };
    probe.remove();
    return result;
  });
  expect(colours.color).toBe(colours.danger);
  expect(colours.border).toBe(colours.danger);
  expect(colours.background).toBe(colours.bg);
  if (safe) {
    await expect(safe).toHaveClass(/\bprimary\b/);
  }
  void page;
}

test('removing, banning and deleting are ghosts in the danger colour, with the safe choice filled beside them', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const { social, match } = await setUp(page);
  friendsWaiting(social);
  match.state = matchState({ you: viewer(), players: [player('sam'), player('neel')] });
  match.matchFound('m1');

  await open(page, '/#moderation');
  // a row's buttons are plain at rest; the danger colour is on the question asked before a removal or a ban, beside the filled way back
  const maps = page.getByRole('region', { name: 'Reported maps' });
  await expect(page.locator('.pane-host .player-row').locator('.button.danger, .button.primary')).toHaveCount(0);
  await maps.getByRole('button', { name: 'Remove the map Paris walk' }).click();
  await expectDanger(page, maps.getByRole('button', { name: 'Remove map' }), maps.getByRole('button', { name: 'Cancel' }));
  const kit = page.locator('.player-row').filter({ hasText: 'kit' });
  await kit.getByRole('button', { name: /^Ban/ }).click();
  await expectDanger(page, kit.getByRole('button', { name: 'Ban', exact: true }), kit.getByRole('button', { name: 'Cancel' }));
  // lifting a ban destroys nothing, and is not asked about
  await expect(page.locator('.player-row').filter({ hasText: 'lee' }).locator('.button.danger')).toHaveCount(0);

  // the offer to rejoin: leaving is for good
  const banner = page.getByRole('region', { name: 'Unfinished match' });
  await expectDanger(page, banner.getByRole('button', { name: 'Leave it' }), banner.getByRole('button', { name: 'Rejoin match' }));

  await open(page, '/#friends');
  // one kind of filled button on this pane: taking up an invite; and no red until a friend is about to be removed
  await expect(page.locator('.pane-host .button.primary, .pane-host .button.accent')).toHaveText(['Join party']);
  await expect(page.getByRole('region', { name: 'Party invites' }).locator('.button.primary')).toHaveCount(1);
  await expect(page.locator('.pane-host .button.danger')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove sam', exact: true }).click();
  const sam = page.getByRole('region', { name: 'Friends', exact: true }).locator('.player-row').filter({ hasText: 'sam' });
  await expectDanger(page, sam.getByRole('button', { name: 'Remove', exact: true }), sam.getByRole('button', { name: 'Cancel' }));

  await open(page, '/?community=my-coast-q1w2');
  const yours = page.getByRole('region', { name: 'Your map' });
  await expectDanger(page, yours.getByRole('button', { name: 'Delete map' }), yours.getByRole('link', { name: 'Edit map' }));
  await yours.getByRole('button', { name: 'Delete map' }).click();
  await expectDanger(page, yours.getByRole('button', { name: 'Yes, delete it' }), yours.getByRole('button', { name: 'Keep it' }));

  await open(page, '/#account');
  const remove = page.getByRole('button', { name: 'Delete account', exact: true });
  await expectDanger(page, remove, null);
  await remove.click();
  const confirm = page.locator('.delete-confirm');
  await expectDanger(page, confirm.getByRole('button', { name: 'Delete my account' }), confirm.getByRole('button', { name: 'Cancel' }));
});

// --- M11: the chart's headline -----------------------------------------------------------------------------------

test("the account's chart headlines say which day they are of, and are the figures in the stat cells", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const { social } = await setUp(page);
  // as the server keeps it: the day's point is written with the XP and the rating themselves, so the last one is where the account stands
  social.profiles = {
    ...social.profiles,
    neel: profile('neel', {
      friend: 'self',
      history: [
        { day: '2026-10-08', xp: 400, rating: 1000, xpRank: 80, ratingRank: 14 },
        { day: '2026-10-10', xp: 1200, rating: 1016, xpRank: 74, ratingRank: 12 },
      ],
    }),
  };
  await open(page, '/#account');
  const chart = (name: string) => page.locator('.chart').filter({ has: page.locator('.chart-head .label').getByText(name, { exact: true }) });
  await expect(chart('XP').locator('.chart-read')).toHaveText('Oct 101,200');
  await expect(chart('Rating').locator('.chart-read')).toHaveText('Oct 101,016');
  await expect(page.locator('.level .settings-line')).toContainText('1,200 XP');
  await expect(page.locator('.account-stats .figure').filter({ hasText: 'Rating' }).first()).toContainText('1,016');

  // reading another day says that day, and leaving the chart goes back to the latest
  const line = chart('XP').locator('.chart-line');
  await line.scrollIntoViewIfNeeded();
  const at = await box(line);
  await page.mouse.move(at.x + 2, at.y + at.height / 2);
  await expect(chart('XP').locator('.chart-read')).toHaveText('Oct 8400');
  await page.mouse.move(at.x - 40, at.y - 40);
  await expect(chart('XP').locator('.chart-read')).toHaveText('Oct 101,200');
});

// --- M12: contrast, as the browser draws it -----------------------------------------------------------------------

/** The WCAG contrast of an element's text against its own fill, from the colours the browser computed. */
const contrastOf = (locator: Locator) =>
  locator.evaluate((node) => {
    const channels = (colour: string) => (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (colour: string) => {
      const [r, g, b] = channels(colour).map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const style = getComputedStyle(node);
    const [light, dark] = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
    return (light! + 0.05) / (dark! + 0.05);
  });

for (const scheme of ['dark', 'light'] as const) {
  test(`${scheme}: the accent button's label and the badge can be read on their fill`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.emulateMedia({ colorScheme: scheme });
    const { social } = await setUp(page);
    friendsWaiting(social);
    await open(page, '/');
    expect(await contrastOf(page.getByRole('button', { name: 'Start game' }))).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator('.badge')).toBeVisible();
    expect(await contrastOf(page.locator('.badge'))).toBeGreaterThanOrEqual(4.5);
  });
}

// --- M13: status ------------------------------------------------------------------------------------------------------

test('a pane that cannot load says so as a status: a dot, a label, the sentence and a way to try again', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await setUp(page);
  let fail = true;
  await page.route('**/api/daily**', (route) => (fail ? route.fulfill({ status: 503, json: { success: false, error: 'Try again shortly.' } }) : route.fallback()));
  await open(page, '/#daily');
  const note = page.locator('.status-box');
  await expect(note).toHaveAttribute('role', 'alert');
  await expect(note.locator('.status-box-label')).toHaveText('Error');
  await expect(note.locator('.status-box-text')).toHaveText('Try again shortly.');
  // the dot is the danger colour, 6px across
  const dot = await note.locator('.status-box-label').evaluate((node) => {
    const style = getComputedStyle(node, '::before');
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.color = 'var(--danger)';
    const danger = getComputedStyle(probe).color;
    probe.remove();
    return { width: style.width, height: style.height, fill: style.backgroundColor, danger };
  });
  expect(dot).toEqual({ width: '6px', height: '6px', fill: dot.danger, danger: dot.danger });
  // the sentence is not label grey
  await expect(note.locator('.status-box-text')).toHaveCSS('font-size', '14px');

  fail = false;
  await note.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: "Play today's challenge" })).toBeVisible();
  await expect(note).toHaveCount(0);
});

test('a refusal beside a control carries the status dot', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const { social } = await setUp(page);
  social.refuse = 'No player has that name.';
  await open(page, '/#friends');
  await page.getByLabel('Add a friend by username').fill('nobody');
  await page.getByRole('button', { name: 'Send request' }).click();
  const refusal = page.getByRole('alert');
  await expect(refusal).toHaveText('No player has that name.');
  expect(await refusal.evaluate((node) => getComputedStyle(node, '::before').width)).toBe('6px');
});

test('a banned account is told so on its own pane as a status with the way to what still works', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await setUp(page, { account: { banned: true } });
  await open(page, '/#account');
  const note = page.locator('.status-box');
  await expect(note.locator('.status-box-label')).toHaveText('banned');
  await expect(note.locator('.status-box-text')).toHaveText('This account is banned from online play: matches, parties, chat, friends and map making. Playing alone still works.');
  await expect(note.getByRole('link', { name: 'Play singleplayer' })).toHaveAttribute('href', '#singleplayer');
});

// --- minors: the player's own row ---------------------------------------------------------------------------------

test("the player's own row on a board says so in a word", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const { social } = await setUp(page, { dailyDone: true });
  boardWithNeel(social);
  await open(page, '/#leaderboards');
  await expect(page.locator('.board tr.own .tag')).toHaveText('you');
  await expect(page.locator('.board .tag')).toHaveCount(1);

  await open(page, '/#daily');
  await expect(page.locator('.daily-board tr.own .tag')).toHaveText('you');
  await expect(page.locator('.daily-board .tag')).toHaveCount(1);
});

// --- the changed panes in German and Russian ----------------------------------------------------------------------

for (const code of ['de', 'ru']) {
  test(`${code}: the panes this pass changed are in the language and fit a phone`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE);
    for (const address of ['/#leaderboards', '/#friends', '/#account', '/?user=sam', '/#moderation', '/#maps', '/?community=my-coast-q1w2', '/#about']) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.goto('about:blank');
      const { social } = await setUp(page, { language: code, dailyDone: true });
      friendsWaiting(social);
      boardWithNeel(social);
      await open(page, address);
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
    }
    // a pane that failed to load, and a banned account's own pane
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.goto('about:blank');
    await setUp(page, { language: code, account: { banned: true } });
    await page.route('**/api/daily**', (route) => route.fulfill({ status: 503, json: { success: false, error: 'Try again shortly.' } }));
    await open(page, '/#daily');
    await expect(page.locator('.status-box-label')).toHaveText(CATALOGS[code]!['status.error']);
    await expectTranslated(page, code, [...NAMES, 'Try again shortly.']);
    await open(page, '/#account');
    await expect(page.locator('.status-box-label')).toHaveText(CATALOGS[code]!['moderation.banned']);
    await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
  });
}
