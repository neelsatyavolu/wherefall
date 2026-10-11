import { describe, expect, it } from 'vitest';
import { REFUSALS, getAccount, getGame, login, logout, recoverAccount, register, restoreAccount, saveGame, type AccountState, type GameDetail, type SavedGame } from './client.ts';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that answers every call with one canned reply and remembers what it was asked. */
function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return reply();
  };
  return { fetchFn: fetchFn as typeof fetch, calls };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const success = (data: unknown, status = 200) => json({ success: true, data }, status);
const failure = (error: string, status: number) => json({ success: false, error }, status);

const UNREACHABLE = 'Could not reach the server. Check your connection and try again.';
const UNEXPECTED = 'The server sent a reply this page could not read. Try again in a moment.';

const game: SavedGame = {
  map: 'world',
  mode: 'nmpz',
  timeLimit: 60,
  seed: 'abc123',
  rounds: [
    { id: 'fr-01', lng: 2.35, lat: 48.85, guessLng: 2.5, guessLat: 48.9, country: 'FR', distanceKm: 12.5, score: 4800 },
    { id: 'jp-01', lng: 139.69, lat: 35.69, guessLng: null, guessLat: null, country: 'JP', distanceKm: null, score: 0 },
  ],
};

const savedReply = { playedAt: '2026-10-10T12:00:00.000Z', map: 'world', mode: 'nmpz', rounds: 2, score: 4800, maxScore: 10_000, xpEarned: 96, xpCapped: false };
const recentGame = { id: 'g1', playedAt: '2026-10-10T12:00:00.000Z', map: 'world', mode: 'nmpz', rounds: 2, score: 4800, maxScore: 10_000 };

const signedIn: AccountState = {
  account: {
    username: 'neel',
    country: 'IN',
    rating: 1016,
    xp: 1200,
    level: 3,
    league: 'Voyager',
    bestStreak: 7,
    bestCountry: 8000,
    bestContinent: 10_000,
    loginStreak: 4,
    duels: { wins: 5, losses: 3, ties: 1, winRate: 55, rank: 12 },
    teams: { wins: 4, losses: 2, ties: 2, winRate: 50 },
    moderator: false,
    banned: false,
    allowFriendRequests: true,
    hideChat: false,
    hideLastSeen: false,
    hasRecoveryCode: true,
  },
  guest: null,
  stats: {
    gamesPlayed: 1,
    roundsPlayed: 2,
    averageRoundScore: 2400,
    bestRoundScore: 4800,
    perfectRounds: 0,
    bestGame: { score: 4800, maxScore: 10_000 },
    ratedGames: 1,
  },
  recentGames: [{ ...recentGame, map: 'world', mode: 'nmpz' }],
};

