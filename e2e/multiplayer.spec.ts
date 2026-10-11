import { expect, test, type Page } from '@playwright/test';
import { EMOTES } from '../src/multiplayer/client.ts';
import { KIND_SETTINGS, PLACES, matchState, outcome, player, queueState, rankedState, settings, teamState, viewer } from '../src/multiplayer/testing.ts';
import { openPlaces } from './contract-helpers.ts';
import { mockServices } from './fixtures.ts';
import { placePin, play, roundReady } from './helpers.ts';
import { FIVE_PLACES, MatchServer, signIn } from './match-server.ts';
import { SocialServer, friend } from './social-server.ts';

const HOUR_MS = 3_600_000;
/** "neel" as a player who is not the host */
const MEMBER = viewer();

const result = (page: Page) => page.getByRole('region', { name: 'Round result' });
const final = (page: Page) => page.getByRole('region', { name: 'Final standing' });
const roster = (page: Page) => page.getByRole('complementary', { name: 'Guesses this round' });
const playerRow = (page: Page, region: 'result' | 'final', name: string) =>
  (region === 'result' ? result(page) : final(page)).getByRole('table', { name: 'Players' }).locator('tbody tr').filter({ hasText: name });

async function sendGuess(page: Page, at: { x: number; y: number }): Promise<void> {
  await placePin(page, at);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guess sent' })).toBeDisabled();
}

