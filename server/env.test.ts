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
      RESEND_API_KEY: undefined,
      APP_URL: 'http://localhost:3000',
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

  it('reads the key email is sent with, and goes without one outside production when it is empty or left out', () => {
    expect(withExtra({ RESEND_API_KEY: 're_made_up' }).RESEND_API_KEY).toBe('re_made_up');
    expect(withExtra({ RESEND_API_KEY: '' }).RESEND_API_KEY).toBeUndefined();
    expect(withExtra({}).RESEND_API_KEY).toBeUndefined();
    expect(withExtra({ NODE_ENV: 'development', VERCEL_ENV: 'development' }).RESEND_API_KEY).toBeUndefined();
    expect(withExtra({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }).RESEND_API_KEY).toBeUndefined();
  });

  it('reads the address of the site as its origin, and takes it to be this machine outside production when it is left out', () => {
    expect(withExtra({ APP_URL: 'https://wherefall.n3el.dev' }).APP_URL).toBe('https://wherefall.n3el.dev');
    expect(withExtra({ APP_URL: 'https://wherefall.n3el.dev/' }).APP_URL).toBe('https://wherefall.n3el.dev');
    expect(withExtra({ APP_URL: 'http://localhost:5173' }).APP_URL).toBe('http://localhost:5173');
    expect(withExtra({ APP_URL: '' }).APP_URL).toBe('http://localhost:3000');
    expect(withExtra({}).APP_URL).toBe('http://localhost:3000');
  });

  it.each(['wherefall.n3el.dev', 'ftp://wherefall.n3el.dev', 'https://wherefall.n3el.dev/play', 'https://wherefall.n3el.dev/?a=1', 'https://user@wherefall.n3el.dev', 'not a url'])(
    'says what the address of the site has to be when it is %s',
    (value) => {
      expect(() => withExtra({ APP_URL: value })).toThrow('APP_URL: must be the origin of the site, as https://wherefall.n3el.dev');
    },
  );

  const PRODUCTION = { RESEND_API_KEY: 're_made_up', APP_URL: 'https://wherefall.n3el.dev' };

  it.each<Record<string, string>>([{ VERCEL_ENV: 'production' }, { NODE_ENV: 'production' }, { VERCEL_ENV: 'production', NODE_ENV: 'production' }])(
    'needs both the key and the address in production (%j), and names whichever is missing or empty',
    (production) => {
      expect(withExtra({ ...production, ...PRODUCTION })).toMatchObject(PRODUCTION);
      expect(() => withExtra(production)).toThrow('Invalid environment. RESEND_API_KEY: is not set; APP_URL: is not set');
      expect(() => withExtra({ ...production, ...PRODUCTION, RESEND_API_KEY: '' })).toThrow('Invalid environment. RESEND_API_KEY: is not set');
      expect(() => withExtra({ ...production, ...PRODUCTION, APP_URL: '' })).toThrow('Invalid environment. APP_URL: is not set');
      expect(() => withExtra({ ...production, RESEND_API_KEY: 're_made_up' })).toThrow('Invalid environment. APP_URL: is not set');
    },
  );

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

  it('never repeats the address of the site in the error either', () => {
    expect(() => withExtra({ APP_URL: 'https://wherefall.n3el.dev/secret-path' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret-path') }),
    );
  });
});
