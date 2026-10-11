import { expect, test } from '@playwright/test';
import { changePassword, deleteAccount, saveAccountSettings, setCountry } from '../src/account/actions.ts';
import { getAccount, getGame, login, register, restoreAccount, saveGame, type SavedGame } from '../src/account/client.ts';
import { getGames } from '../src/account/games.ts';
import { startRun } from '../src/account/runs.ts';
import { claimDaily, getDaily, startDaily } from '../src/daily/client.ts';
import { createParty, getMatch, getQueue, joinParty, joinQueue, mutePlayer, playAsGuest, queueAsPair, sendChat, sendEmote, sendGuess, sendPin, startMatch } from '../src/multiplayer/client.ts';
import { backToLobby, chooseTeam, configureParty, endRound, kickPlayer, lockParty, makeHost, shuffleTeams } from '../src/multiplayer/party.ts';
import { PLACES, guest, matchState, outcome, player, rankedState, settings, teamState, viewer } from '../src/multiplayer/testing.ts';
import { friendAction, getFriends, getLeaderboard, getOnline, getProfile } from '../src/social/client.ts';
import { getMap, getMaps, likeMap, saveMap, type MapRow } from '../src/social/maps.ts';
import { AccountServer } from './account-server.ts';
import { GUESTS, SIGN_IN, dailyPlaces, data, open, refused, roundOn } from './contract-helpers.ts';
import { DailyServer, dailyEntries } from './daily-server.ts';
import { GamesServer, historyGames } from './games-server.ts';
import { MapsServer } from './maps-server.ts';
import { FIVE_PLACES, MatchServer } from './match-server.ts';
import { SocialServer, boardEntries, friend } from './social-server.ts';

/**
 * The stand-in servers against the real clients (see `contract-helpers.ts`). The wave-6 rules of
 * the account, games, daily, social and maps stand-ins are in `contract-mocks-w6.spec.ts`.
 */

test('a visitor becomes a guest, who may play public games and join parties and nothing more', async ({ page }) => {
  const account = await AccountServer.install(page, null);
  const match = await MatchServer.install(page);
  match.session = 'none';
  match.account = account;
  match.state = matchState({ you: viewer({ isHost: false }), players: [player('sam')] });
  const send = await open(page);

  expect(await getQueue(send)).toEqual(refused(SIGN_IN));
  expect(await joinQueue('unranked', send)).toEqual(refused(SIGN_IN));
  expect(data(await getAccount(send))).toMatchObject({ account: null, guest: null });

  expect(await playAsGuest(send)).toEqual({ ok: true, data: { username: 'Guest #4821' } });
  expect(data(await getAccount(send))).toMatchObject({ account: null, guest: 'Guest #4821', stats: null, recentGames: [] });
  // a browser that already has a session is told its name, and no second guest is made
  match.guestName = 'Guest #9999';
  expect(await playAsGuest(send)).toEqual({ ok: true, data: { username: 'Guest #4821' } });

  expect(await createParty({ map: 'world', mode: 'move', timeLimit: 60, rounds: 5 }, send)).toEqual(refused(GUESTS));
  expect(await joinQueue('ranked', send)).toEqual(refused(GUESTS));
  expect(await joinQueue('team', send)).toEqual(refused(GUESTS));
  expect(await sendChat('m1', 'hello', 'all', send)).toEqual(refused(GUESTS));
  expect(await changePassword('a', 'b'.repeat(8), send)).toEqual(refused(GUESTS));
  expect(data(await joinQueue('unranked', send))).toMatchObject({ queued: true, kind: 'unranked', window: null });

  const joined = data(await joinParty('ABC123', send));
  expect(joined.you).toMatchObject({ username: 'Guest #4821', guest: true, isHost: false });
  expect(joined.players.map((p) => [p.username, p.guest])).toEqual([['sam', false], ['Guest #4821', true]]);
  expect(data(await sendEmote('m1', 'hi', send)).chat.at(-1)).toMatchObject({ username: 'Guest #4821', emote: 'hi', scope: 'all' });

  match.guestsRefused = true;
  match.session = 'none';
  expect(await playAsGuest(send)).toEqual(refused('Too many guests from this network. Try again in an hour.'));
});

