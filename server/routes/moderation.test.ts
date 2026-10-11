import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountCookieName, createAccountSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { dailyRounds, placesOn, streakRounds } from '../games/testing.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, scoredRound, testDb } from '../testing.js';
import { account } from './account.js';
import { daily, dailyPost } from './daily.js';
import { saveGame } from './games.js';
import { mapsGet, mapsPost } from './maps.js';
import { matchGet, matchPost } from './match.js';
import { socialGet, socialPost } from './social.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const BANNED = [403, 'This account is banned from online play.'];
const MODERATORS_ONLY = [403, 'Moderators only.'];
const SETTINGS = { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 };
// A match takes only places of its map, so these are three of the world's own.
const PLACES = placesOn('world', 3).map(({ id, lng, lat, country }) => ({ id, lng, lat, country }));
const [FIRST_PLACE = { lng: 0, lat: 0 }] = PLACES;
const LOCATIONS = [0, 1, 2, 3, 4].map((index) => [`p${index}`, 2 + index, 48, 'FR']);
const NOTHING_REPORTED = { maps: [], players: [] };

let db: Db;
const ids = new Map<string, string>();
const cookies = new Map<string, string>();

/** A request context in which `mod` is the one moderator, unless told otherwise. */
const at = (now: number, moderators: readonly string[] | null = ['mod']): Context => ({
  db,
  now,
  secret: TEST_SECRET,
  ...(moderators === null ? {} : { moderators }),
});

async function signUp(username: string, standing: Record<string, number | boolean> = {}): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW + ids.size });
  for (const [column, value] of Object.entries(standing)) {
    // Column names here come from the tests below, never from input.
    await db.query(`UPDATE users SET ${column} = $2 WHERE id = $1`, [id, value]);
  }
  ids.set(username, id);
  cookies.set(username, `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`);
  return id;
}

type Route = (request: Request, context: Context) => Promise<Response>;
const cookieOf = (as: string | null): string | undefined => (as === null ? undefined : cookies.get(as));
const posting = (route: Route, path: string) => (as: string | null, body: unknown, now = NOW) => route(apiRequest('POST', path, { body, cookie: cookieOf(as) }), at(now));
const getting = (route: Route, path: string) => (as: string | null, query = '', now = NOW) => route(apiRequest('GET', `${path}${query}`, { cookie: cookieOf(as) }), at(now));
const social = posting(socialPost, '/api/social');
const match = posting(matchPost, '/api/match');
const maps = posting(mapsPost, '/api/maps');
const seeSocial = getting(socialGet, '/api/social');
const seeMaps = getting(mapsGet, '/api/maps');
const seeMatch = getting(matchGet, '/api/match');

const data = async (response: Response | Promise<Response>) => {
  const body = await (await response).json();
  if (!body.success) {
    throw new Error(body.error);
  }
  return body.data;
};
const refusal = async (response: Response | Promise<Response>) => {
  const sent = await response;
  return [sent.status, (await sent.json()).error];
};
const me = async (as: string, moderators: readonly string[] | null = ['mod']) =>
  (await (await account(apiRequest('GET', '/api/account', { cookie: cookieOf(as) }), at(NOW, moderators))).json()).data.account;
const moderation = () => data(seeSocial('mod', '?moderation=1'));
const decide = (decision: Record<string, unknown>, as: string | null = 'mod') => social(as, { action: 'moderate', ...decision });
/** What signing in again gives a player: a session at the version their account is now at. */
async function signInAgain(username: string): Promise<void> {
  const name = username.toLowerCase();
  const [row] = await db.query<{ id: string; session_version: number }>('SELECT id, session_version FROM users WHERE username = $1', [name]);
  cookies.set(name, `${accountCookieName(true)}=${createAccountSession(row?.id ?? '', NOW, TEST_SECRET, row?.session_version ?? 0)}`);
}
/** Bans a player. A ban signs them out everywhere; in these tests they sign straight back in, to see what a banned account may do. */
const ban = async (username: string) => {
  const view = await data(decide({ target: 'player', username, decision: 'ban' }));
  await signInAgain(username);
  return view;
};
const publish = async (as: string, name = 'Across France'): Promise<string> =>
  (await data(maps(as, { action: 'save', name, description: 'Five places in a line across France.', locations: LOCATIONS }))).slug;

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  ids.clear();
  cookies.clear();
  await signUp('mod');
  await signUp('neel');
  await signUp('troll');
});

