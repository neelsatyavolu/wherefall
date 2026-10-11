import { expect, test, type Page } from '@playwright/test';
import { EMOTES, type MatchState } from '../src/multiplayer/client.ts';
import { KIND_SETTINGS, PLACES, guessRow, guest, matchState, outcome, player, rankedState, viewer } from '../src/multiplayer/testing.ts';
import { AccountServer } from './account-server.ts';
import { mockServices } from './fixtures.ts';
import { placePin, play, roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { backToLobby } from './match-rules.ts';
import { FIVE_PLACES, MatchServer, signIn } from './match-server.ts';

// Wave 5, around an online game: what is left of guests, the queues, chat, the versus intro and the result screens.

const HOUR_MS = 3_600_000;
const GUEST = 'Guest #4821';
/** "neel" as a player who is not the host */
const MEMBER = viewer();
const AS_GUEST = viewer({ username: GUEST, guest: true });

const title = (page: Page) => page.locator('.pane-title');
const result = (page: Page) => page.getByRole('region', { name: 'Round result' });
const final = (page: Page) => page.getByRole('region', { name: 'Final standing' });
const foldedChat = (page: Page) => page.getByRole('complementary', { name: 'Chat' });
const row = (panel: ReturnType<typeof result>, name: string) => panel.getByRole('table', { name: 'Players' }).locator('tbody tr').filter({ hasText: name });

async function sendGuess(page: Page, at: { x: number; y: number }): Promise<void> {
  await placePin(page, at);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guess sent' })).toBeDisabled();
}

/** A public unranked game in its first round, seen by `you`, who is the last of its players. */
const publicGame = (you: MatchState['you'], others: MatchState['players'], change: Partial<MatchState> = {}) =>
  matchState({
    id: 'm9',
    code: null,
    kind: 'unranked',
    phase: 'playing',
    settings: KIND_SETTINGS.unranked,
    you,
    players: [...others, you.guest ? guest(4821) : player(you.username)],
    places: FIVE_PLACES,
    ...change,
  });

/** A party under way, seen by "neel", who is not its host. */
const partyGame = (change: Partial<MatchState> = {}) => matchState({ you: MEMBER, players: [player('sam'), player('neel')], phase: 'preparing', places: PLACES, ...change });

/** Puts the signed-in "neel" in a match that is already under way, by way of the home screen's Rejoin. */
async function rejoin(page: Page, server: MatchServer, change: Parameters<typeof signIn>[3] = {}): Promise<void> {
  server.matchFound(server.state.id);
  await signIn(page, 'neel', 1016, change);
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Rejoin match' }).click();
}

/** A browser that still holds a guest's session from before playing took an account, and the two servers that know it. */
async function asGuest(page: Page) {
  const accounts = await AccountServer.install(page, null);
  const server = await MatchServer.install(page);
  server.session = 'guest';
  accounts.becomeGuest(GUEST);
  server.state = { ...server.state, you: AS_GUEST };
  await mockServices(page);
  return { accounts, server };
}

// --- item 13: guests, now that playing takes an account ---------------------------------------------

test('a guest left from before is shown what signing up adds on every pane that plays, and no control the server would refuse', async ({ page }) => {
  const { server } = await asGuest(page);
  for (const address of ['/#unranked', '/#join', '/#ranked', '/#team', '/#create', '/#friends', '/?edit=new']) {
    await page.goto(address);
    const notice = page.locator('.notice');
    await expect(notice, address).toContainText(`This needs an account. You are here as ${GUEST}, a guest, and a guest can no longer play.`);
    await expect(notice.getByRole('link', { name: 'Sign up' }), address).toHaveAttribute('href', '#account');
    await expect(page.getByRole('button', { name: /Find a match|Create party|Join party|Send request|Publish map|Play as a guest/ }), address).toHaveCount(0);
    await expect(page.locator('.sidebar').getByRole('group', { name: 'Guest session' }), address).toContainText(GUEST);
  }
  // nothing was asked of the server that it would have refused
  expect(server.posts).toEqual([]);

  await page.locator('.sidebar').getByRole('link', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/#account$/);
});

test('a session that runs out during a match ends it with a plain notice and two ways on', async ({ page }) => {
  const { accounts, server } = await asGuest(page);
  server.state = publicGame(AS_GUEST, [player('ana')]);
  server.startRound(0);
  server.matchFound('m9');
  await page.goto('/');
  await page.getByRole('button', { name: 'Rejoin match' }).click();
  await roundReady(page);

  server.session = 'none';
  accounts.signOut();
  const notice = page.getByRole('alert');
  await expect(notice).toContainText('Your guest session has ended, so you are out of this match. A guest session lasts 24 hours.');
  await expect(notice.getByRole('button')).toHaveText(['Home', 'Sign in or create an account']);
  await notice.getByRole('button', { name: 'Sign in or create an account' }).click();
  await expect(page).toHaveURL(/#account$/);
  await expect(title(page)).toHaveText('Account');
  expect(server.posted('leave')).toHaveLength(0);
});

// --- item 14: play again, and back to the lobby ----------------------------------------------------

test('Play again joins the same queue once, and a reload does not join it again', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = rankedState({ id: 'm7', phase: 'preparing', you: MEMBER, places: FIVE_PLACES });
  server.startRound(0);
  await rejoin(page, server);
  await roundReady(page);
  server.reveal(0, 5000);
  server.finish(outcome(['sam'], { ratingChanges: [{ username: 'sam', before: 1004, after: 1020 }, { username: 'neel', before: 1016, after: 1000 }] }));
  await expect(final(page)).toContainText('sam won.');
  await expect(final(page).getByRole('button', { name: 'Back to lobby' })).toHaveCount(0);

  await final(page).getByRole('button', { name: 'Play again' }).click();
  await expect(page).toHaveURL(/#ranked$/);
  await expect(title(page)).toHaveText('Ranked duel');
  await expect(page.getByText('Looking for players')).toBeVisible();
  expect(server.posted('queue')).toEqual([{ action: 'queue', kind: 'ranked' }]);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Find a match' })).toBeVisible();
  expect(server.posted('queue')).toHaveLength(1);
});

/** A party's finished match: three rounds played, "neel" ahead. */
const finishedParty = (you: MatchState['you']) =>
  matchState({
    you,
    players: [player('neel', { total: 9000 }), player('sam', { total: 4000 })],
    phase: 'finished',
    places: PLACES,
    results: [0, 1, 2].map((round) => ({ round, guesses: [guessRow('neel', 3000), guessRow('sam', round === 0 ? 4000 : 0)] })),
    outcome: outcome(['neel']),
  });

test("a party's host takes everyone back to the lobby, which keeps its code and can start again", async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = finishedParty(viewer({ isHost: true, isResolver: true }));
  await rejoin(page, server);
  await expect(final(page)).toContainText('You won.');
  // a party came from no queue, and its rounds earn no XP
  await expect(final(page).getByRole('button', { name: 'Play again' })).toHaveCount(0);
  await expect(final(page).locator('.match-xp')).toHaveCount(0);
  await expect(final(page)).toContainText('Back to lobby takes everyone who is still here with you.');
  // the finished match is still asked for: each poll is what keeps a player in it
  const polls = server.polls;
  await expect.poll(() => server.polls).toBeGreaterThan(polls + 1);

  await final(page).getByRole('button', { name: 'Back to lobby' }).click();
  expect(server.posted('lobby')).toEqual([{ action: 'lobby', matchId: 'm1' }]);
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();
  await expect(page.locator('.lobby-code')).toHaveText('ABC123');
  await expect(page).toHaveURL(/\?party=ABC123$/);
  // the host's row has no controls; every other row has the host's two
  await expect(page.locator('.player-row')).toHaveText(['neelyou, host', 'samMake hostKick']);

  // and the same party plays again
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect.poll(() => server.posted('places').length).toBe(1);
  await roundReady(page);
  await expect(page.locator('.hud')).toContainText('1 / 3');
  expect(server.posted('leave')).toHaveLength(0);
});

test('a player who stays on the standing follows the host back into the lobby', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = finishedParty(MEMBER);
  await rejoin(page, server);
  await expect(final(page)).toContainText('Stay on this screen to remain in the party. The host can take everyone back to the lobby.');
  await expect(final(page).getByRole('button', { name: 'Back to lobby' })).toHaveCount(0);
  await expect(final(page).getByRole('button', { name: 'Home' })).toBeVisible();

  server.state = backToLobby(server.state);
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();
  await expect(page.locator('.lobby-code')).toHaveText('ABC123');
  await expect(page.getByText('Waiting for the host to start the match.')).toBeVisible();
  await expect(page.locator('.player-row')).toHaveText(['neelyou', 'sam']);
});

test('a player the host removes is told so plainly, in the lobby and in a round', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')] });
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/?party=ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();
  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();

  server.kickYou();
  const notice = page.getByRole('alert');
  await expect(notice).toContainText('You were removed from that party.');
  // it says what happened: being removed is no error of the game's
  await expect(notice.locator('.status-box-label')).toHaveText('Removed');
  await expect(notice).not.toContainText('Error');
  await expect(notice).not.toContainText('Connection lost');
  await expect(notice.getByRole('button')).toHaveText(['Home']);
  await notice.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  // the server has already put them out: there is nothing to leave
  expect(server.posted('leave')).toHaveLength(0);

  const playing = await MatchServer.install(page);
  playing.state = partyGame();
  playing.startRound(0);
  playing.matchFound('m1');
  await page.goto('/');
  await page.getByRole('button', { name: 'Rejoin match' }).click();
  await roundReady(page);
  playing.kickYou();
  await expect(page.getByRole('alert')).toContainText('You were removed from that party.');
  await expect(play(page)).toHaveCount(0);
});