test('a host configures the party, seats teams, and uses the host controls; a wrong phase changes nothing', async ({ page }) => {
  const match = await MatchServer.install(page);
  match.state = matchState({ players: [player('neel'), player('sam'), player('ana'), guest(4821)] });
  const send = await open(page);

  const bad = 'Choose a map, a mode, 1 to 20 rounds, and no timer or 10 to 300 seconds a round.';
  expect(await configureParty('m1', { map: 'world', mode: 'move', timeLimit: 45, rounds: 5 }, send)).toEqual(refused(bad));
  expect(await configureParty('m1', { map: 'world', mode: 'move', timeLimit: 60, rounds: 21 }, send)).toEqual(refused(bad));
  expect(await chooseTeam('m1', 1, send)).toEqual(refused('Teams are off in this party.'));
  expect(await shuffleTeams('m1', send)).toEqual(refused('Teams are off in this party.'));

  const teamed = data(await configureParty('m1', { map: 'country:JP', mode: 'nmpz', timeLimit: 0, rounds: 20, communication: 'reactions', teams: 'average' }, send));
  expect(teamed.settings).toEqual({ map: 'country:JP', mode: 'nmpz', timeLimit: 0, rounds: 20, communication: 'reactions', teams: 'average', guests: true });
  expect(teamed.teams).toEqual([{ team: 0, health: null, total: 0 }, { team: 1, health: null, total: 0 }]);
  expect(teamed.players.map((p) => p.team)).toEqual([null, null, null, null]);

  // everyone but the host is on team 2: the other team has nobody yet
  match.state = { ...match.state, players: match.state.players.map((p) => ({ ...p, team: p.username === 'neel' ? null : 1 })) };
  expect(data(await chooseTeam('m1', 1, send)).you.team).toBe(1);
  expect(await startMatch('m1', send)).toEqual(refused('Each team needs at least one player.'));
  expect(data(await shuffleTeams('m1', send)).players.map((p) => p.team)).toEqual([0, 1, 0, 1]);

  expect(data(await lockParty('m1', true, send)).locked).toBe(true);
  expect(await kickPlayer('m1', 'nobody', send)).toEqual(refused('There is no such player in this match.'));
  expect(await kickPlayer('m1', 'neel', send)).toEqual(refused('You cannot do that to yourself.'));
  expect(data(await kickPlayer('m1', 'ana', send)).players.map((p) => p.username)).toEqual(['neel', 'sam', 'Guest #4821']);
  expect(await makeHost('m1', 'Guest #4821', send)).toEqual(refused('A guest cannot host.'));

  const started = data(await startMatch('m1', send));
  expect(started.phase).toBe('preparing');
  // outside the lobby, configure and shuffle answer with the match as it is
  expect(data(await configureParty('m1', { map: 'world', mode: 'move', timeLimit: 60, rounds: 5 }, send)).settings.map).toBe('country:JP');
  expect(data(await shuffleTeams('m1', send)).phase).toBe('preparing');
  // and the party cannot change hands while the places are being found
  expect(data(await makeHost('m1', 'sam', send)).you.isHost).toBe(true);

  match.state = { ...match.state, phase: 'lobby' };
  expect(data(await makeHost('m1', 'sam', send)).you).toMatchObject({ isHost: false, isResolver: false });
  expect(await lockParty('m1', false, send)).toEqual(refused('Only the host can do that.'));
  expect(await endRound('m1', send)).toEqual(refused('Only the host can do that.'));
});

test('a round with no timer ends when the host says, a kicked player leaves every result, and a finished party goes back to its lobby', async ({ page }) => {
  const match = await MatchServer.install(page);
  match.state = matchState({ settings: settings({ timeLimit: 0 }), players: [player('neel'), player('sam'), player('ana')], phase: 'preparing', places: PLACES });
  match.leadMs = 0;
  match.startRound(0);
  const send = await open(page);

  expect(data(await getMatch('m1', send))).toMatchObject({ phase: 'playing', roundEndsAt: null });
  await page.waitForTimeout(50);
  // a guess that leaves one player to go does not cut a round that has no timer
  match.opponentGuesses('sam');
  match.opponentGuesses('ana');
  expect(match.state.roundEndsAt).toBeNull();
  const revealed = data(await endRound('m1', send));
  expect(revealed.phase).toBe('reveal');
  expect(revealed.results[0]?.guesses.map((g) => g.username)).toEqual(['neel', 'sam', 'ana']);
  // endRound outside a round under way changes nothing
  expect(data(await endRound('m1', send)).results).toHaveLength(1);

  const without = data(await kickPlayer('m1', 'ana', send));
  expect(without.players.map((p) => p.username)).toEqual(['neel', 'sam']);
  expect(without.results[0]?.guesses.map((g) => g.username)).toEqual(['neel', 'sam']);

  // lobby on a party that is not finished changes nothing
  expect(data(await backToLobby('m1', send)).phase).toBe('reveal');
  match.finish(outcome(['sam']));
  const polls = match.polls;
  expect(data(await getMatch('m1', send)).phase).toBe('finished');
  expect(match.polls).toBe(polls + 1);
  const lobby = data(await backToLobby('m1', send));
  expect(lobby).toMatchObject({ id: 'm1', code: 'ABC123', phase: 'lobby', round: 0, places: null, results: [], chat: [], outcome: null });
  expect(lobby.settings.timeLimit).toBe(0);
  expect(lobby.players.map((p) => p.total)).toEqual([0, 0]);
});

