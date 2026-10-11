import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, testDb } from '../testing.js';
import { mapsPost } from './maps.js';
import { socialGet, socialPost } from './social.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const LOCATIONS = [0, 1, 2, 3, 4].map((index) => [`p${index}`, 2 + index, 48, 'FR']);

let db: Db;
const ids = new Map<string, string>();
const cookies = new Map<string, string>();

/** A request context in which `mod` is the one moderator. */
const at = (now: number): Context => ({ db, now, secret: TEST_SECRET, moderators: ['mod'] });

async function signUp(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW + ids.size });
  ids.set(username, id);
  cookies.set(username, `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`);
  return id;
}

const post = (as: string | null, body: unknown, now = NOW) =>
  socialPost(apiRequest('POST', '/api/social', { body, cookie: as === null ? undefined : cookies.get(as) }), at(now));
const get = (as: string | null, query: string, now = NOW) =>
  socialGet(apiRequest('GET', `/api/social${query}`, { cookie: as === null ? undefined : cookies.get(as) }), at(now));
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
const report = (as: string, username: string, category = 'other', reason?: string, now = NOW) => data(post(as, { action: 'report', username, category, reason }, now));
const decide = (username: string, decision: string) => data(post('mod', { action: 'moderate', target: 'player', username, decision }));
const mine = async (as: string, now = NOW) => (await data(get(as, '?reports=1', now))).reports;
const iso = (now: number): string => new Date(now).toISOString();

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
  await signUp('cheat');
});