describe('getAccount', () => {
  it('asks the server who is signed in', async () => {
    const { fetchFn, calls } = fakeFetch(success(signedIn));
    expect(await getAccount(fetchFn)).toEqual({ ok: true, data: signedIn });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/account');
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it('reads the signed-out answer', async () => {
    const signedOut = { account: null, guest: null, stats: null, recentGames: [] };
    expect(await getAccount(fakeFetch(success(signedOut)).fetchFn)).toEqual({ ok: true, data: signedOut });
  });

  it('reads a guest: no account, only the guest name', async () => {
    const guest = { account: null, guest: 'Guest #4821', stats: null, recentGames: [] };
    expect(await getAccount(fakeFetch(success(guest)).fetchFn)).toEqual({ ok: true, data: guest });
  });

  it('reads an account with no country and no place on the rating board', async () => {
    const plain = { ...signedIn, account: { ...signedIn.account, country: null, duels: { wins: 0, losses: 0, ties: 0, winRate: 0, rank: null } } };
    expect(await getAccount(fakeFetch(success(plain)).fetchFn)).toEqual({ ok: true, data: plain });
  });

  it('reads a player with no games yet', async () => {
    const fresh = { ...signedIn, stats: { ...signedIn.stats, gamesPlayed: 0, bestGame: null }, recentGames: [] };
    expect(await getAccount(fakeFetch(success(fresh)).fetchFn)).toEqual({ ok: true, data: fresh });
  });

  it.each([
    ['stats are missing', { account: signedIn.account, recentGames: [] }],
    ['the rating is missing', { ...signedIn, account: { ...signedIn.account, rating: undefined } }],
    ['the XP is missing', { ...signedIn, account: { ...signedIn.account, xp: undefined } }],
    ['the league is missing', { ...signedIn, account: { ...signedIn.account, league: undefined } }],
    ['the best streak is missing', { ...signedIn, account: { ...signedIn.account, bestStreak: undefined } }],
    ['the moderator flag is missing', { ...signedIn, account: { ...signedIn.account, moderator: undefined } }],
    ['the banned flag is missing', { ...signedIn, account: { ...signedIn.account, banned: undefined } }],
    ['the guest name is missing', { ...signedIn, guest: undefined }],
    ['the country is missing', { ...signedIn, account: { ...signedIn.account, country: undefined } }],
    ['the country is not a two-letter code', { ...signedIn, account: { ...signedIn.account, country: 'India' } }],
    ['the best Country Guesser score is missing', { ...signedIn, account: { ...signedIn.account, bestCountry: undefined } }],
    ['the best Continent Guesser score is missing', { ...signedIn, account: { ...signedIn.account, bestContinent: undefined } }],
    ['the login streak is missing', { ...signedIn, account: { ...signedIn.account, loginStreak: undefined } }],
    ['the duels are missing', { ...signedIn, account: { ...signedIn.account, duels: undefined } }],
    ['the win rate is missing', { ...signedIn, account: { ...signedIn.account, duels: { ...signedIn.account?.duels, winRate: undefined } } }],
    ['the friend request switch is missing', { ...signedIn, account: { ...signedIn.account, allowFriendRequests: undefined } }],
    ['the hide chat switch is missing', { ...signedIn, account: { ...signedIn.account, hideChat: undefined } }],
    ['the 2v2 record is missing', { ...signedIn, account: { ...signedIn.account, teams: undefined } }],
    ['the 2v2 record has no ties', { ...signedIn, account: { ...signedIn.account, teams: { wins: 1, losses: 0, winRate: 100 } } }],
    ['the last seen switch is missing', { ...signedIn, account: { ...signedIn.account, hideLastSeen: undefined } }],
    ['it does not say whether there is a recovery code', { ...signedIn, account: { ...signedIn.account, hasRecoveryCode: undefined } }],
    ['a recent game has no id', { ...signedIn, recentGames: [{ ...recentGame, id: undefined }] }],
    ['a recent game is on a map that is not one', { ...signedIn, recentGames: [{ ...recentGame, map: 'country:france' }] }],
    ['the rated game count is missing', { ...signedIn, stats: { ...signedIn.stats, ratedGames: undefined } }],
    ['a count is text', { ...signedIn, stats: { ...signedIn.stats, gamesPlayed: 'one' } }],
    ['a game has an unknown mode', { ...signedIn, recentGames: [{ ...recentGame, mode: 'fly' }] }],
    ['the account has no name', { ...signedIn, account: {} }],
  ])('refuses a reply where %s', async (_name, data) => {
    expect(await getAccount(fakeFetch(success(data)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

const registerPlain = (username: string, password: string, fetchFn: typeof fetch) => register(username, password, undefined, fetchFn);

const CODE = 'K7QM-2XHD-9RWP';

describe.each([
  ['register', registerPlain, '/api/account/register', 201, { username: 'neel', recoveryCode: CODE }],
  ['login', login, '/api/account/login', 200, { username: 'neel' }],
] as const)('%s', (_name, send, path, status, reply) => {
  it('posts the username and password as JSON', async () => {
    const { fetchFn, calls } = fakeFetch(success(reply, status));
    expect(await send('Neel', 'correct horse battery', fetchFn)).toEqual({ ok: true, data: reply });
    expect(calls[0]?.url).toBe(path);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ username: 'Neel', password: 'correct horse battery' });
  });

  it("passes on the server's own explanation when it refuses", async () => {
    const { fetchFn } = fakeFetch(failure('Too many attempts. Try again in 15 minutes.', 429));
    expect(await send('neel', 'pw', fetchFn)).toEqual({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' });
  });

  it('refuses a success reply without a username', async () => {
    expect(await send('neel', 'pw', fakeFetch(success({})).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('register with a country', () => {
  it('sends the country along', async () => {
    const { fetchFn, calls } = fakeFetch(success({ username: 'neel', recoveryCode: CODE }, 201));
    expect(await register('neel', 'correct horse battery', 'IN', fetchFn)).toEqual({ ok: true, data: { username: 'neel', recoveryCode: CODE } });
    expect(calls[0]?.url).toBe('/api/account/register');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ username: 'neel', password: 'correct horse battery', country: 'IN' });
  });

  it('refuses a reply without the recovery code, which is shown only then', async () => {
    expect(await register('neel', 'correct horse battery', 'IN', fakeFetch(success({ username: 'neel' }, 201)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it("passes on the refusal for a name that is taken, which is also a moderator's", async () => {
    const taken = 'That username is taken. Choose another, or sign in.';
    expect(await register('mod', 'correct horse battery', 'IN', fakeFetch(failure(taken, 409)).fetchFn)).toEqual({ ok: false, error: taken });
  });

  it('sends no country when none could be guessed', async () => {
    const { fetchFn, calls } = fakeFetch(success({ username: 'neel', recoveryCode: CODE }, 201));
    await register('neel', 'correct horse battery', null, fetchFn);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ username: 'neel', password: 'correct horse battery', country: null });
  });

  it("passes on the server's word on a bad username", async () => {
    const refusal = 'Choose a username of 3 to 20 letters, numbers or single underscores, not starting or ending with one.';
    expect(await register('_neel', 'correct horse battery', 'IN', fakeFetch(failure(refusal, 400)).fetchFn)).toEqual({ ok: false, error: refusal });
  });
});

describe('restoreAccount', () => {
  it('signs in to a deleted account, asking for it to be restored', async () => {
    const { fetchFn, calls } = fakeFetch(success({ username: 'neel' }));
    expect(await restoreAccount('neel', 'correct horse battery', fetchFn)).toEqual({ ok: true, data: { username: 'neel' } });
    expect(calls[0]?.url).toBe('/api/account/login');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ username: 'neel', password: 'correct horse battery', restore: true });
  });

  it('login passes on the refusal that says the account was deleted', async () => {
    const refusal = 'This account was deleted. Restore it to sign in.';
    expect(await login('neel', 'correct horse battery', fakeFetch(failure(refusal, 409)).fetchFn)).toEqual({ ok: false, error: refusal });
  });

  it('names the refusals a screen has to tell apart, word for word as the server sends them', async () => {
    expect(REFUSALS).toEqual({
      signIn: 'Sign in first.',
      guests: 'Guests cannot do that. Make an account first.',
      deleted: 'This account was deleted. Restore it to sign in.',
      removed: 'You were removed from that party.',
      accountsOnly: 'This party is for accounts only. Make an account to join.',
      runTooSoon: 'That run finished sooner than it could have been played.',
      dailyTooSoon: 'That daily finished sooner than it could have been played.',
      dailyUnstarted: 'Start the daily before you finish it.',
      slowDown: 'Too many requests. Slow down a little.',
    });
    const result = await login('neel', 'correct horse battery', fakeFetch(failure('This account was deleted. Restore it to sign in.', 409)).fetchFn);
    expect(!result.ok && result.error === REFUSALS.deleted).toBe(true);
  });
});

describe('recoverAccount', () => {
  const fresh = { username: 'neel', recoveryCode: 'A2B3-C4D5-E6F7' };

  it('signs in with the recovery code and a new password, and returns the new code', async () => {
    const { fetchFn, calls } = fakeFetch(success(fresh));
    expect(await recoverAccount('Neel', 'k7qm 2xhd-9rwp', 'a new password', false, fetchFn)).toEqual({ ok: true, data: fresh });
    expect(calls[0]?.url).toBe('/api/account/login');
    expect(calls[0]?.init?.method).toBe('POST');
    // the code goes as typed: the server reads past case, spaces and hyphens
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ username: 'Neel', recoveryCode: 'k7qm 2xhd-9rwp', newPassword: 'a new password' });
  });

  it('asks for a deleted account to be restored', async () => {
    const { fetchFn, calls } = fakeFetch(success(fresh));
    await recoverAccount('neel', CODE, 'a new password', true, fetchFn);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ username: 'neel', recoveryCode: CODE, newPassword: 'a new password', restore: true });
  });

  it.each([
    ['Wrong username or recovery code.', 401],
    ['Choose a new password of 8 to 200 characters.', 400],
    ['Too many attempts. Try again in 15 minutes.', 429],
    [REFUSALS.deleted, 409],
  ])('passes on the refusal "%s"', async (refusal, status) => {
    expect(await recoverAccount('neel', CODE, 'a new password', false, fakeFetch(failure(refusal, status)).fetchFn)).toEqual({ ok: false, error: refusal });
  });

  it('refuses a reply without the new code', async () => {
    expect(await recoverAccount('neel', CODE, 'a new password', false, fakeFetch(success({ username: 'neel' })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('logout', () => {
  it('posts to the logout route', async () => {
    const { fetchFn, calls } = fakeFetch(success({ signedIn: false }));
    expect(await logout(fetchFn)).toEqual({ ok: true, data: { signedIn: false } });
    expect(calls[0]?.url).toBe('/api/account/logout');
    expect(calls[0]?.init?.method).toBe('POST');
  });
});

describe('saveGame', () => {
  it('posts the finished game exactly as given and returns what was saved', async () => {
    const { fetchFn, calls } = fakeFetch(success(savedReply, 201));
    expect(await saveGame(game, fetchFn)).toEqual({ ok: true, data: savedReply });
    expect(calls[0]?.url).toBe('/api/games');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(game);
  });

  it('sends the day along for a daily challenge', async () => {
    const { fetchFn, calls } = fakeFetch(success(savedReply, 201));
    await saveGame({ ...game, daily: '2026-10-11' }, fetchFn);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ ...game, daily: '2026-10-11' });
  });

  it('reports that the player is signed out', async () => {
    expect(await saveGame(game, fakeFetch(failure('Sign in first.', 401)).fetchFn)).toEqual({ ok: false, error: 'Sign in first.' });
  });

  it('refuses a reply that is not a saved game', async () => {
    expect(await saveGame(game, fakeFetch(success({ saved: true })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('the fields added for history, streaks and country maps', () => {
  it('sends the id and place of each round, its guess and its hint', async () => {
    const detailed: SavedGame = {
      ...game,
      map: 'country:FR',
      rounds: [
        { id: 'fr-01', country: 'FR', distanceKm: 12.5, score: 2400, lng: 2.35, lat: 48.85, guessLng: 2.5, guessLat: 48.9, hinted: true },
        { id: 'fr-02', country: 'FR', distanceKm: null, score: 0, lng: 5.37, lat: 43.3, guessLng: null, guessLat: null, hinted: false },
      ],
    };
    const { fetchFn, calls } = fakeFetch(success({ ...savedReply, map: 'country:FR' }, 201));
    expect(await saveGame(detailed, fetchFn)).toEqual({ ok: true, data: { ...savedReply, map: 'country:FR' } });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(detailed);
  });

  it('refuses a save reply without the XP earned', async () => {
    expect(await saveGame(game, fakeFetch(success(recentGame, 201)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('refuses a save reply that does not say whether the XP was capped', async () => {
    expect(await saveGame(game, fakeFetch(success({ ...savedReply, xpCapped: undefined }, 201)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('reads a game saved past the day\'s XP cap: saved as usual, with the XP cut', async () => {
    const capped = { ...savedReply, xpEarned: 0, xpCapped: true };
    expect(await saveGame(game, fakeFetch(success(capped, 201)).fetchFn)).toEqual({ ok: true, data: capped });
  });

  it.each([
    ['That game could not be saved: its places are not on its map.', 400],
    ["Those are not today's places.", 400],
    [REFUSALS.dailyUnstarted, 409],
    [REFUSALS.dailyTooSoon, 409],
  ])('passes on the refusal "%s"', async (refusal, status) => {
    expect(await saveGame(game, fakeFetch(failure(refusal, status)).fetchFn)).toEqual({ ok: false, error: refusal });
  });

  it('reads an account whose recent game was on a community map', async () => {
    const withCommunity = { ...signedIn, recentGames: [{ ...recentGame, map: 'community:paris-walk-x7k2' }] };
    expect(await getAccount(fakeFetch(success(withCommunity)).fetchFn)).toEqual({ ok: true, data: withCommunity });
  });

  it('reads an account whose recent game was on a country map', async () => {
    const withCountry = { ...signedIn, recentGames: [{ ...recentGame, map: 'country:JP' }] };
    expect(await getAccount(fakeFetch(success(withCountry)).fetchFn)).toEqual({ ok: true, data: withCountry });
  });
});

describe('getGame', () => {
  const detail: GameDetail = {
    id: 'g 1',
    playedAt: '2026-10-10T12:00:00.000Z',
    map: 'world',
    mode: 'move',
    timeLimit: 0,
    daily: null,
    score: 2400,
    maxScore: 10_000,
    kind: 'solo',
    result: null,
    ratingChange: null,
    players: 1,
    rounds: [
      { country: 'FR', distanceKm: 12.5, score: 2400, hinted: true, lng: 2.35, lat: 48.85, guessLng: 2.5, guessLat: 48.9 },
      { country: 'JP', distanceKm: null, score: 0, hinted: false, lng: null, lat: null, guessLng: null, guessLat: null },
    ],
  };

  it('asks for one game by id', async () => {
    const { fetchFn, calls } = fakeFetch(success(detail));
    expect(await getGame('g 1', fetchFn)).toEqual({ ok: true, data: detail });
    expect(calls[0]?.url).toBe('/api/games?id=g%201');
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
  });

  it('reads a ranked duel: who won, what it did to the rating, how many played', async () => {
    const duel = { ...detail, kind: 'ranked', result: 'loss', ratingChange: -14, players: 2 };
    expect(await getGame('g1', fakeFetch(success(duel)).fetchFn)).toEqual({ ok: true, data: duel });
  });

  it.each([
    ['has no kind', { ...detail, kind: undefined }],
    ['is of a kind that is not one', { ...detail, kind: 'coop' }],
    ['has a result that is not one', { ...detail, result: 'won' }],
    ['has no rating change', { ...detail, ratingChange: undefined }],
    ['does not say how many played', { ...detail, players: undefined }],
  ])('refuses a game that %s', async (_name, data) => {
    expect(await getGame('g1', fakeFetch(success(data)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('refuses a game whose rounds are missing', async () => {
    expect(await getGame('g1', fakeFetch(success({ ...detail, rounds: undefined })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it("passes on the server's refusal for someone else's game", async () => {
    expect(await getGame('g1', fakeFetch(failure('That is not one of your games.', 404)).fetchFn)).toEqual({ ok: false, error: 'That is not one of your games.' });
  });
});

describe('when something goes wrong on the way', () => {
  it('gives a friendly error instead of throwing when the network fails', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await getAccount(offline)).toEqual({ ok: false, error: UNREACHABLE });
    expect(await login('neel', 'pw', offline)).toEqual({ ok: false, error: UNREACHABLE });
    expect(await saveGame(game, offline)).toEqual({ ok: false, error: UNREACHABLE });
  });

  it('gives a friendly error for a reply that is not JSON, such as a host error page', async () => {
    const { fetchFn } = fakeFetch(() => new Response('<html>Not found</html>', { status: 404 }));
    expect(await getAccount(fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
    expect(await logout(fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('gives a friendly error for JSON that is not the envelope', async () => {
    expect(await getAccount(fakeFetch(json({ hello: 'world' })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
    expect(await getAccount(fakeFetch(json({ success: false })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
    expect(await getAccount(fakeFetch(json(null)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('does not treat an error status with a success body as success', async () => {
    expect(await getAccount(fakeFetch(success(signedIn, 500)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});
