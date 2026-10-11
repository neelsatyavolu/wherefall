import { expect, test } from '@playwright/test';
import { PLACES, guest, matchState, outcome, player, settings, teamRow, viewer } from '../src/multiplayer/testing.ts';
import { mockServices } from './fixtures.ts';
import { play, roundReady, scrollsSideways } from './helpers.ts';
import { SAYS } from './match-rules.ts';
import { MatchServer, signIn } from './match-server.ts';
import { MEMBER, NO_HEALTH, result, final, lobbyTitle, lobbyRow, names, settingsLine, team, hostPanel, teamHealth, roundNote, rounds, time, sendGuess, enter, partyGame, teamParty, seat, fullParty, openActions } from './party-helpers.ts';

// Wave 5, parties: the party's options, its host's controls, teams in a party, joining under way,
// and the lobby's layout. 2v2, the pair queue and the language checks are in wave5-teams.spec.ts.

// --- item 15: the party form ----------------------------------------------------------------------

test('the party form offers 1 to 20 rounds and no timer or 10 to 300 seconds, by slider or button', async ({ page }) => {
  await MatchServer.install(page);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/#create');

  await expect(rounds(page)).toHaveValue('5');
  await expect(rounds(page)).toHaveAttribute('min', '1');
  await expect(rounds(page)).toHaveAttribute('max', '20');
  await expect(rounds(page)).toHaveAttribute('aria-valuetext', '5 rounds');
  await rounds(page).fill('1');
  await expect(page.locator('.time-value').first()).toHaveText('1 round');
  await expect(page.getByRole('button', { name: 'Fewer rounds' })).toBeDisabled();
  await page.getByRole('button', { name: 'More rounds' }).click();
  await expect(rounds(page)).toHaveValue('2');
  await rounds(page).fill('20');
  await expect(page.getByRole('button', { name: 'More rounds' })).toBeDisabled();
  await page.getByRole('button', { name: 'Fewer rounds' }).click();
  await expect(rounds(page)).toHaveAttribute('aria-valuetext', '19 rounds');

  await expect(time(page)).toHaveValue('60');
  await expect(time(page)).toHaveAttribute('min', '0');
  await expect(time(page)).toHaveAttribute('max', '300');
  await expect(time(page)).toHaveAttribute('step', '10');
  await time(page).fill('0');
  await expect(time(page)).toHaveAttribute('aria-valuetext', 'No limit');
  await expect(page.getByRole('button', { name: 'Less time' })).toBeDisabled();
  await expect(page.getByText('With no limit, a round ends when everyone has guessed or when the host ends it.')).toBeVisible();
  await time(page).fill('300');
  await expect(page.getByRole('button', { name: 'More time' })).toBeDisabled();

  await expect(page.getByRole('group', { name: 'Communication' }).getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('group', { name: 'Teams' }).getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('radio', { name: 'Chat', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'No teams' })).toBeChecked();
});

for (const [name, choose, expected] of [
  ['one round, ten seconds, as it opens otherwise', { rounds: '1', time: '10', mode: 'Move', say: 'Chat', teams: 'No teams' }, settings({ rounds: 1, timeLimit: 10 })],
  ['twenty rounds, five minutes, reactions only, teams by best guess', { rounds: '20', time: '300', mode: 'No move', say: 'Reactions only', teams: 'Best guess' }, settings({ rounds: 20, timeLimit: 300, mode: 'no-move', communication: 'reactions', teams: 'best' })],
  ['seven rounds, no timer, nothing said, teams by average', { rounds: '7', time: '0', mode: 'No move, pan or zoom', say: 'Off', teams: 'Average' }, settings({ rounds: 7, timeLimit: 0, mode: 'nmpz', communication: 'off', teams: 'average' })],
] as const) {
  test(`a party is created with ${name}`, async ({ page }) => {
    const server = await MatchServer.install(page);
    await signIn(page, 'neel');
    await mockServices(page);
    await page.goto('/#create');
    await rounds(page).fill(choose.rounds);
    await time(page).fill(choose.time);
    await page.getByRole('radio', { name: choose.mode, exact: true }).check();
    await page.getByRole('radio', { name: choose.say, exact: true }).check();
    await page.getByRole('radio', { name: choose.teams, exact: true }).check();
    await page.getByRole('button', { name: 'Create party' }).click();

    expect(server.posted('create')).toEqual([{ action: 'create', settings: expected }]);
    await expect(lobbyTitle(page)).toBeVisible();
    // the lobby says what was chosen
    const said = { chat: 'chat', reactions: 'reactions only', off: 'no chat' }[expected.communication];
    await expect(settingsLine(page)).toContainText(said);
    await expect(page.getByRole('region', { name: 'Team 1', exact: true })).toHaveCount(expected.teams === 'none' ? 0 : 1);
  });
}

