import { expect, test } from '@playwright/test';
import { changePassword, deleteAccount, issueRecoveryCode, saveAccountSettings, setCountry, signOutEverywhere } from '../src/account/actions.ts';
import { REFUSALS, getAccount, login, recoverAccount, register, saveGame, type SavedGame } from '../src/account/client.ts';
import { getGames } from '../src/account/games.ts';
import { finishGuesserRun, finishStreak, startRun } from '../src/account/runs.ts';
import { claimDaily, getDaily, startDaily } from '../src/daily/client.ts';
import { continentOf } from '../src/game/continents.ts';
import { createParty, getMatch, getQueue, joinParty, joinQueue, postPlaces } from '../src/multiplayer/client.ts';
import { configureParty } from '../src/multiplayer/party.ts';
import { KIND_SETTINGS, guest, matchState, player, rankedState, settings, viewer } from '../src/multiplayer/testing.ts';
import { friendAction, getFriends, getLeaderboard, getModeration, getMyReports, getProfile, moderatePlayer, rename, reportPlayer, type ReportCategory } from '../src/social/client.ts';
import { countPlay, deleteMap, getMap, getMaps, likeMap, reportMap, saveMap, type MapRow } from '../src/social/maps.ts';
import { AccountServer } from './account-server.ts';
import { GUESTS, SIGN_IN, dailyPlaces, data, googlePlaces, open, openPlaces, refused, roundOn } from './contract-helpers.ts';
import { DailyServer } from './daily-server.ts';
import { endSession } from './fixtures.ts';
import { GamesServer } from './games-server.ts';
import { MapsServer, PARIS } from './maps-server.ts';
import { MatchServer } from './match-server.ts';
import { SocialServer, boardEntries, friend } from './social-server.ts';

/**
 * The wave-6 rules of the account, games, daily, social and maps stand-ins, each driven through
 * the real clients: what the server now checks, refuses and answers, in its own words.
 */

const CODE = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;
const SLOW_DOWN = 'Too many requests. Slow down a little.';
const NOT_ON_MAP = 'That game could not be saved: its places are not on its map.';

/** Three places of the open list in three countries, the first two on different continents. */
function threePlaces() {
  const places = openPlaces();
  const first = places[0]!;
  const second = places.find((place) => continentOf(place) !== null && continentOf(place) !== continentOf(first))!;
  const third = places.find((place) => place.country !== first.country && place.country !== second.country)!;
  return [first, second, third] as const;
}

const game = (rounds: SavedGame['rounds'], change: Partial<SavedGame> = {}): SavedGame => ({ map: 'world', mode: 'move', timeLimit: 0, seed: 'abc123', rounds, ...change });

test('a game is saved only on places of its map, by id, where their list has them', async ({ page }) => {
  await GamesServer.install(page);
  await MapsServer.install(page);
  const send = await open(page);
  const [a, b, c] = threePlaces();

  expect(data(await saveGame(game([roundOn(a, 4000), roundOn(b, 1000)]), send))).toMatchObject({ score: 5000, maxScore: 10_000, rounds: 2, xpEarned: 100, xpCapped: false });
  // within a ten-thousandth of a degree of the list is the same spot; a panorama's own position 100 m off is not
  expect(data(await saveGame(game([{ ...roundOn(a), lng: a.lng + 0.00009 }], { seed: 'near' }), send)).rounds).toBe(1);
  expect(await saveGame(game([{ ...roundOn(a), lat: a.lat + 0.001 }]), send)).toEqual(refused(NOT_ON_MAP));
  expect(await saveGame(game([{ ...roundOn(a), id: 'made-up-place' }]), send)).toEqual(refused(NOT_ON_MAP));
  // no place twice, and all from one list
  expect(await saveGame(game([roundOn(a), roundOn(a)]), send)).toEqual(refused(NOT_ON_MAP));
  expect(await saveGame(game([roundOn(a), roundOn(googlePlaces()[0]!)]), send)).toEqual(refused(NOT_ON_MAP));
  // a country map takes that country's places only
  expect(data(await saveGame(game([roundOn(a)], { map: `country:${a.country}`, seed: 'own' }), send)).map).toBe(`country:${a.country}`);
  expect(await saveGame(game([roundOn(a), roundOn(c)], { map: `country:${a.country}` }), send)).toEqual(refused(NOT_ON_MAP));
  // a round with no id, or half a guess, is not a game
  const invalid = 'That game could not be saved: its details are not valid.';
  expect(await saveGame(game([{ ...roundOn(a), id: undefined as unknown as string }]), send)).toEqual(refused(invalid));
  expect(await saveGame(game([{ ...roundOn(a), guessLat: null }]), send)).toEqual(refused(invalid));

  // a community map: its own places as they are stored now, and no XP
  const [id, lng, lat, country] = PARIS.locations[0]!;
  const onParis = { map: `community:${PARIS.slug}` as const, seed: 'paris' };
  expect(data(await saveGame(game([roundOn({ id, lng, lat, country }, 5000)], onParis), send))).toMatchObject({ score: 5000, xpEarned: 0, xpCapped: false });
  expect(await saveGame(game([roundOn(a)], onParis), send)).toEqual(refused(NOT_ON_MAP));
  expect(await saveGame(game([roundOn({ id, lng, lat, country })], { map: 'community:no-such-map' }), send)).toEqual(refused(NOT_ON_MAP));
});

