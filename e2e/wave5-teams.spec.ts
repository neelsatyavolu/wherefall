import { expect, test } from '@playwright/test';
import { EMOTES } from '../src/multiplayer/client.ts';
import { guest, matchState, outcome, player, settings, teamRow } from '../src/multiplayer/testing.ts';
import { mockServices } from './fixtures.ts';
import { placePin, roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { SAYS } from './match-rules.ts';
import { MatchServer, signIn } from './match-server.ts';
import { MEMBER, NO_HEALTH, result, final, lobbyTitle, names, team, foldedChat, teamHealth, roundNote, sendGuess, enter, partyGame, teamParty, twoVersusTwo, TWENTY_NAMES, fullParty, openActions } from './party-helpers.ts';

// Wave 5, teams: 2v2 (team health, teammates' pins, team chat), queueing for it as a pair, and the
// screens of parties and teams in German and Russian. The parties themselves are in wave5-party.spec.ts.

// --- item 11: 2v2 ---------------------------------------------------------------------------------

test('a 2v2 is played on team health, to the round that leaves a team with none', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = twoVersusTwo();
  server.startRound(0);
  await enter(page, server);
  await roundReady(page);
  const rows = teamHealth(page).locator('.health-row');
  await expect(rows).toHaveText(['Team 1 (yours)5,000', 'Team 25,000']);
  await expect(teamHealth(page).getByRole('meter', { name: 'Team 1 health' })).toHaveAttribute('aria-valuenow', '5000');

  // 4,000 against 2,000: the lower team loses the gap times 1.3
  await sendGuess(page, { x: 150, y: 150 });
  server.revealScores({ neel: 1000, sam: 2000, ana: 4000, kit: 500 });
  await expect(result(page)).toContainText('Next round in');
  await expect(rows).toHaveText(['Team 1 (yours)2,400−2,600', 'Team 25,000']);
  await expect(result(page).getByRole('table', { name: 'Teams' }).locator('tbody tr').nth(0).locator('td')).toHaveText(['Team 1yours', '2,000', '2,000']);

  // in the next round the strip carries the health, and no loss
  server.startRound(1);
  await roundReady(page);
  await expect(rows).toHaveText(['Team 1 (yours)2,400', 'Team 25,000']);
  await expect(teamHealth(page).getByRole('meter', { name: 'Team 1 health' })).toHaveAttribute('aria-valuenow', '2400');

  // a gap that is worth more than the team has left takes what is left, and decides the match
  await sendGuess(page, { x: 150, y: 150 });
  server.revealScores({ neel: 500, sam: 100, ana: 5000, kit: 200 });
  await expect(rows).toHaveText(['Team 1 (yours)0−2,400', 'Team 25,000']);
  await expect(result(page)).toContainText('Final standing in');

  server.finish(outcome(['ana', 'kit']));
  await expect(final(page)).toContainText('The other team won.');
  await expect(final(page).locator('.team-figures .figure')).toHaveText(['Team 1 (yours)2,5000 health', 'Team 2won9,0005,000 health']);
  await expect(rows).toHaveText(['Team 1 (yours)0', 'Team 25,000']);
});

test('a teammate\u2019s pin shows on the map by name and moves, and the player\u2019s own pin is sent at most once a second', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = twoVersusTwo();
  server.startRound(0);
  const sentAt: number[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && (request.postDataJSON() as { action?: string } | null)?.action === 'pin') {
      sentAt.push(Date.now());
    }
  });
  await enter(page, server);
  await roundReady(page);
  await page.locator('.map-panel').hover();
  const mate = page.locator('.pin-mate');
  await expect(mate).toHaveCount(0);

  // sam's pin, as their browser last sent it; the other team's pins are never sent to this player
  server.matePin('sam', 10, 20);
  server.matePin('ana', -40, 10);
  await expect(mate).toHaveText(['sam']);
  await expect(mate).not.toHaveClass(/final/);
  const before = (await mate.boundingBox())!;
  server.matePin('sam', 80, 45);
  await expect.poll(async () => Math.round((await mate.boundingBox())!.x)).not.toBe(Math.round(before.x));
  expect((await mate.boundingBox())!.x).toBeGreaterThan(before.x);

  // three moves of the player's own pin in quick succession: the first goes at once, the last a second later
  await placePin(page, { x: 100, y: 120 });
  await placePin(page, { x: 140, y: 150 });
  await placePin(page, { x: 180, y: 130 });
  await expect.poll(() => server.pins.length).toBe(2);
  expect(sentAt[1]! - sentAt[0]!).toBeGreaterThanOrEqual(950);
  expect(server.pins.every((pin) => pin.round === 0)).toBe(true);
  expect(server.pins[1]).not.toEqual(server.pins[0]);
  await page.waitForTimeout(1200);
  expect(server.pins).toHaveLength(2);
  expect(server.posted('pin')[0]).toEqual({ action: 'pin', matchId: 'm8', round: 0, lng: server.pins[0]!.lng, lat: server.pins[0]!.lat });

  // sam guesses: their pin is final. This player's guess is where their last pin was, and no pin follows it
  server.opponentGuesses('sam');
  await expect(mate).toHaveClass(/final/);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guess sent' })).toBeDisabled();
  const guessed = server.posted('guess')[0] as { lng: number; lat: number };
  expect({ lng: guessed.lng, lat: guessed.lat }).toEqual({ lng: server.pins[1]!.lng, lat: server.pins[1]!.lat });
  await page.waitForTimeout(1200);
  expect(server.pins).toHaveLength(2);

  // at the reveal the teammates' live pins are gone: the round's own markers take over
  server.revealScores({ neel: 1000, sam: 2000, ana: 4000, kit: 500 });
  await expect(result(page)).toBeVisible();
  await expect(mate).toHaveCount(0);
});