test('joining a party: locked, full, on its last round, and after being removed', async ({ page }) => {
  const match = await MatchServer.install(page);
  const send = await open(page);
  const others = (count: number) => Array.from({ length: count }, (_, i) => player(`p${i}`));

  match.state = matchState({ you: viewer(), players: others(3), locked: true });
  expect(await joinParty('ABC123', send)).toEqual(refused('That party is locked.'));
  // wave 6: a party holds forty, so twenty leaves room
  match.state = matchState({ you: viewer(), players: others(40) });
  expect(await joinParty('ABC123', send)).toEqual(refused('That party is full: it has 40 players.'));
  match.state = matchState({ you: viewer(), players: others(3), phase: 'playing', round: 2, places: PLACES });
  expect(await joinParty('ABC123', send)).toEqual(refused('That party is on its last round. Try again when it is back in its lobby.'));

  // under way with rounds to spare: in, to play from the next round, and with teams on the smaller team
  match.state = matchState({ you: viewer(), players: [player('p0', { team: 0 }), player('p1', { team: 0 }), player('p2', { team: 1 })], settings: settings({ teams: 'best' }), phase: 'playing', round: 0, places: PLACES });
  expect(data(await joinParty('ABC123', send)).players.at(-1)).toMatchObject({ username: 'neel', team: 1, total: 0 });

  match.kickYou();
  const removed = 'You were removed from that party.';
  expect(await joinParty('ABC123', send)).toEqual(refused(removed));
  expect(await getMatch('m1', send)).toEqual(refused(removed));
  expect(await sendGuess('m1', 0, { lng: 1, lat: 2 }, send)).toEqual(refused(removed));
});

test('chat follows the kind of match, a muted player is left out, and a team message stays in the team', async ({ page }) => {
  const match = await MatchServer.install(page);
  const send = await open(page);

  match.state = rankedState({ phase: 'playing', places: FIVE_PLACES });
  expect(await sendChat('m1', 'hello', 'all', send)).toEqual(refused('Chat is off in this match.'));
  expect(data(await sendEmote('m1', 'gl', send)).chat).toHaveLength(1);
  match.state = matchState({ kind: 'unranked', code: null });
  expect(await sendChat('m1', 'hello', 'all', send)).toEqual(refused('Chat is off in this match.'));
  match.state = matchState({ settings: settings({ communication: 'reactions' }) });
  expect(await sendChat('m1', 'hello', 'all', send)).toEqual(refused('Chat is off in this match.'));
  match.state = matchState({ settings: settings({ communication: 'off' }) });
  expect(await sendEmote('m1', 'gl', send)).toEqual(refused('Reactions are off in this match.'));

  // 2v2: neel and sam against ana and kit
  match.state = teamState({ phase: 'playing', places: FIVE_PLACES });
  expect(data(await sendChat('m1', 'north of the river', 'team', send)).chat.at(-1)).toMatchObject({ username: 'neel', text: 'north of the river', scope: 'team' });
  match.say('sam', 'agreed', null, 'team');
  match.say('ana', 'they went south', null, 'team');
  match.say('kit', 'good luck all');
  expect(data(await getMatch('m1', send)).chat.map((entry) => [entry.username, entry.scope])).toEqual([['neel', 'team'], ['sam', 'team'], ['kit', 'all']]);

  expect(await mutePlayer('m1', 'nobody', true, send)).toEqual(refused('There is no such player in this match.'));
  expect(await mutePlayer('m1', 'neel', true, send)).toEqual(refused('You cannot do that to yourself.'));
  const muted = data(await mutePlayer('m1', 'kit', true, send));
  expect(muted.you.muted).toEqual(['kit']);
  expect(muted.chat.map((entry) => entry.username)).toEqual(['neel', 'sam']);
  match.say('kit', null, 'lol');
  expect(data(await getMatch('m1', send)).chat.map((entry) => entry.username)).toEqual(['neel', 'sam']);
  expect(data(await mutePlayer('m1', 'kit', false, send)).chat.map((entry) => entry.username)).toEqual(['neel', 'sam', 'kit', 'kit']);
});

