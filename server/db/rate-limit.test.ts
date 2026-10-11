import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, testDb } from '../testing.js';
import type { Db } from './client.js';
import { hitRateLimit, purgeRateLimits } from './rate-limit.js';

const NOW = 1_800_000_000_000;
const WINDOW_MS = 60_000;

let db: Db;

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
});

describe('hitRateLimit', () => {
  it('allows hits up to the limit, then refuses', async () => {
    expect(await hitRateLimit(db, 'login:a', 2, WINDOW_MS, NOW)).toBe(true);
    expect(await hitRateLimit(db, 'login:a', 2, WINDOW_MS, NOW + 1)).toBe(true);
    expect(await hitRateLimit(db, 'login:a', 2, WINDOW_MS, NOW + 2)).toBe(false);
    expect(await hitRateLimit(db, 'login:a', 2, WINDOW_MS, NOW + WINDOW_MS - 1)).toBe(false);
  });

  it('starts counting again once the window has passed', async () => {
    await hitRateLimit(db, 'login:a', 1, WINDOW_MS, NOW);
    expect(await hitRateLimit(db, 'login:a', 1, WINDOW_MS, NOW + 1)).toBe(false);
    expect(await hitRateLimit(db, 'login:a', 1, WINDOW_MS, NOW + WINDOW_MS)).toBe(true);
    expect(await hitRateLimit(db, 'login:a', 1, WINDOW_MS, NOW + WINDOW_MS + 1)).toBe(false);
  });

  it('counts each key on its own', async () => {
    expect(await hitRateLimit(db, 'login:a', 1, WINDOW_MS, NOW)).toBe(true);
    expect(await hitRateLimit(db, 'login:b', 1, WINDOW_MS, NOW)).toBe(true);
    expect(await hitRateLimit(db, 'login:a', 1, WINDOW_MS, NOW)).toBe(false);
  });

  it('counts hits that arrive together', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => hitRateLimit(db, 'login:a', 3, WINDOW_MS, NOW)));
    expect(results.filter(Boolean)).toHaveLength(3);
  });
});

describe('purgeRateLimits', () => {
  it('deletes the counts of windows that began more than two days ago, and no others', async () => {
    const DAY = 24 * 60 * 60_000;
    await hitRateLimit(db, 'old', 5, DAY, NOW - 2 * DAY - 1);
    await hitRateLimit(db, 'recent', 5, DAY, NOW - 2 * DAY);
    await hitRateLimit(db, 'new', 5, WINDOW_MS, NOW);
    await purgeRateLimits(db, NOW);
    expect((await db.query<{ key: string }>('SELECT key FROM rate_limits ORDER BY key')).map((row) => row.key)).toEqual(['new', 'recent']);
  });
});