// --- items 7 and 27: the ranked queue ----------------------------------------------------------------

test('when the other player leaves a ranked duel before it begins, the one who stayed is back on the queue screen', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.leadMs = 5000;
  server.state = rankedState({ id: 'm7', phase: 'preparing', you: MEMBER, places: FIVE_PLACES });
  server.startRound(0);
  await rejoin(page, server);
  // a duel's versus screen stands over the round screen's own status line, so the get-ready is counted on it
  await expect(page.locator('.versus-count')).toHaveText(/^Round starts in \d$/);

  server.dodge('sam');
  await expect(page).toHaveURL(/#ranked$/);
  await expect(title(page)).toHaveText('Ranked duel');
  await expect(page.getByText('The other player left before the match began. Your rating has not changed, and you are back in the queue.')).toBeVisible();
  await expect(page.getByText('Looking for players')).toBeVisible();
  await expect(page.getByText('1 player waiting')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  // the server had already queued them: the page only polls
  expect(server.posted('queue')).toHaveLength(0);
  expect(server.posted('leave')).toHaveLength(0);

  // and the next opponent is found from there
  server.leadMs = 400;
  server.state = rankedState({ id: 'm8', phase: 'preparing', you: MEMBER, places: FIVE_PLACES });
  server.startRound(0);
  server.matchFound('m8');
  await roundReady(page);
  expect(server.posted('leaveQueue')).toHaveLength(0);
});

test('a ranked lock is shown counting down on the server clock, instead of a way into the queue', async ({ page }) => {
  // an hour ahead: the countdown only reads right if it is measured against the server's time
  const server = await MatchServer.install(page, HOUR_MS);
  server.lockRanked(120_000);
  await signIn(page, 'neel', 1016);
  await mockServices(page);
  await page.goto('/#ranked');
  await expect(page.getByText('Ranked rounds pay double XP.')).toBeVisible();
  await expect(page.locator('.queue-lock')).toHaveText(/^You left two ranked matches before they began\. You can queue again in (2:00|1:5\d)\.$/);
  await expect(page.getByRole('button', { name: 'Find a match' })).toHaveCount(0);
  expect(server.posts).toEqual([]);
});

test('a lock the server answers a search with counts down, then gives the button back', async ({ page }) => {
  const server = await MatchServer.install(page);
  await signIn(page, 'neel', 1016);
  await mockServices(page);
  await page.goto('/#ranked');
  await expect(page.getByRole('button', { name: 'Find a match' })).toBeVisible();

  server.lockRanked(5000);
  await page.getByRole('button', { name: 'Find a match' }).click();
  await expect(page.locator('.queue-lock')).toHaveText(/You can queue again in 0:0[1-5]\.$/);
  await expect(page.getByRole('button', { name: 'Find a match' })).toHaveCount(0);
  await expect(page.getByText('Looking for players')).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Find a match' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.queue-lock')).toHaveCount(0);
  await page.getByRole('button', { name: 'Find a match' }).click();
  await expect(page.getByText('Looking for players')).toBeVisible();
});