test('a refusal of the settings is shown as the server words it, and the form can be sent again', async ({ page }) => {
  const server = await MatchServer.install(page);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/#create');
  server.refuse = SAYS.badSettings;
  await page.getByRole('button', { name: 'Create party' }).click();
  await expect(page.getByRole('alert').filter({ hasText: SAYS.badSettings })).toBeVisible();
  server.refuse = null;
  await page.getByRole('button', { name: 'Create party' }).click();
  await expect(lobbyTitle(page)).toBeVisible();
});

// --- the lobby: settings that follow, and the host changing them ------------------------------------

test('the host changes the settings in the lobby, and the line follows', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ players: [player('neel'), player('sam')] });
  await enter(page, server);
  await expect(settingsLine(page)).toHaveText('World · 3 rounds · 30 sec · move · chat');

  await page.getByRole('button', { name: 'Change settings' }).click();
  const form = page.getByRole('form', { name: 'Party settings' });
  // the form opens on the settings as they are
  await expect(form.getByRole('slider', { name: 'Rounds' })).toHaveValue('3');
  await expect(form.getByRole('slider', { name: 'Time per round' })).toHaveValue('30');
  await form.getByRole('slider', { name: 'Rounds' }).fill('8');
  await form.getByRole('slider', { name: 'Time per round' }).fill('0');
  await form.getByRole('radio', { name: 'Off', exact: true }).check();
  await form.getByRole('radio', { name: 'Best guess' }).check();

  // a refusal keeps the form open, with the server's words
  server.refuse = SAYS.badSettings;
  await form.getByRole('button', { name: 'Save settings' }).click();
  await expect(form.getByRole('alert')).toHaveText(SAYS.badSettings);
  server.refuse = null;
  await form.getByRole('button', { name: 'Save settings' }).click();

  expect(server.posted('configure').at(-1)).toEqual({ action: 'configure', matchId: 'm1', settings: settings({ rounds: 8, timeLimit: 0, communication: 'off', teams: 'best' }) });
  await expect(form).toHaveCount(0);
  await expect(settingsLine(page)).toHaveText('World · 8 rounds · No limit · move · no chat · teams by best guess');
  // teams are on now, and chat is off
  await expect(team(page, 'Team 1')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Chat' })).toBeHidden();

  // changing one's mind sends nothing
  await page.getByRole('button', { name: 'Change settings' }).click();
  await page.getByRole('form', { name: 'Party settings' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('form', { name: 'Party settings' })).toHaveCount(0);
  expect(server.posted('configure')).toHaveLength(2);
});

test('a player who is not the host sees the settings change, and is offered nothing that is the host\u2019s', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('ana')] });
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/?party=ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();
  await expect(lobbyTitle(page)).toBeVisible();
  await expect(settingsLine(page)).toHaveText('World · 3 rounds · 30 sec · move · chat');
  await expect(page.getByText('Players · 3 of 40')).toBeVisible();

  for (const name of ['Change settings', 'Lock party', 'Shuffle teams', 'Start match', 'Queue for 2v2 together']) {
    await expect(page.getByRole('button', { name })).toBeHidden();
  }
  await expect(page.getByRole('button', { name: /^(Kick|Make) / })).toHaveCount(0);

  // the host changes the settings and locks the party: the lobby follows on its next poll
  server.state = { ...server.state, settings: settings({ rounds: 12, timeLimit: 0, mode: 'nmpz', communication: 'reactions', teams: 'average' }), teams: NO_HEALTH, locked: true };
  await expect(settingsLine(page)).toHaveText('World · 12 rounds · No limit · no move, pan or zoom · reactions only · teams by average');
  await expect(page.getByText('This party is locked. Nobody new can join.')).toBeVisible();
  await expect(page.locator('.lobby-count .tag')).toHaveText('locked');
  // picking a team is every player's own to do
  await team(page, 'Team 2').getByRole('button', { name: 'Join Team 2' }).click();
  expect(server.posted('team')).toEqual([{ action: 'team', matchId: 'm1', team: 1 }]);
  await expect(team(page, 'Team 2').locator('.player-name')).toHaveText(['neel']);
});