test("XP from playing alone stops at the day's cap, and the reply says so", async ({ page }) => {
  const games = await GamesServer.install(page);
  const send = await open(page);
  const [a, b] = threePlaces();

  games.xpLeft = 130;
  // 5,000 points are worth 100 XP: the first game fits, the second is cut to what is left, the third earns nothing
  expect(data(await saveGame(game([roundOn(a, 5000)], { seed: 'one' }), send))).toMatchObject({ xpEarned: 100, xpCapped: false });
  expect(data(await saveGame(game([roundOn(a, 5000)], { seed: 'two' }), send))).toMatchObject({ score: 5000, xpEarned: 30, xpCapped: true });
  expect(data(await saveGame(game([roundOn(a, 5000)], { seed: 'three' }), send))).toMatchObject({ score: 5000, xpEarned: 0, xpCapped: true });
  // a run past the cap is saved as usual too
  const run = data(await startRun('country', send)).run;
  expect(data(await finishGuesserRun('country', run, [{ id: a.id, answer: a.country }, { id: b.id, answer: b.country }], send))).toEqual({ best: 2000, correct: 2, xpEarned: 0, xpCapped: true });
  expect(games.history).toHaveLength(9);
});

test('a run is begun on the server, finished with its rounds, counted there, and cannot come too soon', async ({ page }) => {
  const games = await GamesServer.install(page);
  const send = await open(page);
  const [a, b, c] = threePlaces();
  const right = (place: typeof a) => ({ id: place.id, answer: place.country });

  const streak = data(await startRun('streak', send)).run;
  expect(games.starts).toEqual([{ action: 'start', kind: 'streak' }]);
  // two right and then the wrong one: the server counts two
  const rounds = [right(a), right(b), { id: c.id, answer: a.country }];
  games.roundMs = 2000;
  expect(await finishStreak(streak, rounds, false, send)).toEqual(refused(REFUSALS.runTooSoon));
  // three rounds need six seconds
  games.advance(4000);
  expect(await finishStreak(streak, rounds, false, send)).toEqual(refused(REFUSALS.runTooSoon));
  games.advance(2000);
  expect(await finishStreak(streak, rounds, false, send)).toEqual({ ok: true, data: { bestStreak: 7, streak: 2, xpEarned: 40, xpCapped: false } });
  // a run counts once: finished again it is answered with the first result and no XP
  expect(await finishStreak(streak, [right(a), right(b), right(c)], false, send)).toEqual({ ok: true, data: { bestStreak: 7, streak: 2, xpEarned: 0, xpCapped: false } });
  games.roundMs = 0;

  // a streak ends at its first wrong answer, whatever comes after, and no answer is a wrong one
  const second = data(await startRun('streak', send)).run;
  expect(data(await finishStreak(second, [{ id: a.id, answer: null }, right(b), right(c)], false, send)).streak).toBe(0);
  // the streak behind world games sets the best and pays nothing
  const behind = data(await startRun('streak', send)).run;
  const nine = openPlaces().slice(0, 9).map(right);
  expect(await finishStreak(behind, nine, true, send)).toEqual({ ok: true, data: { bestStreak: 9, streak: 9, xpEarned: 0, xpCapped: false } });

  // a token of another kind, or one nobody was given, was not started here
  const notHere = 'That run was not started here.';
  const country = data(await startRun('country', send)).run;
  expect(await finishStreak(country, [right(a)], false, send)).toEqual(refused(notHere));
  expect(await finishGuesserRun('country', 'run.made.up', [right(a)], send)).toEqual(refused(notHere));
  expect(await finishGuesserRun('country', country, [{ id: 'made-up-place', answer: 'FR' }], send)).toEqual(refused('That run could not be saved: its places are not known.'));
  expect(data(await finishGuesserRun('country', country, [right(a), right(b), { id: c.id, answer: a.country }], send))).toEqual({ best: 2000, correct: 2, xpEarned: 40, xpCapped: false });

  const continent = data(await startRun('continent', send)).run;
  const byContinent = [a, b].map((place) => ({ id: place.id, answer: continentOf(place) }));
  expect(data(await finishGuesserRun('continent', continent, [...byContinent, { id: c.id, answer: null }], send))).toMatchObject({ best: 2000, correct: 2 });
  // a continent is not a country, and eleven rounds are not a guesser run
  const invalid = 'That game could not be saved: its details are not valid.';
  expect(await finishGuesserRun('continent', data(await startRun('continent', send)).run, [right(a)], send)).toEqual(refused(invalid));
  expect(await finishGuesserRun('country', data(await startRun('country', send)).run, openPlaces().slice(0, 11).map(right), send)).toEqual(refused(invalid));

  games.startsRefused = true;
  expect(await startRun('streak', send)).toEqual(refused('Too many runs started in the last hour. Try again later.'));
  // the finished runs are the saves; a start saves nothing
  expect(games.saved.every((body) => typeof body.run === 'string')).toBe(true);
});

