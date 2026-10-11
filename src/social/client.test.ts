import { describe, expect, it } from 'vitest';
import {
  friendAction,
  getFriends,
  getLeaderboard,
  getModeration,
  getMyReports,
  getOnline,
  getProfile,
  inviteFriend,
  moderateMap,
  moderatePlayer,
  pendingCount,
  rename,
  reportPlayer,
  REPORT_CATEGORIES,
  type Friends,
  type Leaderboard,
  type Moderation,
  type Profile,
} from './client.ts';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const success = (data: unknown, status = 200) => fakeFetch({ success: true, data }, status);
const failure = (error: string, status: number) => fakeFetch({ success: false, error }, status);
const sentBody = (call: Call | undefined) => JSON.parse(String(call?.init?.body));

const UNEXPECTED = 'The server sent a reply this page could not read. Try again in a moment.';

const board: Leaderboard = {
  board: 'rating',
  period: 'all',
  inactive: false,
  entries: [
    { rank: 1, username: 'sam', country: 'GB', value: 1540, level: 12, league: 'Nomad' },
    { rank: 2, username: 'neel', country: null, value: 1016, level: 3, league: 'Voyager' },
  ],
  you: { rank: 2, value: 1016 },
};

const profile: Profile = {
  username: 'sam',
  country: 'GB',
  joinedAt: '2026-09-01T10:00:00.000Z',
  xp: 36_000,
  level: 13,
  rating: 1540,
  league: 'Nomad',
  ratedGames: 40,
  gamesPlayed: 210,
  bestStreak: 23,
  bestCountry: 9000,
  bestContinent: 10_000,
  duels: { wins: 24, losses: 14, ties: 2, winRate: 60, rank: 3 },
  teams: { wins: 6, losses: 3, ties: 1, winRate: 60 },
  views: 118,
  friend: 'friends',
  online: true,
  lastSeenAt: '2026-10-11T11:59:00.000Z',
  recentGames: [{ id: 'g9', playedAt: '2026-10-10T12:00:00.000Z', map: 'community:tokyo-lanes-a1b2', mode: 'move', rounds: 5, score: 21_000, maxScore: 25_000 }],
  history: [
    { day: '2026-10-09', xp: 35_000, rating: 1520, xpRank: null, ratingRank: null },
    { day: '2026-10-10', xp: 36_000, rating: 1540, xpRank: 5, ratingRank: 3 },
  ],
};

const friends: Friends = {
  friends: [
    { username: 'sam', country: 'GB', level: 13, league: 'Nomad', party: 'ABC123', online: true, lastSeenAt: '2026-10-11T11:59:00.000Z' },
    { username: 'ana', country: null, level: 2, league: 'Trekker', party: null, online: false, lastSeenAt: null },
  ],
  incoming: ['kit'],
  outgoing: ['lee'],
  invites: [{ from: 'sam', code: 'ABC123' }],
};