// --- teams in a party -----------------------------------------------------------------------------

test('players pick a team, the host shuffles, and Start with an empty team is refused in the server\u2019s words', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ settings: settings({ teams: 'best' }), teams: NO_HEALTH, players: [player('neel'), player('sam')] });
  await enter(page, server);

  // nobody has a team yet
  await expect(team(page, 'Team 1')).toContainText('Nobody yet');
  await expect(team(page, 'Team 2')).toContainText('Nobody yet');
  await expect(team(page, 'No team yet').locator('.player-name')).toHaveText(['neel', 'sam']);
  await expect(page.getByText('Pick a team. Anyone without one joins the smaller team when the match starts.')).toBeVisible();

  await page.getByRole('button', { name: 'Join Team 2' }).click();
  expect(server.posted('team')).toEqual([{ action: 'team', matchId: 'm1', team: 1 }]);
  await expect(team(page, 'Team 2').locator('.player-name')).toHaveText(['neel']);
  await expect(team(page, 'Team 2').locator('.team-head .tag')).toHaveText('yours');
  await expect(page.getByRole('button', { name: 'Join Team 2' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Join Team 1' })).toBeVisible();

  // sam picks the same team: one team is empty, and the server will not start
  server.state = seat(server.state, 'sam', 1);
  await expect(team(page, 'Team 2').locator('.player-name')).toHaveText(['neel', 'sam']);
  await expect(team(page, 'No team yet')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('.lobby-start').getByRole('alert')).toHaveText(SAYS.teamsNeedPlayers);
  expect(server.state.phase).toBe('lobby');

  await page.getByRole('button', { name: 'Shuffle teams' }).click();
  expect(server.posted('shuffle')).toEqual([{ action: 'shuffle', matchId: 'm1' }]);
  await expect(team(page, 'Team 1').locator('.player-name')).toHaveText(['neel']);
  await expect(team(page, 'Team 2').locator('.player-name')).toHaveText(['sam']);

  await page.getByRole('button', { name: 'Start match' }).click();
  await expect.poll(() => server.state.phase).not.toBe('lobby');
  await expect(lobbyTitle(page)).toHaveCount(0);
});

for (const [mode, heading, teamScores] of [
  ['best', 'Best guess', ['4,000', '3,000']],
  ['average', 'Average', ['2,500', '2,000']],
] as const) {
  test(`a party with teams scored by ${mode} shows each team's round and total, and the winning team`, async ({ page }) => {
    const server = await MatchServer.install(page);
    server.state = teamParty(mode, { you: viewer({ team: 0 }) });
    server.startRound(0);
    await enter(page, server);
    await roundReady(page);
    // a party's teams have no health
    await expect(teamHealth(page)).toBeHidden();
    await sendGuess(page, { x: 150, y: 150 });
    server.revealScores({ neel: 4000, sam: 1000, ana: 3000, kit: 1000 });

    const teams = result(page).getByRole('table', { name: 'Teams' });
    await expect(teams.locator('thead th')).toHaveText(['Team', heading, 'Total']);
    await expect(teams.locator('tbody tr').nth(0).locator('td')).toHaveText(['Team 1yours', teamScores[0], teamScores[0]]);
    await expect(teams.locator('tbody tr').nth(1).locator('td')).toHaveText(['Team 2', teamScores[1], teamScores[1]]);
    const players = result(page).getByRole('table', { name: 'Players' });
    await expect(players.locator('thead th')).toHaveText(['Player', 'Team', 'Distance', 'Points', 'Total']);
    await expect(players.locator('tbody tr').filter({ hasText: 'neel' }).locator('td')).toHaveText(['neelyou', '1', '321 km', '4,000', '4,000']);
    await expect(players.locator('tbody tr').filter({ hasText: 'ana' }).locator('td')).toHaveText(['ana', '2', '900 km', '3,000', '3,000']);

    // the totals are the server's own
    server.state = { ...server.state, teams: [teamRow(0, { health: null, total: 9100 }), teamRow(1, { health: null, total: 8200 })] };
    await expect(teams.locator('tbody tr').nth(0).locator('td')).toHaveText(['Team 1yours', teamScores[0], teamScores[0]]);
    server.finish(outcome(['neel', 'sam']));
    await expect(final(page)).toContainText('Your team won.');
    await expect(final(page).locator('.team-figures .figure')).toHaveText(['Team 1 (yours)won9,100', 'Team 28,200']);
    const standing = final(page).getByRole('table', { name: 'Players' }).locator('tbody tr');
    await expect(standing.filter({ hasText: 'won' }).locator('.player')).toHaveText(['neel', 'sam']);
    await expect(standing.filter({ hasText: 'ana' }).locator('td').nth(2)).toHaveText('2');
  });
}

// --- host controls --------------------------------------------------------------------------------

test('the host kicks a player from the lobby after being asked, and a guest is offered no hand-over', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ players: [player('neel'), player('sam'), guest(4821)] });
  await enter(page, server);
  await expect(names(page)).toHaveText(['neel', 'sam', 'Guest #4821']);

  // nothing on the host's own row; a guest cannot be made host
  await expect(lobbyRow(page, 'neel').getByRole('button')).toHaveCount(0);
  await expect(lobbyRow(page, 'sam').getByRole('button')).toHaveText(['Make host', 'Kick']);
  await expect(lobbyRow(page, 'Guest #4821').getByRole('button')).toHaveText(['Kick']);

  await page.getByRole('button', { name: 'Kick sam' }).click();
  await expect(lobbyRow(page, 'sam')).toContainText('Remove sam from the party? They cannot come back.');
  // the question stays open across polls, and saying no sends nothing
  await page.waitForTimeout(2000);
  await lobbyRow(page, 'sam').getByRole('button', { name: 'Cancel' }).click();
  expect(server.posted('kick')).toHaveLength(0);
  await expect(lobbyRow(page, 'sam').getByRole('button')).toHaveText(['Make host', 'Kick']);

  await page.getByRole('button', { name: 'Kick sam' }).click();
  await lobbyRow(page, 'sam').getByRole('button', { name: 'Remove' }).click();
  expect(server.posted('kick')).toEqual([{ action: 'kick', matchId: 'm1', username: 'sam' }]);
  await expect(names(page)).toHaveText(['neel', 'Guest #4821']);
  await expect(page.getByText('Players · 2 of 40')).toBeVisible();

  // a kick the server refuses is explained
  server.refuse = SAYS.noSuchPlayer;
  server.refuseStatus = 409;
  await page.getByRole('button', { name: 'Kick Guest #4821' }).click();
  await lobbyRow(page, 'Guest #4821').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('alert').filter({ hasText: SAYS.noSuchPlayer })).toBeVisible();
  await expect(names(page)).toHaveText(['neel', 'Guest #4821']);
});