test('chat in a 2v2 has a Team / All switch, and a team line reaches only the team', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = twoVersusTwo();
  server.startRound(0);
  await enter(page, server);
  await roundReady(page);
  const chat = foldedChat(page);
  await chat.getByRole('button', { name: 'Chat', exact: true }).click();
  const scope = chat.getByRole('group', { name: 'Send to' });
  await expect(scope.getByRole('radio')).toHaveCount(2);
  await expect(scope.getByRole('radio', { name: 'All' })).toBeChecked();

  await chat.getByRole('textbox', { name: 'Message' }).fill('hello everyone');
  await chat.getByRole('button', { name: 'Send' }).click();
  await scope.getByRole('radio', { name: 'Team' }).check();
  await chat.getByRole('textbox', { name: 'Message' }).fill('it is Paris');
  await chat.getByRole('button', { name: 'Send' }).click();
  expect(server.posted('chat')).toEqual([
    { action: 'chat', matchId: 'm8', text: 'hello everyone', scope: 'all' },
    { action: 'chat', matchId: 'm8', text: 'it is Paris', scope: 'team' },
  ]);
  await expect(chat.locator('.chat-line')).toHaveText(['youhello everyone', 'youteamit is Paris']);

  // the teammate's team line arrives, marked; the other team's never does, and what they say to all does
  server.say('sam', 'agreed', null, 'team');
  server.say('ana', 'they will never know', null, 'team');
  server.say('ana', 'good luck');
  await expect(chat.locator('.chat-line')).toHaveText(['youhello everyone', 'youteamit is Paris', 'samteamagreed', 'anagood luck']);
  await expect(chat.locator('.chat-line .chat-team')).toHaveCount(2);
});

test('a party without teams has no Team / All switch, and one with teams has it for a player on a team', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ players: [player('neel'), player('sam')] });
  await enter(page, server);
  const chat = page.getByRole('region', { name: 'Chat' });
  await expect(chat.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await expect(chat.getByRole('group', { name: 'Send to' })).toBeHidden();

  // teams go on: the switch waits until the player is on one
  server.state = { ...server.state, settings: settings({ teams: 'best' }), teams: NO_HEALTH };
  await expect(team(page, 'Team 1')).toBeVisible();
  await expect(chat.getByRole('group', { name: 'Send to' })).toBeHidden();
  await page.getByRole('button', { name: 'Join Team 1' }).click();
  await expect(chat.getByRole('group', { name: 'Send to' })).toBeVisible();
  await chat.getByRole('radio', { name: 'Team' }).check();
  await chat.getByRole('textbox', { name: 'Message' }).fill('our plan');
  await chat.getByRole('button', { name: 'Send' }).click();
  expect(server.posted('chat')).toEqual([{ action: 'chat', matchId: 'm1', text: 'our plan', scope: 'team' }]);
});

// --- the pair queue -------------------------------------------------------------------------------