test('a party is created, started and played through three rounds to the final standing', async ({ page, browser, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // the server's clock runs an hour ahead: the round clock only reads right if the page corrects for it
  const server = await MatchServer.install(page, HOUR_MS);
  await signIn(page, 'neel');
  const shown = await mockServices(page);

  await page.goto('/#create');
  await page.getByRole('slider', { name: 'Rounds' }).fill('3');
  await page.getByRole('slider', { name: 'Time per round' }).fill('30');
  await page.getByRole('button', { name: 'Create party' }).click();
  expect(server.posted('create')).toEqual([{ action: 'create', settings: { map: 'world', mode: 'move', timeLimit: 30, rounds: 3, communication: 'chat', teams: 'none', guests: true } }]);

  // lobby: the code, the link, who is in, and Start only once there are two
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();
  await expect(page.locator('.lobby-code')).toHaveText('ABC123');
  await expect(page.getByLabel('Join link')).toHaveValue('http://localhost:5184/?party=ABC123');
  await expect(page).toHaveURL(/\?party=ABC123$/);
  await expect(page.locator('.player-row')).toHaveText(['neelyou, host']);
  await expect(page.getByText('World · 3 rounds · 30 sec · move')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start match' })).toBeDisabled();
  await page.getByRole('button', { name: 'Copy join link' }).click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://localhost:5184/?party=ABC123');

  server.addPlayer('sam');
  await expect(page.locator('.player-row')).toHaveCount(2);
  await expect(page.getByText('Players · 2 of 40')).toBeVisible();
  await page.getByRole('button', { name: 'Start match' }).click();
  expect(server.posted('start')).toEqual([{ action: 'start', matchId: 'm1' }]);

  // as the resolver this page picks the places from the match seed, resolves them and posts them
  await expect.poll(() => server.posted('places').length).toBe(1);
  const posted = server.posted('places')[0] as { matchId: string; places: Array<{ id: string; lng: number; lat: number; country: string }> };
  // no scale is sent: the server works it out from the map
  expect(Object.keys(posted).sort()).toEqual(['action', 'matchId', 'places']);
  expect(posted.matchId).toBe('m1');
  expect(posted.places).toHaveLength(3);
  // each place goes where its list has it, which the server checks, and not where its picture turned out to be (2.345, 48.86 here)
  const listed = new Map(openPlaces().map((place) => [place.id, place]));
  for (const place of posted.places) {
    expect(place).toEqual(listed.get(place.id));
    expect(place.lng).not.toBe(2.345);
  }

  // round 1: the clock is the server's, the guess goes to the server, and the wait shows who is in
  await roundReady(page);
  expect(shown[0]).toBe(posted.places[0]!.id);
  await expect(page.locator('.hud')).toContainText('1 / 3');
  await expect(page.locator('.hud')).toContainText(/0:(30|2\d)/);
  await expect(roster(page)).toBeHidden();
  await sendGuess(page, { x: 160, y: 150 });
  expect(server.posted('guess')).toEqual([{ action: 'guess', matchId: 'm1', round: 0, lng: expect.any(Number), lat: expect.any(Number) }]);
  await expect(roster(page).locator('.roster-row')).toHaveText(['neel (you)guessed', 'samguessing']);
  server.opponentGuesses();
  await expect(roster(page).locator('.roster-row')).toHaveText(['neel (you)guessed', 'samguessed']);

  server.reveal(4200, 3000);
  await expect(play(page)).toHaveAttribute('data-phase', 'result');
  await expect(result(page).locator('.figure')).toContainText('Round 1 of 3');
  // the reveal stands in the panel slot under the HUD, which stays
  await expect(page.locator('.hud')).toBeVisible();
  await expect(playerRow(page, 'result', 'neel').locator('td')).toHaveText(['neelyou', '321 km', '4,200', '4,200']);
  await expect(playerRow(page, 'result', 'sam').locator('td')).toHaveText(['sam', '900 km', '3,000', '3,000']);
  // a reveal lasts ten seconds
  await expect(result(page)).toContainText(/Next round in (10|9)(?!\d)/);
  await expect(page.locator('.pin-actual')).toHaveCount(1);
  await expect(page.locator('.pin-guess')).toHaveText(['NEE']);
  await expect(page.locator('.pin-other')).toHaveText(['SAM']);

  // round 2: no guess from this player
  server.startRound(1);
  await roundReady(page);
  await expect(page.locator('.hud')).toContainText('2 / 3');
  await expect(page.locator('.hud .hud-cell').nth(2)).toHaveText('Score4,200');
  expect(shown).toContain(posted.places[1]!.id);
  server.opponentGuesses();
  server.reveal(0, 2500);
  await expect(playerRow(page, 'result', 'neel').locator('td')).toHaveText(['neelyou', 'No guess', '0', '4,200']);
  await expect(playerRow(page, 'result', 'sam').locator('td')).toHaveText(['sam', '900 km', '2,500', '5,500']);
  await expect(result(page).locator('tbody tr').first()).toContainText('sam');
  await expect(page.locator('.pin-guess')).toHaveCount(0);
  await expect(page.locator('.pin-other')).toHaveCount(1);

  // round 3, then the final standing
  server.startRound(2);
  await roundReady(page);
  await expect(page.locator('.hud')).toContainText('3 / 3');
  await sendGuess(page, { x: 200, y: 150 });
  server.opponentGuesses();
  server.reveal(5000, 100);
  // and five after the last round
  await expect(result(page)).toContainText(/Final standing in [54](?!\d)/);
  expect(server.posted('guess').map((guess) => guess.round)).toEqual([0, 2]);

  server.finish(outcome(['neel']));
  await expect(play(page)).toHaveAttribute('data-phase', 'summary');
  await expect(final(page)).toContainText('You won.');
  // the last cell of a row is where its player is reported from: nobody reports themselves
  await expect(playerRow(page, 'final', 'neel').locator('td')).toHaveText(['1', 'neelyouwon', '9,200', '']);
  await expect(playerRow(page, 'final', 'sam').locator('td')).toHaveText(['2', 'sam', '5,600', '']);
  await expect(playerRow(page, 'final', 'sam').locator('td').last().getByRole('button', { name: 'Report sam' })).toBeVisible();
  await expect(final(page)).not.toContainText('Rating');
  await expect(page.locator('.pin-actual')).toHaveCount(3);

  await final(page).getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page).not.toHaveURL(/party/);
  expect(server.posted('leave')).toHaveLength(0);

  // the same seed and settings alone give the same first place
  const alone = await browser.newPage();
  const aloneShown = await mockServices(alone);
  await alone.goto('/?map=world&seed=e2e00001&t=0&mode=move&n=3');
  await alone.getByRole('button', { name: 'Play challenge' }).click();
  await roundReady(alone);
  expect(aloneShown[0]).toBe(posted.places[0]!.id);
  await alone.close();
});

test('a join link fills in the code, and a guest plays the places the resolver posted', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')] });
  await signIn(page, 'neel');
  const shown = await mockServices(page);
  // this client cannot show the second place
  await page.route(/api\.panoramax\.xyz\/api\/search.*place-two/, (route) => route.fulfill({ json: { features: [] } }));

  await page.goto('/?party=ABC123');
  await expect(page.locator('.pane-title')).toHaveText('Join party');
  await expect(page.getByLabel('Party code')).toHaveValue('ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();
  expect(server.posted('join')).toEqual([{ action: 'join', code: 'ABC123' }]);

  await expect(page.locator('.player-row')).toHaveText(['sam', 'neelyou']);
  await expect(page.getByRole('button', { name: 'Start match' })).toBeHidden();
  await expect(page.getByText('Waiting for the host to start the match.')).toBeVisible();

  server.state = { ...server.state, phase: 'preparing' };
  await expect(page.locator('.status')).toHaveText('Waiting for the places');
  server.state = { ...server.state, places: PLACES };
  server.startRound(0);

  await roundReady(page);
  expect(shown).toEqual(['place-one']);
  expect(server.posted('places')).toHaveLength(0);
  await sendGuess(page, { x: 150, y: 150 });
  server.opponentGuesses();
  server.reveal(1000, 2000);
  await expect(playerRow(page, 'result', 'neel').locator('td')).toHaveText(['neelyou', '321 km', '1,000', '1,000']);

  server.startRound(1);
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
  await expect(page.locator('.status')).toHaveText('This place cannot be shown on this device. You can still guess.');
  await sendGuess(page, { x: 180, y: 150 });
  expect(server.posted('guess').map((guess) => guess.round)).toEqual([0, 1]);
});

test('leaving the lobby tells the server and goes home', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')] });
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/?party=ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();

  await page.getByRole('button', { name: 'Leave party' }).click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  expect(server.posted('leave')).toEqual([{ action: 'leave', matchId: 'm1' }]);
  await expect(page).not.toHaveURL(/party/);
});

