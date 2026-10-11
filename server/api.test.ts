import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getAccount, POST as postAccount } from '../api/account/index.js';
import { POST as postLogin } from '../api/account/login.js';
import { POST as postLogout } from '../api/account/logout.js';
import { POST as postRegister } from '../api/account/register.js';
import { POST as postReset } from '../api/account/reset.js';
import { GET as getDaily, POST as postDaily } from '../api/daily.js';
import { GET as getGame, POST as postGame } from '../api/games.js';
import { GET as getMaps, POST as postMaps } from '../api/maps.js';
import { GET as getMatch, POST as postMatch } from '../api/match.js';
import { GET as getSocial, POST as postSocial } from '../api/social.js';
import { spreadPlaces } from './places/testing.js';
import { apiRequest, cookieFrom, scoredRound } from './testing.js';

// The route files as Vercel calls them: one Request in, settings from the environment.
const SESSION_SECRET = Buffer.alloc(32, 5).toString('base64');
const credentials = { username: 'neel', password: 'correct horse battery' };
/** What signing up sends: each account has an email of its own. */
const newAccount = (username = credentials.username) => ({ ...credentials, username, email: `${username}@example.com` });
const game = { map: 'world', mode: 'move', timeLimit: 0, seed: 'abc', rounds: [scoredRound(4990)] };

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'pglite://memory');
  vi.stubEnv('SESSION_SECRET', SESSION_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the API routes', () => {
  it('register, save a game, read it back, sign out and sign in again', async () => {
    const registered = await postRegister(apiRequest('POST', '/api/account/register', { body: newAccount() }));
    expect(registered.status).toBe(201);
    const cookie = cookieFrom(registered);

    const saved = await postGame(apiRequest('POST', '/api/games', { body: game, cookie }));
    expect(saved.status).toBe(201);
    expect((await saved.json()).data).toMatchObject({ rounds: 1, score: 4990, maxScore: 5000 });

    const me = await getAccount(apiRequest('GET', '/api/account', { cookie }));
    expect((await me.json()).data).toMatchObject({
      account: { username: 'neel' },
      stats: { gamesPlayed: 1, bestRoundScore: 4990 },
      recentGames: [{ map: 'world', mode: 'move', score: 4990 }],
    });

    const out = await postLogout(apiRequest('POST', '/api/account/logout', { cookie }));
    expect(out.status).toBe(200);
    const after = await getAccount(apiRequest('GET', '/api/account', { cookie: cookieFrom(out) }));
    expect((await after.json()).data.account).toBeNull();

    const back = await postLogin(apiRequest('POST', '/api/account/login', { body: credentials }));
    expect(back.status).toBe(200);
    const again = await getAccount(apiRequest('GET', '/api/account', { cookie: cookieFrom(back) }));
    expect((await again.json()).data.stats.gamesPlayed).toBe(1);
  });

  it('open a party, join it, poll it and leave it, on the real clock', async () => {
    const signUp = async (username: string) =>
      cookieFrom(await postRegister(apiRequest('POST', '/api/account/register', { body: newAccount(username) })));
    const host = await signUp('host');
    const guest = await signUp('guest');

    const settings = { map: 'world', mode: 'move', timeLimit: 60, rounds: 5 };
    const created = await postMatch(apiRequest('POST', '/api/match', { body: { action: 'create', settings }, cookie: host }));
    expect(created.status).toBe(201);
    const lobby = (await created.json()).data;

    const joined = await postMatch(apiRequest('POST', '/api/match', { body: { action: 'join', code: lobby.code }, cookie: guest }));
    expect((await joined.json()).data.players).toHaveLength(2);

    const before = Date.now();
    const polled = await getMatch(apiRequest('GET', `/api/match?id=${lobby.id}`, { cookie: host }));
    const state = (await polled.json()).data;
    expect(state).toMatchObject({ id: lobby.id, phase: 'lobby', players: [{ username: 'host', active: true }, { username: 'guest', active: true }] });
    expect(Date.parse(state.serverNow)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(state.serverNow)).toBeLessThanOrEqual(Date.now());

    const queue = await getMatch(apiRequest('GET', '/api/match?queue=1', { cookie: guest }));
    expect((await queue.json()).data).toEqual({ queued: false, kind: null, waiting: 0, matchId: lobby.id, startsAt: null, since: null, serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });

    const left = await postMatch(apiRequest('POST', '/api/match', { body: { action: 'leave', matchId: lobby.id }, cookie: guest }));
    expect(await left.json()).toEqual({ success: true, data: { left: true } });
    expect((await getMatch(apiRequest('GET', '/api/match?queue=1'))).status).toBe(401);
  });

  it('save a game with its places, read it back, and show up on the XP leaderboard and in a profile', async () => {
    const cookie = cookieFrom(await postRegister(apiRequest('POST', '/api/account/register', { body: newAccount('historian') })));
    // A real place, named by its id and guessed exactly: the server reads the place lists for itself.
    const [place] = spreadPlaces(1) as [ReturnType<typeof spreadPlaces>[number]];
    const { id, lng, lat } = place;
    const rounds = [{ id, lng, lat, guessLng: lng, guessLat: lat, hinted: false, score: 1, distanceKm: 999, country: 'ZZ' }];
    const saved = (await (await postGame(apiRequest('POST', '/api/games', { body: { ...game, seed: 'history', rounds, scaleKm: 100 }, cookie }))).json()).data;
    expect(saved).toMatchObject({ score: 5000, xpEarned: 100, xpCapped: false });

    // What the browser claimed for the country, the distance and the score was not read.
    const read = await getGame(apiRequest('GET', `/api/games?id=${saved.id}`, { cookie }));
    expect((await read.json()).data.rounds).toEqual([{ country: place.country, distanceKm: 0, score: 5000, hinted: false, lng, lat, guessLng: lng, guessLat: lat }]);
    const invented = [{ id: 'made-up', lng: 1, lat: 1, guessLng: 1, guessLat: 1 }];
    const refusedGame = await postGame(apiRequest('POST', '/api/games', { body: { ...game, seed: 'invented', rounds: invented }, cookie }));
    expect([refusedGame.status, (await refusedGame.json()).error]).toEqual([400, 'That game could not be saved: its places are not on its map.']);
    expect((await getGame(apiRequest('GET', `/api/games?id=${saved.id}`))).status).toBe(401);

    const board = (await (await getSocial(apiRequest('GET', '/api/social?leaderboard=xp', { cookie }))).json()).data;
    expect(board.entries).toContainEqual(expect.objectContaining({ username: 'historian', value: 100, level: 1, league: 'Trekker' }));
    expect(board.you).toMatchObject({ value: 100 });

    const profile = await getSocial(apiRequest('GET', '/api/social?profile=historian'));
    expect((await profile.json()).data).toMatchObject({ username: 'historian', xp: 100, gamesPlayed: 1, rating: 500, league: 'Trekker', friend: null });

    const history = (await (await getGame(apiRequest('GET', '/api/games?page=1', { cookie }))).json()).data;
    expect(history).toMatchObject({ games: [{ id: saved.id, kind: 'solo', score: 5000, result: null, players: 1 }], page: 1, more: false });
    expect((await getGame(apiRequest('GET', '/api/games?page=1'))).status).toBe(401);
  });

  it('change the country and the settings of an account, then delete it and restore it', async () => {
    const registered = await postRegister(apiRequest('POST', '/api/account/register', { body: { ...newAccount('leaver'), country: 'FR' } }));
    const cookie = cookieFrom(registered);
    const ask = (body: unknown) => postAccount(apiRequest('POST', '/api/account', { body, cookie }));
    expect((await (await ask({ action: 'country', country: 'JP' })).json()).data).toEqual({ country: 'JP' });
    expect((await (await ask({ action: 'settings', hideChat: true })).json()).data).toEqual({ allowFriendRequests: true, hideChat: true, hideLastSeen: false });
    expect((await (await getAccount(apiRequest('GET', '/api/account', { cookie }))).json()).data).toMatchObject({
      account: { username: 'leaver', country: 'JP', rating: 500, league: 'Trekker', hideChat: true, loginStreak: 1 },
      guest: null,
    });
    expect((await postAccount(apiRequest('POST', '/api/account', { body: { action: 'country', country: 'JP' } }))).status).toBe(401);

    const deleted = await ask({ action: 'delete', password: credentials.password });
    expect((await deleted.json()).data).toEqual({ deleted: true, restoreUntil: expect.any(String) });
    expect((await getSocial(apiRequest('GET', '/api/social?profile=leaver'))).status).toBe(404);
    const body = { ...credentials, username: 'leaver' };
    expect((await postLogin(apiRequest('POST', '/api/account/login', { body }))).status).toBe(409);
    expect((await postLogin(apiRequest('POST', '/api/account/login', { body: { ...body, restore: true } }))).status).toBe(200);
    expect((await getSocial(apiRequest('GET', '/api/social?profile=leaver'))).status).toBe(200);
  });

  it('give a recovery code at sign-up, take it for a forgotten password, and sign every other browser out', async () => {
    const body = newAccount('forgetful');
    const registered = await postRegister(apiRequest('POST', '/api/account/register', { body }));
    const first = cookieFrom(registered);
    const { username, recoveryCode } = (await registered.json()).data;
    expect([username, recoveryCode]).toEqual(['forgetful', expect.stringMatching(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/)]);
    const account = async (cookie: string) => (await (await getAccount(apiRequest('GET', '/api/account', { cookie }))).json()).data.account;
    expect(await account(first)).toMatchObject({ hasRecoveryCode: true, teams: { wins: 0, losses: 0, ties: 0, winRate: 0 }, hideLastSeen: false });

    const recover = (code: string) => postLogin(apiRequest('POST', '/api/account/login', { body: { username: 'forgetful', recoveryCode: code, newPassword: 'another long password' } }));
    expect((await recover('AAAA-AAAA-AAAA')).status).toBe(401);
    const recovered = await recover(recoveryCode.toLowerCase().replaceAll('-', ' '));
    expect(recovered.status).toBe(200);
    const fresh = (await recovered.json()).data.recoveryCode;
    expect(fresh).not.toBe(recoveryCode);
    // The code is spent, the browser that was signed in is out, and the new password is the password.
    expect((await recover(recoveryCode)).status).toBe(401);
    expect(await account(first)).toBeNull();
    expect(await account(cookieFrom(recovered))).toMatchObject({ username: 'forgetful' });
    expect((await postLogin(apiRequest('POST', '/api/account/login', { body }))).status).toBe(401);
    const again = await postLogin(apiRequest('POST', '/api/account/login', { body: { ...body, password: 'another long password' } }));
    expect(again.status).toBe(200);

    const everywhere = await postAccount(apiRequest('POST', '/api/account', { body: { action: 'signOutEverywhere' }, cookie: cookieFrom(again) }));
    expect((await everywhere.json()).data).toEqual({ signedOut: true });
    expect(await account(cookieFrom(again))).toBeNull();
    expect(await account(cookieFrom(recovered))).toBeNull();
  });

  it('start a streak run for an account, and take no run that was not started', async () => {
    const cookie = cookieFrom(await postRegister(apiRequest('POST', '/api/account/register', { body: newAccount('runner') })));
    const started = await postGame(apiRequest('POST', '/api/games', { body: { action: 'start', kind: 'streak' }, cookie }));
    expect(started.status).toBe(201);
    const { run } = (await started.json()).data;
    expect(run).toEqual(expect.any(String));
    const [place] = spreadPlaces(1);
    const rounds = [{ id: place?.id, answer: place?.country }];
    // Finished in the same moment it was started: nobody plays a round that fast.
    const tooSoon = await postGame(apiRequest('POST', '/api/games', { body: { kind: 'streak', run, rounds }, cookie }));
    expect([tooSoon.status, (await tooSoon.json()).error]).toEqual([409, 'That run finished sooner than it could have been played.']);
    expect((await postGame(apiRequest('POST', '/api/games', { body: { kind: 'streak', streak: 500, seed: 'a1' }, cookie }))).status).toBe(400);
    expect((await postGame(apiRequest('POST', '/api/games', { body: { kind: 'streak', run: 'run.made-up', rounds }, cookie }))).status).toBe(400);
  });

  it('let nobody in as a guest: a visitor who asks, or who queues, is told to sign in', async () => {
    const asked = await postMatch(apiRequest('POST', '/api/match', { body: { action: 'guest' } }));
    expect([asked.status, (await asked.json()).error, asked.headers.getSetCookie()]).toEqual([401, 'Sign in first.', []]);
    const queued = await postMatch(apiRequest('POST', '/api/match', { body: { action: 'queue', kind: 'unranked' } }));
    expect([queued.status, (await queued.json()).error]).toEqual([401, 'Sign in first.']);
  });

  it('make friends through the route file', async () => {
    const signUp = async (username: string) =>
      cookieFrom(await postRegister(apiRequest('POST', '/api/account/register', { body: newAccount(username) })));
    const asker = await signUp('asker');
    const asked = await signUp('asked');
    const requested = await postSocial(apiRequest('POST', '/api/social', { body: { action: 'request', username: 'asked' }, cookie: asker }));
    expect((await requested.json()).data.outgoing).toEqual(['asked']);
    // The once-a-minute call that says a player is there.
    expect((await getSocial(apiRequest('GET', '/api/social?online=1', { cookie: asker }))).status).toBe(200);
    const accepted = await postSocial(apiRequest('POST', '/api/social', { body: { action: 'accept', username: 'asker' }, cookie: asked }));
    expect((await accepted.json()).data.friends).toEqual([
      { username: 'asker', country: null, level: 1, league: 'Trekker', party: null, online: true, lastSeenAt: expect.any(String) },
    ]);
    expect((await getSocial(apiRequest('GET', '/api/social?friends=1'))).status).toBe(401);
  });

  it('publish a community map, list it, play it and open a party on it', async () => {
    const cookie = cookieFrom(await postRegister(apiRequest('POST', '/api/account/register', { body: newAccount('mapmaker') })));
    const locations = [0, 1, 2, 3, 4].map((index) => [`p${index}`, 2 + index, 48, 'FR']);
    const published = await postMaps(apiRequest('POST', '/api/maps', { body: { action: 'save', name: 'Across France', description: 'Five places in a line across France.', locations }, cookie }));
    expect(published.status).toBe(201);
    const { slug } = (await published.json()).data;

    const listed = (await (await getMaps(apiRequest('GET', '/api/maps?list=newest&q=across'))).json()).data;
    expect(listed).toMatchObject({ maps: [{ slug, name: 'Across France', description: 'Five places in a line across France.', maker: 'mapmaker', places: 5 }], page: 1, more: false });

    // Playing takes an account, so counting a play does too.
    expect((await postMaps(apiRequest('POST', '/api/maps', { body: { action: 'play', slug }, ip: '203.0.113.9' }))).status).toBe(401);
    const played = await postMaps(apiRequest('POST', '/api/maps', { body: { action: 'play', slug }, cookie, ip: '203.0.113.9' }));
    expect(await played.json()).toEqual({ success: true, data: { plays: 1 } });
    expect((await (await getMaps(apiRequest('GET', `/api/maps?slug=${slug}`))).json()).data).toMatchObject({ plays: 1, locations, mine: false });

    const settings = { map: `community:${slug}`, mode: 'move', timeLimit: 60, rounds: 5 };
    const party = await postMatch(apiRequest('POST', '/api/match', { body: { action: 'create', settings }, cookie }));
    expect(party.status).toBe(201);
    expect((await postMaps(apiRequest('POST', '/api/maps', { body: { action: 'delete', slug } }))).status).toBe(401);
  });

  it('hand out Google viewers up to the limit set for the day, to visitors too', async () => {
    vi.stubEnv('GOOGLE_VIEWERS_PER_DAY', '3');
    const ask = async (ip: string) => (await (await postDaily(apiRequest('POST', '/api/daily', { body: { action: 'viewer' }, ip }))).json()).data;
    expect(await ask('198.51.100.1')).toEqual({ google: true, usedToday: 1, limit: 3 });
    expect(await ask('198.51.100.2')).toEqual({ google: true, usedToday: 2, limit: 3 });
    // The last third of the day's viewers is kept for signed-in accounts.
    expect(await ask('198.51.100.3')).toEqual({ google: false, usedToday: 2, limit: 3 });
    const cookie = cookieFrom(await postRegister(apiRequest('POST', '/api/account/register', { body: newAccount('viewer') })));
    const asAccount = await postDaily(apiRequest('POST', '/api/daily', { body: { action: 'viewer' }, cookie, ip: '198.51.100.4' }));
    expect((await asAccount.json()).data).toEqual({ google: true, usedToday: 3, limit: 3 });
  });

  it('know the moderators from the MODERATORS setting, and let them see what has been reported', async () => {
    const signUp = async (username: string) =>
      cookieFrom(await postRegister(apiRequest('POST', '/api/account/register', { body: newAccount(username) })));
    // An account is listed only once it exists: a listed name that nobody has yet cannot be registered.
    const keeper = await signUp('keeper');
    vi.stubEnv('MODERATORS', 'Keeper, someone_else');
    expect((await postRegister(apiRequest('POST', '/api/account/register', { body: newAccount('someone_else') }))).status).toBe(409);
    const player = await signUp('reported');
    const account = async (cookie: string) => (await (await getAccount(apiRequest('GET', '/api/account', { cookie }))).json()).data.account;
    expect(await account(keeper)).toMatchObject({ moderator: true, banned: false });
    expect(await account(player)).toMatchObject({ moderator: false, banned: false });

    await postSocial(apiRequest('POST', '/api/social', { body: { action: 'report', username: 'reported', category: 'chat', reason: 'rude' }, cookie: keeper }));
    const seen = await getSocial(apiRequest('GET', '/api/social?moderation=1', { cookie: keeper }));
    expect((await seen.json()).data.players).toEqual([{ username: 'reported', reports: 1, reasons: [{ category: 'chat', note: 'rude' }], banned: false }]);
    const mine = await getSocial(apiRequest('GET', '/api/social?reports=1', { cookie: keeper }));
    expect((await mine.json()).data.reports).toEqual([{ username: 'reported', category: 'chat', note: 'rude', at: expect.any(String), status: 'open' }]);
    expect((await getSocial(apiRequest('GET', '/api/social?moderation=1', { cookie: player }))).status).toBe(403);

    const banned = await postSocial(apiRequest('POST', '/api/social', { body: { action: 'moderate', target: 'player', username: 'reported', decision: 'ban' }, cookie: keeper }));
    expect(banned.status).toBe(200);
    // The ban signed the player out; signed in again, they are told why they cannot play.
    const queue = (cookie: string) => postMatch(apiRequest('POST', '/api/match', { body: { action: 'queue', kind: 'unranked' }, cookie }));
    expect((await queue(player)).status).toBe(401);
    const back = cookieFrom(await postLogin(apiRequest('POST', '/api/account/login', { body: { ...credentials, username: 'reported' } })));
    const refused = await queue(back);
    expect([refused.status, (await refused.json()).error]).toEqual([403, 'This account is banned from online play.']);
  });

  it("serve today's daily challenge to a visitor", async () => {
    const utcDay = () => new Date().toISOString().slice(0, 10);
    const before = utcDay();
    const response = await getDaily(apiRequest('GET', '/api/daily'));
    expect(response.status).toBe(200);
    const { date, ...rest } = (await response.json()).data;
    // Either side of the request, in case midnight UTC fell in between.
    expect([before, utcDay()]).toContain(date);
    expect(rest).toMatchObject({
      seed: `daily${date.replaceAll('-', '')}`,
      settings: { map: 'world', mode: 'move', timeLimit: 180, rounds: 3 },
      state: 'open',
      yours: null,
      streak: { current: 0, best: 0, atRisk: false },
      history: [],
      leaderboard: { entries: [], page: 1, more: false },
    });
    // Reading it is open; playing it takes an account.
    const visiting = await postDaily(apiRequest('POST', '/api/daily', { body: { action: 'start' } }));
    expect([visiting.status, (await visiting.json()).error]).toEqual([401, 'Sign in first.']);
  });

  it('let an account start its one daily attempt, which the daily then says is under way', async () => {
    const cookie = cookieFrom(await postRegister(apiRequest('POST', '/api/account/register', { body: newAccount('dailyplayer') })));
    const started = await postDaily(apiRequest('POST', '/api/daily', { body: { action: 'start' }, cookie }));
    expect((await started.json()).data).toEqual({ state: 'started', token: null });
    expect((await (await getDaily(apiRequest('GET', '/api/daily', { cookie }))).json()).data).toMatchObject({ state: 'started', yours: null });
  });

  it('email a forgotten password its reset link through Resend, and take the link for a new password', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_made_up_key');
    vi.stubEnv('APP_URL', 'https://wherefall.example/');
    const posted: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      posted.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    });
    const body = newAccount('absent_minded');
    const first = cookieFrom(await postRegister(apiRequest('POST', '/api/account/register', { body })));

    const asked = await postReset(apiRequest('POST', '/api/account/reset', { body: { action: 'request', email: body.email, lang: 'fr' } }));
    expect([asked.status, await asked.json()]).toEqual([200, { success: true, data: { requested: true } }]);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toBe('https://api.resend.com/emails');
    expect(posted[0]?.init?.headers).toMatchObject({ Authorization: 'Bearer re_made_up_key' });
    const mail = JSON.parse(String(posted[0]?.init?.body));
    expect(mail).toMatchObject({ from: 'Wherefall <no-reply@n3el.dev>', to: [body.email], subject: 'Réinitialisez votre mot de passe Wherefall' });
    const link = /https:\/\/wherefall\.example\/\?reset=[A-Za-z0-9_-]{43}/.exec(mail.text)?.[0] ?? '';
    expect(mail.html).toContain(`href="${link}"`);

    const token = new URL(link).searchParams.get('reset');
    const password = 'another long password';
    const done = await postReset(apiRequest('POST', '/api/account/reset', { body: { action: 'complete', token, password } }));
    expect([done.status, await done.json()]).toEqual([200, { success: true, data: { username: 'absent_minded' } }]);
    const account = async (cookie: string) => (await (await getAccount(apiRequest('GET', '/api/account', { cookie }))).json()).data.account;
    expect(await account(cookieFrom(done))).toMatchObject({ username: 'absent_minded', email: body.email });
    expect(await account(first)).toBeNull();
    expect((await postLogin(apiRequest('POST', '/api/account/login', { body: { ...body, password } }))).status).toBe(200);
    expect((await postReset(apiRequest('POST', '/api/account/reset', { body: { action: 'complete', token, password } }))).status).toBe(400);
  });

  it('write the reset link to the log, on this machine’s address, and call nobody when there is no key to send email with', async () => {
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    const logged = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const body = newAccount('local_dev');
    await postRegister(apiRequest('POST', '/api/account/register', { body }));

    const asked = await postReset(apiRequest('POST', '/api/account/reset', { body: { action: 'request', email: body.email } }));
    expect(asked.status).toBe(200);
    expect(fetched).not.toHaveBeenCalled();
    expect(logged.mock.calls.flat().join(' ')).toMatch(/local_dev: http:\/\/localhost:3000\/\?reset=[A-Za-z0-9_-]{43}$/);
  });

  it('answer with a plain 500 on the live site when the key or the address of the site is missing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('VERCEL_ENV', 'production');

    const response = await getAccount(apiRequest('GET', '/api/account'));
    expect(response.status).toBe(500);
    const [, error] = logged.mock.calls[0] ?? [];
    expect(String(error)).toContain('RESEND_API_KEY: is not set; APP_URL: is not set');
  });

  it('refuses to save a game for a signed-out visitor', async () => {
    const response = await postGame(apiRequest('POST', '/api/games', { body: game }));
    expect(response.status).toBe(401);
  });

  it('answers with a plain 500 and logs which setting is wrong when the server is not configured', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('SESSION_SECRET', 'too-short');

    const response = await getAccount(apiRequest('GET', '/api/account'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Something went wrong on our side. Try again in a moment.' });

    const [, error] = logged.mock.calls[0] ?? [];
    expect(String(error)).toContain('SESSION_SECRET: must be 32 random bytes, base64 encoded');
    expect(JSON.stringify(body)).not.toContain('SESSION_SECRET');
  });
});