test('the daily is saved only when begun today, long enough ago, on the places of the day', async ({ page }) => {
  const daily = await DailyServer.install(page);
  await GamesServer.install(page, daily);
  const send = await open(page);
  const todays = dailyPlaces(daily.date);
  const played = (places = todays, scores = [4000, 3000, 2000]): SavedGame => game(places.map((place, index) => roundOn(place, scores[index])), { timeLimit: 180, seed: daily.seed, daily: daily.date });

  expect(await saveGame(played(), send)).toEqual(refused(REFUSALS.dailyUnstarted));
  daily.minMs = 6000;
  expect(await startDaily(send)).toEqual({ ok: true, data: { state: 'started', token: null } });
  expect(await saveGame(played(), send)).toEqual(refused(REFUSALS.dailyTooSoon));
  daily.advance(6000);

  const notTodays = "Those are not today's places.";
  // yesterday's places; three places that keep no rule; a place nobody knows
  expect(await saveGame(played(dailyPlaces('2026-10-10')), send)).toEqual(refused(notTodays));
  expect(await saveGame(played(openPlaces().filter((place) => place.country === todays[0]!.country).slice(0, 3)), send)).toEqual(refused(notTodays));
  expect(await saveGame(played([todays[0]!, todays[1]!, { ...todays[2]!, id: 'made-up-place' }]), send)).toEqual(refused(notTodays));
  expect(await saveGame({ ...played(), seed: 'abc123' }, send)).toEqual(refused("That game could not be saved as a daily challenge: it is not today's."));
  expect(data(await getDaily(1, send)).state).toBe('started');

  // the first daily of an account, on a day two others have finished: no averages, and no personal best
  expect(data(await saveGame(played(), send))).toMatchObject({ score: 9000, xpEarned: 180, xpCapped: false });
  expect(data(await getDaily(1, send)).yours).toEqual({ score: 9000, maxScore: 15_000, rounds: [4000, 3000, 2000], rank: 3, beat: 0, averages: null, personalBest: false });

  // the fifth to finish brings the day's average for each round, the player's own result counted in
  daily.entries = [
    { username: 'sam', country: 'GB', score: 13_000, rounds: [5000, 4000, 4000] },
    { username: 'ana', country: null, score: 9000, rounds: [3000, 3000, 3000] },
    { username: 'kit', country: null, score: 6000, rounds: [2000, 2001, 1999] },
  ];
  expect(data(await getDaily(1, send)).yours?.averages).toBeNull();
  daily.entries = [...daily.entries, { username: 'lee', country: null, score: 3000 }];
  expect(data(await getDaily(1, send)).yours?.averages).toEqual([3000, 2600, 2400]);

  // a personal best is a total above every earlier daily of the account
  daily.history = [{ date: '2026-10-09', score: 8999 }, { date: '2026-10-10', score: null }];
  expect(data(await getDaily(1, send)).yours?.personalBest).toBe(true);
  daily.history = [{ date: '2026-10-09', score: 9000 }];
  expect(data(await getDaily(1, send)).yours?.personalBest).toBe(false);
});

