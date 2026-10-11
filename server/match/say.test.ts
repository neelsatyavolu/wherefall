import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { pausingAfter, resetDb, testDb } from '../testing.js';
import { createParty, joinParty } from './parties.js';
import { getMatch, guess, leaveMatch, postPlaces, say, startMatch } from './play.js';
import { COUNTDOWN_MS, REVEAL_MS, type MatchState, type Reply } from './types.js';

const T = 1_800_000_000_000;
const SECOND = 1000;
const SETTINGS = { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 } as const;
const PLACES = [0, 1, 2].map((index) => ({ id: `p${index}`, lng: 2.3522, lat: 48.8566, country: 'FR' }));

let db: Db;
let alice: string;
let bob: string;
let carol: string;
let matchId: string;

async function addUser(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: T });
  return id;
}

function yes<T>(reply: Reply<T>): T {
  if (!reply.ok) {
    throw new Error(`refused with ${reply.status}: ${reply.error}`);
  }
  return reply.data;
}

const line = (userId: string, text: string, now: number, on: Db = db) => say(on, userId, matchId, { text, emote: null, scope: 'all' }, now);
const state = (userId: string, now: number, on: Db = db): Promise<MatchState> => getMatch(on, userId, matchId, now).then(yes);

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  [alice, bob, carol] = await Promise.all([addUser('alice'), addUser('bob'), addUser('carol')]);
  const lobby = yes(await createParty(db, alice, SETTINGS, T));
  matchId = yes(await joinParty(db, bob, lobby.code ?? '', T)).id;
});