test('the wait shows the time waited on the server clock and, for ranked, how wide the search is', async ({ page }) => {
  const server = await MatchServer.install(page, -HOUR_MS);
  await signIn(page, 'neel', 1016);
  await mockServices(page);
  await page.goto('/#ranked');
  await page.getByRole('button', { name: 'Find a match' }).click();
  await expect(page.locator('.queue-waited')).toHaveText(/^Waiting for 0:0[0-3]$/);
  await expect(page.locator('.queue-window')).toHaveText(/^Opponents within ±(50|60|70|80) of your rating$/);

  // twenty seconds in, the window has widened by ten a second
  server.queue = { ...server.queue, since: server.time(-20_000) };
  await expect(page.locator('.queue-waited')).toHaveText(/^Waiting for 0:(2\d|3\d)$/);
  await expect(page.locator('.queue-window')).toHaveText(/^Opponents within ±(2[5-9]0|3\d0|400) of your rating$/);

  // seventy-five seconds in it would be ±800: it stops widening at ±400
  server.queue = { ...server.queue, since: server.time(-75_000) };
  await expect(page.locator('.queue-waited')).toHaveText(/^Waiting for 1:(1[5-9]|2\d)$/);
  await expect(page.locator('.queue-window')).toHaveText('Opponents within ±400 of your rating');

  // a public game has no rating to search by
  await page.goto('/#unranked');
  await page.getByRole('button', { name: 'Find a match' }).click();
  await expect(page.locator('.queue-waited')).toHaveText(/^Waiting for 0:0[0-3]$/);
  await expect(page.locator('.queue-window')).toBeHidden();
});