describe('who is a moderator', () => {
  it('is whoever the setting names, and nobody when there is no setting', async () => {
    expect(await me('mod')).toMatchObject({ username: 'mod', moderator: true, banned: false });
    expect(await me('neel')).toMatchObject({ moderator: false, banned: false });
    expect(await me('mod', [])).toMatchObject({ moderator: false });
    expect(await me('mod', null)).toMatchObject({ moderator: false });
    expect(await me('neel', ['mod', 'neel'])).toMatchObject({ moderator: true });
  });

  it('cannot change their username, which is what makes them one', async () => {
    expect(await refusal(social('mod', { action: 'rename', username: 'someone_else' }))).toEqual([409, "A moderator's username cannot be changed."]);
    expect((await me('mod')).username).toBe('mod');
  });

  it('cannot be become by taking a name the setting lists', async () => {
    const context: Context = { db, now: NOW, secret: TEST_SECRET, moderators: ['mod', 'not_registered_yet'] };
    const request = apiRequest('POST', '/api/social', { body: { action: 'rename', username: 'Not_Registered_Yet' }, cookie: cookieOf('troll') });
    const response = await socialPost(request, context);
    expect([response.status, (await response.json()).error]).toEqual([409, 'That username is taken. Choose another.']);
    expect((await me('troll')).username).toBe('troll');
  });
});