test('the host hands the party over: the controls go at once and come back when the party is handed back', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ settings: settings({ teams: 'best' }), teams: NO_HEALTH, players: [player('neel'), player('sam')] });
  await enter(page, server);
  await expect(page.getByRole('button', { name: 'Start match' })).toBeVisible();
  await expect(lobbyRow(page, 'neel')).toContainText('you, host');

  await page.getByRole('button', { name: 'Make sam the host' }).click();
  expect(server.posted('host')).toEqual([{ action: 'host', matchId: 'm1', username: 'sam' }]);
  for (const name of ['Start match', 'Change settings', 'Lock party', 'Shuffle teams', 'Queue for 2v2 together']) {
    await expect(page.getByRole('button', { name })).toBeHidden();
  }
  await expect(page.getByRole('button', { name: /^(Kick|Make) / })).toHaveCount(0);
  await expect(lobbyRow(page, 'neel').locator('.tag')).toHaveText('you');
  await expect(page.getByText('Waiting for the host to start the match.')).toBeVisible();

  // sam hands it back: the controls are there on the next poll
  server.makeYouHost();
  await expect(page.getByRole('button', { name: 'Start match' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kick sam' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shuffle teams' })).toBeVisible();
});

test('the host locks and unlocks the party, and the lobby says so', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ players: [player('neel'), player('sam')] });
  await enter(page, server);
  await expect(page.getByText('This party is locked. Nobody new can join.')).toBeHidden();

  await page.getByRole('button', { name: 'Lock party' }).click();
  await expect(page.getByText('This party is locked. Nobody new can join.')).toBeVisible();
  await expect(page.locator('.lobby-count .tag')).toHaveText('locked');
  await page.getByRole('button', { name: 'Unlock party' }).click();
  await expect(page.getByText('This party is locked. Nobody new can join.')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Lock party' })).toBeVisible();
  expect(server.posted('lock')).toEqual([
    { action: 'lock', matchId: 'm1', locked: true },
    { action: 'lock', matchId: 'm1', locked: false },
  ]);
});