// --- items 12 and 25: chat ---------------------------------------------------------------------------

test('a player can be muted for the rest of the match and let back in', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = partyGame({ players: [player('sam'), player('ana'), player('neel')] });
  server.startRound(0);
  server.say('sam', 'hello');
  server.say('ana', 'hi all');
  await rejoin(page, server);
  await roundReady(page);

  const chat = foldedChat(page);
  await chat.getByRole('button', { name: /Chat/ }).click();
  await expect(chat.locator('.chat-line')).toHaveText(['samhello', 'anahi all']);
  await chat.getByText('Mute players').click();
  await expect(chat.locator('.mute-row')).toHaveText(['samMute', 'anaMute']);

  await chat.getByRole('button', { name: 'Mute sam' }).click();
  expect(server.posted('mute')).toEqual([{ action: 'mute', matchId: 'm1', username: 'sam', muted: true }]);
  await expect(chat.locator('.chat-line')).toHaveText(['anahi all']);
  await expect(chat.locator('.mute-row')).toHaveText(['sammutedUnmute', 'anaMute']);
  // what a muted player says from then on does not arrive either
  server.say('sam', 'still here');
  server.say('ana', 'ok');
  await expect(chat.locator('.chat-line')).toHaveText(['anahi all', 'anaok']);

  await chat.getByRole('button', { name: 'Unmute sam' }).click();
  expect(server.posted('mute')[1]).toEqual({ action: 'mute', matchId: 'm1', username: 'sam', muted: false });
  await expect(chat.locator('.mute-row')).toHaveText(['samMute', 'anaMute']);
  server.say('sam', 'back');
  await expect(chat.locator('.chat-line').last()).toHaveText('samback');
});

test('an account that hides chat is shown none, in the lobby or in a match', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')] });
  server.say('sam', 'anyone there');
  await signIn(page, 'neel', 1000, { hideChat: true });
  await mockServices(page);
  await page.goto('/?party=ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();
  await expect(page.getByText('Waiting for the host to start the match.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chat' })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Chat' })).toBeHidden();

  server.state = { ...server.state, phase: 'preparing', places: PLACES };
  server.startRound(0);
  await roundReady(page);
  server.say('sam', null, 'wow');
  await page.waitForTimeout(1800);
  await expect(page.locator('.chat')).toBeHidden();
  await expect(page.getByText('sam: wow')).toHaveCount(0);
});

