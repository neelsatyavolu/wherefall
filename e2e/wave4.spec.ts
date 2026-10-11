import { expect, test, type Page } from '@playwright/test';
import { KIND_SETTINGS, guessRow, matchState, outcome, player, viewer } from '../src/multiplayer/testing.ts';
import { RUSSIA_ONLY, mockPlaces, mockServices } from './fixtures.ts';
import { placePin, play, roundReady } from './helpers.ts';
import { MapsServer } from './maps-server.ts';
import { FIVE_PLACES, MatchServer, signIn } from './match-server.ts';
import { SocialServer } from './social-server.ts';

const CHALLENGE = '/?map=world&seed=e2e00001&t=0&mode=move&n=3';
/** "neel" as a player who is not the host */
const MEMBER = viewer();
const title = (page: Page) => page.locator('.pane-title');
const buttonsOf = (page: Page) => page.getByRole('alert').getByRole('button');

async function setUp(page: Page, username: string | null = 'neel', flags: { moderator?: boolean; banned?: boolean } = {}) {
  await mockServices(page);
  await signIn(page, username, 1000, flags);
  const match = await MatchServer.install(page);
  const social = await SocialServer.install(page);
  const maps = await MapsServer.install(page);
  return { match, social, maps };
}

async function guessOnce(page: Page): Promise<void> {
  await placePin(page, { x: 150, y: 150 });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
}

// --- 1. skip ---------------------------------------------------------------------------------------

test('a place whose view will not load can be skipped for a spare, and the game keeps its rounds', async ({ page }) => {
  const shown = await mockServices(page);
  // the first picture asked for never loads, however often it is tried
  let broken: string | null = null;
  await page.route('https://img.plonk.test/**/sd.jpg', async (route) => {
    broken ??= route.request().url();
    await (route.request().url() === broken ? route.abort() : route.fallback());
  });
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();

  await expect(page.getByRole('alert')).toContainText('This view would not load.');
  await expect(buttonsOf(page)).toHaveText(['Try again', 'Skip this place', 'Exit']);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('alert')).toContainText('This view would not load.');
  await page.getByRole('button', { name: 'Skip this place' }).click();

  await roundReady(page);
  await expect(page.locator('.hud')).toContainText('1 / 3');
  expect(shown).toHaveLength(1);
  // the rest of the game is as it was
  for (let round = 1; round <= 3; round++) {
    await roundReady(page);
    await guessOnce(page);
    await page.getByRole('button', { name: round === 3 ? 'See summary' : 'Next round' }).click();
  }
  await expect(page.getByRole('region', { name: 'Game summary' }).locator('tbody tr')).toHaveCount(3);
});