test("a visitor cannot begin the daily, and a new account claims only what a visitor's start once began, on that day's places", async ({ page }) => {
  const daily = await DailyServer.install(page, 'none');
  const send = await open(page);
  const result = (day: string, token: string, places = dailyPlaces(day)) => ({ daily: day, token, rounds: places.map((place) => roundOn(place, 3000)) });

  // playing takes an account: the start is refused, and the daily stays as it was
  expect(await startDaily(send)).toEqual(refused(SIGN_IN));
  expect(data(await getDaily(1, send)).state).toBe('open');
  daily.session = 'guest';
  expect(await startDaily(send)).toEqual(refused(GUESTS));
  // a token as a start was answered with while a visitor could play: this browser kept it with today's result
  const today = { token: daily.tokenFor(daily.date) };

  // the account is made, and offers what the browser kept
  daily.session = 'account';
  daily.startsRefused = true;
  expect(await startDaily(send)).toEqual(refused('Too many dailies started in the last hour. Try again later.'));
  const kept = [
    result('2026-10-10', daily.tokenFor('2026-10-10')),
    // begun on another day than it says; never begun at all; begun, on places that are not that day's
    result('2026-10-09', today.token),
    result('2026-10-08', 'daily.made.up'),
    result('2026-10-07', daily.tokenFor('2026-10-07'), dailyPlaces('2026-10-06')),
    result(daily.date, today.token),
  ];
  expect(await claimDaily(kept, send)).toEqual({ ok: true, data: { claimed: ['2026-10-10', daily.date] } });
  const after = data(await getDaily(1, send));
  expect(after.history).toEqual([{ date: '2026-10-10', score: 9000 }, { date: daily.date, score: 9000 }]);
  expect(after.state).toBe('done');
  // a result kept before starts had tokens has none, and is skipped
  const old = [{ daily: '2026-10-05', rounds: result('2026-10-05', 'x').rounds }] as unknown as Parameters<typeof claimDaily>[0];
  expect(await claimDaily(old, send)).toEqual({ ok: true, data: { claimed: [] } });
});

test('a recovery code is shown once, replaced when issued again and when used, and gets a forgotten password back', async ({ page }) => {
  const account = await AccountServer.install(page, null);
  const send = await open(page);
  const wrong = 'Wrong username or recovery code.';

  account.taken = ['mod'];
  expect(await register('mod', 'correct horse battery', 'neel@example.com', 'IN', send)).toEqual(refused('That username is taken. Choose another, or sign in.'));
  const made = data(await register('neel', 'correct horse battery', 'neel@example.com', 'IN', send));
  expect(made).toEqual({ username: 'neel', recoveryCode: expect.stringMatching(CODE) });
  expect(data(await getAccount(send)).account).toMatchObject({ username: 'neel', hasRecoveryCode: true, hideLastSeen: false, teams: { wins: 0, losses: 0, ties: 0, winRate: 0 } });

  // a new code takes the current password, and replaces the one from sign-up
  expect(await issueRecoveryCode('not it', send)).toEqual(refused('That is not your current password.'));
  const issued = data(await issueRecoveryCode('correct horse battery', send)).recoveryCode;
  expect(issued).toMatch(CODE);
  expect(issued).not.toBe(made.recoveryCode);

  // forgotten: signed out, the old code is nobody's, and the new password is looked at before the code
  expect(data(await signOutEverywhere(send))).toEqual({ signedOut: true });
  expect(await recoverAccount('neel', made.recoveryCode, 'a new password', false, send)).toEqual(refused(wrong));
  expect(await recoverAccount('nobody', issued, 'a new password', false, send)).toEqual(refused(wrong));
  expect(await recoverAccount('neel', made.recoveryCode, 'short', false, send)).toEqual(refused('Choose a new password of 8 to 200 characters.'));
  const version = account.sessionVersion;
  // case, spaces and hyphens in the code do not matter
  const back = data(await recoverAccount('Neel', ` ${issued.toLowerCase().replaceAll('-', ' ')} `, 'a new password', false, send));
  expect(back).toEqual({ username: 'neel', recoveryCode: expect.stringMatching(CODE) });
  expect(back.recoveryCode).not.toBe(issued);
  expect(account.sessionVersion).toBe(version + 1);
  expect(account.password).toBe('a new password');
  expect(data(await getAccount(send)).account?.username).toBe('neel');
  // the code that was used is spent
  expect(await recoverAccount('neel', issued, 'another password', false, send)).toEqual(refused(wrong));

  // a deleted account: the right code says so, and restores it when asked
  data(await deleteAccount('a new password', send));
  expect(await recoverAccount('neel', back.recoveryCode, 'third password', false, send)).toEqual(refused(REFUSALS.deleted));
  expect(await recoverAccount('neel', 'AAAA-AAAA-AAAA', 'third password', true, send)).toEqual(refused(wrong));
  expect(data(await recoverAccount('neel', back.recoveryCode, 'third password', true, send)).username).toBe('neel');
  expect(data(await getAccount(send)).account?.username).toBe('neel');

  // an account from before there were codes has none until it issues one, and cannot be recovered
  account.recoveryCode = null;
  expect(data(await getAccount(send)).account?.hasRecoveryCode).toBe(false);
  data(await signOutEverywhere(send));
  expect(await recoverAccount('neel', back.recoveryCode, 'fourth password', false, send)).toEqual(refused(wrong));
  // sign-in and recovery share one count of tries
  account.locked = true;
  const locked = 'Too many attempts. Try again in 15 minutes.';
  expect(await recoverAccount('neel', back.recoveryCode, 'fourth password', false, send)).toEqual(refused(locked));
  expect(await login('neel', 'third password', send)).toEqual(refused(locked));
});