for (const [name, state] of [
  ['a ranked duel', () => rankedState({ id: 'm7', phase: 'preparing', you: MEMBER, places: FIVE_PLACES })],
  ['a public game', () => publicGame(MEMBER, [player('ana'), player('sam')])],
] as const) {
  test(`${name} has the twenty reactions in four rows of five on a phone, and no message box`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const server = await MatchServer.install(page);
    server.state = state();
    server.startRound(0);
    await rejoin(page, server);
    await roundReady(page);

    const chat = foldedChat(page);
    await chat.getByRole('button', { name: 'Chat', exact: true }).click();
    const reactions = chat.getByRole('group', { name: 'Reactions' }).getByRole('button');
    await expect(reactions).toHaveText([...EMOTES]);
    await expect(chat.getByRole('textbox', { name: 'Message' })).toBeHidden();
    await expect(chat.getByRole('button', { name: 'Send' })).toBeHidden();

    const boxes = await reactions.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect()).map(({ left, right, top }) => ({ left, right, top })));
    expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBe(4);
    expect(new Set(boxes.slice(0, 5).map((box) => Math.round(box.top))).size).toBe(1);
    expect(Math.min(...boxes.map((box) => box.left))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...boxes.map((box) => box.right))).toBeLessThanOrEqual(390);

    await chat.getByRole('button', { name: 'gg', exact: true }).click();
    expect(server.posted('emote')).toEqual([{ action: 'emote', matchId: server.state.id, emote: 'gg' }]);
    expect(server.posted('chat')).toHaveLength(0);
  });
}

// --- item 19: the versus intro -------------------------------------------------------------------------

const duel = () =>
  rankedState({
    id: 'm7',
    phase: 'preparing',
    you: MEMBER,
    places: FIVE_PLACES,
    players: [player('neel', { rating: 1016, health: 5000, country: 'IN' }), player('sam', { rating: 780, health: 5000, country: 'FR' })],
  });

test('a ranked duel opens on both players, and the screen goes when the server starts the round', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.leadMs = 5000;
  server.state = duel();
  server.startRound(0);
  await rejoin(page, server);

  const versus = page.getByRole('complementary', { name: 'Ranked duel: neel versus sam' });
  await expect(versus).toBeVisible();
  await expect(versus.locator('.versus-card')).toHaveText([/neel\s*1,016\s*Voyager/, /sam\s*780\s*Trekker/]);
  await expect(versus.locator('.versus-word')).toHaveText('versus');
  await expect(versus.getByRole('img', { name: 'India' })).toBeVisible();
  await expect(versus.getByRole('img', { name: 'France' })).toBeVisible();
  // names here are not links: there is nothing to press on this screen
  await expect(versus.getByRole('link')).toHaveCount(0);
  expect(await versus.locator('.versus-card').first().evaluate((card) => getComputedStyle(card).animationName)).toBe('versus-in');
  // a duel's versus screen stands over the round screen's own status line, so the get-ready is counted on it
  await expect(page.locator('.versus-count')).toHaveText(/^Round starts in \d$/);

  // it ends with the get-ready, and nothing is in the way of the round
  await roundReady(page);
  await expect(versus).toBeHidden();
  await sendGuess(page, { x: 150, y: 150 });
  expect(server.posted('guess')).toHaveLength(1);

  // only the first round has one
  server.reveal(3000, 1000);
  await expect(result(page)).toBeVisible();
  server.startRound(1);
  await expect(page.locator('.status')).toHaveText(/^Round starts in \d$/);
  await expect(versus).toBeHidden();
});

test('the versus screen holds still for a player who asked for less motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const server = await MatchServer.install(page);
  server.leadMs = 5000;
  server.state = duel();
  server.startRound(0);
  await rejoin(page, server);
  const cards = page.locator('.versus-card');
  await expect(cards).toHaveCount(2);
  expect(await cards.evaluateAll((all) => all.map((card) => getComputedStyle(card).animationName))).toEqual(['none', 'none']);
  expect(await page.locator('.versus-word').evaluate((word) => getComputedStyle(word).animationName)).toBe('none');
});