test('when the spares run out the game says so, and Exit is the way out', async ({ page }) => {
  await mockServices(page);
  await page.route('https://img.plonk.test/**/sd.jpg', (route) => route.abort());
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await expect(page.getByRole('alert')).toContainText('This view would not load.');

  // five spares are drawn with a three-round game: each takes its turn and fails, and the sixth skip finds none
  for (let skip = 1; skip <= 6; skip++) {
    await page.getByRole('button', { name: 'Skip this place' }).click();
    await expect(page.getByRole('alert')).toContainText(skip <= 5 ? 'This view would not load.' : 'There is no other place to switch to in this game.');
  }
  await expect(buttonsOf(page)).toHaveText(['Try again', 'Exit']);
  await page.getByRole('button', { name: 'Exit', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});

test('a streak skips a place that will not load and carries on', async ({ page }) => {
  await mockServices(page);
  await mockPlaces(page, RUSSIA_ONLY);
  let failed = false;
  await page.route('https://img.plonk.test/**/sd.jpg', async (route) => {
    const first = !failed;
    failed = true;
    await (first ? route.abort() : route.fallback());
  });
  await page.goto('/#streak');
  await page.getByRole('button', { name: 'Start streak' }).click();
  await expect(buttonsOf(page)).toHaveText(['Try again', 'Skip this place', 'Exit']);
  await page.getByRole('button', { name: 'Skip this place' }).click();
  await roundReady(page);
  await expect(page.locator('.hud .hud-cell').filter({ hasText: 'Streak' })).toHaveText('Streak0');
});

// --- 2. joining a public game under way ---------------------------------------------------------------

test('a player dropped into a public game sees the standing, joins at the next round, and has blanks before it', async ({ page }) => {
  const { match } = await setUp(page);
  const others = ['ana', 'sam'];
  match.state = matchState({
    id: 'm9',
    code: null,
    kind: 'unranked',
    phase: 'playing',
    settings: KIND_SETTINGS.unranked,
    you: MEMBER,
    players: [player('ana', { total: 3000 }), player('sam', { total: 1000 }), player('neel')],
    places: FIVE_PLACES,
    results: [{ round: 0, guesses: [guessRow('ana', 3000), guessRow('sam', 1000)] }],
  });
  match.startRound(1);
  // the second round of 45 seconds has been running for twenty when this player arrives: more than
  // fifteen seconds of it are left and three rounds are still to start, so the server lets them in
  match.state = { ...match.state, roundStartsAt: match.time(-20_000), roundEndsAt: match.time(25_000) };
  await page.goto('/#unranked');
  await expect(page.getByText('you are dropped into it and play from its next round')).toBeVisible();
  // the queue answers with the match at once
  match.matchFound('m9');
  await page.route('**/api/match', async (route) => {
    await (route.request().postDataJSON()?.action === 'queue' ? route.fulfill({ json: { success: true, data: { ...match.queue, serverNow: match.time(0) } } }) : route.fallback());
  });
  await page.getByRole('button', { name: 'Find a match' }).click();

  const joining = page.getByRole('region', { name: 'Joining a game under way' });
  await expect(joining).toContainText('You join in round 3');
  await expect(joining.locator('tbody tr')).toHaveText([/1\s*ana\s*3,000/, /2\s*sam\s*1,000/, /3\s*neelyou\s*0/]);
  await expect(page.getByRole('button', { name: 'Guess', exact: true })).toBeHidden();
  // the corner says which round the others are on
  await expect(page.locator('.hud')).toContainText('2 / 5');
  others.forEach((name) => match.opponentGuesses(name));
  match.reveal(0, 1000);
  await page.waitForTimeout(1800);
  await expect(joining).toBeVisible();
  expect(match.posted('guess')).toHaveLength(0);

  match.startRound(2);
  await roundReady(page);
  await expect(page.locator('.hud')).toContainText('3 / 5');
  await guessOnce(page);
  others.forEach((name) => match.opponentGuesses(name));
  match.reveal(4000, 500);
  const result = page.getByRole('region', { name: 'Round result' });
  await expect(result.locator('tbody tr').first().locator('td')).toHaveText(['neelyou', '321 km', '4,000', '4,000']);

  match.finish(outcome(['ana']));
  const final = page.getByRole('region', { name: 'Final standing' });
  await expect(final.locator('tbody tr')).toHaveText([/1\s*anawon\s*4,500/, /2\s*neelyou\s*4,000/, /3\s*sam\s*2,500/]);
});

// --- 3. moderation ---------------------------------------------------------------------------------------

test('only a moderator has the Moderation pane, and it acts on reported maps and players', async ({ page }) => {
  const { social } = await setUp(page, 'neel', { moderator: true });
  await page.goto('/');
  await page.getByRole('link', { name: 'Moderation' }).click();
  await expect(title(page)).toHaveText('Moderation');

  const maps = page.getByRole('region', { name: 'Reported maps' });
  const players = page.getByRole('region', { name: 'Reported players' });
  await expect(maps.locator('.player-row')).toHaveText([/Paris walk\s*by sam\s*2 reports.*half of it is indoors/]);
  // each open report of a player says what it is about, before the note that came with it
  await expect(players.locator('.player-row')).toHaveText([/kit\s*3 reports.*Offensive chat\s*rude in chat\s*Other\s*left every game\s*Cheating/, /lee\s*banned · 1 report/]);

  // a ban is asked once more in the row, and settles the open reports
  await page.getByRole('button', { name: 'Ban kit from online play' }).click();
  await players.getByRole('button', { name: 'Ban', exact: true }).click();
  await expect(players.locator('.player-row').first()).toContainText('banned · 0 reports');
  await page.getByRole('button', { name: 'Lift the ban on lee' }).click();
  await page.getByRole('button', { name: 'Dismiss the reports on lee' }).click();
  await expect(players.locator('.player-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove the map Paris walk' }).click();
  await maps.getByRole('button', { name: 'Remove map', exact: true }).click();
  await expect(maps).toContainText('No map is waiting for a decision.');
  expect(social.posted('moderate')).toEqual([
    { action: 'moderate', target: 'player', username: 'kit', decision: 'ban' },
    { action: 'moderate', target: 'player', username: 'lee', decision: 'unban' },
    { action: 'moderate', target: 'player', username: 'lee', decision: 'dismiss' },
    { action: 'moderate', target: 'map', slug: 'paris-walk-x7k2', decision: 'remove' },
  ]);

  await signIn(page, 'neel');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Moderation' })).toBeHidden();
});

test('a player can be reported from their profile and from a final standing, but nobody reports themselves', async ({ page }) => {
  const { social, match } = await setUp(page);
  await page.goto('/?user=sam');
  await page.getByRole('button', { name: 'Report player' }).click();
  // a report says what it is about (wave 6)
  await page.locator('.report-form').getByRole('radio', { name: 'Cheating' }).check();
  await page.getByLabel('Report sam').fill('made-up scores');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Reported. A moderator will look at it.')).toBeVisible();
  await page.goto('/?user=neel');
  await expect(page.getByRole('region', { name: "neel's stats" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Report player' })).toHaveCount(0);

  match.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')], phase: 'finished', places: FIVE_PLACES.slice(0, 3), outcome: outcome(['sam']) });
  match.matchFound('m1');
  await page.goto('/');
  await page.getByRole('button', { name: 'Rejoin match' }).click();
  const final = page.getByRole('region', { name: 'Final standing' });
  await expect(final.getByRole('button', { name: /^Report / })).toHaveCount(1);
  await final.getByRole('button', { name: 'Report sam' }).click();
  await expect(page.getByRole('dialog')).toContainText('Report sam to the moderators?');
  await page.getByRole('dialog').getByRole('radio', { name: 'Offensive name' }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Report', exact: true }).click();
  // what became of it is said under the table, and the button stays off
  await expect(final.getByRole('status').filter({ hasText: 'reported' })).toHaveText('sam was reported. A moderator will look at it.');
  await expect(final.getByRole('button', { name: 'Report sam' })).toBeDisabled();
  expect(social.posted('report')).toEqual([
    { action: 'report', username: 'sam', category: 'cheating', reason: 'made-up scores' },
    { action: 'report', username: 'sam', category: 'name' },
  ]);
});

test('a banned account is told so on every online pane and the editor, and can still play alone', async ({ page }) => {
  await setUp(page, 'neel', { banned: true });
  for (const address of ['/#ranked', '/#unranked', '/#team', '/#create', '/#join', '/#friends', '/?edit=new']) {
    await page.goto(address);
    await expect(page.getByRole('alert'), address).toContainText('This account is banned from online play');
    await expect(page.getByRole('button', { name: /Find a match|Create party|Join party|Send request|Publish map/ })).toHaveCount(0);
  }
  await page.goto('/#account');
  await expect(page.getByRole('alert')).toContainText('This account is banned from online play');
  await page.getByRole('alert').getByRole('link', { name: 'Play singleplayer' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await roundReady(page);
});

// --- 4, 5. the viewer budget and sounds ------------------------------------------------------------------

test('with no Google imagery set up, the daily allowance is never asked about', async ({ page }) => {
  await mockServices(page);
  const asked: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/daily' && request.method() === 'POST') {
      asked.push(request.postData() ?? '');
    }
  });
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await guessOnce(page);
  expect(asked).toEqual([]);
  await expect(play(page)).toHaveAttribute('data-imagery', 'panoramax');
  await expect(page.locator('.credit')).toHaveText('Imagery: Panoramax contributors');
});

/** Counts every audio context the page makes, from before any of its code runs. */
async function countAudio(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    (window as unknown as { audioMade: number }).audioMade = 0;
    window.AudioContext = class extends Real {
      constructor() {
        super();
        (window as unknown as { audioMade: number }).audioMade += 1;
      }
    };
  });
  return () => page.evaluate(() => (window as unknown as { audioMade: number }).audioMade);
}

test('no sound is made before the player touches the page, and none at all when Sound is off', async ({ page }) => {
  await mockServices(page);
  await signIn(page, null);
  const audioMade = await countAudio(page);
  await page.goto(CHALLENGE);
  await expect(page.getByRole('button', { name: 'Play challenge' })).toBeVisible();
  expect(await audioMade()).toBe(0);

  // a button's click is the first sound (wave 6): one context is made at that first touch, and reused after
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  expect(await audioMade()).toBe(1);
  await placePin(page, { x: 150, y: 150 });
  expect(await audioMade()).toBe(1);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  expect(await audioMade()).toBe(1);

  await page.goto('/#account');
  await expect(page.getByRole('radio', { name: 'On', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Off', exact: true }).check();
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(page);
  await guessOnce(page);
  await expect(play(page)).toHaveAttribute('data-phase', 'result');
  expect(await audioMade()).toBe(0);
  await page.goto('/#account');
  await expect(page.getByRole('radio', { name: 'Off', exact: true })).toBeChecked();
});

// --- 6. the installable app -------------------------------------------------------------------------------

test('the manifest, its icons and the service worker are served, and the worker leaves the API alone', async ({ page }) => {
  await mockServices(page);
  let calls = 0;
  await page.route('**/api/account', (route) => route.fulfill({ json: { success: true, data: { account: null, guest: null, stats: null, recentGames: [], n: ++calls } } }));
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');

  const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  expect(manifest).toMatchObject({ name: 'Wherefall', display: 'standalone', start_url: '/', background_color: '#0E0E0D' });
  const icons = manifest.icons as Array<{ src: string; sizes: string; purpose: string }>;
  expect(icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  for (const icon of [...icons.map((each) => each.src), '/icons/apple-touch-icon.png']) {
    expect(await page.evaluate(async (src) => (await fetch(src)).status, icon), icon).toBe(200);
  }

  // the worker installs and takes the page over
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
  // two calls to the API give two different answers: neither came from a cache
  const before = calls;
  const seen = await page.evaluate(async () => {
    const ask = async () => ((await (await fetch('/api/account')).json()) as { data: { n: number } }).data.n;
    return [await ask(), await ask()];
  });
  expect(seen[1]).toBe(seen[0]! + 1);
  expect(calls).toBe(before + 2);
  // and nothing but the shell is kept
  const kept = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls = await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)));
    return urls.flat();
  });
  expect(kept.every((path) => path === '/' || path.startsWith('/assets/'))).toBe(true);
  await page.evaluate(async () => Promise.all((await navigator.serviceWorker.getRegistrations()).map((registration) => registration.unregister())));
});

// --- 8, 9. the tutorial, and the server's count ------------------------------------------------------------

for (const [name, width, height] of [
  ['a wide screen', 1280, 720],
  ['a phone', 390, 800],
] as const) {
  test(`the tutorial coaches two rounds on ${name}, stays clear of the controls, and is never saved`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const phone = width < 720;
    const shown = await mockServices(page);
    await signIn(page, 'neel');
    let saves = 0;
    await page.route('**/api/games', (route) => {
      saves += 1;
      return route.fulfill({ status: 500, body: 'no' });
    });
    await page.goto('/');
    await page.getByRole('region', { name: 'How to play' }).getByRole('button', { name: 'Play the tutorial' }).click();
    await roundReady(page);
    // the Eiffel Tower, on the imagery this browser has
    expect(shown[0]).toBe('1d54c183-312a-42e4-bc9d-5c8d13354494');
    await expect(page.locator('.hud')).toContainText('1 / 2');
    await expect(page.getByRole('button', { name: /^Hint/ })).toBeHidden();

    const coach = page.getByRole('complementary', { name: 'Tutorial' });
    await expect(coach).toContainText('Look around');
    // the tip covers neither the HUD nor the way to the map
    const tip = (await coach.boundingBox())!;
    const clearOf = async (selector: string) => {
      const box = (await page.locator(selector).boundingBox())!;
      return tip.x + tip.width <= box.x || box.x + box.width <= tip.x || tip.y + tip.height <= box.y || box.y + box.height <= tip.y;
    };
    expect(await clearOf('.hud')).toBe(true);
    expect(await clearOf(phone ? '.map-toggle' : '.map-panel')).toBe(true);

    await page.keyboard.press('ArrowUp');
    await expect(coach).toContainText('Now the map.');
    if (phone) {
      await page.getByRole('button', { name: 'Open map' }).click();
    } else {
      await page.locator('.map-panel').hover();
    }
    await expect(coach).toContainText('Click the map where you think you are.');
    await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 220 } });
    await expect(coach).toContainText('Press Guess.');
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
    await expect(coach).toContainText('The dashed line is how far off you were');
    await expect(page.getByRole('region', { name: 'Round result' })).toContainText('France');
    await page.getByRole('button', { name: 'Next round' }).click();

    await roundReady(page);
    await expect(coach).toContainText('This one is yours to find.');
    await coach.getByRole('button', { name: 'Hide tips' }).click();
    await expect(coach).toBeHidden();
    if (phone) {
      await page.getByRole('button', { name: 'Open map' }).click();
    }
    await guessOnce(page);
    await expect(page.getByRole('region', { name: 'Round result' })).toContainText('Italy');
    await page.getByRole('button', { name: 'See summary' }).click();
    const summary = page.getByRole('region', { name: 'Game summary' });
    await expect(summary.locator('tbody tr')).toHaveCount(2);
    await expect(summary).toContainText('That was the tutorial. It is not saved and does not count for stats.');
    expect(saves).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
}