test('the host of a party of two queues both for 2v2: the lobby closes and the host waits in the 2v2 queue', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ players: [player('neel'), player('sam')] });
  let queuePolls = 0;
  page.on('request', (request) => {
    queuePolls += request.method() === 'GET' && request.url().includes('queue=1') ? 1 : 0;
  });
  await enter(page, server);
  await expect(page.getByText('With exactly two of you here, you can queue for 2v2 as teammates. This closes the party.')).toBeVisible();

  // the server's refusal is shown as sent
  server.refuse = SAYS.pairOnly;
  server.refuseStatus = 409;
  await page.getByRole('button', { name: 'Queue for 2v2 together' }).click();
  await expect(page.locator('.lobby-start').getByRole('alert')).toHaveText(SAYS.pairOnly);
  await expect(lobbyTitle(page)).toBeVisible();

  server.refuse = null;
  await page.getByRole('button', { name: 'Queue for 2v2 together' }).click();
  expect(server.posted('queue').at(-1)).toEqual({ action: 'queue', kind: 'team', matchId: 'm1' });
  await expect(page.locator('.pane-title')).toHaveText('2v2 match');
  await expect(page).toHaveURL(/#team$/);
  await expect(page.getByText('You and your teammate are in the 2v2 queue together.')).toBeVisible();
  await expect(page.getByText('Looking for players')).toBeVisible();
  await expect(page.getByText('2 players waiting')).toBeVisible();
  // the queue is watched, not joined again, and the closed party is not left
  const polls = queuePolls;
  await expect.poll(() => queuePolls).toBeGreaterThan(polls + 1);
  expect(server.posted('queue')).toHaveLength(2);
  expect(server.posted('leave')).toHaveLength(0);

  // the queue finds the match, and the pair are on one team
  server.state = twoVersusTwo();
  server.startRound(0);
  server.matchFound('m8');
  await roundReady(page);
  await expect(teamHealth(page).locator('.health-row')).toHaveText(['Team 1 (yours)5,000', 'Team 25,000']);
});

test('the other player of the pair is taken to the 2v2 queue when the host queues them', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')] });
  let queuePolls = 0;
  page.on('request', (request) => {
    queuePolls += request.method() === 'GET' && request.url().includes('queue=1') ? 1 : 0;
  });
  await enter(page, server);
  await expect(lobbyTitle(page)).toBeVisible();
  // only the host is offered it
  await expect(page.getByRole('button', { name: 'Queue for 2v2 together' })).toBeHidden();

  server.pairQueued();
  await expect(page.locator('.pane-title')).toHaveText('2v2 match');
  await expect(page.getByText('You and your teammate are in the 2v2 queue together.')).toBeVisible();
  await expect(page.getByText('Looking for players')).toBeVisible();
  const polls = queuePolls;
  await expect.poll(() => queuePolls).toBeGreaterThan(polls + 1);
  // nothing was asked of the server: it had already queued this player
  expect(server.posted('queue')).toHaveLength(0);
  expect(server.posted('leave')).toHaveLength(0);

  // leaving the queue is this player's own business: the other stays
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(server.posted('leaveQueue')).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Find a match' })).toBeVisible();
});