test('during a match the host has a Host panel: lock, hand over, kick, and End round', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = partyGame({ players: [player('neel'), player('sam'), player('ana'), guest(4821)] });
  server.startRound(0);
  await enter(page, server);
  await roundReady(page);
  // a timed round says nothing about its timer, and the host can still end it
  await expect(roundNote(page)).toBeEmpty();
  await expect(page.getByRole('button', { name: 'End round' })).toBeVisible();

  await hostPanel(page).getByRole('button', { name: 'Host', exact: true }).click();
  await expect(hostPanel(page).locator('.player-row')).toHaveText([/^samMake hostKick$/, /^anaMake hostKick$/, /^Guest #4821Kick$/]);
  await hostPanel(page).getByRole('button', { name: 'Lock party' }).click();
  expect(server.posted('lock')).toEqual([{ action: 'lock', matchId: 'm1', locked: true }]);
  await expect(hostPanel(page).getByRole('button', { name: 'Unlock party' })).toBeVisible();

  // a kick in a round: asked first, and the player is gone from every list
  // the panel is narrow: a row's two actions stand behind its button of three dots
  await openActions(hostPanel(page), 'Actions for ana');
  await hostPanel(page).getByRole('button', { name: 'Kick ana' }).click();
  await expect(hostPanel(page)).toContainText('Remove ana from the party? They cannot come back.');
  await hostPanel(page).getByRole('button', { name: 'Remove' }).click();
  expect(server.posted('kick')).toEqual([{ action: 'kick', matchId: 'm1', username: 'ana' }]);
  await expect(hostPanel(page).locator('.player-name')).toHaveText(['sam', 'Guest #4821']);

  // no pin is shared in a match without teams
  await sendGuess(page, { x: 150, y: 150 });
  expect(server.pins).toHaveLength(0);

  await page.getByRole('button', { name: 'End round' }).click();
  expect(server.posted('endRound')).toEqual([{ action: 'endRound', matchId: 'm1' }]);
  await expect(result(page)).toBeVisible();
  await expect(result(page).getByRole('table', { name: 'Players' }).locator('tbody tr')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'End round' })).toBeHidden();

  // handing over during the reveal takes the panel away; getting the party back returns it
  await openActions(hostPanel(page), 'Actions for sam');
  await hostPanel(page).getByRole('button', { name: 'Make sam the host' }).click();
  expect(server.posted('host')).toEqual([{ action: 'host', matchId: 'm1', username: 'sam' }]);
  await expect(hostPanel(page)).toBeHidden();
  server.makeYouHost();
  await expect(hostPanel(page).getByRole('button', { name: 'Host', exact: true })).toBeVisible();
});

test('a player who is not the host has no Host panel and no End round', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = partyGame({ you: MEMBER, players: [player('sam'), player('neel')] });
  server.startRound(0);
  await enter(page, server);
  await roundReady(page);
  await expect(hostPanel(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'End round' })).toBeHidden();
  await expect(page.locator('.round-bar')).toBeHidden();

  // the party is handed to this player in the middle of the round
  server.makeYouHost();
  await expect(hostPanel(page).getByRole('button', { name: 'Host', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End round' })).toBeVisible();
});

// --- a round with no timer --------------------------------------------------------------------------

test('a round with no timer says how it ends, and the host ends it', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = partyGame({ settings: settings({ timeLimit: 0 }) });
  server.startRound(0);
  await enter(page, server);
  await roundReady(page);
  await expect(page.locator('.round-label')).toHaveText('No timer');
  await expect(roundNote(page)).toHaveText('The round ends when everyone has guessed, or when you end it.');
  await expect(page.locator('.hud')).not.toContainText(/\d:\d\d/);
  await sendGuess(page, { x: 150, y: 150 });
  // the host has guessed and the other player has not: nothing runs out, and End round is still there
  await page.waitForTimeout(1500);
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
  server.endRoundScores = { own: 3100, other: 0 };
  await page.getByRole('button', { name: 'End round' }).click();
  await expect(result(page).getByRole('table', { name: 'Players' }).locator('tbody tr').filter({ hasText: 'neel' }).locator('td')).toHaveText(['neelyou', '321 km', '3,100', '3,100']);
  await expect(roundNote(page)).toBeHidden();
});