test('the tutorial can be replayed from the account pane', async ({ page }) => {
  await setUp(page);
  await page.goto('/#account');
  await page.getByRole('button', { name: 'Play the tutorial' }).click();
  await roundReady(page);
  await expect(page.getByRole('complementary', { name: 'Tutorial' })).toContainText('Look around');
});

test("a saved game names each round's place and sends no scale, and the server's total is shown when it differs", async ({ page }) => {
  await mockServices(page);
  await signIn(page, 'neel');
  const saved: Array<{ kind?: string; scaleKm?: number; rounds?: Array<{ id?: string }> }> = [];
  await page.route('**/api/games', async (route) => {
    saved.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      json: { success: true, data: { playedAt: '2026-10-11T09:00:00.000Z', map: 'world', mode: 'move', rounds: 3, score: 1234, maxScore: 15_000, xpEarned: 25, xpCapped: false } },
    });
  });
  await page.goto(CHALLENGE);
  await page.getByRole('button', { name: 'Play challenge' }).click();
  for (let round = 1; round <= 3; round++) {
    await roundReady(page);
    await guessOnce(page);
    await page.getByRole('button', { name: round === 3 ? 'See summary' : 'Next round' }).click();
  }
  await expect(page.getByRole('region', { name: 'Game summary' })).toContainText("Saved to neel's stats. +25 XP. The server counted it as 1,234 points.");
  // the game itself, among whatever the background country streak sent as a run of its own (a body with a `kind`)
  const games = saved.filter((body) => body.kind === undefined);
  expect(games).toHaveLength(1);
  // the scale is the server's to work out from the map: none is sent, and every round says which place it was
  expect(games[0]).not.toHaveProperty('scaleKm');
  expect(games[0]!.rounds).toHaveLength(3);
  expect(games[0]!.rounds!.every((round) => typeof round.id === 'string' && round.id.length > 0)).toBe(true);
});