test('2v2 is played on shared health, teammates see each other\'s pins, and the server cuts a round short', async ({ page }) => {
  const match = await MatchServer.install(page);
  match.state = teamState({ phase: 'preparing', places: FIVE_PLACES });
  match.leadMs = 0;
  match.startRound(0);
  const send = await open(page);

  const before = data(await getMatch('m1', send));
  expect(before.mates).toEqual([]);
  expect(before.teams).toEqual([{ team: 0, health: 5000, total: 0 }, { team: 1, health: 5000, total: 0 }]);
  const ends = Date.parse(before.roundEndsAt!) - Date.parse(before.serverNow);
  expect(ends).toBeGreaterThan(55_000);

  // a teammate's pin is sent on, an opponent's never
  match.matePin('sam', 12.5, 41.9);
  match.matePin('ana', -3.7, 40.4);
  expect(data(await sendPin('m1', 0, { lng: 2.35, lat: 48.85 }, send)).mates).toEqual([{ username: 'sam', lng: 12.5, lat: 41.9, guessed: false }]);
  expect(match.pins).toEqual([{ round: 0, lng: 2.35, lat: 48.85 }]);
  match.opponentGuesses('sam');
  expect(data(await getMatch('m1', send)).mates).toEqual([{ username: 'sam', lng: 12.5, lat: 41.9, guessed: true }]);

  // two more guesses leave one player to go: the round ends 20 seconds from then
  match.opponentGuesses('ana');
  expect(Date.parse(match.state.roundEndsAt!) - Date.parse(match.time(0))).toBeGreaterThan(40_000);
  match.opponentGuesses('kit');
  const cut = data(await getMatch('m1', send));
  expect(Date.parse(cut.roundEndsAt!) - Date.parse(cut.serverNow)).toBeLessThanOrEqual(20_000);
  expect(Date.parse(cut.roundEndsAt!) - Date.parse(cut.serverNow)).toBeGreaterThan(18_000);

  // a second guess for the round is answered with the match as it is
  const guessed = data(await sendGuess('m1', 0, { lng: 2, lat: 48 }, send));
  expect(data(await sendGuess('m1', 0, { lng: 99, lat: 9 }, send)).players).toEqual(guessed.players);

  // team 1's best is 4000, team 2's is 3000: the lower team loses the difference times 1.3
  match.revealScores({ neel: 1000, sam: 4000, ana: 3000, kit: 2000 });
  const revealed = data(await getMatch('m1', send));
  expect(revealed.teams).toEqual([{ team: 0, health: 5000, total: 4000 }, { team: 1, health: 3700, total: 3000 }]);
  expect(revealed.players.every((p) => p.health === null)).toBe(true);
  expect(revealed.mates).toEqual([]);
  expect(Date.parse(revealed.revealEndsAt!) - Date.parse(revealed.serverNow)).toBeGreaterThan(9000);
});

test('ranked: a 15 second cut, an 8 second reveal, a 5 second last reveal, a dodge, and the lock that follows two', async ({ page }) => {
  const match = await MatchServer.install(page);
  match.state = rankedState({ phase: 'preparing', places: FIVE_PLACES });
  match.leadMs = 0;
  match.startRound(0);
  const send = await open(page);
  const left = (state: { serverNow: string }, until: string | null) => Date.parse(until!) - Date.parse(state.serverNow);

  match.opponentGuesses('sam');
  const cut = data(await getMatch('m1', send));
  expect(left(cut, cut.roundEndsAt)).toBeLessThanOrEqual(15_000);
  expect(left(cut, cut.roundEndsAt)).toBeGreaterThan(13_000);
  match.reveal(0, 1000);
  const first = data(await getMatch('m1', send));
  expect(left(first, first.revealEndsAt)).toBeLessThanOrEqual(8000);
  expect(left(first, first.revealEndsAt)).toBeGreaterThan(6000);
  expect(first.players.map((p) => p.health)).toEqual([4000, 5000]);

  // the round that empties a player's health is the last, and its reveal is five seconds
  match.startRound(1);
  match.reveal(0, 4500);
  const last = data(await getMatch('m1', send));
  expect(last.players.map((p) => p.health)).toEqual([0, 5000]);
  expect(left(last, last.revealEndsAt)).toBeLessThanOrEqual(5000);

  // the opponent leaves a new duel before anyone has guessed: cancelled, and this player is queued again
  match.state = rankedState({ phase: 'playing', places: FIVE_PLACES });
  match.dodge('sam');
  expect(data(await getMatch('m1', send))).toMatchObject({ phase: 'finished', outcome: { winners: [], ratingChanges: [], dodgedBy: 'sam' } });
  expect(data(await getQueue(send))).toMatchObject({ queued: true, kind: 'ranked', matchId: null, lockedUntil: null });

  // the window is 50 and widens by 10 for each whole second waited
  match.queue = { ...match.queue, since: match.time(-12_400) };
  expect(data(await getQueue(send)).window).toBe(170);

  match.lockRanked(97_000);
  expect(data(await getQueue(send)).lockedUntil).not.toBeNull();
  expect(await joinQueue('ranked', send)).toEqual(refused('You left two ranked matches before they began. You can queue again in 97 seconds.'));
  expect(data(await joinQueue('unranked', send))).toMatchObject({ queued: true, kind: 'unranked', window: null });
});