describe('getLeaderboard', () => {
  it.each(['rating', 'xp', 'streak'] as const)('asks for the %s board over all time', async (name) => {
    const { fetchFn, calls } = success({ ...board, board: name });
    expect(await getLeaderboard(name, 'all', false, fetchFn)).toEqual({ ok: true, data: { ...board, board: name } });
    expect(calls[0]?.url).toBe(`/api/social?leaderboard=${name}&period=all`);
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
  });

  it.each(['rating', 'xp', 'streak'] as const)("asks for the %s board by today's gain", async (name) => {
    const today = { ...board, board: name, period: 'day', entries: [{ rank: 1, username: 'ana', country: 'BR', value: 42, level: 2, league: 'Trekker' }] };
    const { fetchFn, calls } = success(today);
    expect(await getLeaderboard(name, 'day', false, fetchFn)).toEqual({ ok: true, data: today });
    expect(calls[0]?.url).toBe(`/api/social?leaderboard=${name}&period=day`);
  });

  it('asks for the players not seen for 14 days as well, and reads that they were ranked', async () => {
    const everyone = { ...board, inactive: true };
    const { fetchFn, calls } = success(everyone);
    expect(await getLeaderboard('rating', 'all', true, fetchFn)).toEqual({ ok: true, data: everyone });
    expect(calls[0]?.url).toBe('/api/social?leaderboard=rating&period=all&inactive=1');
  });

  it("reads that the day's board never ranks them, whatever was asked", async () => {
    const today = { ...board, period: 'day', inactive: false };
    const { fetchFn, calls } = success(today);
    expect(await getLeaderboard('xp', 'day', true, fetchFn)).toEqual({ ok: true, data: today });
    expect(calls[0]?.url).toBe('/api/social?leaderboard=xp&period=day&inactive=1');
  });

  it('reads a board for a visitor', async () => {
    expect(await getLeaderboard('xp', 'all', false, success({ ...board, you: null }).fetchFn)).toEqual({ ok: true, data: { ...board, you: null } });
  });

  it.each([
    ['a row has no rank', { ...board, entries: [{ username: 'sam', country: null, value: 1, level: 1, league: 'Trekker' }] }],
    ['a row has no country', { ...board, entries: [{ rank: 1, username: 'sam', value: 1, level: 1, league: 'Trekker' }] }],
    ['the period is missing', { ...board, period: undefined }],
    ['the period is not one', { ...board, period: 'week' }],
    ['it does not say whether inactive players were ranked', { ...board, inactive: undefined }],
  ])('refuses a board where %s', async (_name, broken) => {
    expect(await getLeaderboard('xp', 'all', false, success(broken).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it("passes on the server's refusal of a period", async () => {
    const error = 'Ask for a period of all or day.';
    expect(await getLeaderboard('xp', 'all', false, failure(error, 400).fetchFn)).toEqual({ ok: false, error });
  });
});

describe('getOnline', () => {
  it('asks how many players are online, which is also the presence heartbeat', async () => {
    const { fetchFn, calls } = success({ online: 37 });
    expect(await getOnline(fetchFn)).toEqual({ ok: true, data: { online: 37 } });
    expect(calls[0]?.url).toBe('/api/social?online=1');
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
  });

  it('refuses a reply without a count', async () => {
    expect(await getOnline(success({ online: 'many' }).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('getProfile', () => {
  it('asks for a player by name, with thirty days of history unless told otherwise', async () => {
    const { fetchFn, calls } = success(profile);
    expect(await getProfile('s am', undefined, fetchFn)).toEqual({ ok: true, data: profile });
    expect(calls[0]?.url).toBe('/api/social?profile=s%20am&range=30');
  });

  it.each([7, 30, 'all'] as const)('asks for a history of %s', async (range) => {
    const { fetchFn, calls } = success(profile);
    await getProfile('sam', range, fetchFn);
    expect(calls[0]?.url).toBe(`/api/social?profile=sam&range=${range}`);
  });

  it('says so when there is no such player', async () => {
    expect(await getProfile('nobody', 30, failure('No player has that name.', 404).fetchFn)).toEqual({ ok: false, error: 'No player has that name.' });
  });

  it("passes on the server's refusal of a range", async () => {
    const error = 'Ask for a range of 7, 30 or all.';
    expect(await getProfile('sam', 30, failure(error, 400).fetchFn)).toEqual({ ok: false, error });
  });

  it('reads a profile with no history yet, and refuses one without the field', async () => {
    const fresh = { ...profile, history: [] };
    expect(await getProfile('sam', 30, success(fresh).fetchFn)).toEqual({ ok: true, data: fresh });
    expect(await getProfile('sam', 30, success({ ...profile, history: undefined }).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('reads a profile as a visitor sees it: no word on friendship, a player never seen', async () => {
    const seenByVisitor = { ...profile, friend: null, online: false, lastSeenAt: null, country: null };
    expect(await getProfile('sam', 30, success(seenByVisitor).fetchFn)).toEqual({ ok: true, data: seenByVisitor });
  });

  it.each([
    ['a level', { ...profile, level: undefined }],
    ['a country', { ...profile, country: undefined }],
    ['the best guesser scores', { ...profile, bestCountry: undefined }],
    ['the duels', { ...profile, duels: undefined }],
    ['the view count', { ...profile, views: undefined }],
    ['a known standing as a friend', { ...profile, friend: 'blocked' }],
    ['a word on whether the player is online', { ...profile, online: undefined }],
    ['the ranks in its history', { ...profile, history: [{ day: '2026-10-10', xp: 1, rating: 500 }] }],
  ])('refuses a profile without %s', async (_name, broken) => {
    expect(await getProfile('sam', 30, success(broken).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('friends', () => {
  it('asks for the lists', async () => {
    const { fetchFn, calls } = success(friends);
    expect(await getFriends(fetchFn)).toEqual({ ok: true, data: friends });
    expect(calls[0]?.url).toBe('/api/social?friends=1');
  });

  it.each(['request', 'accept', 'decline', 'remove'] as const)('posts %s with the username and returns the lists', async (action) => {
    const { fetchFn, calls } = success(friends);
    expect(await friendAction(action, 'kit', fetchFn)).toEqual({ ok: true, data: friends });
    expect(calls[0]?.url).toBe('/api/social');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(sentBody(calls[0])).toEqual({ action, username: 'kit' });
  });

  it('invites a friend to a party by its code', async () => {
    const { fetchFn, calls } = success(friends);
    expect(await inviteFriend('ana', 'ABC123', fetchFn)).toEqual({ ok: true, data: friends });
    expect(sentBody(calls[0])).toEqual({ action: 'invite', username: 'ana', code: 'ABC123' });
  });

  it("passes on the server's refusal", async () => {
    expect(await friendAction('request', 'kit', failure('You already have 100 friends.', 400).fetchFn)).toEqual({ ok: false, error: 'You already have 100 friends.' });
  });

  it('says so when the player has turned friend requests off', async () => {
    const error = 'That player is not accepting friend requests.';
    expect(await friendAction('request', 'kit', failure(error, 403).fetchFn)).toEqual({ ok: false, error });
  });

  it.each([
    ['a country', { username: 'sam', level: 13, league: 'Nomad', party: null, online: true, lastSeenAt: null }],
    ['a word on whether they are online', { username: 'sam', country: null, level: 13, league: 'Nomad', party: null, lastSeenAt: null }],
    ['when they were last seen', { username: 'sam', country: null, level: 13, league: 'Nomad', party: null, online: false }],
  ])('refuses a friend without %s', async (_name, friend) => {
    expect(await getFriends(success({ ...friends, friends: [friend] }).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('reports a visitor', async () => {
    expect(await getFriends(failure('Sign in first.', 401).fetchFn)).toEqual({ ok: false, error: 'Sign in first.' });
  });

  it('counts what is waiting for an answer', () => {
    expect(pendingCount(friends)).toBe(2);
    expect(pendingCount({ ...friends, incoming: [], invites: [] })).toBe(0);
  });
});

describe('rename', () => {
  it('posts the new name and returns it as the server stored it', async () => {
    const { fetchFn, calls } = success({ username: 'neel2' });
    expect(await rename('Neel2', fetchFn)).toEqual({ ok: true, data: { username: 'neel2' } });
    expect(sentBody(calls[0])).toEqual({ action: 'rename', username: 'Neel2' });
  });

  it('explains a rename that is too soon', async () => {
    expect(await rename('neel2', failure('You can change your name once every 30 days.', 429).fetchFn)).toEqual({
      ok: false,
      error: 'You can change your name once every 30 days.',
    });
  });

  it('refuses a reply that is the friends lists', async () => {
    expect(await rename('neel2', success(friends).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('reports and moderation', () => {
  const queue: Moderation = {
    maps: [{ slug: 'bad-map-a1', name: 'Bad map', maker: 'kit', reports: 2, reasons: ['indoors', ''] }],
    players: [{ username: 'kit', reports: 2, reasons: [{ category: 'chat', note: 'rude in chat' }, { category: 'cheating', note: '' }], banned: false }],
  };

  it('names the four things a report can be about', () => {
    expect(REPORT_CATEGORIES).toEqual(['cheating', 'name', 'chat', 'other']);
  });

  it.each(REPORT_CATEGORIES)('reports a player for %s, with a note', async (category) => {
    const { fetchFn, calls } = success({ reported: true });
    expect(await reportPlayer('kit', category, 'rude in chat', fetchFn)).toEqual({ ok: true, data: { reported: true } });
    expect(calls[0]?.url).toBe('/api/social');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(sentBody(calls[0])).toEqual({ action: 'report', username: 'kit', category, reason: 'rude in chat' });
  });

  it('reports a player with no note', async () => {
    const { fetchFn, calls } = success({ reported: true });
    await reportPlayer('kit', 'cheating', undefined, fetchFn);
    expect(sentBody(calls[0])).toEqual({ action: 'report', username: 'kit', category: 'cheating' });
  });

  it.each([
    ['Say what the report is about: cheating, name, chat or other.', 400],
    ['Too many reports in the last hour. Try again later.', 429],
    ['Sign in first.', 401],
  ])('passes on the refusal "%s"', async (error, status) => {
    expect(await reportPlayer('kit', 'other', '', failure(error, status).fetchFn)).toEqual({ ok: false, error });
  });

  it("asks for the account's own reports and reads where each stands", async () => {
    const mine = {
      reports: [
        { username: 'kit', category: 'chat', note: 'rude in chat', at: '2026-10-11T09:00:00.000Z', status: 'open' },
        { username: 'lee', category: 'cheating', note: '', at: '2026-10-10T09:00:00.000Z', status: 'actioned' },
        { username: 'ana', category: 'name', note: '', at: '2026-10-09T09:00:00.000Z', status: 'dismissed' },
      ],
    };
    const { fetchFn, calls } = success(mine);
    expect(await getMyReports(fetchFn)).toEqual({ ok: true, data: mine });
    expect(calls[0]?.url).toBe('/api/social?reports=1');
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
  });

  it.each([
    ['has a status that is not one', { reports: [{ username: 'kit', category: 'chat', note: '', at: '2026-10-11T09:00:00.000Z', status: 'closed' }] }],
    ['has no date', { reports: [{ username: 'kit', category: 'chat', note: '', status: 'open' }] }],
    ['is not a list', { reports: null }],
  ])('refuses a list of reports that %s', async (_name, data) => {
    expect(await getMyReports(success(data).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it("passes on the refusal for a visitor's reports", async () => {
    expect(await getMyReports(failure('Sign in first.', 401).fetchFn)).toEqual({ ok: false, error: 'Sign in first.' });
  });

  it('asks for what has been reported', async () => {
    const { fetchFn, calls } = success(queue);
    expect(await getModeration(fetchFn)).toEqual({ ok: true, data: queue });
    expect(calls[0]?.url).toBe('/api/social?moderation=1');
  });

  it('is refused for a player who is not a moderator', async () => {
    expect(await getModeration(failure('Moderators only.', 403).fetchFn)).toEqual({ ok: false, error: 'Moderators only.' });
  });

  it.each(['remove', 'dismiss'] as const)('decides on a map: %s', async (decision) => {
    const { fetchFn, calls } = success(queue);
    expect(await moderateMap('bad-map-a1', decision, fetchFn)).toEqual({ ok: true, data: queue });
    expect(sentBody(calls[0])).toEqual({ action: 'moderate', target: 'map', slug: 'bad-map-a1', decision });
  });

  it.each(['ban', 'unban', 'dismiss'] as const)('decides on a player: %s', async (decision) => {
    const { fetchFn, calls } = success(queue);
    expect(await moderatePlayer('kit', decision, fetchFn)).toEqual({ ok: true, data: queue });
    expect(sentBody(calls[0])).toEqual({ action: 'moderate', target: 'player', username: 'kit', decision });
  });

  it("refuses a queue whose players' reasons are the bare notes they used to be", async () => {
    const old = { ...queue, players: [{ username: 'kit', reports: 1, reasons: ['rude in chat'], banned: false }] };
    expect(await getModeration(success(old).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('refuses a queue whose rows are not rows', async () => {
    expect(await getModeration(success({ maps: [{ slug: 'x' }], players: [] }).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});