describe('reporting a player', () => {
  const report = (as: string | null, username: unknown, reason?: unknown, now = NOW, category: unknown = 'other') =>
    social(as, { action: 'report', username, category, reason }, now);
  const NO_CATEGORY = [400, 'Say what the report is about: cheating, name, chat or other.'];

  it('stores what it is about and the note, and answers only that it was reported', async () => {
    const response = await report('neel', 'Troll', '  swearing in chat,\nevery round ', NOW, 'chat');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { reported: true } });
    expect(await db.query('SELECT target_id, reporter_id, category, reason, status FROM player_reports')).toEqual([
      { target_id: ids.get('troll'), reporter_id: ids.get('neel'), category: 'chat', reason: 'swearing in chat, every round', status: 'open' },
    ]);
  });

  it.each(['cheating', 'name', 'chat', 'other'])('takes a report about %s, with or without a note', async (category) => {
    expect((await report('neel', 'troll', undefined, NOW, category)).status).toBe(200);
    expect(await db.query('SELECT category, reason FROM player_reports')).toEqual([{ category, reason: '' }]);
  });

  it('refuses one that does not say what it is about at all', async () => {
    expect(await refusal(social('neel', { action: 'report', username: 'troll', reason: 'x' }))).toEqual(NO_CATEGORY);
    expect(await refusal(social('neel', { action: 'report', username: 'troll' }))).toEqual(NO_CATEGORY);
    expect(await db.query('SELECT 1 FROM player_reports')).toEqual([]);
  });

  it.each([['spam'], ['Cheating'], [''], [7], [null], [['chat']]])('refuses one that is about %j, which is nothing a report can be about', async (category) => {
    expect(await refusal(report('neel', 'troll', 'x', NOW, category))).toEqual(NO_CATEGORY);
    // A name that is nobody's is still only that: what the report is about is looked at for a name that could be one.
    expect(await refusal(report('neel', 'not a username!', 'x', NOW, category))).toEqual([404, 'No player by that name.']);
    expect(await db.query('SELECT 1 FROM player_reports')).toEqual([]);
  });

  it('keeps one report from each reporter for each player: a newer one replaces it', async () => {
    await data(report('neel', 'troll', 'first thoughts', NOW, 'chat'));
    await data(report('neel', 'troll', 'second thoughts', NOW + MINUTE, 'cheating'));
    await data(report('mod', 'troll'));
    await data(report('neel', 'mod', 'another player'));
    expect(await db.query('SELECT category, reason FROM player_reports ORDER BY reason')).toEqual([
      { category: 'other', reason: '' },
      { category: 'other', reason: 'another player' },
      { category: 'cheating', reason: 'second thoughts' },
    ]);
  });

  it.each(['dismiss', 'ban'])('is open again when the player is reported again after a moderator’s %s', async (decision) => {
    await data(report('neel', 'troll', 'first thoughts'));
    await data(decide({ target: 'player', username: 'troll', decision }));
    expect((await moderation()).players.map((player: { reports: number }) => player.reports)).toEqual(decision === 'ban' ? [0] : []);

    await data(report('neel', 'troll', 'at it again', NOW + MINUTE, 'cheating'));
    expect(await db.query('SELECT category, reason, status FROM player_reports')).toEqual([{ category: 'cheating', reason: 'at it again', status: 'open' }]);
    expect((await moderation()).players).toEqual([
      { username: 'troll', reports: 1, reasons: [{ category: 'cheating', note: 'at it again' }], banned: decision === 'ban' },
    ]);
  });

  it('takes a reason of 200 characters and refuses one of 201', async () => {
    expect((await report('neel', 'troll', 'r'.repeat(200))).status).toBe(200);
    expect(await refusal(report('neel', 'troll', 'r'.repeat(201)))).toEqual([400, 'A reason is up to 200 characters.']);
    expect(await refusal(report('neel', 'troll', 42))).toEqual([400, 'A reason is up to 200 characters.']);
  });

  it('says only "No player by that name" for a name that is nobody’s', async () => {
    for (const username of ['nobody', 'not a username!', '', 42, undefined]) {
      expect(await refusal(report('neel', username, 'x'))).toEqual([404, 'No player by that name.']);
    }
    expect(await db.query('SELECT 1 FROM player_reports')).toEqual([]);
  });

  it('refuses a report of oneself, a visitor, and a request from another site', async () => {
    expect(await refusal(report('neel', 'NEEL', 'x'))).toEqual([400, 'You cannot report yourself.']);
    expect(await refusal(report(null, 'troll', 'x'))).toEqual([401, 'Sign in first.']);
    const crossSite = apiRequest('POST', '/api/social', {
      body: { action: 'report', username: 'troll', category: 'other' },
      cookie: cookieOf('neel'),
      headers: { origin: 'https://evil.example' },
    });
    expect((await socialPost(crossSite, at(NOW))).status).toBe(403);
    expect(await db.query('SELECT 1 FROM player_reports')).toEqual([]);
  });

  it('cannot be done without end', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      statuses.push((await report('neel', 'troll', `again ${index}`)).status);
    }
    expect(statuses).toEqual([...Array.from({ length: 20 }, () => 200), 429]);
  });

  it('shows the report to nobody but a moderator: not the reporter, not the reported, not a visitor', async () => {
    await data(report('neel', 'troll', 'a very particular reason'));
    for (const as of ['neel', 'troll', null]) {
      const seen = JSON.stringify([
        await data(seeSocial(as, '?profile=troll')),
        await data(seeSocial(as, '?leaderboard=xp')),
        as === null ? null : await data(seeSocial(as, '?friends=1')),
        as === null ? null : await me(as),
      ]);
      expect(seen).not.toContain('particular');
      expect(await refusal(seeSocial(as, '?moderation=1'))).toEqual(MODERATORS_ONLY);
    }
  });
});