test('a session ends from elsewhere, and everywhere: after that the browser is answered as a visitor', async ({ page }) => {
  const account = await AccountServer.install(page, 'neel');
  const games = await GamesServer.install(page);
  const daily = await DailyServer.install(page);
  const social = await SocialServer.install(page);
  const maps = await MapsServer.install(page);
  const send = await open(page);

  // a password change ends every other session and keeps this one
  expect(data(await changePassword(account.password, 'a new password', send))).toEqual({ changed: true });
  expect(account.sessionVersion).toBe(1);
  expect(data(await getAccount(send)).account?.username).toBe('neel');
  expect(data(await saveAccountSettings({ hideLastSeen: true }, send))).toEqual({ allowFriendRequests: true, hideChat: false, hideLastSeen: true });
  expect(data(await getAccount(send)).account?.hideLastSeen).toBe(true);

  // the same thing done in another browser ends this one: nothing is said until the next request
  account.endedElsewhere();
  endSession(games, daily, social, maps);
  expect(await setCountry('BR', send)).toEqual(refused(SIGN_IN));
  expect(data(await getAccount(send))).toMatchObject({ account: null, guest: null, stats: null, recentGames: [] });
  expect(await issueRecoveryCode('a new password', send)).toEqual(refused(SIGN_IN));
  expect(await signOutEverywhere(send)).toEqual(refused(SIGN_IN));
  expect(await getGames(1, send)).toEqual(refused(SIGN_IN));
  expect(await startRun('streak', send)).toEqual(refused(SIGN_IN));
  expect(await saveGame(game([roundOn(openPlaces()[0]!)]), send)).toEqual(refused(SIGN_IN));
  expect(await getFriends(send)).toEqual(refused(SIGN_IN));
  expect(await getMyReports(send)).toEqual(refused(SIGN_IN));
  expect(await reportPlayer('kit', 'chat', '', send)).toEqual(refused(SIGN_IN));
  expect(await getMaps({ list: 'mine' }, send)).toEqual(refused(SIGN_IN));
  expect(await claimDaily([{ daily: daily.date, token: 'x', rounds: [] }], send)).toEqual(refused(SIGN_IN));
  expect(await startDaily(send)).toEqual(refused(SIGN_IN));
  // what a visitor may ask still answers
  expect(data(await getLeaderboard('rating', 'all', false, send)).you).toBeNull();

  // signing in again gives a session that counts; "Sign out everywhere" ends this browser's too
  expect(data(await login('neel', 'a new password', send)).username).toBe('neel');
  expect(data(await getAccount(send)).account).toMatchObject({ username: 'neel', hideLastSeen: true });
  expect(data(await signOutEverywhere(send))).toEqual({ signedOut: true });
  expect(account.sessionVersion).toBe(3);
  expect(data(await getAccount(send)).account).toBeNull();

  // country and settings are held to 120 an hour
  data(await login('neel', 'a new password', send));
  account.slowDown = true;
  expect(await setCountry('BR', send)).toEqual(refused(SLOW_DOWN));
  expect(await saveAccountSettings({ hideChat: true }, send)).toEqual(refused(SLOW_DOWN));
});

