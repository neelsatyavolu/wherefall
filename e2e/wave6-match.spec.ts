import { expect, test, type Page, type Request } from '@playwright/test';
import { EMOTES } from '../src/multiplayer/client.ts';
import { mockServices } from './fixtures.ts';
import { roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { clashes } from './match-boxes.ts';
import { SAYS } from './match-rules.ts';
import { MatchServer, signIn } from './match-server.ts';
import { SCENES, SEEN_MS, guessInScene, lobbyOf, openLobby, openScene, revealScene, typedIn } from './match-scenes.ts';

// Wave 6 for a match: the slower polling a party of forty brings (item 6), reactions that float over
// the round screen (item 15), places sent a round at a time (item 26), and two things the second
// design review asked for. The lobby at forty is in wave6-lobby.spec.ts.

const PHONE = { width: 390, height: 800 };
const DESKTOPS = [
  { width: 1360, height: 840 },
  { width: 1440, height: 900 },
] as const;

/** everything a reaction must never lie on while a round is played: the pin map's panel is the map, its tools and its Guess bar */
const NEVER_UNDER = ['.hud', '.health', '.net-banner', '.round-bar', '.roster', '.compass', '.pano-tools .return', '.credit', '.map-panel', '.map-toggle', '.chat-toggle', '.host-toggle', '.move-arrow'];
const floats = (page: Page) => page.locator('.reaction-float');

/** The gaps between the page's next `count` requests for the match, in ms. */
async function pollGaps(page: Page, count: number): Promise<number[]> {
  const times: number[] = [];
  const note = (request: Request) => {
    if (request.method() === 'GET' && request.url().includes('/api/match?id=')) {
      times.push(Date.now());
    }
  };
  page.on('request', note);
  await expect.poll(() => times.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(count + 1);
  page.off('request', note);
  return times.slice(1, count + 1).map((time, index) => time - times[index]!);
}

/** Each gap is the pace and the time one reply takes, no less and not much more. */
const expectPace = (gaps: number[], ms: number) => gaps.forEach((gap) => expect([gap >= ms - 100, gap <= ms + 900], `a gap of ${gap} ms at a pace of ${ms}`).toEqual([true, true]));

// --- item 6: forty players, and how often a match is asked for --------------------------------------

test('a duel is asked for every 1.5 seconds', async ({ page }) => {
  test.setTimeout(60_000);
  await openScene(page, 'ranked', 'en');
  expectPace(await pollGaps(page, 3), 1500);
});

test('a party of twenty is asked for every 2.5 seconds', async ({ page }) => {
  test.setTimeout(60_000);
  await openScene(page, 'twenty', 'en');
  expectPace(await pollGaps(page, 3), 2500);
});

test('a full party is asked for every 4 seconds, in its lobby as in its rounds, and quicker again as it empties', async ({ page }) => {
  test.setTimeout(90_000);
  const { server } = await openLobby(page, lobbyOf('forty'));
  await expect(page.getByText('Players · 40 of 40')).toBeVisible();
  expectPace(await pollGaps(page, 2), 4000);
  // down to ten players: the next reply says so, and from it on the lobby is asked for every second and a half
  server.state = { ...server.state, players: server.state.players.slice(0, 10) };
  await expect(page.getByText('Players · 10 of 40')).toBeVisible({ timeout: SEEN_MS });
  expectPace(await pollGaps(page, 3), 1500);
});

test('the Create party pane says a party holds two to forty, in every language', async ({ page }) => {
  await MatchServer.install(page);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/#create');
  await expect(page.getByText('A private match for two to forty players.', { exact: false })).toBeVisible();
  await expect(page.getByText('2 to 40 players · any map · your rules · not rated')).toBeVisible();
  for (const code of ['es', 'fr', 'de', 'ru']) {
    expect(CATALOGS[code]!['party.create.facts']).toContain('40');
    expect(CATALOGS[code]!['party.create.facts']).not.toContain('20');
  }
});

// --- minors -----------------------------------------------------------------------------------------

for (const code of ['en', 'fr', 'ru'] as const) {
  test(`a duel's health bar in ${code} names the player without "(you)", whole, and still says so to a screen reader`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    const { say } = await openScene(page, 'ranked', code);
    const own = page.locator('.health-row.own');
    await expect(own.locator('.health-name')).toHaveText(/neel$/);
    expect(await own.locator('.health-name').evaluate((name) => name.scrollWidth <= name.clientWidth)).toBe(true);
    const you = say['match.nameYou']!.replace('{name}', 'neel');
    await expect(own.getByRole('meter')).toHaveAttribute('aria-label', say['match.healthOf']!.replace('{name}', you));
    await expect(page.locator('.health-row:not(.own)').getByRole('meter')).toHaveAttribute('aria-label', say['match.healthOf']!.replace('{name}', 'aleksandra_wojcik_92'));
  });
}

test('a match that is not there is said in the server’s words, not as a lost connection', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = SCENES.eight().state;
  // the queue hands over a match the server no longer has: it ended, or this player is no longer in it
  server.matchFound('gone');
  await signIn(page, 'neel', 1016);
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Rejoin match' }).click();
  const notice = page.locator('.notice-panel');
  await expect(notice).toBeVisible({ timeout: SEEN_MS });
  await expect(notice.locator('.prose')).toHaveText(SAYS.noSuchMatch);
  expect(SAYS.noSuchMatch).toBe('That match does not exist, or you are not in it.');
  await expect(page.getByText('Connection lost', { exact: false })).toHaveCount(0);
  // nothing more is asked of it, and there is a way on
  let asked = 0;
  page.on('request', (request) => {
    asked += request.url().includes('/api/match?id=') ? 1 : 0;
  });
  await page.waitForTimeout(2500);
  expect(asked).toBe(0);
  await notice.getByRole('button', { name: 'Home' }).click();
  await expect(notice).toHaveCount(0);
});