describe('GET /api/social?moderation=1', () => {
  it('is for moderators only', async () => {
    expect(await refusal(seeSocial('neel', '?moderation=1'))).toEqual(MODERATORS_ONLY);
    expect(await refusal(seeSocial(null, '?moderation=1'))).toEqual(MODERATORS_ONLY);
    const noSetting = await socialGet(apiRequest('GET', '/api/social?moderation=1', { cookie: cookieOf('mod') }), at(NOW, null));
    expect(noSetting.status).toBe(403);
    expect((await seeSocial('mod', '?moderation=1')).status).toBe(200);
  });

  it('is empty when nothing has been reported and nobody is banned', async () => {
    expect(await moderation()).toEqual(NOTHING_REPORTED);
  });

  it('lists each reported map and player with how often and why, newest reason first, and never by whom', async () => {
    await signUp('other');
    const slug = await publish('troll', 'Rude map');
    await publish('neel', 'Fine map');
    await data(maps('neel', { action: 'report', slug, reason: 'older reason' }, NOW));
    await data(maps('other', { action: 'report', slug, reason: 'newer reason' }, NOW + MINUTE));
    await data(social('neel', { action: 'report', username: 'troll', category: 'chat', reason: 'rude' }, NOW));
    await data(social('other', { action: 'report', username: 'troll', category: 'cheating' }, NOW + MINUTE));
    await data(social('troll', { action: 'report', username: 'neel', category: 'name', reason: 'revenge' }, NOW + 2 * MINUTE));

    const view = await moderation();
    expect(view).toEqual({
      maps: [{ slug, name: 'Rude map', maker: 'troll', reports: 2, reasons: ['newer reason', 'older reason'] }],
      players: [
        {
          username: 'troll',
          reports: 2,
          reasons: [
            { category: 'cheating', note: '' },
            { category: 'chat', note: 'rude' },
          ],
          banned: false,
        },
        { username: 'neel', reports: 1, reasons: [{ category: 'name', note: 'revenge' }], banned: false },
      ],
    });
    const sent = JSON.stringify(view);
    for (const reporter of ['other', ids.get('other'), ids.get('neel'), ids.get('troll')]) {
      expect(sent).not.toContain(reporter);
    }
  });

  it('shows the ten newest reasons, and counts them all', async () => {
    for (let index = 0; index < 12; index += 1) {
      await signUp(`reporter${index}`);
      await data(social(`reporter${index}`, { action: 'report', username: 'troll', category: 'chat', reason: `reason ${index}` }, NOW + index * SECOND));
    }
    const [reported] = (await moderation()).players;
    expect(reported.reports).toBe(12);
    expect(reported.reasons).toEqual(Array.from({ length: 10 }, (_unused, index) => ({ category: 'chat', note: `reason ${11 - index}` })));
  });

  it('counts and shows open reports only: not the ones a moderator has dismissed or acted on', async () => {
    await signUp('other');
    await data(social('neel', { action: 'report', username: 'troll', category: 'chat', reason: 'rude' }, NOW));
    await data(decide({ target: 'player', username: 'troll', decision: 'dismiss' }));
    await data(social('other', { action: 'report', username: 'troll', category: 'name', reason: 'that name' }, NOW + MINUTE));
    expect((await moderation()).players).toEqual([{ username: 'troll', reports: 1, reasons: [{ category: 'name', note: 'that name' }], banned: false }]);

    await ban('troll');
    await data(social('mod', { action: 'report', username: 'troll', category: 'cheating' }, NOW + 2 * MINUTE));
    expect((await moderation()).players).toEqual([{ username: 'troll', reports: 1, reasons: [{ category: 'cheating', note: '' }], banned: true }]);
    expect(await db.query('SELECT status, count(*)::int AS reports FROM player_reports GROUP BY status ORDER BY status')).toEqual([
      { status: 'actioned', reports: 1 },
      { status: 'dismissed', reports: 1 },
      { status: 'open', reports: 1 },
    ]);
  });

  it('does not list a player who has deleted their account, until they restore it', async () => {
    await data(social('neel', { action: 'report', username: 'troll', category: 'chat', reason: 'rude' }));
    await db.query('UPDATE users SET deleted_at = $2 WHERE id = $1', [ids.get('troll'), new Date(NOW)]);
    expect(await moderation()).toEqual(NOTHING_REPORTED);
    expect(await refusal(decide({ target: 'player', username: 'troll', decision: 'ban' }))).toEqual([404, 'No player by that name.']);
    await db.query('UPDATE users SET deleted_at = NULL WHERE id = $1', [ids.get('troll')]);
    expect((await moderation()).players).toEqual([{ username: 'troll', reports: 1, reasons: [{ category: 'chat', note: 'rude' }], banned: false }]);
  });

  it('keeps a banned player listed after their reports are dismissed, so the ban can be lifted', async () => {
    await data(social('neel', { action: 'report', username: 'troll', category: 'chat', reason: 'rude' }));
    await ban('troll');
    expect(await data(decide({ target: 'player', username: 'troll', decision: 'dismiss' }))).toEqual({
      maps: [],
      players: [{ username: 'troll', reports: 0, reasons: [], banned: true }],
    });
    expect(await data(decide({ target: 'player', username: 'troll', decision: 'unban' }))).toEqual(NOTHING_REPORTED);
  });
});