test('a pair is queued for 2v2 only by the host of a party of exactly two', async ({ page }) => {
  const match = await MatchServer.install(page);
  const send = await open(page);
  const no = 'To queue as a pair, be the host of a party of exactly two.';

  match.state = matchState({ players: [player('neel'), player('sam'), player('ana')] });
  expect(await queueAsPair('m1', send)).toEqual(refused(no));
  match.state = matchState({ you: viewer(), players: [player('sam'), player('neel')] });
  expect(await queueAsPair('m1', send)).toEqual(refused(no));
  match.state = matchState({ players: [player('neel'), guest(4821)] });
  expect(await queueAsPair('m1', send)).toEqual(refused(no));

  match.state = matchState();
  expect(data(await queueAsPair('m1', send))).toMatchObject({ queued: true, kind: 'team', waiting: 2 });
  // the lobby has closed: the other player learns it from their next poll
  expect(data(await getMatch('m1', send))).toMatchObject({ phase: 'finished', movedToQueue: 'team', outcome: { winners: [] } });
  expect(data(await getQueue(send)).since).not.toBeNull();
});

test('the daily: one attempt a day, a paged top hundred, and results claimed by a new account', async ({ page }) => {
  const daily = await DailyServer.install(page);
  const games = await GamesServer.install(page, daily);
  daily.entries = dailyEntries(130);
  const send = await open(page);

  const open1 = data(await getDaily(1, send));
  expect(open1).toMatchObject({ state: 'open', yours: null, settings: { map: 'world', mode: 'move', timeLimit: 60, rounds: 3 } });
  expect(open1.leaderboard).toMatchObject({ page: 1, more: true });
  expect(open1.leaderboard.entries).toHaveLength(20);
  expect(open1.leaderboard.entries[0]).toEqual({ rank: 1, username: 'player001', country: 'FR', score: 14_000 });
  expect(open1.distribution).toHaveLength(10);
  expect(open1.distribution.reduce((sum, n) => sum + n, 0)).toBe(130);
  expect(Date.parse(open1.nextAt)).toBeGreaterThan(Date.parse(open1.serverNow));

  const fifth = data(await getDaily(5, send)).leaderboard;
  expect(fifth).toMatchObject({ page: 5, more: false });
  expect(fifth.entries.map((entry) => entry.rank)).toEqual(Array.from({ length: 20 }, (_, i) => 81 + i));
  // only the top hundred are served: a page past the fifth is empty
  expect(data(await getDaily(6, send)).leaderboard).toEqual({ entries: [], page: 6, more: false });

  expect(await startDaily(send)).toEqual({ ok: true, data: { state: 'started', token: null } });
  expect(data(await getDaily(1, send)).state).toBe('started');

  // each day's daily is on that day's three places
  const rounds = (day: string, scores: number[]) => scores.map((score, index) => roundOn(dailyPlaces(day)[index]!, score));
  const game: SavedGame = { map: 'world', mode: 'move', timeLimit: 60, seed: daily.seed, daily: daily.date, rounds: rounds(daily.date, [4000, 3000, 2001]) };
  expect(data(await saveGame(game, send))).toMatchObject({ score: 9001, maxScore: 15_000, rounds: 3 });
  const done = data(await getDaily(1, send));
  expect(done.state).toBe('done');
  // 9,001 is behind fifty players who made 9,100 or more, and ahead of the other eighty
  expect(done.yours).toMatchObject({ score: 9001, maxScore: 15_000, rounds: [4000, 3000, 2001], rank: 51, beat: 61 });
  expect(done.history.at(-1)).toEqual({ date: '2026-10-11', score: 9001 });
  expect(done.records).toEqual({ played: 1, best: 9001, average: 9001 });
  expect(await startDaily(send)).toEqual({ ok: true, data: { state: 'done', token: null } });
  // a second result for the day is answered with the first
  expect(data(await saveGame({ ...game, rounds: rounds(daily.date, [5000, 5000, 5000]) }, send)).score).toBe(9001);
  expect(games.history[0]).toMatchObject({ kind: 'daily', score: 9001 });

  // a claim: yesterday is taken, today is already played, a result of two rounds is not one, and of two for a day the first is taken
  const stored = (day: string, scores: number[]) => ({ daily: day, token: daily.tokenFor(day), rounds: rounds(day, scores) });
  const claim = [stored('2026-10-10', [1000, 2000, 3000]), stored('2026-10-11', [1, 2, 3]), stored('2026-10-09', [5000, 5000]), stored('2026-10-10', [5000, 5000, 5000])];
  expect(await claimDaily(claim, send)).toEqual({ ok: true, data: { claimed: ['2026-10-10'] } });
  expect(data(await getDaily(1, send)).history).toEqual([{ date: '2026-10-10', score: 6000 }, { date: '2026-10-11', score: 9001 }]);
  expect(await claimDaily([], send)).toEqual(refused('A claim holds 1 to 14 results.'));
  daily.claimable = false;
  expect(await claimDaily(claim, send)).toEqual(refused('Results can only be claimed on the day an account is made.'));

  // a visitor is sent the challenge and the board, and nothing about themselves
  daily.session = 'none';
  expect(data(await getDaily(1, send))).toMatchObject({ state: 'open', yours: null, streak: { current: 0, best: 0, atRisk: false }, records: null, history: [] });
  // a visitor's start, and a guest's, is answered with a token to keep with the result
  expect(data(await startDaily(send))).toEqual({ state: 'started', token: expect.stringMatching(/^daily\./) });
  expect(await claimDaily(claim, send)).toEqual(refused(SIGN_IN));
  daily.session = 'guest';
  expect(data(await startDaily(send)).token).not.toBeNull();
  expect(await claimDaily(claim, send)).toEqual(refused(GUESTS));
});

