import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { dailyRounds, placesOn, roundOn } from '../games/testing.js';
import type { Context } from '../serve.js';
import { WORLD_SCALE_KM, distanceKm, scoreForDistance } from '../match/scoring.js';
import { scaleOf, type KnownPlace } from '../places/lists.js';
import { TEST_SECRET, apiRequest, pausingAfter, resetDb, scoredRound, testDb } from '../testing.js';
import { account } from './account.js';
import { dailyPost } from './daily.js';
import { GAMES_PER_PAGE, gamesGet as getGame, saveGame } from './games.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const TODAY = '2027-01-15';
const GUESTS_CANNOT = 'Guests cannot do that. Make an account first.';

let db: Db;
let neel: string;
let friend: string;

const at = (now: number, on: Db = db): Context => ({ db: on, now, secret: TEST_SECRET });

async function signUp(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW });
  return `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`;
}

async function guest(): Promise<string> {
  const made = await createGuest(db, NOW);
  return `${accountCookieName(true)}=${createGuestSession(made.userId, NOW, TEST_SECRET)}`;
}

const NOT_VALID = 'That game could not be saved: its details are not valid.';

const round = scoredRound;
const game = (rounds: unknown[], change: Record<string, unknown> = {}) => ({ map: 'world', mode: 'move', timeLimit: 0, seed: 'seed1', rounds, ...change });
const dailyGame = (scores: number[]) => game(dailyRounds(TODAY, scores), { timeLimit: 60, seed: 'daily20270115', daily: TODAY });

/** The first place of the first list that is on a map. */
function firstOn(map: string): KnownPlace {
  const [place] = placesOn(map, 1);
  if (!place) {
    throw new Error(`No place on ${map}`);
  }
  return place;
}

const FRANCE = placesOn('country:FR', 3);
const FRANCE_SCALE_KM = scaleOf('country:FR', 0);
/** Rounds on France's own map that score what is asked there. */
const french = (scores: number[], changes: Array<Record<string, unknown>> = []) =>
  FRANCE.slice(0, scores.length).map((place, index) => roundOn(place, scores[index] ?? 0, FRANCE_SCALE_KM, changes[index]));

/** The rounds of a match as the match keeps them for one player: the place, and that player's guess. */
const MATCH_ROUNDS = [
  { country: 'FR', distanceKm: 87.5, score: 4200, lng: 2.35, lat: 48.85, guessLng: 3.1, guessLat: 48.2 },
  { country: 'JP', distanceKm: null, score: 0, lng: 139.7, lat: 35.7, guessLng: null, guessLat: null },
];

/** A finished online match as the match code saves it for one of its players, written straight into the table. Gives back its id. */
async function match(username: string, change: Record<string, unknown> = {}): Promise<string> {
  const row = {
    id: randomUUID(),
    kind: 'party',
    map: 'world',
    mode: 'move',
    time_limit: 60,
    played_at: NOW,
    result: 'win',
    score: 4200,
    max_score: 10_000,
    rating_before: null,
    rating_after: null,
    xp_earned: 0,
    players: 2,
    rounds: MATCH_ROUNDS,
    ...change,
  };
  await db.query(
    `INSERT INTO online_games (id, user_id, match_id, kind, map, mode, time_limit, played_at, result, score, max_score,
                               rating_before, rating_after, xp_earned, players, rounds)
     SELECT $1, id, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11::integer, $12::integer, $13, $14, $15::jsonb FROM users WHERE username = $16`,
    [
      row.id,
      randomUUID(),
      row.kind,
      row.map,
      row.mode,
      row.time_limit,
      new Date(row.played_at as number).toISOString(),
      row.result,
      row.score,
      row.max_score,
      row.rating_before,
      row.rating_after,
      row.xp_earned,
      row.players,
      JSON.stringify(row.rounds),
      username,
    ],
  );
  return row.id as string;
}