describe('a moderator’s decision', () => {
  it('is for moderators only, and changes nothing for anyone else', async () => {
    const slug = await publish('troll');
    expect(await refusal(decide({ target: 'player', username: 'neel', decision: 'ban' }, 'troll'))).toEqual(MODERATORS_ONLY);
    expect(await refusal(decide({ target: 'map', slug, decision: 'remove' }, 'neel'))).toEqual(MODERATORS_ONLY);
    expect(await refusal(decide({ target: 'player', username: 'neel', decision: 'ban' }, null))).toEqual([401, 'Sign in first.']);
    expect((await me('neel')).banned).toBe(false);
    expect((await seeMaps(null, `?slug=${slug}`)).status).toBe(200);
  });

  it('dismisses the reports of a map and leaves the map', async () => {
    const slug = await publish('neel');
    await data(maps('troll', { action: 'report', slug, reason: 'out of spite' }));
    expect(await data(decide({ target: 'map', slug, decision: 'dismiss' }))).toEqual(NOTHING_REPORTED);
    expect((await seeMaps(null, `?slug=${slug}`)).status).toBe(200);
    expect(await db.query('SELECT 1 FROM map_reports')).toEqual([]);
  });

  it('removes a map just as its maker deleting it would: gone, with its likes and reports', async () => {
    const slug = await publish('troll');
    await data(maps('neel', { action: 'like', slug, liked: true }));
    await data(maps('neel', { action: 'report', slug, reason: 'not places at all' }));
    expect(await data(decide({ target: 'map', slug, decision: 'remove' }))).toEqual(NOTHING_REPORTED);
    expect((await seeMaps(null, `?slug=${slug}`)).status).toBe(404);
    expect((await data(seeMaps('troll', '?list=mine'))).maps).toEqual([]);
    for (const table of ['community_maps', 'map_likes', 'map_reports']) {
      expect(await db.query(`SELECT 1 FROM ${table}`)).toEqual([]);
    }
  });

  it('bans a player and lifts the ban, which the player’s own account says', async () => {
    expect(await ban('Troll')).toEqual({ maps: [], players: [{ username: 'troll', reports: 0, reasons: [], banned: true }] });
    expect(await me('troll')).toMatchObject({ banned: true, moderator: false });
    expect((await me('neel')).banned).toBe(false);
    await data(decide({ target: 'player', username: 'troll', decision: 'unban' }));
    expect((await me('troll')).banned).toBe(false);
  });

  it('dismisses the reports of a player without banning them, and keeps them for whoever made them to see', async () => {
    await data(social('troll', { action: 'report', username: 'neel', category: 'other', reason: 'revenge' }));
    expect(await data(decide({ target: 'player', username: 'neel', decision: 'dismiss' }))).toEqual(NOTHING_REPORTED);
    expect((await me('neel')).banned).toBe(false);
    expect(await db.query('SELECT reason, status FROM player_reports')).toEqual([{ reason: 'revenge', status: 'dismissed' }]);
  });

  it('answers 404 for a map or a player that does not exist', async () => {
    expect(await refusal(decide({ target: 'map', slug: 'no-such-map', decision: 'remove' }))).toEqual([404, 'There is no such map.']);
    expect(await refusal(decide({ target: 'map', slug: 'no-such-map', decision: 'dismiss' }))).toEqual([404, 'There is no such map.']);
    expect(await refusal(decide({ target: 'player', username: 'nobody', decision: 'ban' }))).toEqual([404, 'No player by that name.']);
  });

  it.each([
    ['no target', { decision: 'ban', username: 'troll' }],
    ['a target that is neither', { target: 'party', decision: 'remove' }],
    ['a decision for the other kind of target', { target: 'map', slug: 'some-map', decision: 'ban' }],
    ['another decision for the other kind', { target: 'player', username: 'troll', decision: 'remove' }],
    ['a map with no slug', { target: 'map', decision: 'remove' }],
    ['a player with no name', { target: 'player', decision: 'ban' }],
    ['a slug that could not be one', { target: 'map', slug: 'Not A Slug', decision: 'dismiss' }],
  ])('refuses %s', async (_name, decision) => {
    const response = await decide(decision);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^Say whether it is a map or a player/);
    expect((await me('troll')).banned).toBe(false);
  });

  it('signs the banned player out of every browser, once: they can sign in again, banned, and banning them again ends nothing', async () => {
    const before = cookieOf('troll');
    await ban('troll');
    const withOld = (route: Route, path: string) => route(apiRequest('GET', path, { cookie: before }), at(NOW));
    expect((await withOld(matchGet, '/api/match?queue=1')).status).toBe(401);
    expect((await (await withOld(account, '/api/account')).json()).data.account).toBeNull();
    expect((await me('troll')).banned).toBe(true);
    // Already banned: the session made since still stands.
    await data(decide({ target: 'player', username: 'troll', decision: 'ban' }));
    expect((await me('troll')).banned).toBe(true);
    await data(decide({ target: 'player', username: 'troll', decision: 'unban' }));
    expect((await me('troll')).banned).toBe(false);
  });

  it('can still be made by a moderator who has been banned, to lift it', async () => {
    await ban('mod');
    expect(await me('mod')).toMatchObject({ moderator: true, banned: true });
    expect((await decide({ target: 'player', username: 'mod', decision: 'unban' })).status).toBe(200);
    expect((await me('mod')).banned).toBe(false);
  });
});