test('in a round with no timer the other players are told the host can end it', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = partyGame({ you: MEMBER, players: [player('sam'), player('neel')], settings: settings({ timeLimit: 0 }) });
  server.startRound(0);
  await enter(page, server);
  await roundReady(page);
  await expect(page.locator('.round-label')).toHaveText('No timer');
  await expect(roundNote(page)).toHaveText('The round ends when everyone has guessed, or when the host ends it.');
  await expect(page.getByRole('button', { name: 'End round' })).toBeHidden();
});

// --- joining a party under way --------------------------------------------------------------------

test('a player who joins a party under way sees where it stands and plays from the next round', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.leadMs = 0;
  server.state = matchState({ you: MEMBER, players: [player('sam', { total: 3100 }), player('ana', { total: 1200 })], places: PLACES });
  server.startRound(1);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/?party=ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();

  const joining = page.getByRole('region', { name: 'Joining a game under way' });
  await expect(joining).toContainText('You join in round 3');
  await expect(joining.getByRole('table', { name: 'Players' }).locator('tbody tr')).toHaveCount(3);
  await expect(joining.getByRole('table', { name: 'Players' }).locator('.player')).toHaveText(['sam', 'ana', 'neel']);
  // the round being played is not theirs
  await expect(page.getByRole('button', { name: 'Guess', exact: true })).toBeHidden();
  await expect(page.locator('.hud')).toContainText('2 / 3');

  server.reveal(0, 2000);
  await expect(joining).toBeVisible();
  await expect(result(page)).toHaveCount(0);

  server.startRound(2);
  await roundReady(page);
  await expect(joining).toHaveCount(0);
  await expect(page.locator('.hud')).toContainText('3 / 3');
  await sendGuess(page, { x: 150, y: 150 });
  expect(server.posted('guess').map((sent) => sent.round)).toEqual([2]);
});

test('a player who joins while a round is getting ready is in time for it', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.leadMs = 5000;
  server.state = matchState({ you: MEMBER, players: [player('sam'), player('ana')], places: PLACES });
  server.startRound(1);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/?party=ABC123');
  await page.getByRole('button', { name: 'Join party' }).click();
  await expect(page.locator('.status')).toContainText('Round starts in');
  await expect(page.getByRole('region', { name: 'Joining a game under way' })).toHaveCount(0);
  await roundReady(page);
  await sendGuess(page, { x: 150, y: 150 });
  expect(server.posted('guess').map((sent) => sent.round)).toEqual([1]);
});

test('a party that is locked, full or on its last round refuses a joiner in the server\u2019s words', async ({ page }) => {
  const server = await MatchServer.install(page);
  await signIn(page, 'neel');
  await mockServices(page);
  await page.goto('/?party=ABC123');
  const join = page.getByRole('button', { name: 'Join party' });
  const refusal = page.locator('.account-form').getByRole('alert');
  const others = [player('sam'), player('ana')];

  server.state = matchState({ you: MEMBER, players: others, locked: true });
  await join.click();
  await expect(refusal).toHaveText('That party is locked.');

  server.state = matchState({ you: MEMBER, players: Array.from({ length: 40 }, (_, index) => player(`p${index + 1}`)) });
  await join.click();
  await expect(refusal).toHaveText('That party is full: it has 40 players.');

  server.state = matchState({ you: MEMBER, players: others, places: PLACES, phase: 'playing', round: 2 });
  await join.click();
  await expect(refusal).toHaveText('That party is on its last round. Try again when it is back in its lobby.');
  await expect(page.locator('.pane-title')).toHaveText('Join party');

  // and one that has room is joined
  server.state = matchState({ you: MEMBER, players: others });
  await join.click();
  await expect(lobbyTitle(page)).toBeVisible();
});