test('a code the server refuses is explained and can be corrected', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.refuse = 'No party has that code.';
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/#join');

  await page.getByRole('button', { name: 'Join party' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter the code the host gave you.');
  expect(server.posts).toHaveLength(0);

  await page.getByLabel('Party code').fill(' NOPE00 ');
  await page.getByRole('button', { name: 'Join party' }).click();
  await expect(page.getByRole('alert')).toHaveText('No party has that code.');
  expect(server.posted('join')).toEqual([{ action: 'join', code: 'NOPE00' }]);
  await expect(page.getByRole('button', { name: 'Join party' })).toBeEnabled();
});

test('the ranked queue finds a duel, which is played on health and moves the ratings', async ({ page }) => {
  const server = await MatchServer.install(page, -HOUR_MS);
  await signIn(page, 'neel', 1016);
  await mockServices(page);

  await page.goto('/#ranked');
  await expect(page.getByText('1 v 1 · World · moving · up to 5 rounds · 1 min a round · rated')).toBeVisible();
  await expect(page.getByText('Your rating: 1,016 · Voyager')).toBeVisible();
  await page.getByRole('button', { name: 'Find a match' }).click();
  expect(server.posted('queue')).toEqual([{ action: 'queue', kind: 'ranked' }]);
  await expect(page.getByText('Looking for players')).toBeVisible();
  await expect(page.getByText('1 player waiting')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();

  server.queue = { ...server.queue, waiting: 2 };
  await expect(page.getByText('2 players waiting')).toBeVisible();

  // a ranked duel: the world, moving, sixty seconds a round and five rounds at most
  server.state = rankedState({
    id: 'm7',
    phase: 'preparing',
    you: MEMBER,
    players: [player('sam', { rating: 1000, health: 5000 }), player('neel', { rating: 1016, health: 5000 })],
  });
  server.matchFound('m7');
  await expect(page.locator('.status')).toHaveText('Waiting for the places');

  server.state = { ...server.state, places: FIVE_PLACES };
  server.startRound(0);
  await roundReady(page);
  await expect(page.locator('.hud')).toContainText('1 / 5');
  await expect(page.locator('.hud')).toContainText(/1:00|0:5\d/);
  // moving is allowed, so there is a way back to where the round began
  await expect(page.getByRole('button', { name: 'Return to start' })).toBeVisible();
  expect(server.posted('leaveQueue')).toHaveLength(0);
  // both start on full health
  const health = page.getByRole('complementary', { name: 'Health' });
  await expect(health.locator('.health-row')).toHaveText([/sam\s*5,000/, /neel\s*5,000/]);
  await expect(health.getByRole('meter', { name: 'neel (you) health' })).toHaveAttribute('aria-valuenow', '5000');

  // neel scores nothing against 4,000 and loses the difference
  server.reveal(0, 4000);
  await expect(result(page)).toBeVisible();
  await expect(health.locator('.health-row')).toHaveText([/sam\s*5,000/, /neel\s*1,000\s*−4,000/]);
  // a reveal lasts eight seconds in a duel
  await expect(result(page)).toContainText(/Next round in [87](?!\d)/);

  // the next round empties it, which ends the duel before round five
  server.startRound(1);
  await roundReady(page);
  server.reveal(0, 3000);
  await expect(health.locator('.health-row').nth(1)).toContainText(/neel\s*0\s*−3,000/);
  await expect(result(page)).toContainText(/Final standing in [54](?!\d)/);
  server.finish(
    outcome(['sam'], {
      ratingChanges: [
        { username: 'sam', before: 1000, after: 1017 },
        { username: 'neel', before: 1016, after: 999 },
      ],
    }),
  );
  await expect(final(page)).toContainText('sam won.');
  // health is in the bars over the screen, not a column; the rating has its separator, and its change a cell of its own, signed
  await expect(final(page).locator('thead th')).toHaveText(['#', 'Player', 'Total', 'Rating', '']);
  await expect(playerRow(page, 'final', 'sam').locator('td')).toHaveText(['1', 'samwon', '7,000', '1,017', '+17', '']);
  await expect(playerRow(page, 'final', 'neel').locator('td')).toHaveText(['2', 'neelyou', '0', '999', '−17', '']);
  await expect(health.getByRole('meter', { name: 'sam health' })).toHaveAttribute('aria-valuenow', '5000');
  await expect(final(page).getByRole('link', { name: 'sam' })).toHaveAttribute('href', '?user=sam');
});

test('a search can be cancelled', async ({ page }) => {
  const server = await MatchServer.install(page);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/#unranked');
  await page.getByRole('button', { name: 'Find a match' }).click();
  await expect(page.getByText('Looking for players')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Find a match' })).toBeVisible();
  expect(server.posted('queue')).toEqual([{ action: 'queue', kind: 'unranked' }]);
  expect(server.posted('leaveQueue')).toHaveLength(1);
});

test('walking away from a search takes the player out of the queue', async ({ page }) => {
  const server = await MatchServer.install(page);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/#unranked');
  await page.getByRole('button', { name: 'Find a match' }).click();
  await expect(page.getByText('Looking for players')).toBeVisible();

  await page.getByRole('link', { name: 'Singleplayer' }).click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect.poll(() => server.posted('leaveQueue').length).toBe(1);
});

test('a 2v2 match shows the teams and scores each by its best member', async ({ page }) => {
  const server = await MatchServer.install(page);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/#team');
  await page.getByRole('button', { name: 'Find a match' }).click();
  expect(server.posted('queue')).toEqual([{ action: 'queue', kind: 'team' }]);

  server.state = teamState({
    id: 'm8',
    phase: 'playing',
    you: viewer({ team: 0 }),
    players: [player('neel', { team: 0 }), player('ana', { team: 0 }), player('sam', { team: 1 }), player('kit', { team: 1 })],
    places: FIVE_PLACES,
  });
  server.startRound(0);
  server.matchFound('m8');
  await roundReady(page);
  // 2v2 is one of the two places with free chat
  await page.getByRole('complementary', { name: 'Chat' }).getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Chat' }).getByRole('textbox', { name: 'Message' })).toBeVisible();
  await page.getByRole('complementary', { name: 'Chat' }).getByRole('button', { name: 'Close chat' }).click();
  await sendGuess(page, { x: 150, y: 150 });
  await expect(roster(page).locator('.roster-row')).toHaveCount(4);

  // neel scores 1,200 and everyone else 3,000: team 1 takes ana's 3,000, not neel's
  server.reveal(1200, 3000);
  const teams = result(page).getByRole('table', { name: 'Teams' }).locator('tbody tr');
  await expect(teams.nth(0).locator('td')).toHaveText(['Team 1yours', '3,000', '3,000']);
  await expect(teams.nth(1).locator('td')).toHaveText(['Team 2', '3,000', '3,000']);
  await expect(playerRow(page, 'result', 'neel').locator('td')).toHaveText(['neelyou', '1', '321 km', '1,200', '1,200']);
  await expect(page.locator('.pin-other')).toHaveText(['ANA', 'SAM', 'KIT']);

  server.finish(outcome(['neel', 'ana']));
  await expect(final(page)).toContainText('Your team won.');
  // the round was a tie, so neither team lost health; each team's figure says what it has left, and which won
  await expect(final(page).locator('.team-figures .figure')).toHaveText(['Team 1 (yours)won3,0005,000 health', 'Team 23,0005,000 health']);
});

test('a lost connection is reported during a round and clears when it is back', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')], phase: 'preparing', places: PLACES });
  server.startRound(0);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/#join');
  await page.getByLabel('Party code').fill('ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();
  await roundReady(page);
  await expect(page.locator('.net-banner')).toBeHidden();

  server.down = true;
  await expect(page.locator('.net-banner')).toHaveText('Connection lost. Could not reach the server. Check your connection and try again.', { timeout: 10_000 });
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');

  server.down = false;
  await expect(page.locator('.net-banner')).toBeHidden();
});

test('backing out of a party leaves it', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')] });
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Join party' }).click();
  await page.getByLabel('Party code').fill('ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect.poll(() => server.posted('leave')).toEqual([{ action: 'leave', matchId: 'm1' }]);
});

test('a slow reply does not pull the player into a party they walked away from', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')] });
  server.delayMs = 600;
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/#join');
  await page.getByLabel('Party code').fill('ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();
  await page.getByRole('link', { name: 'Singleplayer' }).click();

  await expect.poll(() => server.posted('join').length).toBe(1);
  await page.waitForTimeout(1000);
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toHaveCount(0);
});

test('when the time runs out a placed pin is sent, and without one the round is over', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')], phase: 'preparing', places: PLACES });
  server.startRound(0, 4000);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/?party=ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();

  // a pin is on the map but Guess is never pressed
  await roundReady(page);
  await placePin(page, { x: 150, y: 150 });
  await expect(page.getByRole('button', { name: 'Guess sent' })).toBeDisabled();
  expect(server.posted('guess')).toEqual([{ action: 'guess', matchId: 'm1', round: 0, lng: expect.any(Number), lat: expect.any(Number) }]);

  // no pin at all: nothing is sent and the button says why it is off
  server.reveal(100, 100);
  await expect(result(page)).toBeVisible();
  server.startRound(1, 1500);
  await expect(page.getByRole('button', { name: 'Time is up' })).toBeDisabled();
  await expect(page.locator('.hud .hud-cell').nth(3)).toHaveText('Time0:00');
  expect(server.posted('guess')).toHaveLength(1);
});

test('the lobby has chat and friends to invite, and names lead to profiles', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ players: [player('neel'), player('sam')] });
  const social = await SocialServer.install(page);
  social.friends = { friends: [friend('ana', { level: 2 }), friend('sam', { level: 13, league: 'Nomad', party: 'ABC123' })], incoming: [], outgoing: [], invites: [] };
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/#create');
  await page.getByRole('button', { name: 'Create party' }).click();
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();

  const profile = page.getByRole('link', { name: 'sam', exact: true });
  await expect(profile).toHaveAttribute('href', '?user=sam');
  await expect(profile).toHaveAttribute('target', '_blank');

  // only the friend who is not here yet can be invited
  await expect(page.getByRole('button', { name: /^Invite / })).toHaveCount(1);
  await page.getByRole('button', { name: 'Invite ana' }).click();
  await expect(page.getByRole('button', { name: 'Invite ana' })).toHaveText('Invited');
  expect(social.posted('invite')).toEqual([{ action: 'invite', username: 'ana', code: 'ABC123' }]);

  const chat = page.getByRole('region', { name: 'Chat' });
  await expect(chat).toContainText('Nothing said yet.');
  await chat.getByRole('textbox', { name: 'Message' }).fill('ready when you are');
  await chat.getByRole('button', { name: 'Send' }).click();
  expect(server.posted('chat')).toEqual([{ action: 'chat', matchId: 'm1', text: 'ready when you are', scope: 'all' }]);
  await expect(chat.locator('.chat-line')).toHaveText(['youready when you are']);
  server.say('sam', 'go');
  await expect(chat.locator('.chat-line')).toHaveText(['youready when you are', 'samgo']);
});