describe('a banned account', () => {
  let lobby: { id: string; code: string };
  let slug: string;

  beforeEach(async () => {
    lobby = await data(match('neel', { action: 'create', settings: SETTINGS }));
    slug = await publish('neel');
    // Friends before the ban, with a request waiting each way of the other kind.
    await signUp('asker');
    await data(social('troll', { action: 'request', username: 'neel' }));
    await data(social('neel', { action: 'accept', username: 'troll' }));
    await data(social('asker', { action: 'request', username: 'troll' }));
    await ban('troll');
  });

  it.each([
    ['queue for a match', () => match('troll', { action: 'queue', kind: 'unranked' })],
    ['queue for a ranked duel', () => match('troll', { action: 'queue', kind: 'ranked' })],
    ['open a party', () => match('troll', { action: 'create', settings: SETTINGS })],
    ['join a party', () => match('troll', { action: 'join', code: lobby.code })],
    ['start a match', () => match('troll', { action: 'start', matchId: lobby.id })],
    ['chat', () => match('troll', { action: 'chat', matchId: lobby.id, text: 'hello' })],
    ['send a reaction', () => match('troll', { action: 'emote', matchId: lobby.id, emote: 'gg' })],
    ['ask to be friends', () => social('troll', { action: 'request', username: 'mod' })],
    ['accept a friend', () => social('troll', { action: 'accept', username: 'asker' })],
    ['decline a friend', () => social('troll', { action: 'decline', username: 'asker' })],
    ['remove a friend', () => social('troll', { action: 'remove', username: 'neel' })],
    ['invite a friend', () => social('troll', { action: 'invite', username: 'neel', code: lobby.code })],
    ['report a player', () => social('troll', { action: 'report', username: 'neel', category: 'other', reason: 'revenge' })],
    ['make a map', () => maps('troll', { action: 'save', name: 'Another map', locations: LOCATIONS })],
    ['like a map', () => maps('troll', { action: 'like', slug, liked: true })],
    ['report a map', () => maps('troll', { action: 'report', slug, reason: 'revenge' })],
  ])('cannot %s', async (_name, attempt) => {
    expect(await refusal(attempt())).toEqual(BANNED);
  });

  it('is told so before anything else about the request is looked at, and it is not counted against any limit', async () => {
    const counted = () => db.query(`SELECT key, count FROM rate_limits WHERE key LIKE '%' || $1 ORDER BY key`, [ids.get('troll')]);
    const before = await counted();
    expect(await refusal(match('troll', { action: 'join', code: 'NOSUCH' }))).toEqual(BANNED);
    expect(await refusal(maps('troll', { action: 'save', name: 'x' }))).toEqual(BANNED);
    expect(await refusal(social('troll', { action: 'request', username: 'nobody' }))).toEqual(BANNED);
    expect(await counted()).toEqual(before);
  });

  it('left nothing behind from what it tried', async () => {
    await match('troll', { action: 'queue', kind: 'unranked' });
    await social('troll', { action: 'remove', username: 'neel' });
    await maps('troll', { action: 'like', slug, liked: true });
    expect(await db.query('SELECT 1 FROM match_queue')).toEqual([]);
    expect((await data(seeSocial('neel', '?friends=1'))).friends).toMatchObject([{ username: 'troll' }]);
    expect(await db.query('SELECT 1 FROM map_likes')).toEqual([]);
  });

  it('can still sign in, see its account, and play alone: games, the daily, streaks and community maps', async () => {
    expect(await me('troll')).toMatchObject({ username: 'troll', banned: true });
    const body = { map: 'world', mode: 'move', timeLimit: 0, seed: 'solo', rounds: [scoredRound(5000)] };
    const saved = await saveGame(apiRequest('POST', '/api/games', { body, cookie: cookieOf('troll') }), at(NOW));
    expect(saved.status).toBe(201);
    const games = (body: unknown, now: number) => saveGame(apiRequest('POST', '/api/games', { body, cookie: cookieOf('troll') }), at(now));
    const { run } = await data(games({ action: 'start', kind: 'streak' }, NOW));
    const streak = await games({ kind: 'streak', run, rounds: streakRounds(3) }, NOW + MINUTE);
    expect(streak.status).toBe(200);
    expect((await daily(apiRequest('GET', '/api/daily', { cookie: cookieOf('troll') }), at(NOW))).status).toBe(200);
    expect((await maps('troll', { action: 'play', slug })).status).toBe(200);
    expect((await seeMaps('troll', `?slug=${slug}`)).status).toBe(200);
    expect((await seeSocial('troll', '?friends=1')).status).toBe(200);
    expect((await match('troll', { action: 'leaveQueue' })).status).toBe(200);
    expect((await social('troll', { action: 'rename', username: 'reformed' })).status).toBe(200);
  });

  it('is welcome again once the ban is lifted', async () => {
    await data(decide({ target: 'player', username: 'troll', decision: 'unban' }));
    expect((await match('troll', { action: 'join', code: lobby.code })).status).toBe(200);
    expect((await maps('troll', { action: 'like', slug, liked: true })).status).toBe(200);
  });
});