// --- item 18: flags, Perfect, confetti and XP in a match -------------------------------------------------

test("a public game's reveal has flags, the Perfect mark, confetti and the round's XP, and the standing adds them up", async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = publicGame(MEMBER, [player('ana', { country: 'BR' }), guest(7302)]);
  server.startRound(0);
  await rejoin(page, server, { country: 'IN' });
  await roundReady(page);
  await sendGuess(page, { x: 150, y: 150 });
  // while waiting, the list of who has guessed carries the flags too
  await expect(page.getByRole('complementary', { name: 'Guesses this round' }).getByRole('img', { name: 'Brazil' })).toBeVisible();

  server.revealScores({ neel: 5000, ana: 3000, 'Guest #7302': 1200 });
  // the burst is over in a second and a half
  await expect(page.locator('.confetti')).toHaveCount(1);
  await expect(result(page).locator('.figure').getByRole('img', { name: 'France' })).toBeVisible();
  await expect(result(page).locator('.figure')).toContainText('France');
  await expect(row(result(page), 'neel').locator('td')).toHaveText(['neelyou', '321 km', '5,000Perfect', '5,000']);
  await expect(row(result(page), 'ana').locator('td')).toHaveText([/ana$/, '900 km', '3,000', '3,000']);
  await expect(row(result(page), 'ana').getByRole('img', { name: 'Brazil' })).toBeVisible();
  // a guest's name is never a link
  await expect(row(result(page), 'Guest').getByRole('link')).toHaveCount(0);
  await expect(result(page).locator('.round-xp')).toHaveText('+100 XP.');

  server.finish(outcome(['neel']));
  await expect(row(final(page), 'ana').getByRole('img', { name: 'Brazil' })).toBeVisible();
  await expect(row(final(page), 'Guest').getByRole('link')).toHaveCount(0);
  // a guest has no account to report
  await expect(final(page).getByRole('button', { name: /^Report / })).toHaveAccessibleName('Report ana');
  await expect(final(page).locator('.match-xp')).toHaveText('You earned 100 XP.');
});

test('a ranked round pays double XP, a lesser round has no mark or confetti, and a party round earns none', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = rankedState({ id: 'm7', phase: 'preparing', you: MEMBER, places: FIVE_PLACES });
  server.startRound(0);
  await rejoin(page, server);
  await roundReady(page);
  await sendGuess(page, { x: 150, y: 150 });
  server.reveal(4200, 5000);
  await expect(row(result(page), 'neel').locator('td')).toHaveText(['neelyou', '321 km', '4,200', '4,200']);
  // the other player's full score is theirs to be told about, not this one's
  await expect(result(page).getByText('Perfect')).toHaveCount(0);
  await expect(result(page).locator('.round-xp')).toHaveText('+168 XP.');
  await expect(page.locator('.confetti')).toHaveCount(0);
  server.finish(outcome(['sam']));
  await expect(final(page).locator('.match-xp')).toHaveText('You earned 168 XP. Ranked duels pay double.');

  const party = await MatchServer.install(page);
  party.state = partyGame();
  party.startRound(0);
  party.matchFound('m1');
  await page.goto('/');
  await page.getByRole('button', { name: 'Rejoin match' }).click();
  await roundReady(page);
  await sendGuess(page, { x: 150, y: 150 });
  party.reveal(5000, 100);
  await expect(row(result(page), 'neel').locator('td')).toHaveText(['neelyou', '321 km', '5,000Perfect', '5,000']);
  await expect(result(page).locator('.round-xp')).toHaveCount(0);
});

// --- the new screens in the other four languages, on a phone ---------------------------------------------