// --- item 15: reactions that float ------------------------------------------------------------------

for (const viewport of [PHONE, DESKTOPS[0]]) {
  const size = `${viewport.width}x${viewport.height}`;
  const phone = viewport.width <= 720;

  test(`at ${size} a reaction floats by the roster with its sender's name, lies on nothing, and goes`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const { server, say } = await openScene(page, 'eight', 'en');
    // while the player is still guessing there is no list of who has guessed: the reaction stands where it will be
    server.say('ana', null, 'gg');
    await expect(floats(page).last()).toHaveText(/ana\s*gg$/, { timeout: SEEN_MS });
    expect(await clashes(page, ['.reaction-float', ...NEVER_UNDER])).toEqual([]);
    await expect(floats(page)).toHaveCount(0, { timeout: 6000 });

    // once the guess is in, it floats by that list: under it on a wide screen, beside its one line on a phone
    await guessInScene(page, say);
    await expect(page.locator('.roster')).toBeVisible();
    // off the pin map, which is larger while the pointer is on it
    await page.mouse.move(400, 40);
    await page.waitForTimeout(400);
    server.say('maximilian_wanderer', null, 'nice');
    await expect(floats(page).last()).toBeVisible({ timeout: SEEN_MS });
    // it comes up a little way as it appears: measured once it stands still
    await page.waitForTimeout(400);
    const [chip, roster] = [(await floats(page).last().boundingBox())!, (await page.locator('.roster').boundingBox())!];
    if (phone) {
      expect(chip.x).toBeGreaterThanOrEqual(roster.x + roster.width);
      expect(Math.abs(chip.y - roster.y)).toBeLessThanOrEqual(1);
      expect(chip.x + chip.width).toBeLessThanOrEqual(viewport.width - 16 + 0.5);
    } else {
      expect(chip.y).toBeGreaterThanOrEqual(roster.y + roster.height);
      expect(chip.x).toBe(roster.x);
      expect(chip.x + chip.width).toBeLessThanOrEqual(roster.x + roster.width + 0.5);
    }
    expect(await clashes(page, ['.reaction-float', ...NEVER_UNDER])).toEqual([]);
    // the name gives way, the word is whole
    expect(await floats(page).last().locator('.reaction-word').evaluate((word) => word.scrollWidth <= word.clientWidth)).toBe(true);
    await expect(floats(page)).toHaveCount(0, { timeout: 6000 });
  });

  test(`at ${size} five reactions at once are a short list, not a heap, and the player's own floats too`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const { server } = await openScene(page, 'eight', 'en');
    await expect(floats(page)).toHaveCount(0);
    ['ana', 'kit', 'o', 'bartholomew_fitzroy', 'maximilian_wanderer'].forEach((name, index) => server.say(name, null, EMOTES[index]!));
    // no more than three stand there, the newest last; on a phone the row beside the roster's line has room for one
    await expect(floats(page).last()).toHaveText(/maximilian_wanderer\s*nice$/, { timeout: SEEN_MS });
    await expect(floats(page)).toHaveCount(3);
    await expect(page.locator('.reaction-float:visible')).toHaveCount(phone ? 1 : 3);
    expect(await clashes(page, ['.reaction-float', ...NEVER_UNDER])).toEqual([]);
    await expect(floats(page)).toHaveCount(0, { timeout: 6000 });

    // sent from this page: it is in the reply to the request, so it floats at once
    await page.getByRole('complementary', { name: 'Chat' }).getByRole('button', { name: /Chat/ }).click();
    await page.getByRole('group', { name: 'Reactions' }).getByRole('button', { name: 'wow', exact: true }).click();
    await expect(floats(page).last()).toHaveText(/neel\s*wow$/);
  });
}

test('a reaction floats and is no longer said twice: the chat button’s toast is for what was written', async ({ page }) => {
  const { server } = await openScene(page, 'twenty', 'en');
  const toast = page.locator('.chat-toast');
  server.say('ana', null, 'gg');
  await expect(floats(page).last()).toHaveText(/ana\s*gg$/, { timeout: SEEN_MS });
  await expect(toast).toBeEmpty();
  // and it is read out where it floats
  await expect(page.locator('.reaction-floats')).toHaveAttribute('role', 'status');
  server.say('ana', 'which way is north');
  await expect(toast).toHaveText('ana: which way is north', { timeout: SEEN_MS });
  await expect(floats(page).filter({ hasText: 'north' })).toHaveCount(0);
});