test('the pair queue is offered to exactly two accounts: not with a third player, and not with a guest', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ players: [player('neel'), guest(4821)] });
  await enter(page, server);
  await expect(page.getByRole('button', { name: 'Start match' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Queue for 2v2 together' })).toBeHidden();

  server.state = { ...server.state, players: [player('neel'), player('sam')] };
  await expect(page.getByRole('button', { name: 'Queue for 2v2 together' })).toBeVisible();
  server.addPlayer('ana');
  await expect(page.getByRole('button', { name: 'Queue for 2v2 together' })).toBeHidden();
  expect(server.posted('queue')).toHaveLength(0);
});

// --- the new screens in German and Russian, on a phone -----------------------------------------------

for (const code of ['de', 'ru']) {
  const say = CATALOGS[code]!;
  const named = (key: keyof typeof say, name: string) => say[key]!.replace('{name}', name);

  test.describe(`${code}, on a phone`, () => {
    test.use({ viewport: { width: 390, height: 800 } });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
    });

    test('the party form is in the language and fits', async ({ page }) => {
      await MatchServer.install(page);
      await signIn(page, 'neel');
      await mockServices(page);
      await page.goto('/#create');
      // by its exact name: on a phone the menu's own button names the pane too
      await expect(page.getByRole('button', { name: say['party.create.submit'], exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: say['party.rounds.more'] })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expectTranslated(page, code, ['neel']);
    });

    test('a lobby of twenty with teams and the host\u2019s controls is in the language and fits', async ({ page }) => {
      const server = await MatchServer.install(page);
      server.state = fullParty();
      await enter(page, server, say['home.resume.rejoin']);
      await expect(names(page)).toHaveCount(20);
      // a kick being asked about, and the settings form open under the line it changes
      await openActions(page, named('host.moreLabel', 'player_02'));
      await page.getByRole('button', { name: named('host.kickLabel', 'player_02') }).click();
      await page.getByRole('button', { name: say['party.settings.change'] }).click();
      await expect(page.getByRole('button', { name: say['party.settings.save'] })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expectTranslated(page, code, [...TWENTY_NAMES, ...EMOTES, 'ABC123']);
    });

    test('a 2v2 round with the team strip, a teammate\u2019s pin, and the chat with its Team / All switch are in the language and fit', async ({ page }) => {
      const server = await MatchServer.install(page);
      server.state = twoVersusTwo();
      server.startRound(0);
      await enter(page, server, say['home.resume.rejoin']);
      await roundReady(page);
      server.matePin('sam', 10, 20);
      await expect(page.getByRole('complementary', { name: say['team.health'] }).locator('.health-row')).toHaveCount(2);
      await page.getByRole('button', { name: say['round.openMap'] }).click();
      await expect(page.locator('.pin-mate')).toHaveText(['sam']);
      await expectTranslated(page, code, ['neel', 'sam', 'ana', 'kit']);
      await page.getByRole('button', { name: say['round.closeMap'] }).click();

      const chat = page.locator('.chat.folded');
      await chat.getByRole('button', { name: say['label.chat'], exact: true }).click();
      await chat.getByRole('radio', { name: say['chat.scope.team'] }).check();
      await chat.getByRole('textbox', { name: say['chat.message'] }).fill('Paris');
      await chat.getByRole('button', { name: say['chat.send'] }).click();
      server.say('sam', 'Lyon', null, 'team');
      await expect(chat.locator('.chat-line .chat-team')).toHaveCount(2);
      await expectTranslated(page, code, ['neel', 'sam', 'ana', 'kit', 'Paris', 'Lyon', ...EMOTES]);
      const panel = (await chat.locator('.chat-panel').boundingBox())!;
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(390);
      expect(panel.y).toBeGreaterThanOrEqual(0);
      expect(panel.y + panel.height).toBeLessThanOrEqual(800);

      // the reveal and the standing, with the teams' table, health and who won
      await chat.getByRole('button', { name: say['chat.close'] }).click();
      server.revealScores({ neel: 1000, sam: 2000, ana: 4000, kit: 500 });
      await expect(page.locator('.team-table')).toBeVisible();
      await expectTranslated(page, code, ['neel', 'sam', 'ana', 'kit', 'NEE', 'SAM', 'ANA', 'KIT']);
      server.finish(outcome(['ana', 'kit']));
      await expect(page.locator('.team-figures')).toBeVisible();
      await expectTranslated(page, code, ['neel', 'sam', 'ana', 'kit']);
    });

    test('a round with no timer, and the Host panel with a kick being asked about, are in the language and fit', async ({ page }) => {
      const server = await MatchServer.install(page);
      server.state = partyGame({ settings: settings({ timeLimit: 0 }), players: [player('neel'), player('sam'), guest(4821)] });
      server.startRound(0);
      await enter(page, server, say['home.resume.rejoin']);
      await roundReady(page);
      await expect(roundNote(page)).toHaveText(say['party.noTimerHost']);
      await expect(page.getByRole('button', { name: say['host.endRound'] })).toBeVisible();
      await expectTranslated(page, code, ['neel', 'sam', 'Guest #4821']);

      const host = page.locator('.host-fold');
      await host.getByRole('button', { name: say['host.title'], exact: true }).click();
      await openActions(host, named('host.moreLabel', 'sam'));
      await host.getByRole('button', { name: named('host.kickLabel', 'sam') }).click();
      await expect(host).toContainText(named('host.kickConfirm', 'sam'));
      await expectTranslated(page, code, ['neel', 'sam', 'Guest #4821']);
      const panel = (await host.locator('.host-panel').boundingBox())!;
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(390);
      expect(panel.y).toBeGreaterThanOrEqual(0);
      expect(panel.y + panel.height).toBeLessThanOrEqual(800);
    });

    test('a party joined under way, and the 2v2 queue as a pair, are in the language and fit', async ({ page }) => {
      const server = await MatchServer.install(page);
      server.leadMs = 0;
      server.state = teamParty('average', { you: MEMBER, players: [player('sam', { team: 0, total: 3100 }), player('ana', { team: 1, total: 1200 })], teams: [teamRow(0, { health: null, total: 3100 }), teamRow(1, { health: null, total: 1200 })] });
      server.startRound(1);
      await signIn(page, 'neel');
      await mockServices(page);
      await page.goto('/?party=ABC123');
      await page.getByRole('button', { name: say['party.join.submit'], exact: true }).click();
      await expect(page.getByRole('region', { name: say['match.join.label'] })).toBeVisible();
      await expectTranslated(page, code, ['neel', 'sam', 'ana']);

      const pair = await MatchServer.install(page);
      pair.state = matchState({ you: MEMBER, players: [player('sam'), player('neel')] });
      pair.matchFound('m1');
      await page.goto('/');
      await page.getByRole('button', { name: say['home.resume.rejoin'] }).click();
      await expect(page.locator('.lobby')).toBeVisible();
      pair.pairQueued();
      await expect(page.getByText(say['party.pair.queued'])).toBeVisible();
      await expect(page.locator('.queue-waited')).not.toBeEmpty();
      await expectTranslated(page, code, ['neel']);
    });
  });
}
