import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { resetDb, testDb } from '../testing.js';
import type { Db } from './client.js';
import { SOLO_XP_PER_DAY, addSoloXp, addXp } from './progress.js';
import { insertUser } from './users.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60_000;

let db: Db;
let neel: string;

const standing = async () => (await db.query<{ xp: number; solo_xp: number; solo_xp_day: string | null }>('SELECT xp, solo_xp, solo_xp_day FROM users WHERE id = $1', [neel]))[0];
const days = () => db.query<{ day: string; xp: number; xp_gained: number }>('SELECT day, xp, xp_gained FROM progress_days ORDER BY day');

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  neel = randomUUID();
  await insertUser(db, { id: neel, username: 'neel', passwordHash: 'not-a-real-hash', createdAt: NOW });
});

describe('addSoloXp', () => {
  it('adds what was earned, says so, and records the day', async () => {
    expect(await addSoloXp(db, neel, 300, NOW)).toBe(300);
    expect(await addSoloXp(db, neel, 200, NOW + 1000)).toBe(200);
    expect(await standing()).toEqual({ xp: 500, solo_xp: 500, solo_xp_day: '2027-01-15' });
    expect(await days()).toEqual([{ day: '2027-01-15', xp: 500, xp_gained: 500 }]);
  });

  it('stops at the cap for the day: the game that crosses it is paid what was left, and later ones nothing', async () => {
    expect(SOLO_XP_PER_DAY).toBe(20_000);
    expect(await addSoloXp(db, neel, 19_900, NOW)).toBe(19_900);
    expect(await addSoloXp(db, neel, 500, NOW)).toBe(100);
    expect(await addSoloXp(db, neel, 500, NOW)).toBe(0);
    expect(await standing()).toMatchObject({ xp: 20_000, solo_xp: 20_000 });
    expect(await days()).toEqual([{ day: '2027-01-15', xp: 20_000, xp_gained: 20_000 }]);
  });

  it('starts again the next UTC day', async () => {
    await addSoloXp(db, neel, 25_000, NOW);
    expect(await addSoloXp(db, neel, 400, NOW + DAY)).toBe(400);
    expect(await standing()).toEqual({ xp: 20_400, solo_xp: 400, solo_xp_day: '2027-01-16' });
  });

  it('does not count XP earned in matches against the cap', async () => {
    await addXp(db, neel, 30_000, NOW);
    expect(await addSoloXp(db, neel, 400, NOW)).toBe(400);
    expect(await standing()).toMatchObject({ xp: 30_400, solo_xp: 400 });
  });

  it('gives a guest, and an account that is gone, nothing', async () => {
    const guest = await createGuest(db, NOW);
    expect(await addSoloXp(db, guest.userId, 100, NOW)).toBe(0);
    expect(await addSoloXp(db, randomUUID(), 100, NOW)).toBe(0);
    expect(await db.query('SELECT 1 FROM progress_days')).toEqual([]);
  });

  it('holds to the cap when many games are saved at the same moment', async () => {
    await addSoloXp(db, neel, 19_000, NOW);
    const gained = await Promise.all(Array.from({ length: 8 }, () => addSoloXp(db, neel, 300, NOW)));
    expect(gained.reduce((sum, one) => sum + one, 0)).toBe(1000);
    expect([...gained].sort((a, b) => b - a)).toEqual([300, 300, 300, 100, 0, 0, 0, 0]);
    expect(await standing()).toMatchObject({ xp: 20_000, solo_xp: 20_000 });
    expect(await days()).toEqual([{ day: '2027-01-15', xp: 20_000, xp_gained: 20_000 }]);
  });
});