describe('GET /api/social?reports=1', () => {
  it('is empty for an account that has reported nobody', async () => {
    expect(await data(get('neel', '?reports=1'))).toEqual({ reports: [] });
  });

  it('lists the players the account reported, newest first, each with what it was about, the note, when, and that it is open', async () => {
    await report('neel', 'troll', 'chat', '  swearing,\nevery round ', NOW);
    await report('neel', 'cheat', 'cheating', undefined, NOW + MINUTE);
    expect(await mine('neel')).toEqual([
      { username: 'cheat', category: 'cheating', note: '', at: iso(NOW + MINUTE), status: 'open' },
      { username: 'troll', category: 'chat', note: 'swearing, every round', at: iso(NOW), status: 'open' },
    ]);
  });

  it('shows a report made again once, as it was last made', async () => {
    await report('neel', 'troll', 'chat', 'first thoughts', NOW);
    await report('neel', 'cheat', 'cheating', undefined, NOW + MINUTE);
    await report('neel', 'troll', 'name', 'second thoughts', NOW + 2 * MINUTE);
    expect(await mine('neel')).toEqual([
      { username: 'troll', category: 'name', note: 'second thoughts', at: iso(NOW + 2 * MINUTE), status: 'open' },
      { username: 'cheat', category: 'cheating', note: '', at: iso(NOW + MINUTE), status: 'open' },
    ]);
  });

  it('is the account’s own: nobody is shown another’s reports, or who reported them', async () => {
    await report('neel', 'troll', 'chat', 'a very particular reason');
    for (const as of ['troll', 'cheat', 'mod']) {
      expect(await mine(as)).toEqual([]);
    }
    expect(await refusal(get(null, '?reports=1'))).toEqual([401, 'Sign in first.']);
    const guest = await createGuest(db, NOW);
    cookies.set('guest', `${accountCookieName(true)}=${createGuestSession(guest.userId, NOW, TEST_SECRET)}`);
    expect(await refusal(get('guest', '?reports=1'))).toEqual([403, 'Guests cannot do that. Make an account first.']);
  });

  it('says a report was acted on once a moderator bans the player, and lifting the ban changes nothing', async () => {
    await report('neel', 'troll', 'chat');
    await report('neel', 'cheat', 'cheating', undefined, NOW + MINUTE);
    await decide('troll', 'ban');
    expect((await mine('neel')).map((one: { username: string; status: string }) => [one.username, one.status])).toEqual([
      ['cheat', 'open'],
      ['troll', 'actioned'],
    ]);
    await decide('troll', 'unban');
    expect((await mine('neel')).map((one: { status: string }) => one.status)).toEqual(['open', 'actioned']);
  });

  it('says a report was dismissed when a moderator dismisses the player’s reports, each reporter’s alike', async () => {
    await report('neel', 'troll', 'chat');
    await report('cheat', 'troll', 'name');
    await report('neel', 'cheat', 'cheating', undefined, NOW + MINUTE);
    await decide('troll', 'dismiss');
    expect((await mine('neel')).map((one: { username: string; status: string }) => [one.username, one.status])).toEqual([
      ['cheat', 'open'],
      ['troll', 'dismissed'],
    ]);
    expect((await mine('cheat')).map((one: { status: string }) => one.status)).toEqual(['dismissed']);
  });

  it('leaves a decided report as it was decided: a dismissed one is not acted on by a later ban, nor an acted-on one dismissed', async () => {
    await report('neel', 'troll', 'chat');
    await decide('troll', 'dismiss');
    await decide('troll', 'ban');
    expect((await mine('neel')).map((one: { status: string }) => one.status)).toEqual(['dismissed']);

    await report('neel', 'cheat', 'cheating');
    await decide('cheat', 'ban');
    await decide('cheat', 'dismiss');
    expect((await mine('neel')).map((one: { username: string; status: string }) => [one.username, one.status])).toContainEqual(['cheat', 'actioned']);
  });

  it('opens a report again when the player is reported again', async () => {
    await report('neel', 'troll', 'chat', 'first', NOW);
    await decide('troll', 'dismiss');
    await report('neel', 'troll', 'chat', 'again', NOW + MINUTE);
    expect(await mine('neel')).toEqual([{ username: 'troll', category: 'chat', note: 'again', at: iso(NOW + MINUTE), status: 'open' }]);
  });

  it('does not list a report of an account that has since been deleted, and lists it again if the account is restored', async () => {
    await report('neel', 'troll', 'chat');
    await db.query('UPDATE users SET deleted_at = $2 WHERE id = $1', [ids.get('troll'), new Date(NOW)]);
    expect(await mine('neel')).toEqual([]);
    await db.query('UPDATE users SET deleted_at = NULL WHERE id = $1', [ids.get('troll')]);
    expect(await mine('neel')).toHaveLength(1);
  });

  it('goes by the name the reported player has now', async () => {
    await report('neel', 'troll', 'name');
    await data(post('troll', { action: 'rename', username: 'reformed' }));
    expect((await mine('neel')).map((one: { username: string }) => one.username)).toEqual(['reformed']);
  });

  it('does not list reports of maps', async () => {
    const maps = (as: string, body: unknown) => mapsPost(apiRequest('POST', '/api/maps', { body, cookie: cookies.get(as) }), at(NOW));
    const { slug } = await data(maps('troll', { action: 'save', name: 'Rude map', description: 'Five places in a line across France.', locations: LOCATIONS }));
    await data(maps('neel', { action: 'report', slug, reason: 'not places at all' }));
    expect(await mine('neel')).toEqual([]);
  });

  it('shows the newest fifty', async () => {
    for (let index = 0; index < 52; index += 1) {
      const id = randomUUID();
      await insertUser(db, { id, username: `player${index}`, passwordHash: 'not-a-real-hash', createdAt: NOW });
      await db.query("INSERT INTO player_reports (target_id, reporter_id, reason, created_at, category) VALUES ($1, $2, '', $3::timestamptz, 'other')", [
        id,
        ids.get('neel'),
        new Date(NOW + index * MINUTE),
      ]);
    }
    const listed = await mine('neel');
    expect(listed).toHaveLength(50);
    expect(listed[0].username).toBe('player51');
    expect(listed[49].username).toBe('player2');
  });

  it.each(['dismiss', 'ban'])('keeps a report made at the same moment as a moderator’s %s, open or decided, whichever came first', async (decision) => {
    await report('neel', 'troll', 'chat', 'first', NOW);
    const [reported, decided] = await Promise.all([
      post('neel', { action: 'report', username: 'troll', category: 'cheating', reason: 'again' }, NOW + MINUTE),
      post('mod', { action: 'moderate', target: 'player', username: 'troll', decision }),
    ]);
    expect([reported.status, decided.status]).toEqual([200, 200]);
    const [kept, ...others] = await mine('neel', NOW + MINUTE);
    expect(others).toEqual([]);
    expect(kept).toMatchObject({ username: 'troll', category: 'cheating', note: 'again', at: iso(NOW + MINUTE) });
    expect(['open', decision === 'ban' ? 'actioned' : 'dismissed']).toContain(kept.status);
    // What the moderator is shown agrees with what the reporter is.
    const view = await data(get('mod', '?moderation=1'));
    const listed = view.players.find((player: { username: string }) => player.username === 'troll');
    expect(listed?.reports ?? 0).toBe(kept.status === 'open' ? 1 : 0);
  });
});