const save = (body: unknown, cookie: string | null = neel, now = NOW, on: Db = db) =>
  saveGame(apiRequest('POST', '/api/games', { body, cookie: cookie ?? undefined }), at(now, on));
const fetchGame = (id: string, cookie: string | null = neel) => getGame(apiRequest('GET', `/api/games?id=${id}`, { cookie: cookie ?? undefined }), at(NOW));
const history = (query = '?page=1', cookie: string | null = neel, on: Db = db) =>
  getGame(apiRequest('GET', `/api/games${query}`, { cookie: cookie ?? undefined }), at(NOW, on));
/** Begins today's daily and saves it as soon as it could have been played. */
async function playDaily(scores: number[], now = NOW): Promise<Response> {
  await dailyPost(apiRequest('POST', '/api/daily', { body: { action: 'start' }, cookie: neel }), at(now - 6_000));
  return save(dailyGame(scores), neel, now);
}
const me = async (cookie = neel) => (await (await account(apiRequest('GET', '/api/account', { cookie }), at(NOW))).json()).data;
const data = async (response: Response | Promise<Response>) => (await (await response).json()).data;
const refusal = async (response: Response | Promise<Response>) => {
  const sent = await response;
  return [sent.status, (await sent.json()).error];
};
beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  neel = await signUp('neel');
  friend = await signUp('friend');
});

describe('XP for a saved game', () => {
  it('is a fiftieth of each round, said in the reply and added to the account', async () => {
    const saved = await data(save(game([round(5000), round(2500), round(1234), round(0)])));
    expect(saved.xpEarned).toBe(100 + 50 + 25 + 0);
    expect((await me()).account).toMatchObject({ xp: 175, level: 1 });
    expect((await me(friend)).account.xp).toBe(0);
  });

  it('adds up over games, and the level follows it', async () => {
    for (const seed of ['a', 'b', 'c']) {
      await save(game([round(5000)], { seed }));
    }
    expect((await me()).account).toMatchObject({ xp: 300, level: 2 });
  });

  it('is earned on the halved score of a hinted round', async () => {
    const saved = await data(save(game([round(5000, { hinted: true }), round(5000)])));
    expect(saved).toMatchObject({ score: 7500, xpEarned: 150 });
  });

  it('is paid once for a game posted twice, and the second reply says what the first earned', async () => {
    const first = await save(game([round(5000), round(5000)]));
    const second = await save(game([round(5000), round(5000)]), neel, NOW + 2_000);
    expect([first.status, second.status]).toEqual([201, 200]);
    expect((await second.json()).data.xpEarned).toBe(200);
    expect((await me()).account.xp).toBe(200);
  });

  it('is paid once when the two copies arrive together', async () => {
    const slow = pausingAfter(db, /FROM games/);
    await Promise.all([save(game([round(5000)]), neel, NOW, slow), save(game([round(5000)]), neel, NOW, slow)]);
    expect((await me()).account.xp).toBe(100);
  });
});