test('a report has a category and a place under My reports, where a moderator\'s decision shows', async ({ page }) => {
  const social = await SocialServer.install(page);
  const send = await open(page);

  expect(data(await getMyReports(send))).toEqual({ reports: [] });
  expect(await reportPlayer('kit', undefined as unknown as ReportCategory, 'rude', send)).toEqual(refused('Say what the report is about: cheating, name, chat or other.'));
  expect(await reportPlayer('kit', 'spam' as ReportCategory, 'rude', send)).toEqual(refused('Say what the report is about: cheating, name, chat or other.'));
  expect(await reportPlayer('kit', 'chat', 'x'.repeat(201), send)).toEqual(refused('A reason is up to 200 characters.'));
  expect(await reportPlayer('neel', 'other', '', send)).toEqual(refused('You cannot report yourself.'));
  expect(await reportPlayer('no such name!', 'other', '', send)).toEqual(refused('No player by that name.'));

  expect(data(await reportPlayer('kit', 'chat', 'rude in chat', send))).toEqual({ reported: true });
  expect(data(await reportPlayer('lee', 'cheating', undefined, send))).toEqual({ reported: true });
  expect(social.posted('report').at(-1)).toEqual({ action: 'report', username: 'lee', category: 'cheating' });
  const mine = data(await getMyReports(send)).reports;
  expect(mine.map((each) => [each.username, each.category, each.note, each.status])).toEqual([
    ['lee', 'cheating', '', 'open'],
    ['kit', 'chat', 'rude in chat', 'open'],
  ]);
  expect(Date.parse(mine[0]!.at)).not.toBeNaN();

  // the moderators' queue names what each open report is about
  expect(data(await getModeration(send)).players[0]).toEqual({
    username: 'kit',
    reports: 3,
    reasons: [{ category: 'chat', note: 'rude in chat' }, { category: 'other', note: 'left every game' }, { category: 'cheating', note: '' }],
    banned: false,
  });
  // a ban is action taken, and leaves no report of that player open; dismissing is dismissed
  expect(data(await moderatePlayer('kit', 'ban', send)).players[0]).toEqual({ username: 'kit', reports: 0, reasons: [], banned: true });
  data(await moderatePlayer('lee', 'dismiss', send));
  expect(data(await getMyReports(send)).reports.map((each) => [each.username, each.status])).toEqual([['lee', 'dismissed'], ['kit', 'actioned']]);
  // lifting the ban changes nothing here; reporting the player again replaces the report and opens it
  data(await moderatePlayer('kit', 'unban', send));
  expect(data(await getMyReports(send)).reports[1]?.status).toBe('actioned');
  data(await reportPlayer('kit', 'name', '', send));
  expect(data(await getMyReports(send)).reports.map((each) => [each.username, each.category, each.status])).toEqual([['kit', 'name', 'open'], ['lee', 'cheating', 'dismissed']]);

  social.session = 'guest';
  expect(await getMyReports(send)).toEqual(refused(GUESTS));
});

test('the 2v2 record, a hidden last seen, inactive players on the boards, and the limits on social writes', async ({ page }) => {
  const social = await SocialServer.install(page);
  const send = await open(page);

  social.profiles = { ...social.profiles, sam: { ...social.profiles.sam!, teams: { wins: 6, losses: 3, ties: 1, winRate: 60 } } };
  expect(data(await getProfile('sam', 30, send))).toMatchObject({ teams: { wins: 6, losses: 3, ties: 1, winRate: 60 }, online: true, lastSeenAt: '2026-10-11T11:59:00.000Z' });
  expect(data(await getProfile('neel', 30, send)).teams).toEqual({ wins: 0, losses: 0, ties: 0, winRate: 0 });

  // a player who hides it is still online or not, and nothing more; they see their own
  social.friends = { friends: [friend('sam', { online: true, lastSeenAt: '2026-10-11T11:59:00.000Z' }), friend('ana', { lastSeenAt: '2026-10-10T08:00:00.000Z' })], incoming: ['kit'], outgoing: [], invites: [] };
  social.hideLastSeen = ['sam', 'neel'];
  social.profiles = { ...social.profiles, neel: { ...social.profiles.neel!, lastSeenAt: '2026-10-11T12:00:00.000Z' } };
  expect(data(await getProfile('sam', 30, send))).toMatchObject({ online: true, lastSeenAt: null });
  expect(data(await getProfile('neel', 30, send)).lastSeenAt).toBe('2026-10-11T12:00:00.000Z');
  expect(data(await getFriends(send)).friends.map((each) => [each.username, each.online, each.lastSeenAt])).toEqual([
    ['sam', true, null],
    ['ana', false, '2026-10-10T08:00:00.000Z'],
  ]);

  // the all-time boards leave out players not seen for 14 days unless they are asked for; the day's board has none to add
  social.boards.all.xp = { entries: boardEntries(5), you: null };
  social.inactive = ['player002', 'player004'];
  const active = data(await getLeaderboard('xp', 'all', false, send));
  expect(active.inactive).toBe(false);
  expect(active.entries.map((each) => [each.rank, each.username])).toEqual([[1, 'player001'], [2, 'player003'], [3, 'player005']]);
  const everyone = data(await getLeaderboard('xp', 'all', true, send));
  expect(everyone.inactive).toBe(true);
  expect(everyone.entries).toHaveLength(5);
  expect(data(await getLeaderboard('rating', 'day', true, send)).inactive).toBe(false);
  expect(social.asked.slice(-3)).toEqual(['leaderboard=xp&period=all', 'leaderboard=xp&period=all&inactive=1', 'leaderboard=rating&period=day&inactive=1']);

  // a moderator's name is taken, like anyone's
  social.taken = ['mod'];
  expect(await rename('Mod', send)).toEqual(refused('That username is taken. Choose another.'));
  expect(data(await rename('Neel_S', send))).toEqual({ username: 'neel_s' });

  // accepting, declining and removing are held to 120 an hour; asking is not
  social.slowDown = true;
  for (const action of ['accept', 'decline', 'remove'] as const) {
    expect(await friendAction(action, 'kit', send)).toEqual(refused(SLOW_DOWN));
  }
  expect(data(await friendAction('request', 'lee', send)).outgoing).toEqual(['lee']);
  social.refuse = 'Too many reports in the last hour. Try again later.';
  social.refuseStatus = 429;
  expect(await reportPlayer('kit', 'chat', '', send)).toEqual(refused('Too many reports in the last hour. Try again later.'));
});