test('an account changes its password, country and settings, and is deleted and restored', async ({ page }) => {
  const account = await AccountServer.install(page, 'neel', 1016, { country: 'IN' });
  const send = await open(page);
  const wrong = 'That is not your current password.';

  expect(data(await getAccount(send)).account).toMatchObject({ username: 'neel', country: 'IN', league: 'Voyager', bestCountry: 0, bestContinent: 0, allowFriendRequests: true, hideChat: false });
  expect(await setCountry('BR', send)).toEqual({ ok: true, data: { country: 'BR' } });
  expect(await setCountry(null, send)).toEqual({ ok: true, data: { country: null } });
  expect(await setCountry('Brazil', send)).toEqual(refused('Choose a country by its two-letter code, or none.'));
  expect(await saveAccountSettings({ hideChat: true }, send)).toEqual({ ok: true, data: { allowFriendRequests: true, hideChat: true, hideLastSeen: false } });
  expect(await saveAccountSettings({ allowFriendRequests: false }, send)).toEqual({ ok: true, data: { allowFriendRequests: false, hideChat: true, hideLastSeen: false } });
  expect(await saveAccountSettings({ hideChat: 'yes' as unknown as boolean }, send)).toEqual(refused('A setting is either on or off.'));
  expect(data(await getAccount(send)).account).toMatchObject({ country: null, allowFriendRequests: false, hideChat: true });

  expect(await changePassword(account.password, 'short', send)).toEqual(refused('Choose a new password of 8 to 200 characters.'));
  expect(await changePassword('not it', 'a new password', send)).toEqual(refused(wrong));
  expect(await changePassword(account.password, 'a new password', send)).toEqual({ ok: true, data: { changed: true } });
  expect(await deleteAccount('correct horse battery', send)).toEqual(refused(wrong));

  const deleted = data(await deleteAccount('a new password', send));
  expect(Date.parse(deleted.restoreUntil)).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  expect(data(await getAccount(send))).toMatchObject({ account: null, guest: null });
  expect(await setCountry('BR', send)).toEqual(refused(SIGN_IN));
  expect(await login('neel', 'a new password', send)).toEqual(refused('This account was deleted. Restore it to sign in.'));
  expect(await restoreAccount('neel', 'a new password', send)).toEqual({ ok: true, data: { username: 'neel' } });
  expect(data(await getAccount(send)).account).toMatchObject({ username: 'neel', hideChat: true });

  // ten tries at the password an hour, then no more
  for (let i = 0; i < 7; i++) {
    await changePassword('guess', 'another password', send);
  }
  expect(await changePassword('a new password', 'another password', send)).toEqual(refused('Too many tries at your password in the last hour. Try again later.'));

  const fresh = await AccountServer.install(page, 'mod', 1000, { moderator: true });
  expect(await deleteAccount(fresh.password, send)).toEqual(refused("A moderator's account cannot be deleted."));
});