test('chat and the twenty reactions work during a party, and unread lines show while it is closed', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')], phase: 'preparing', places: PLACES });
  server.startRound(0);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/?party=ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();
  await roundReady(page);

  const chat = page.getByRole('complementary', { name: 'Chat' });
  // closed: a reaction from the other player floats over the round for a moment (wave 6) and is counted on the button
  server.say('sam', null, 'wow');
  await expect(page.locator('.reaction-float')).toHaveText(/sam\s*wow$/);
  await expect(chat.getByRole('button', { name: 'Chat · 1 new' })).toBeVisible();

  await chat.getByRole('button', { name: /Chat/ }).click();
  await expect(chat.getByRole('group', { name: 'Reactions' }).getByRole('button')).toHaveText([...EMOTES]);
  await expect(chat.getByRole('group', { name: 'Reactions' }).getByRole('button')).toHaveCount(20);
  await expect(chat.locator('.chat-line')).toHaveText(['samwow']);
  await chat.getByRole('button', { name: 'nice', exact: true }).click();
  expect(server.posted('emote')).toEqual([{ action: 'emote', matchId: 'm1', emote: 'nice' }]);
  await chat.getByRole('textbox', { name: 'Message' }).fill('good one');
  await chat.getByRole('textbox', { name: 'Message' }).press('Enter');
  expect(server.posted('chat')).toEqual([{ action: 'chat', matchId: 'm1', text: 'good one', scope: 'all' }]);
  await expect(chat.locator('.chat-line')).toHaveText(['samwow', 'younice', 'yougood one']);
  // typing a message does not count as a guess or move the view
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
  expect(server.posted('guess')).toHaveLength(0);

  server.refuse = 'One message a second.';
  await chat.getByRole('textbox', { name: 'Message' }).fill('again');
  await chat.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(chat.getByRole('alert')).toHaveText('One message a second.');

  await chat.getByRole('button', { name: 'Close chat' }).click();
  await expect(chat.getByRole('textbox', { name: 'Message' })).toBeHidden();
  await expect(chat.getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
});