test("maps: an account's maps hold 25,000 places in all, and the map of a banned or deleted maker is gone for everyone else", async ({ page }) => {
  const maps = await MapsServer.install(page);
  const send = await open(page);
  const places = (count: number, prefix: string): MapRow[] => Array.from({ length: count }, (_, i) => [`${prefix}-${String(i).padStart(16, '0')}`, 2 + i * 0.0001, 48, 'FR']);
  const content = (name: string, count: number) => ({ name, description: 'Small streets south of the river.', locations: places(count, name.slice(0, 4).toLowerCase()) });
  const full = "An account's maps can hold 25,000 places in all. Make this one smaller, or delete another.";

  // "My coast" has five places already: four maps of 5,000 leave room for 4,995 more
  const made = await Promise.all(['Alpha map', 'Bravo map', 'Delta map', 'Gamma map'].map(async (name) => data(await saveMap(content(name, 5000), null, send))));
  expect(await saveMap(content('Sigma map', 4996), null, send)).toEqual(refused(full));
  expect(data(await saveMap(content('Sigma map', 4995), null, send)).places).toBe(4995);
  // saving over one of the account's own counts it as it will be, not twice
  expect(data(await saveMap(content('Alpha map', 5000), made[0]!.slug, send)).places).toBe(5000);
  expect(data(await saveMap(content('Alpha map', 100), made[0]!.slug, send)).places).toBe(100);
  expect(data(await saveMap(content('Omega map', 4900), null, send)).places).toBe(4900);
  expect(await saveMap(content('Extra map', 5), null, send)).toEqual(refused(full));

  maps.slowDown = true;
  expect(await deleteMap(made[1]!.slug, send)).toEqual(refused(SLOW_DOWN));
  maps.slowDown = false;
  expect(data(await deleteMap(made[1]!.slug, send))).toEqual({ deleted: true });

  // sam is banned: the map is not served by slug, though its maker would still get it
  maps.gone = ['sam', 'neel'];
  expect(await getMap(PARIS.slug, send)).toEqual(refused('There is no such map.'));
  expect(await likeMap(PARIS.slug, true, send)).toEqual(refused('There is no such map.'));
  expect(await reportMap(PARIS.slug, 'gone', send)).toEqual(refused('There is no such map.'));
  expect(await countPlay(PARIS.slug, send)).toEqual(refused('There is no such map.'));
  expect(data(await getMap('my-coast-q1w2', send)).mine).toBe(true);
});

// --- the match stand-in, by the wave-6 contract (sections 3 and 4) ---------------------------------

const NOT_THE_RESOLVER = 'Only the player picking the places can post them.';
const NOT_THIS_MAP = "Those places are not on this match's map.";
const TOO_FEW_CONTINENTS = 'A world game needs places on at least three continents.';

/** Five places of the open list on three continents, and five that are all in Europe. */
function matchPlaces() {
  const open = openPlaces();
  const on = (continent: string, count: number) => open.filter((place) => continentOf(place) === continent).slice(0, count);
  return { spread: [...on('europe', 3), ...on('asia', 1), ...on('south-america', 1)], europe: on('europe', 5) };
}