test('registering takes a country, and holds usernames to the new rule', async ({ page }) => {
  await AccountServer.install(page, null);
  const send = await open(page);
  const name = 'Choose a username of 3 to 20 letters, numbers or single underscores, not starting or ending with one.';

  for (const username of ['_neel', 'neel_', 'ne__el', 'ne', 'neel!', 'a'.repeat(21)]) {
    expect(await register(username, 'correct horse battery', 'neel@example.com', 'IN', send), username).toEqual(refused(name));
  }
  expect(await register('neel_s', 'short', 'neel@example.com', 'IN', send)).toEqual(refused('Choose a password of at least 8 characters.'));
  expect(data(await register('Neel_S', 'correct horse battery', 'neel@example.com', 'IN', send)).username).toBe('neel_s');
  expect(data(await getAccount(send)).account).toMatchObject({ username: 'neel_s', country: 'IN', rating: 500, league: 'Trekker' });
  // a country that is not a code is stored as none, not refused
  expect(data(await register('sam', 'correct horse battery', 'neel@example.com', 'India', send)).username).toBe('sam');
  expect(data(await getAccount(send)).account?.country).toBeNull();
});

test('the history comes a page at a time with every kind of game, and only an account has games or runs', async ({ page }) => {
  const games = await GamesServer.install(page);
  games.history = historyGames(40);
  const send = await open(page);

  const first = data(await getGames(1, send));
  expect(first).toMatchObject({ page: 1, more: true });
  expect(first.games).toHaveLength(20);
  expect(first.games.slice(0, 6).map((game) => game.kind)).toEqual(['ranked', 'team', 'unranked', 'party', 'daily', 'solo']);
  expect(first.games[0]).toMatchObject({ result: 'win', ratingChange: 18, players: 2 });
  expect(data(await getGames(3, send))).toMatchObject({ page: 3, more: false });
  expect(data(await getGames(3, send)).games).toHaveLength(6);
  expect(await getGames(0, send)).toEqual(refused('Ask for your games by page.'));
  expect(await getGames(1.5, send)).toEqual(refused('Ask for your games by page.'));

  expect(data(await getGame('m-ranked', send))).toMatchObject({ kind: 'ranked', result: 'win', ratingChange: 18, players: 2 });
  expect(await getGame('someone-elses', send)).toEqual(refused('That is not one of your games.'));

  // the wave-5 way of saving a run, by its count and a seed, is no longer taken
  const old = await send('/api/games', { method: 'POST', body: JSON.stringify({ kind: 'streak', streak: 9, seed: 'seed0004' }) });
  expect([old.status, await old.json()]).toEqual([400, { success: false, error: 'That game could not be saved: its details are not valid.' }]);
  expect(games.bestStreak).toBe(7);

  games.session = 'guest';
  expect(await getGames(1, send)).toEqual(refused(GUESTS));
  expect(await startRun('streak', send)).toEqual(refused(GUESTS));
  games.session = 'none';
  expect(await startRun('country', send)).toEqual(refused(SIGN_IN));
});

test('social: presence, boards by period, profiles by range, friends who are online, and requests turned off', async ({ page }) => {
  const social = await SocialServer.install(page);
  const send = await open(page);

  expect(await getOnline(send)).toEqual({ ok: true, data: { online: 37 } });
  expect(social.heartbeats).toBe(1);

  const all = data(await getLeaderboard('rating', 'all', false, send));
  expect(all).toMatchObject({ board: 'rating', period: 'all', you: { rank: 2, value: 1016 } });
  expect(all.entries[0]).toEqual({ rank: 1, username: 'sam', country: 'GB', value: 1540, level: 12, league: 'Nomad' });
  expect(data(await getLeaderboard('rating', 'day', false, send))).toMatchObject({ period: 'day', entries: [{ username: 'ana', value: 31 }, { username: 'neel', value: 16 }] });
  social.boards.all.xp = { entries: boardEntries(140), you: { rank: 120, value: 1881 } };
  expect(data(await getLeaderboard('xp', 'all', false, send)).entries).toHaveLength(100);
  expect(social.asked).toEqual(['leaderboard=rating&period=all', 'leaderboard=rating&period=day', 'leaderboard=xp&period=all']);

  const sam = data(await getProfile('sam', 30, send));
  expect(sam).toMatchObject({ country: 'GB', bestCountry: 9000, bestContinent: 10_000, views: 118, friend: 'none', online: true, duels: { wins: 24, losses: 14, ties: 2, winRate: 60, rank: 1 } });
  expect(sam.history).toHaveLength(4);
  expect(sam.history[0]).toMatchObject({ xpRank: null, ratingRank: null });
  social.profiles = { ...social.profiles, sam: { ...sam, history: Array.from({ length: 40 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, xp: i, rating: 500 + i, xpRank: 40 - i, ratingRank: 40 - i })) } };
  expect(data(await getProfile('sam', 7, send)).history).toHaveLength(7);
  expect(data(await getProfile('sam', 30, send)).history).toHaveLength(30);
  expect(data(await getProfile('sam', 'all', send)).history).toHaveLength(40);
  expect(data(await getProfile('neel', 30, send)).friend).toBe('self');
  expect(await getProfile('nobody', 30, send)).toEqual(refused('No player has that name.'));

  social.friends = { friends: [friend('sam', { country: 'GB', online: true, lastSeenAt: '2026-10-11T11:59:00.000Z' }), friend('ana')], incoming: [], outgoing: [], invites: [] };
  expect(data(await getFriends(send)).friends.map((each) => [each.username, each.country, each.online, each.lastSeenAt])).toEqual([
    ['sam', 'GB', true, '2026-10-11T11:59:00.000Z'],
    ['ana', null, false, null],
  ]);
  social.requestsOff = ['kit'];
  expect(await friendAction('request', 'kit', send)).toEqual(refused('That player is not accepting friend requests.'));
  expect(data(await friendAction('request', 'lee', send)).outgoing).toEqual(['lee']);

  // a visitor reads the boards, a profile and the count, and is told nothing about friendship
  social.session = 'none';
  expect(data(await getLeaderboard('rating', 'all', false, send)).you).toBeNull();
  expect(data(await getProfile('sam', 30, send)).friend).toBeNull();
  expect(await getOnline(send)).toEqual({ ok: true, data: { online: 37 } });
  expect(await getFriends(send)).toEqual(refused(SIGN_IN));
  social.session = 'guest';
  expect(await friendAction('request', 'lee', send)).toEqual(refused(GUESTS));
});