describe('score checking', () => {
  // Two places in France, and a guess in London, a few hundred kilometres from either.
  const [PARIS, LYON] = [FRANCE[0] ?? firstOn('country:FR'), FRANCE[1] ?? firstOn('country:FR')];
  const LONDON = { guessLng: -0.1276, guessLat: 51.5072 };
  const kmFrom = (place: KnownPlace) => distanceKm(place, { lng: LONDON.guessLng, lat: LONDON.guessLat });
  const KM = kmFrom(PARIS);
  /** A round on a real place, with a real guess, that claims whatever score is asked. */
  const claimed = (score: number, change: Record<string, unknown> = {}, place = PARIS) => ({
    id: place.id,
    lng: place.lng,
    lat: place.lat,
    country: 'FR',
    distanceKm: 0,
    score,
    ...LONDON,
    ...change,
  });
  const onWorld = scoreForDistance(KM, WORLD_SCALE_KM);

  it('stores the score and the distance the server works out, not the ones the browser sends, and pays XP on them', async () => {
    const other = scoreForDistance(kmFrom(LYON), WORLD_SCALE_KM);
    const saved = await data(save(game([claimed(5000), claimed(5000, {}, LYON)])));
    expect(saved).toMatchObject({ score: onWorld + other, maxScore: 10_000, xpEarned: Math.round(onWorld / 50) + Math.round(other / 50) });
    expect(onWorld).toBeLessThan(4500);

    const { rounds } = await data(fetchGame(saved.id));
    expect(rounds.map((entry: { score: number; distanceKm: number }) => [entry.score, entry.distanceKm])).toEqual([
      [onWorld, KM],
      [other, kmFrom(LYON)],
    ]);
    expect((await me()).account.xp).toBe(saved.xpEarned);
  });

  it('gives a player who understates their score what they really scored', async () => {
    expect((await data(save(game([claimed(0, { distanceKm: null })])))).score).toBe(onWorld);
  });

  it('halves a hinted round, rounding down, whatever the browser sent for it', async () => {
    const saved = await data(save(game([claimed(5000, { hinted: true }), round(4997, { hinted: true })])));
    expect(saved.score).toBe(Math.floor(onWorld / 2) + 2498);
  });

  it('takes a round with no guess as it is: nothing scored', async () => {
    const saved = await data(save(game([round(0), claimed(1)])));
    expect(saved).toMatchObject({ rounds: 2, score: onWorld });
  });

  it('scores a round with no guess at nothing, whatever score and distance it claims', async () => {
    const saved = await data(save(game([claimed(5000, { distanceKm: 0, guessLng: null, guessLat: null }), round(0, { score: 4990, distanceKm: 3 })])));
    expect(saved).toMatchObject({ rounds: 2, score: 0, xpEarned: 0 });
    expect((await data(fetchGame(saved.id))).rounds).toMatchObject([
      { distanceKm: null, score: 0 },
      { distanceKm: null, score: 0 },
    ]);
  });

  it.each([
    ['a score but no place', { country: 'FR', distanceKm: 3, score: 4990 }],
    ['a place by its id alone', { id: PARIS.id, ...LONDON }],
    ['where a place is but not which', { lng: PARIS.lng, lat: PARIS.lat, ...LONDON }],
    ['half a guess', claimed(0, { guessLat: undefined })],
    ['half a place', claimed(0, { lng: undefined })],
  ])('refuses a round that gives %s, saving nothing and paying nothing', async (_name, unchecked) => {
    const response = await save(game([round(5000), unchecked]));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: NOT_VALID });
    expect(await db.query('SELECT id FROM games')).toEqual([]);
    expect((await me()).account.xp).toBe(0);
  });

  it('still answers a double submit with the first save, whatever the second claims', async () => {
    const first = await data(save(game([claimed(1)])));
    const second = await save(game([round(5000)]), neel, NOW + 2_000);
    expect(second.status).toBe(200);
    expect((await second.json()).data).toEqual(first);
  });

  it('leaves games saved before the check as they were', async () => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO games (id, user_id, map, mode, time_limit, seed, rounds, score, max_score, played_at)
       SELECT $1, id, 'world', 'move', 0, 'old', 1, 4990, 5000, $2 FROM users WHERE username = 'neel'`,
      [id, new Date(NOW - 60 * MINUTE)],
    );
    await db.query(`INSERT INTO game_rounds (game_id, round, country, distance_km, score) VALUES ($1, 1, 'FR', 3, 4990)`, [id]);
    expect(await data(fetchGame(id))).toMatchObject({ score: 4990, rounds: [{ distanceKm: 3, score: 4990, lng: null, guessLng: null }] });
    expect((await me()).stats).toMatchObject({ gamesPlayed: 1, bestRoundScore: 4990 });
  });
});

describe('maps', () => {
  it.each(['africa', 'country:FR', 'country:NZ'])('saves a game on %s, scored on that map’s scale', async (map) => {
    const response = await save(game([roundOn(firstOn(map), 100, scaleOf(map, 0))], { map }));
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({ map, score: 100 });
  });

  it.each(['country:fr', 'country:FRA', 'country:', 'antarctica', 'country:F1'])('refuses a game on %s', async (map) => {
    expect((await save(game([round(100)], { map }))).status).toBe(400);
  });
});

describe('GET /api/games?id=', () => {
  const PLAYED = french([4200, 0, 3800], [{ hinted: false }, {}, { hinted: true }]);
  const guessOf = (sent: Record<string, unknown>) => ({ lng: sent.guessLng as number, lat: sent.guessLat as number });
  /** A stored round: the place and the guess that were sent, with the distance the server measured between them and the score it gave. */
  const kept = (sent: Record<string, unknown>, score: number) => ({
    country: 'FR',
    distanceKm: sent.guessLat === null ? null : expect.closeTo(distanceKm({ lng: sent.lng as number, lat: sent.lat as number }, guessOf(sent)), 6),
    score,
    hinted: sent.hinted === true,
    lng: sent.lng,
    lat: sent.lat,
    guessLng: sent.guessLng,
    guessLat: sent.guessLat,
  });

  it('gives the owner the game with every round, its place and its guess', async () => {
    const saved = await data(save(game(PLAYED, { map: 'country:FR', mode: 'nmpz', timeLimit: 60 })));
    const response = await fetchGame(saved.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: {
        id: saved.id,
        playedAt: new Date(NOW).toISOString(),
        map: 'country:FR',
        mode: 'nmpz',
        timeLimit: 60,
        daily: null,
        kind: 'solo',
        result: null,
        ratingChange: null,
        players: 1,
        score: 6100,
        maxScore: 15_000,
        // The hinted round was worth 3800 before its hint halved it.
        rounds: [kept(PLAYED[0] ?? {}, 4200), kept(PLAYED[1] ?? {}, 0), kept(PLAYED[2] ?? {}, 1900)],
      },
    });
  });

  it('says which day a daily challenge was', async () => {
    const saved = await data(playDaily([1000, 1000, 1000]));
    expect(await data(fetchGame(saved.id))).toMatchObject({ daily: TODAY, timeLimit: 60, kind: 'daily', result: null, ratingChange: null, players: 1 });
  });

  it('gives a match by its id too, with the player’s own guess in each round and how it ended', async () => {
    const id = await match('neel', { kind: 'ranked', result: 'loss', rating_before: 520, rating_after: 504, played_at: NOW + MINUTE });
    const response = await fetchGame(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        id,
        playedAt: new Date(NOW + MINUTE).toISOString(),
        map: 'world',
        mode: 'move',
        timeLimit: 60,
        daily: null,
        kind: 'ranked',
        result: 'loss',
        ratingChange: -16,
        players: 2,
        score: 4200,
        maxScore: 10_000,
        rounds: [
          { country: 'FR', distanceKm: 87.5, score: 4200, hinted: false, lng: 2.35, lat: 48.85, guessLng: 3.1, guessLat: 48.2 },
          { country: 'JP', distanceKm: null, score: 0, hinted: false, lng: 139.7, lat: 35.7, guessLng: null, guessLat: null },
        ],
      },
    });
  });

  it.each([
    ['a party', { kind: 'party', players: 6 }, { kind: 'party', result: 'win', ratingChange: null, players: 6 }],
    ['a public game', { kind: 'unranked', result: 'draw', players: 9 }, { kind: 'unranked', result: 'draw', ratingChange: null, players: 9 }],
    ['a 2v2', { kind: 'team', players: 4 }, { kind: 'team', result: 'win', ratingChange: null, players: 4 }],
    ['a cancelled duel', { kind: 'ranked', result: null }, { kind: 'ranked', result: null, ratingChange: null, players: 2 }],
    // Only a ranked duel changes a rating, whatever the row holds.
    ['a public game with ratings on its row', { kind: 'unranked', rating_before: 500, rating_after: 520 }, { kind: 'unranked', ratingChange: null }],
  ])('says of %s what kind it was and how it ended', async (_name, change, told) => {
    const id = await match('neel', change);
    expect(await data(fetchGame(id))).toMatchObject(told);
    expect((await data(history())).games).toMatchObject([{ id, ...told }]);
  });

  it("answers 404 for someone else's match", async () => {
    const id = await match('friend');
    expect((await fetchGame(id)).status).toBe(404);
    expect((await fetchGame(id, friend)).status).toBe(200);
  });

  it('gives a game saved before places and guesses were kept blanks for them', async () => {
    const saved = { id: randomUUID() };
    await db.query(
      `INSERT INTO games (id, user_id, map, mode, time_limit, seed, rounds, score, max_score, played_at)
       SELECT $1, id, 'world', 'move', 0, 'old', 1, 0, 5000, $2 FROM users WHERE username = 'neel'`,
      [saved.id, new Date(NOW - 60 * MINUTE)],
    );
    await db.query(`INSERT INTO game_rounds (game_id, round, country, distance_km, score) VALUES ($1, 1, 'FR', NULL, 0)`, [saved.id]);
    expect((await data(fetchGame(saved.id))).rounds).toEqual([
      { country: 'FR', distanceKm: null, score: 0, hinted: false, lng: null, lat: null, guessLng: null, guessLat: null },
    ]);
  });

  it('is the same id the recent games carry', async () => {
    const saved = await data(save(game(PLAYED)));
    expect((await me()).recentGames.map((entry: { id: string }) => entry.id)).toEqual([saved.id]);
  });

  it("answers 404 for someone else's game, in the same words as for one that does not exist", async () => {
    const saved = await data(save(game(PLAYED)));
    const theirs = await fetchGame(saved.id, friend);
    expect(theirs.status).toBe(404);
    const body = await theirs.json();
    expect(body).toEqual({ success: false, error: 'That game does not exist, or it is not yours.' });
    expect(await (await fetchGame(randomUUID())).json()).toEqual(body);
    expect(await (await fetchGame("x' OR 1=1")).json()).toEqual(body);
    expect((await getGame(apiRequest('GET', '/api/games', { cookie: neel }), at(NOW))).status).toBe(404);
  });

  it('refuses a visitor, and a guest', async () => {
    const saved = await data(save(game(PLAYED)));
    expect((await fetchGame(saved.id, null)).status).toBe(401);
    expect(await refusal(fetchGame(saved.id, await guest()))).toEqual([403, GUESTS_CANNOT]);
  });

  it.each([
    ['a place off the map', { lng: 180.5, lat: 0 }],
    ['a guess off the map', { guessLat: -91 }],
    ['a place as text', { lng: '2.35' }],
    ['a hint that is not yes or no', { hinted: 'yes' }],
  ])('refuses a game with %s', async (_name, change) => {
    expect((await save(game([round(100, change)]))).status).toBe(400);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });
});

describe('GET /api/games?page=', () => {
  it('is empty before the first game', async () => {
    const response = await history();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true, data: { games: [], page: 1, more: false } });
  });

  it('lists every mode in one list, newest first', async () => {
    const solo = await data(save(game(french([5000, 2500]), { map: 'country:FR', mode: 'nmpz', timeLimit: 30 })));
    const daily = await data(playDaily([1000, 0, 500], NOW + MINUTE));
    const ranked = await match('neel', { kind: 'ranked', rating_before: 500, rating_after: 517, xp_earned: 168, played_at: NOW + 2 * MINUTE });
    const party = await match('neel', { kind: 'party', map: 'europe', mode: 'no-move', result: 'loss', players: 5, played_at: NOW + 3 * MINUTE });

    expect(await data(history())).toEqual({
      games: [
        { id: party, kind: 'party', playedAt: new Date(NOW + 3 * MINUTE).toISOString(), map: 'europe', mode: 'no-move', rounds: 2, score: 4200, maxScore: 10_000, result: 'loss', ratingChange: null, xpEarned: 0, players: 5 },
        { id: ranked, kind: 'ranked', playedAt: new Date(NOW + 2 * MINUTE).toISOString(), map: 'world', mode: 'move', rounds: 2, score: 4200, maxScore: 10_000, result: 'win', ratingChange: 17, xpEarned: 168, players: 2 },
        { id: daily.id, kind: 'daily', playedAt: new Date(NOW + MINUTE).toISOString(), map: 'world', mode: 'move', rounds: 3, score: 1500, maxScore: 15_000, result: null, ratingChange: null, xpEarned: 30, players: 1 },
        { id: solo.id, kind: 'solo', playedAt: new Date(NOW).toISOString(), map: 'country:FR', mode: 'nmpz', rounds: 2, score: 7500, maxScore: 10_000, result: null, ratingChange: null, xpEarned: 150, players: 1 },
      ],
      page: 1,
      more: false,
    });
  });

  it('says what a lost ranked duel took from the rating', async () => {
    await match('neel', { kind: 'ranked', result: 'loss', rating_before: 512, rating_after: 498 });
    expect((await data(history())).games).toMatchObject([{ result: 'loss', ratingChange: -14 }]);
  });

  it('gives 20 to a page across both kinds of game, says whether there are more, and never repeats or skips one between pages', async () => {
    const ids: string[] = [];
    // Newest first: 45 games, every third one a match, a minute apart.
    for (let index = 44; index >= 0; index -= 1) {
      const playedAt = NOW + index * MINUTE;
      ids.unshift(index % 3 === 0 ? await match('neel', { played_at: playedAt }) : (await data(save(game([round(100)], { seed: `s${index}` }), neel, playedAt))).id);
    }
    const newestFirst = [...ids].reverse();
    const pages = [await data(history('?page=1')), await data(history('?page=2')), await data(history('?page=3')), await data(history('?page=4'))];
    expect(pages.map((page) => [page.page, page.games.length, page.more])).toEqual([
      [1, GAMES_PER_PAGE, true],
      [2, GAMES_PER_PAGE, true],
      [3, 5, false],
      [4, 0, false],
    ]);
    expect(GAMES_PER_PAGE).toBe(20);
    expect(pages.flatMap((page) => page.games.map((entry: { id: string }) => entry.id))).toEqual(newestFirst);
  });

  it('says there are no more when a page is exactly full', async () => {
    for (let index = 0; index < GAMES_PER_PAGE; index += 1) {
      await match('neel', { played_at: NOW + index * MINUTE });
    }
    expect(await data(history())).toMatchObject({ page: 1, more: false });
  });

  it('reads a page in one query, after the one that checks the session', async () => {
    await save(game([round(100)]));
    await match('neel');
    const asked: string[] = [];
    const watching: Db = {
      query: (sql, params) => {
        asked.push(sql);
        return db.query(sql, params);
      },
      transaction: db.transaction,
    };
    expect((await data(history('?page=1', neel, watching))).games).toHaveLength(2);
    expect(asked).toHaveLength(2);
  });

  it("lists only the asker's own", async () => {
    await save(game([round(100)]), friend);
    await match('friend');
    expect((await data(history())).games).toEqual([]);
    expect((await data(history('?page=1', friend))).games).toHaveLength(2);
  });

  it('takes page 0 as the first', async () => {
    await match('neel');
    expect(await data(history('?page=0'))).toMatchObject({ page: 1, games: [{ kind: 'party' }] });
  });

  it.each(['?page=-1', '?page=two', '?page=1.5', '?page=10001'])('refuses %s', async (query) => {
    expect(await refusal(history(query))).toEqual([400, 'Ask for your games by page.']);
  });

  it('refuses a visitor, and a guest', async () => {
    expect(await refusal(history('?page=1', null))).toEqual([401, 'Sign in first.']);
    expect(await refusal(history('?page=1', await guest()))).toEqual([403, GUESTS_CANNOT]);
  });
});