for (const code of ['es', 'fr', 'de', 'ru']) {
  const say = CATALOGS[code]!;

  test.describe(`${code}, on a phone`, () => {
    test.use({ viewport: { width: 390, height: 800 } });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
    });

    test('the guest notices are in the language and fit', async ({ page }) => {
      await asGuest(page);
      for (const address of ['/', '/#unranked', '/#ranked', '/#join']) {
        await page.goto('about:blank');
        await page.goto(address);
        await expect(page.locator('.sidebar .guest-badge')).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expectTranslated(page, code, [GUEST]);
      }
    });

    test('the queue screen and the ranked lock are in the language and fit', async ({ page }) => {
      const server = await MatchServer.install(page);
      await signIn(page, 'neel', 1016);
      await mockServices(page);
      await page.goto('/#ranked');
      await page.getByRole('button', { name: say['queue.find'] }).click();
      await expect(page.locator('.queue-window')).not.toBeEmpty();
      await expectTranslated(page, code);

      await page.getByRole('button', { name: say['common.cancel'] }).click();
      server.lockRanked(120_000);
      await page.getByRole('button', { name: say['queue.find'] }).click();
      await expect(page.locator('.queue-lock')).toBeVisible();
      await expectTranslated(page, code);
    });

    test('the queue screen after the other player left is in the language and fits', async ({ page }) => {
      const server = await MatchServer.install(page);
      server.leadMs = 5000;
      server.state = duel();
      server.startRound(0);
      server.matchFound('m7');
      await signIn(page, 'neel', 1016);
      await mockServices(page);
      await page.goto('/');
      await page.getByRole('button', { name: say['home.resume.rejoin'] }).click();
      // the versus screen, while the round gets ready
      await expect(page.locator('.versus-card')).toHaveCount(2);
      await expectTranslated(page, code, ['neel', 'sam']);

      server.dodge('sam');
      await expect(page.getByText(say['queue.dodged'])).toBeVisible();
      await expect(page.locator('.queue-waited')).not.toBeEmpty();
      await expectTranslated(page, code);
    });

    test('the chat with its reactions and mutes open, and a final standing, are in the language and fit', async ({ page }) => {
      const party = await MatchServer.install(page);
      party.state = partyGame({ players: [player('sam'), player('ana', { country: 'BR' }), player('neel')] });
      party.startRound(0);
      party.matchFound('m1');
      await signIn(page, 'neel', 1016);
      await mockServices(page);
      await page.goto('/');
      await page.getByRole('button', { name: say['home.resume.rejoin'] }).click();
      await roundReady(page);

      // a party with chat on: the message box, the twenty reactions and the mutes all at once
      const chat = page.locator('.chat.folded');
      await chat.getByRole('button', { name: say['label.chat'], exact: true }).click();
      await chat.getByRole('button', { name: 'nice', exact: true }).click();
      await chat.getByText(say['chat.mute.title']).click();
      await chat.getByRole('button', { name: say['chat.mute.label'].replace('{name}', 'ana') }).click();
      await expect(chat.locator('.mute-row .tag')).toHaveText(say['chat.mute.tag']);
      await expectTranslated(page, code, ['neel', 'sam', 'ana', ...EMOTES]);
      const panel = (await chat.locator('.chat-panel').boundingBox())!;
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(390);
      expect(panel.y).toBeGreaterThanOrEqual(0);
      expect(panel.y + panel.height).toBeLessThanOrEqual(800);

      // a public game's reveal and standing: flags, Perfect, XP and Play again
      const game = await MatchServer.install(page);
      game.state = publicGame(MEMBER, [player('ana', { country: 'BR' }), guest(7302)]);
      game.startRound(0);
      game.matchFound('m9');
      await page.goto('/');
      await page.getByRole('button', { name: say['home.resume.rejoin'] }).click();
      await roundReady(page);
      const names = ['neel', 'ana', 'Guest #7302', 'NEE', 'ANA', 'GUE'];
      game.revealScores({ neel: 5000, ana: 3000, 'Guest #7302': 1200 });
      await expect(page.getByRole('region', { name: say['match.roundResult'] })).toBeVisible();
      await expectTranslated(page, code, names);
      game.finish(outcome(['neel']));
      const standing = page.getByRole('region', { name: say['match.finalStanding'] });
      await expect(standing.getByRole('button', { name: say['play.again'] })).toBeVisible();
      await expect(standing.locator('.match-xp')).toBeVisible();
      await expectTranslated(page, code, names);
    });
  });
}