describe('a player banned while playing', () => {
  it('plays the match out, guesses and all, but cannot chat in it', async () => {
    const lobby = await data(match('neel', { action: 'create', settings: SETTINGS }));
    await data(match('troll', { action: 'join', code: lobby.code }));
    await data(match('neel', { action: 'start', matchId: lobby.id }));
    const placed = await data(match('neel', { action: 'places', matchId: lobby.id, places: PLACES, scaleKm: 14_916.862 }));
    await ban('troll');

    const round = Date.parse(placed.roundStartsAt);
    expect(await refusal(match('troll', { action: 'chat', matchId: lobby.id, text: 'unfair' }, round))).toEqual(BANNED);
    expect(await refusal(match('troll', { action: 'emote', matchId: lobby.id, emote: 'oof' }, round))).toEqual(BANNED);
    expect((await seeMatch('troll', `?id=${lobby.id}`, round)).status).toBe(200);
    const guessed = await data(match('troll', { action: 'guess', matchId: lobby.id, round: 0, lng: FIRST_PLACE.lng, lat: FIRST_PLACE.lat }, round));
    expect(guessed.players[1]).toMatchObject({ username: 'troll', guessed: true, active: true });
    const revealed = await data(match('neel', { action: 'guess', matchId: lobby.id, round: 0, lng: 0, lat: 0 }, round));
    expect(revealed.results[0].guesses[1]).toMatchObject({ username: 'troll', score: 5000 });
    expect(await data(match('troll', { action: 'leave', matchId: lobby.id }, round))).toEqual({ left: true });
  });

  it('can still post the places when it is the one picking them', async () => {
    const lobby = await data(match('troll', { action: 'create', settings: SETTINGS }));
    await data(match('neel', { action: 'join', code: lobby.code }));
    await data(match('troll', { action: 'start', matchId: lobby.id }));
    await ban('troll');
    expect((await match('troll', { action: 'places', matchId: lobby.id, places: PLACES, scaleKm: 14_916.862 })).status).toBe(200);
  });

  it('is taken out of the queue it was waiting in, and is not matched', async () => {
    await data(match('troll', { action: 'queue', kind: 'ranked' }));
    await ban('troll');
    expect(await db.query('SELECT 1 FROM match_queue')).toEqual([]);
    expect(await data(match('neel', { action: 'queue', kind: 'ranked' }))).toMatchObject({ queued: true, waiting: 1, matchId: null });
    expect(await data(seeMatch('troll', '?queue=1'))).toMatchObject({ queued: false, matchId: null });
  });
});