describe('say', () => {
  it('adds a line that every player sees, with who said it and when', async () => {
    const mine = yes(await line(alice, 'hello there', T + SECOND));
    const entry = { id: 1, username: 'alice', text: 'hello there', emote: null, at: new Date(T + SECOND).toISOString(), scope: 'all' };
    expect(mine.chat).toEqual([entry]);
    expect((await state(bob, T + 2 * SECOND)).chat).toEqual([entry]);
  });

  it('adds a reaction, which has no text', async () => {
    yes(await line(alice, 'nice one', T));
    const after = yes(await say(db, bob, matchId, { text: null, emote: 'gg' }, T));
    expect(after.chat).toEqual([
      { id: 1, username: 'alice', text: 'nice one', emote: null, at: new Date(T).toISOString(), scope: 'all' },
      { id: 2, username: 'bob', text: null, emote: 'gg', at: new Date(T).toISOString(), scope: 'all' },
    ]);
  });

  it('masks the listed words before anything is stored', async () => {
    expect(yes(await line(alice, 'shit, so close', T)).chat[0]?.text).toBe('****, so close');
    expect(JSON.stringify(await db.query('SELECT chat FROM matches'))).not.toContain('shit');
  });

  it('holds each player to one line or reaction a second, and tells them so', async () => {
    yes(await line(alice, 'one', T));
    const tooSoon = await line(alice, 'two', T + SECOND - 1);
    expect(tooSoon).toEqual({ ok: false, status: 429, error: 'One message a second. Try again in a moment.' });
    expect(await say(db, alice, matchId, { text: null, emote: 'wow' }, T + SECOND - 1)).toMatchObject({ ok: false, status: 429 });
    expect(yes(await line(bob, 'me too', T + SECOND - 1)).chat.map((entry) => entry.text)).toEqual(['one', 'me too']);
    expect(yes(await line(alice, 'three', T + SECOND)).chat.map((entry) => entry.text)).toEqual(['one', 'me too', 'three']);
  });

  it('keeps the latest 30 entries, numbered on from where they were', async () => {
    for (let index = 0; index < 33; index += 1) {
      yes(await line(index % 2 === 0 ? alice : bob, `line ${index}`, T + index * SECOND));
    }
    const { chat } = await state(alice, T + 33 * SECOND);
    expect(chat).toHaveLength(30);
    expect(chat[0]).toMatchObject({ id: 4, text: 'line 3', username: 'bob' });
    expect(chat.at(-1)).toMatchObject({ id: 33, text: 'line 32', username: 'alice' });
    expect((await db.query<{ kept: number }>('SELECT jsonb_array_length(chat) AS kept FROM matches'))[0]?.kept).toBe(30);
  });

  it('keeps both lines when two players speak at the same moment', async () => {
    const slow = pausingAfter(db, /FROM matches/);
    await Promise.all([line(alice, 'first', T, slow), line(bob, 'second', T, slow)]);
    const { chat } = await state(alice, T);
    expect(chat.map((entry) => entry.id)).toEqual([1, 2]);
    expect(chat.map((entry) => entry.text).sort()).toEqual(['first', 'second']);
  });

  it('lets one of two lines through when a player sends both at the same moment', async () => {
    const slow = pausingAfter(db, /FROM matches/);
    const replies = await Promise.all([line(alice, 'once', T, slow), line(alice, 'once', T, slow)]);
    expect(replies.map((reply) => reply.ok).sort()).toEqual([false, true]);
    expect((await state(alice, T)).chat).toHaveLength(1);
  });

  it('works in the lobby, during a round, in the reveal and after the match is over, and changes nothing else', async () => {
    yes(await line(alice, 'in the lobby', T));
    yes(await startMatch(db, alice, matchId, T));
    yes(await postPlaces(db, alice, { matchId, places: PLACES, scaleKm: 14_916.862 }, T));
    const round = T + COUNTDOWN_MS;
    const playing = yes(await line(bob, 'during the round', round));
    expect(playing).toMatchObject({ phase: 'playing', roundEndsAt: new Date(round + 30 * SECOND).toISOString(), players: [{ guessed: false }, { guessed: false }] });

    yes(await guess(db, alice, { matchId, round: 0, lng: 0, lat: 0 }, round));
    yes(await guess(db, bob, { matchId, round: 0, lng: 0, lat: 0 }, round));
    const reveal = yes(await line(alice, 'in the reveal', round + SECOND));
    expect(reveal).toMatchObject({ phase: 'reveal', revealEndsAt: new Date(round + REVEAL_MS).toISOString() });

    yes(await leaveMatch(db, bob, matchId, round + 2 * SECOND));
    yes(await leaveMatch(db, alice, matchId, round + 2 * SECOND));
    expect((await state(alice, round + 3 * SECOND)).chat.map((entry) => entry.text)).toEqual(['in the lobby', 'during the round', 'in the reveal']);
  });

  it('is refused for a player who has left the match, though they can still read it', async () => {
    yes(await startMatch(db, alice, matchId, T));
    yes(await line(alice, 'bye then', T));
    yes(await leaveMatch(db, bob, matchId, T));
    expect(await line(bob, 'wait', T + SECOND)).toEqual({ ok: false, status: 403, error: 'You have left this match.' });
    expect((await state(bob, T + SECOND)).chat.map((entry) => entry.text)).toEqual(['bye then']);
  });

  it('is refused for someone who is not in the match, who cannot read it either', async () => {
    yes(await line(alice, 'private', T));
    expect(await line(carol, 'hi', T)).toMatchObject({ ok: false, status: 404 });
    expect(await getMatch(db, carol, matchId, T)).toMatchObject({ ok: false, status: 404 });
    expect(await say(db, alice, randomUUID(), { text: 'hi', emote: null, scope: 'all' }, T)).toMatchObject({ ok: false, status: 404 });
  });

  it('keeps the name a line was said under when its player leaves the lobby', async () => {
    yes(await line(bob, 'got to go', T));
    yes(await leaveMatch(db, bob, matchId, T));
    expect((await state(alice, T)).chat).toMatchObject([{ username: 'bob', text: 'got to go' }]);
  });

  it('adds no query to a poll, however much has been said', async () => {
    for (let index = 0; index < 30; index += 1) {
      yes(await line(alice, `line ${index}`, T + index * SECOND));
    }
    let queries = 0;
    const counting: Db = {
      query: db.query,
      transaction: (fn) =>
        db.transaction((tx) =>
          fn({
            query: (sql, params) => {
              queries += 1;
              return tx.query(sql, params);
            },
          }),
        ),
    };
    expect((await state(bob, T + 30 * SECOND, counting)).chat).toHaveLength(30);
    expect(queries).toBe(4);
  });
});