test('Exit leaves a match after asking, and tells the server', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')], phase: 'preparing', places: PLACES });
  server.startRound(0);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/?party=ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();
  await roundReady(page);

  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.getByRole('dialog')).toContainText('Leave this match? You will not be able to come back to it.');
  await page.getByRole('button', { name: 'Stay' }).click();
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
  expect(server.posted('leave')).toHaveLength(0);

  // the reveal has its own way out, since the HUD is behind its panel
  server.reveal(0, 100);
  await result(page).getByRole('button', { name: 'Leave match' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave match' }).click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect.poll(() => server.posted('leave')).toEqual([{ action: 'leave', matchId: 'm1' }]);
});

const EIGHT = ['neel', 'ana', 'sam', 'kit', 'lee', 'mia', 'raj', 'zoe'];

/** A public unranked game with eight players, in its first round, seen by "neel". */
const publicGame = () =>
  matchState({
    id: 'm9',
    code: null,
    kind: 'unranked',
    phase: 'playing',
    settings: KIND_SETTINGS.unranked,
    you: MEMBER,
    players: EIGHT.map((name) => player(name)),
    places: FIVE_PLACES,
  });

test('the public queue counts down on the server clock, then starts a game for everyone gathered', async ({ page }) => {
  // an hour ahead: the countdown only reads right if it is measured against the server's time
  const server = await MatchServer.install(page, HOUR_MS);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/#unranked');
  await expect(page.getByText('2 to 10 players · World · moving · 5 rounds · 45 sec a round · not rated')).toBeVisible();
  await page.getByRole('button', { name: 'Find a match' }).click();
  await expect(page.getByText('Looking for players')).toBeVisible();
  await expect(page.getByText('1 player waiting')).toBeVisible();

  // a second and third player arrive: the ten seconds start
  server.queue = queueState({ queued: true, kind: 'unranked', waiting: 3, startsAt: server.time(9000), since: server.time(-2000) });
  await expect(page.locator('.queue-status')).toHaveText(/^Starting in [6-9]$/);
  await expect(page.getByText('3 players waiting')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  const before = server.posts.length;

  // the countdown is cancelled when the others leave
  server.queue = queueState({ queued: true, kind: 'unranked', waiting: 1, since: server.time(-4000) });
  await expect(page.locator('.queue-status')).toHaveText('Looking for players');

  server.queue = queueState({ queued: true, kind: 'unranked', waiting: 10, startsAt: server.time(1500), since: server.time(-6000) });
  await expect(page.locator('.queue-status')).toHaveText(/^Starting in [0-2]$/);
  server.state = publicGame();
  server.startRound(0);
  server.matchFound('m9');
  await roundReady(page);
  // waiting through a countdown is polling only: nothing was posted
  expect(server.posts.length).toBe(before);
  await expect(page.locator('.hud')).toContainText('1 / 5');
  // a public round is 45 seconds
  await expect(page.locator('.hud')).toContainText(/0:4[0-5]/);
});

for (const [name, width, height] of [
  ['a wide screen', 1280, 720],
  ['a phone', 390, 800],
] as const) {
  test(`eight players fit the wait, the reveal and the final standing on ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const server = await MatchServer.install(page);
    server.state = publicGame();
    server.startRound(0);
    server.matchFound('m9');
    await signIn(page, 'neel');
    await mockServices(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Rejoin match' }).click();
    await roundReady(page);
    if (width < 720) {
      await page.getByRole('button', { name: 'Open map' }).click();
    }
    await sendGuess(page, { x: 150, y: 200 });
    if (width < 720) {
      await page.getByRole('button', { name: 'Close map' }).click();
    }
    await expect(roster(page).locator('.roster-row')).toHaveCount(8);
    const list = (await roster(page).boundingBox())!;
    expect(list.y + list.height).toBeLessThan(height - 80);

    server.reveal(1200, 3000);
    await expect(result(page).getByRole('table', { name: 'Players' }).locator('tbody tr')).toHaveCount(8);
    await expect(page.locator('.pin-other')).toHaveText(['ANA', 'SAM', 'KIT', 'LEE', 'MIA', 'RAJ', 'ZOE']);
    await expect(page.locator('.pin-guess')).toHaveText(['NEE']);
    await expect(result(page).getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('target', '_blank');
    const reveal = (await result(page).boundingBox())!;
    expect(reveal.y).toBeGreaterThanOrEqual(0);
    expect(reveal.y + reveal.height).toBeLessThanOrEqual(height);
    // the way out is inside the panel, and reachable even when the table has to scroll
    await result(page).getByRole('button', { name: 'Leave match' }).click({ timeout: 3000 });
    await page.getByRole('dialog').getByRole('button', { name: 'Stay' }).click();

    server.finish(outcome(['ana']));
    await expect(final(page).getByRole('table', { name: 'Players' }).locator('tbody tr')).toHaveCount(8);
    const standing = (await final(page).boundingBox())!;
    expect(standing.y + standing.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await final(page).getByRole('button', { name: 'Home' }).click({ timeout: 3000 });
    await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  });
}

// --- the rules of wave 5 ------------------------------------------------------------------------

/** Puts the page in a match that is already under way, by way of the home screen's Rejoin. */
async function rejoin(page: Page, server: MatchServer): Promise<void> {
  server.matchFound(server.state.id);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Rejoin match' }).click();
}

const clock = (page: Page) => page.locator('.hud .hud-cell').nth(3);

test('the round clock follows the server when it cuts the round short', async ({ page }) => {
  const server = await MatchServer.install(page, HOUR_MS);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')], phase: 'preparing', places: PLACES, settings: settings({ timeLimit: 120 }) });
  server.startRound(0);
  await rejoin(page, server);
  await roundReady(page);
  await expect(clock(page)).toHaveText(/Time(2:00|1:5\d)/);

  // sam guesses, which leaves one player still to guess: the server ends the round 20 seconds from then
  server.opponentGuesses();
  await expect(clock(page)).toHaveText(/Time0:(20|1\d)/);
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');

  // and it can move the end earlier again: the page shows what the server last said, not a time of its own
  server.endRoundIn(5000);
  await expect(clock(page)).toHaveText(/Time0:0[0-5]/);
  await expect(page.getByRole('button', { name: 'Time is up' })).toBeDisabled({ timeout: 10_000 });
});

test('in a ranked duel the clock drops to 15 seconds once the opponent has guessed', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = rankedState({ id: 'm7', phase: 'preparing', you: MEMBER, places: FIVE_PLACES });
  server.startRound(0);
  await rejoin(page, server);
  await roundReady(page);
  await expect(clock(page)).toHaveText(/Time(1:00|0:5\d)/);
  server.opponentGuesses();
  await expect(clock(page)).toHaveText(/Time0:1[0-5]/);
});

test('a round starts after the five seconds the server gives to get ready', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.leadMs = 5000;
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')], phase: 'preparing', places: PLACES });
  server.startRound(0);
  await rejoin(page, server);
  await expect(page.locator('.status')).toHaveText(/^Round starts in [2-5]$/);
  await expect(page.getByRole('button', { name: 'Wait for the start' })).toBeDisabled();
  await roundReady(page);
  await expect(clock(page)).toHaveText(/Time0:(30|2\d)/);
});

test('a party round with no timer has no clock and does not run out', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')], phase: 'preparing', places: PLACES, settings: settings({ timeLimit: 0 }) });
  server.startRound(0);
  expect(server.state.roundEndsAt).toBeNull();
  await rejoin(page, server);
  await roundReady(page);
  await expect(clock(page)).not.toContainText(/\d:\d\d/);
  await page.waitForTimeout(2000);
  await expect(page.getByRole('button', { name: 'Time is up' })).toHaveCount(0);
  await sendGuess(page, { x: 150, y: 150 });
  expect(server.posted('guess')).toHaveLength(1);
});

for (const [name, state] of [
  ['a ranked duel', () => rankedState({ id: 'm7', phase: 'preparing', you: MEMBER, places: FIVE_PLACES })],
  ['a public game', publicGame],
] as const) {
  test(`${name} has the twenty reactions and no free chat`, async ({ page }) => {
    const server = await MatchServer.install(page);
    server.state = state();
    server.startRound(0);
    await rejoin(page, server);
    await roundReady(page);

    const chat = page.getByRole('complementary', { name: 'Chat' });
    await chat.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(chat.getByRole('group', { name: 'Reactions' }).getByRole('button')).toHaveCount(20);
    await expect(chat.getByRole('textbox', { name: 'Message' })).toBeHidden();
    await expect(chat.getByRole('button', { name: 'Send' })).toBeHidden();

    await chat.getByRole('button', { name: 'gl', exact: true }).click();
    expect(server.posted('emote')).toEqual([{ action: 'emote', matchId: server.state.id, emote: 'gl' }]);
    await expect(chat.locator('.chat-line')).toHaveText(['yougl']);
    expect(server.posted('chat')).toHaveLength(0);
  });
}

test('a party lobby offers what its host allows: chat, the reactions alone, or nothing', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')], settings: settings({ communication: 'reactions' }) });
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/?party=ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();

  const chat = page.getByRole('region', { name: 'Chat' });
  await expect(chat.getByRole('group', { name: 'Reactions' }).getByRole('button')).toHaveCount(20);
  await expect(chat.getByRole('textbox', { name: 'Message' })).toBeHidden();

  // the host turns chat on, then everything off: the lobby follows on its next poll
  server.state = { ...server.state, settings: settings({ communication: 'chat' }) };
  await expect(chat.getByRole('textbox', { name: 'Message' })).toBeVisible();
  server.state = { ...server.state, settings: settings({ communication: 'off' }) };
  await expect(chat).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Chat' })).toBeHidden();
});