describe('what a banned account made and earned', () => {
  it('has its maps left out of the lists everyone sees, but not out of its own, and puts them back when the ban is lifted', async () => {
    const theirs = await publish('troll', 'By the troll');
    await publish('neel', 'By neel');
    await ban('troll');
    const names = async (as: string | null, list: string) => (await data(seeMaps(as, `?list=${list}`))).maps.map((entry: { name: string }) => entry.name);
    for (const as of ['neel', 'mod', null]) {
      expect(await names(as, 'newest')).toEqual(['By neel']);
      expect(await names(as, 'popular')).toEqual(['By neel']);
    }
    expect(await names('troll', 'newest')).toEqual(['By neel']);
    expect(await names('troll', 'mine')).toEqual(['By the troll']);
    expect((await data(seeMaps(null, '?list=newest&q=troll'))).maps).toEqual([]);
    // A link straight to the map no longer opens it for anyone but its maker, who can still take it down.
    for (const as of ['neel', 'mod', null]) {
      expect(await refusal(seeMaps(as, `?slug=${theirs}`))).toEqual([404, 'There is no such map.']);
    }
    expect(await data(seeMaps('troll', `?slug=${theirs}`))).toMatchObject({ slug: theirs, maker: 'troll', mine: true });

    await data(decide({ target: 'player', username: 'troll', decision: 'unban' }));
    expect((await seeMaps(null, `?slug=${theirs}`)).status).toBe(200);
    expect(await names(null, 'newest')).toEqual(['By neel', 'By the troll']);
    await ban('troll');
    expect(await data(maps('troll', { action: 'delete', slug: theirs }))).toEqual({ deleted: true });
  });

  it('is left out of every leaderboard, where the players below move up, and is told no place of its own', async () => {
    await signUp('first', { xp: 900, rating: 1500, rated_games: 3, best_streak: 30 });
    await signUp('cheat', { xp: 800, rating: 1400, rated_games: 3, best_streak: 20 });
    await signUp('third', { xp: 700, rating: 1300, rated_games: 3, best_streak: 10 });
    await ban('cheat');
    for (const board of ['xp', 'rating', 'streak']) {
      const seen = await data(seeSocial('third', `?leaderboard=${board}`));
      expect(seen.entries.map((entry: { rank: number; username: string }) => [entry.rank, entry.username])).toEqual([
        [1, 'first'],
        [2, 'third'],
      ]);
      expect(seen.you.rank).toBe(2);
      expect((await data(seeSocial('cheat', `?leaderboard=${board}`))).you).toBeNull();
    }
    await data(decide({ target: 'player', username: 'cheat', decision: 'unban' }));
    expect((await data(seeSocial('cheat', '?leaderboard=xp'))).you).toEqual({ rank: 2, value: 800 });
  });

  it('is left out of the daily leaderboard, though its own result still stands', async () => {
    const today = async (as: string | null) => (await (await daily(apiRequest('GET', '/api/daily', { cookie: cookieOf(as) }), at(NOW))).json()).data;
    const { seed, settings } = await today(null);
    const body = { ...settings, seed, daily: '2027-01-15', rounds: dailyRounds('2027-01-15', [4000, 0, 0]) };
    for (const as of ['troll', 'neel']) {
      // The daily is started before it is finished, and takes at least a few seconds to play.
      expect((await dailyPost(apiRequest('POST', '/api/daily', { body: { action: 'start' }, cookie: cookieOf(as) }), at(NOW))).status).toBe(200);
      expect((await saveGame(apiRequest('POST', '/api/games', { body, cookie: cookieOf(as) }), at(NOW + MINUTE))).status).toBe(201);
    }
    await ban('troll');
    expect((await today(null)).leaderboard.entries).toEqual([{ rank: 1, username: 'neel', country: null, score: 4000 }]);
    expect((await today('troll')).yours).toMatchObject({ score: 4000, maxScore: 15_000 });
  });
});