test('under reduced motion a reaction appears and goes, without moving or fading', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { server } = await openScene(page, 'eight', 'en');
  server.say('ana', null, 'gg');
  const chip = floats(page).last();
  await expect(chip).toBeVisible({ timeout: SEEN_MS });
  expect(await chip.evaluate((node) => [getComputedStyle(node).animationName, getComputedStyle(node).opacity, getComputedStyle(node).transform])).toEqual(['none', '1', 'none']);
  await expect(floats(page)).toHaveCount(0, { timeout: 6000 });
});

test('with motion allowed it moves: the same reaction is drawn by the keyframes', async ({ page }) => {
  const { server } = await openScene(page, 'eight', 'en');
  server.say('ana', null, 'gg');
  await expect(floats(page).last()).toBeVisible({ timeout: SEEN_MS });
  expect(await floats(page).last().evaluate((node) => getComputedStyle(node).animationName)).toBe('reaction-float');
});

test('nothing floats for an account that hides chat', async ({ page }) => {
  const { server } = await openScene(page, 'eight', 'en', undefined, { hideChat: true });
  await expect(page.getByRole('complementary', { name: 'Chat' })).toBeHidden();
  const polls = server.polls;
  server.say('ana', null, 'gg');
  await expect.poll(() => server.polls, { timeout: SEEN_MS }).toBeGreaterThanOrEqual(polls + 2);
  await expect(floats(page)).toHaveCount(0);
});

test('nothing floats from a muted player, and nothing in a party whose host turned communication off', async ({ page }) => {
  const { server } = await openScene(page, 'twenty', 'en');
  server.state = { ...server.state, you: { ...server.state.you, muted: ['ana'] } };
  server.say('ana', null, 'gg');
  server.say('kit', null, 'hi');
  await expect(floats(page).last()).toHaveText(/kit\s*hi$/, { timeout: SEEN_MS });
  await expect(floats(page)).toHaveCount(1);
  await expect(floats(page)).toHaveCount(0, { timeout: 6000 });

  server.state = { ...server.state, settings: { ...server.state.settings, communication: 'off' }, you: { ...server.state.you, muted: [] } };
  const polls = server.polls;
  server.say('kit', null, 'wow');
  await expect.poll(() => server.polls, { timeout: SEEN_MS }).toBeGreaterThanOrEqual(polls + 2);
  await expect(floats(page)).toHaveCount(0);
});

test('a reaction over a reveal stands beside the panel and off the HUD, the chat button and the map’s own buttons', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { server, scene, say } = await openScene(page, 'team', 'en');
  await guessInScene(page, say);
  await revealScene(page, server, scene);
  server.say('kit', null, 'gg');
  await expect(floats(page).last()).toBeVisible({ timeout: SEEN_MS });
  expect(await clashes(page, ['.reaction-float', '.hud', '.health', '.panel-host > *', '.map-zoom', '.chat-toggle', '.map .maplibregl-ctrl-attrib-button'])).toEqual([]);
});

for (const code of ['de', 'ru'] as const) {
  test(`a floating reaction on a phone is all in ${code}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    const { server, scene, say } = await openScene(page, 'eight', code);
    await guessInScene(page, say);
    server.say('bartholomew_fitzroy', null, 'heart');
    await expect(floats(page).last()).toBeVisible({ timeout: SEEN_MS });
    await expectTranslated(page, code, [...typedIn(scene), ...EMOTES]);
  });
}

// --- item 26: a match's places sent only up to the round being played ------------------------------

test('a player who did not draw the places sees every round, with the places sent a round at a time', async ({ page }) => {
  test.setTimeout(60_000);
  const server = await MatchServer.install(page);
  const { state } = SCENES.eight();
  server.state = state;
  server.startRound(0, 300_000);
  server.matchFound(state.id);
  await signIn(page, 'neel', 1016);
  await mockServices(page);
  const sent: number[] = [];
  page.on('response', async (response) => {
    if (response.request().method() === 'GET' && response.url().includes('/api/match?id=')) {
      const body = (await response.json().catch(() => null)) as { data?: { places?: unknown[] | null } } | null;
      sent.push(body?.data?.places?.length ?? 0);
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Rejoin match' }).click();
  // a round that is ready has its picture: without one the status line would say so
  await roundReady(page);
  expect(new Set(sent)).toEqual(new Set([1]));

  for (const round of [1, 2]) {
    server.revealScores(SCENES.eight().scores);
    await expect(page.locator('.play')).toHaveAttribute('data-phase', 'result');
    // the revealed round's place is one of those the page has: the panel names its country
    await expect(page.locator('.panel-host .figure-value').first()).not.toBeEmpty();
    server.startRound(round, 300_000);
    await roundReady(page);
    await expect(page.locator('.hud')).toContainText(`${round + 1} / 5`);
    await expect(page.getByText(CATALOGS.en!['match.viewMissing']!)).toHaveCount(0);
  }
  expect(Math.max(...sent)).toBe(3);
});