test('maps: the liked list, two descriptions, search by description and maker, and the limits on a save', async ({ page }) => {
  const maps = await MapsServer.install(page);
  const send = await open(page);
  const places = (count: number): MapRow[] => Array.from({ length: count }, (_, i) => [`pano-${String(i).padStart(17, '0')}`, 2 + i * 0.001, 48, 'FR']);
  const needs = 'A map needs a name of 3 to 30 characters, a description of 20 to 100, and 5 to 5000 places.';

  expect(data(await getMaps({ list: 'liked' }, send)).maps).toEqual([]);
  expect(data(await likeMap('paris-walk-x7k2', true, send))).toMatchObject({ liked: true, likes: 4, description: 'Left bank and right, all on foot.' });
  expect(data(await getMaps({ list: 'liked' }, send)).maps.map((map) => map.slug)).toEqual(['paris-walk-x7k2']);
  expect(data(await getMap('paris-walk-x7k2', send)).details).toContain('\n');

  expect(data(await getMaps({ list: 'popular', search: 'on foot' }, send)).maps.map((map) => map.name)).toEqual(['Paris walk']);
  expect(data(await getMaps({ list: 'popular', search: 'neel' }, send)).maps.map((map) => map.name)).toEqual(['My coast']);
  // a search shorter than three characters is ignored
  expect(data(await getMaps({ list: 'popular', search: 'zz' }, send)).maps).toHaveLength(2);

  const good = { name: 'Left bank lanes', description: 'Small streets south of the river.', details: 'Line one.\nLine two.', locations: places(5) };
  expect(await saveMap({ ...good, description: 'Too short.' }, null, send)).toEqual(refused(needs));
  expect(await saveMap({ ...good, name: 'x'.repeat(31) }, null, send)).toEqual(refused(needs));
  expect(await saveMap({ ...good, locations: places(4) }, null, send)).toEqual(refused(needs));
  expect(await saveMap({ ...good, details: 'x'.repeat(1001) }, null, send)).toEqual(refused(needs));
  const made = data(await saveMap(good, null, send));
  expect(made).toMatchObject({ name: 'Left bank lanes', description: 'Small streets south of the river.', details: 'Line one.\nLine two.', places: 5, mine: true });
  // saved again with no long description and as many places as a map may have
  expect(data(await saveMap({ name: good.name, description: good.description, locations: places(5000) }, made.slug, send))).toMatchObject({ places: 5000, details: '' });

  maps.session = 'none';
  expect(await getMaps({ list: 'liked' }, send)).toEqual(refused(SIGN_IN));
  expect(await getMaps({ list: 'mine' }, send)).toEqual(refused(SIGN_IN));
  expect(data(await getMaps({ list: 'popular' }, send)).maps.length).toBeGreaterThan(0);
  maps.session = 'guest';
  expect(await getMaps({ list: 'liked' }, send)).toEqual(refused(GUESTS));
  expect(await likeMap('paris-walk-x7k2', false, send)).toEqual(refused(GUESTS));
});