// --- the lobby's layout ---------------------------------------------------------------------------

for (const viewport of [
  { width: 1360, height: 840 },
  { width: 1440, height: 900 },
]) {
  test.describe(`the lobby at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('is left-aligned with a 28px title, and the chat stands beside the players, above the fold', async ({ page }) => {
      const server = await MatchServer.install(page);
      server.state = fullParty();
      await enter(page, server);
      await expect(names(page)).toHaveCount(20);

      const title = lobbyTitle(page);
      await expect(title).toHaveCSS('font-size', '28px');
      const titleBox = (await title.boundingBox())!;
      const lobby = (await page.locator('.lobby').boundingBox())!;
      // left-aligned: the screen starts at the left edge, and is no wider than the panes' wide measure
      expect(lobby.x).toBe(0);
      expect(titleBox.x).toBeLessThan(80);
      const content = (await page.locator('.lobby-grid').boundingBox())!;
      expect(content.x).toBe(titleBox.x);
      expect(content.width).toBeLessThanOrEqual(880);
      // what is read or filled in keeps the forms' measure
      expect((await page.locator('.lobby-main').boundingBox())!.width).toBeLessThanOrEqual(640);

      const chat = page.getByRole('region', { name: 'Chat' });
      const players = (await page.locator('.lobby-players').boundingBox())!;
      const chatBox = (await chat.boundingBox())!;
      // a right-hand column: clear of the players, and starting no lower than they do
      expect(chatBox.x).toBeGreaterThanOrEqual(players.x + players.width);
      expect(chatBox.y).toBeLessThan(players.y);
      const field = (await chat.getByRole('textbox', { name: 'Message' }).boundingBox())!;
      expect(field.y + field.height).toBeLessThan(viewport.height);
      const send = (await chat.getByRole('button', { name: 'Send' }).boundingBox())!;
      expect(send.y + send.height).toBeLessThan(viewport.height);
      expect(await scrollsSideways(page)).toBe(false);

      // the destructive choices are ghosts in the danger colour; Start is the filled one
      const danger = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--danger').trim());
      const colourOf = (hex: string) => page.evaluate((value) => Object.assign(document.createElement('i'), { style: `color:${value}` }).style.color, hex);
      await expect(page.getByRole('button', { name: 'Leave party' })).toHaveCSS('color', await colourOf(danger));
      // a row's own actions are quiet (second review, N3): forty Kick buttons must not be a wall of red
      await expect(page.locator('.lobby-players .button.danger')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Start match' })).not.toHaveCSS('background-color', await page.getByRole('button', { name: 'Leave party' }).evaluate((node) => getComputedStyle(node).backgroundColor));
    });
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('a lobby of twenty stays usable: Start before the list, the chat after it, nothing off the side', async ({ page }) => {
    const server = await MatchServer.install(page);
    server.state = fullParty();
    await enter(page, server);
    await expect(names(page)).toHaveCount(20);
    await expect(page.getByText('Players · 20 of 40')).toBeVisible();

    const start = (await page.getByRole('button', { name: 'Start match' }).boundingBox())!;
    const players = (await page.locator('.lobby-players').boundingBox())!;
    const chat = (await page.getByRole('region', { name: 'Chat' }).boundingBox())!;
    expect(start.y + start.height).toBeLessThan(players.y);
    expect(chat.y).toBeGreaterThanOrEqual(players.y + players.height);
    expect(await scrollsSideways(page)).toBe(false);

    // every control of every row is on the screen's width, and big enough to touch
    const boxes = await page.locator('.lobby-players button:visible').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect()).map((box) => ({ left: box.left, right: box.right, height: box.height })));
    // one button of three dots a row, and the ways onto a team and to shuffle them
    expect(boxes.length).toBeGreaterThanOrEqual(20);
    expect(boxes.every((box) => box.left >= 0 && box.right <= 390 && box.height >= 44)).toBe(true);

    // the last player can still be kicked: the question opens in their own row
    await openActions(page, 'Actions for Guest #7305');
    await page.getByRole('button', { name: 'Kick Guest #7305' }).click();
    const row = lobbyRow(page, 'Guest #7305');
    await expect(row).toContainText('Remove Guest #7305 from the party?');
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(names(page)).toHaveCount(19);
  });
});