test('places are taken from the resolver alone, checked in the server\'s order, and sent back a round at a time', async ({ page }) => {
  const match = await MatchServer.install(page);
  const send = await open(page);
  const { spread, europe } = matchPlaces();
  const preparing = (change = {}) => rankedState({ phase: 'preparing', ...change });

  match.state = preparing({ you: viewer() });
  expect(await postPlaces('m1', spread, send)).toEqual(refused(NOT_THE_RESOLVER));
  // a match that is not waiting for places answers with itself, unchanged
  match.state = matchState();
  expect(data(await postPlaces('m1', spread, send))).toMatchObject({ phase: 'lobby', places: null });

  match.state = preparing();
  expect(await postPlaces('m1', spread.slice(0, 4), send)).toEqual(refused('This match needs exactly 5 places.'));
  expect(await postPlaces('m1', [...spread.slice(0, 4), spread[0]!], send)).toEqual(refused(NOT_THIS_MAP));
  expect(await postPlaces('m1', [...spread.slice(0, 4), { ...spread[4]!, id: 'no-such-place' }], send)).toEqual(refused(NOT_THIS_MAP));
  // a place is taken where its list has it, within 0.0001 degrees: not where its picture turned out to be
  expect(await postPlaces('m1', [...spread.slice(0, 4), { ...spread[4]!, lng: spread[4]!.lng + 0.001 }], send)).toEqual(refused(NOT_THIS_MAP));
  // all from the same file
  expect(await postPlaces('m1', [...spread.slice(0, 4), googlePlaces()[0]!], send)).toEqual(refused(NOT_THIS_MAP));
  expect(await postPlaces('m1', europe, send)).toEqual(refused(TOO_FEW_CONTINENTS));
  // a refused post changes nothing, and the resolver may post again
  expect(data(await getMatch('m1', send))).toMatchObject({ phase: 'preparing', places: null });

  const nudged = [...spread.slice(0, 4), { ...spread[4]!, lat: spread[4]!.lat + 0.00005 }];
  const taken = data(await postPlaces('m1', nudged, send));
  // only the first round's place comes back, on the list's own coordinates
  expect(taken).toMatchObject({ phase: 'playing', round: 0, places: [spread[0]] });
  // a second post, once places are in, answers with the match as it is
  expect(data(await postPlaces('m1', europe, send)).places).toEqual([spread[0]]);
  match.reveal(0, 0);
  expect(data(await getMatch('m1', send)).places).toEqual([spread[0]]);
  match.startRound(1);
  expect(data(await getMatch('m1', send)).places).toEqual(spread.slice(0, 2));
  match.startRound(4);
  expect(data(await getMatch('m1', send)).places).toEqual(spread);

  // a party is not held to three continents, nor is a game of fewer than three rounds
  match.state = matchState({ phase: 'preparing', settings: settings({ rounds: 5 }) });
  expect(data(await postPlaces('m1', europe, send))).toMatchObject({ phase: 'playing', places: [europe[0]] });
  match.state = preparing({ settings: settings({ rounds: 2 }) });
  expect(data(await postPlaces('m1', europe.slice(0, 2), send)).phase).toBe('playing');

  // a guest left from before playing took an account posts nothing, resolver or not
  match.session = 'guest';
  match.state = matchState({ kind: 'unranked', code: null, phase: 'preparing', settings: KIND_SETTINGS.unranked, you: viewer({ username: 'Guest #4821', guest: true, isResolver: true }), players: [guest(4821), player('sam')] });
  expect(await postPlaces('m1', spread, send)).toEqual(refused(GUESTS));
});

test('no party lets a guest in, the ranked search stops widening at 400, and a queue names its typical wait', async ({ page }) => {
  const match = await MatchServer.install(page);
  const send = await open(page);
  const chosen = { map: 'world', mode: 'move', timeLimit: 60, rounds: 5 } as const;

  // left out, guests may join; a queue's game always says so
  expect(data(await createParty(chosen, send)).settings.guests).toBe(true);
  expect(KIND_SETTINGS.ranked.guests).toBe(true);
  expect(data(await createParty({ ...chosen, guests: false }, send)).settings.guests).toBe(false);
  expect(await configureParty('m1', { ...chosen, guests: 'no' as unknown as boolean }, send)).toEqual(refused('Choose a map, a mode, 1 to 20 rounds, and no timer or 10 to 300 seconds a round.'));

  // a guest left from before playing took an account is turned away whatever the party's setting says
  match.session = 'guest';
  for (const guests of [false, true]) {
    match.state = matchState({ settings: settings({ guests }), you: viewer({ username: 'Guest #4821', guest: true }), players: [player('sam')] });
    expect(await joinParty('ABC123', send)).toEqual(refused(GUESTS));
  }
  // one already in a party stays in its list until they leave
  match.state = matchState({ settings: settings({ guests: false }), you: viewer({ username: 'Guest #4821', guest: true }), players: [player('sam'), guest(4821)] });
  expect(data(await getMatch('m1', send)).players.map((each) => each.username)).toEqual(['sam', 'Guest #4821']);

  match.session = 'account';
  expect(data(await getQueue(send))).toMatchObject({ queued: false, kind: null, typicalWaitSeconds: null });
  match.typicalWait = 95;
  expect(data(await getQueue(send)).typicalWaitSeconds).toBeNull();
  expect(data(await joinQueue('ranked', send))).toMatchObject({ kind: 'ranked', window: 50, typicalWaitSeconds: 95 });
  match.queue = { ...match.queue, since: match.time(-20_000) };
  expect(data(await getQueue(send)).window).toBe(250);
  match.queue = { ...match.queue, since: match.time(-75_000) };
  expect(data(await getQueue(send)).window).toBe(400);
  match.typicalWait = null;
  expect(data(await getQueue(send)).typicalWaitSeconds).toBeNull();
});
