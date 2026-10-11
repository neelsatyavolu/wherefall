import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const SESSION_SECRET = Buffer.alloc(32, 9).toString('base64');

describe('parseEnv', () => {
  it('returns the settings the server needs and nothing else', () => {
    expect(parseEnv({ DATABASE_URL: 'pglite://memory', SESSION_SECRET, HOME: '/somewhere' })).toEqual({
      DATABASE_URL: 'pglite://memory',
      SESSION_SECRET,
      MODERATORS: [],
      GOOGLE_VIEWERS_PER_DAY: 150,
    });
  });

  const withExtra = (extra: Record<string, string>) => parseEnv({ DATABASE_URL: 'pglite://memory', SESSION_SECRET, ...extra });

  it('reads the moderators as a list of usernames in lower case, and nobody when it is empty or left out', () => {
    expect(withExtra({ MODERATORS: 'Neel, friend_2 ,,MOD ' }).MODERATORS).toEqual(['neel', 'friend_2', 'mod']);
    expect(withExtra({ MODERATORS: 'neel' }).MODERATORS).toEqual(['neel']);
    expect(withExtra({ MODERATORS: '' }).MODERATORS).toEqual([]);
    expect(withExtra({ MODERATORS: ' , ' }).MODERATORS).toEqual([]);
    expect(withExtra({}).MODERATORS).toEqual([]);
  });

  it('reads the daily limit on Google viewers, 150 when it is empty or left out, and 0 to hand out none', () => {
    expect(withExtra({ GOOGLE_VIEWERS_PER_DAY: '40' }).GOOGLE_VIEWERS_PER_DAY).toBe(40);
    expect(withExtra({ GOOGLE_VIEWERS_PER_DAY: '0' }).GOOGLE_VIEWERS_PER_DAY).toBe(0);
    expect(withExtra({ GOOGLE_VIEWERS_PER_DAY: '' }).GOOGLE_VIEWERS_PER_DAY).toBe(150);
    expect(withExtra({}).GOOGLE_VIEWERS_PER_DAY).toBe(150);
  });

  it.each(['many', '-1', '1.5', '150 a day', '1e3'])('says what the daily limit has to be when it is %s', (value) => {
    expect(() => withExtra({ GOOGLE_VIEWERS_PER_DAY: value })).toThrow('GOOGLE_VIEWERS_PER_DAY: must be a whole number, 0 or more');
  });

  it('names every setting that is missing', () => {
    expect(() => parseEnv({})).toThrow('Invalid environment. DATABASE_URL: is not set; SESSION_SECRET: is not set');
    expect(() => parseEnv({ SESSION_SECRET, DATABASE_URL: '' })).toThrow('Invalid environment. DATABASE_URL: is empty');
  });

  it('says what a session secret has to be when it is the wrong size', () => {
    expect(() => parseEnv({ DATABASE_URL: 'pglite://memory', SESSION_SECRET: 'too-short' })).toThrow(
      'SESSION_SECRET: must be 32 random bytes, base64 encoded',
    );
  });

  it('never repeats a value in the error', () => {
    const secret = 'c2VjcmV0LXZhbHVl';
    expect(() => parseEnv({ DATABASE_URL: 'pglite://memory', SESSION_SECRET: secret })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });
});
