import { describe, expect, it } from 'vitest';
import { loginSchema, newUsernameSchema, recoveryClaimSchema, recoveryCodeSchema, registerSchema, savedGameSchema, usernameSchema } from './input.js';

const game = (change: Record<string, unknown> = {}) => ({
  map: 'world',
  mode: 'move',
  timeLimit: 60,
  seed: 'abc123',
  rounds: [
    { id: 'place-1', lng: 2.35, lat: 48.85, guessLng: 2.4, guessLat: 48.9 },
    { id: 'place-2', lng: 139.69, lat: 35.68, guessLng: null, guessLat: null },
  ],
  ...change,
});

const round = (change: Record<string, unknown>) => ({ id: 'place-1', lng: 2.35, lat: 48.85, guessLng: 2.4, guessLat: 48.9, ...change });

describe('registerSchema', () => {
  it('trims and lowercases the username', () => {
    expect(registerSchema.parse({ username: '  Neel_01 ', password: 'long enough' })).toEqual({
      username: 'neel_01',
      password: 'long enough',
    });
  });

  it.each(['ab', 'a'.repeat(21), 'has space', 'dash-ed', 'émile', '', '_abc', 'abc_', '_', '___', 'a__b', 'a_b__c'])('rejects the username %j', (username) => {
    expect(registerSchema.safeParse({ username, password: 'long enough' }).success).toBe(false);
  });

  it.each(['fuck', 'FUCKER', 'big_shit', 'shit_happens', 'a_bitch_b', 'cunt99'])('rejects the username %j for the word in it', (username) => {
    expect(registerSchema.safeParse({ username, password: 'long enough' }).success).toBe(false);
  });

  it('accepts usernames of 3 to 20 letters, numbers and single underscores between them', () => {
    for (const username of ['abc', 'a'.repeat(20), 'a_b', 'a_b_c_1', '007', 'scunthorpe', 'class_act']) {
      expect(registerSchema.safeParse({ username, password: 'long enough' }).success).toBe(true);
    }
  });

  it('takes a country code, and drops anything else given as one without refusing the rest', () => {
    const country = (given: unknown) => registerSchema.parse({ username: 'neel', password: 'long enough', country: given }).country;
    expect(country('IN')).toBe('IN');
    expect(country(null)).toBeNull();
    for (const given of ['in', 'IND', 'es-419', '', 91, {}]) {
      expect(country(given)).toBeNull();
    }
  });

  it('wants a password of 8 to 200 characters, kept exactly as typed', () => {
    expect(registerSchema.safeParse({ username: 'neel', password: '1234567' }).success).toBe(false);
    expect(registerSchema.safeParse({ username: 'neel', password: 'x'.repeat(201) }).success).toBe(false);
    expect(registerSchema.parse({ username: 'neel', password: '  Spaced 8 ' }).password).toBe('  Spaced 8 ');
  });

  it('rejects anything that is not text', () => {
    expect(registerSchema.safeParse({ username: 42, password: 'long enough' }).success).toBe(false);
    expect(registerSchema.safeParse({ username: 'neel' }).success).toBe(false);
    expect(registerSchema.safeParse(null).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('normalises the username the same way and takes any non-empty password', () => {
    expect(loginSchema.parse({ username: ' NEEL ', password: 'x' })).toEqual({ username: 'neel', password: 'x' });
  });

  it('takes a name made before the rules on underscores and words, so its owner can still sign in', () => {
    for (const username of ['_abc', 'abc_', 'a__b', 'shithead']) {
      expect(loginSchema.safeParse({ username, password: 'x' }).success).toBe(true);
      expect(usernameSchema.safeParse(username).success).toBe(true);
      expect(newUsernameSchema.safeParse(username).success).toBe(false);
    }
  });

  it('takes a request to restore, which is yes or no', () => {
    expect(loginSchema.parse({ username: 'neel', password: 'x', restore: true }).restore).toBe(true);
    expect(loginSchema.safeParse({ username: 'neel', password: 'x', restore: 'yes' }).success).toBe(false);
  });

  it('rejects an empty or oversized password and a malformed username', () => {
    expect(loginSchema.safeParse({ username: 'neel', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'neel', password: 'x'.repeat(201) }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'no', password: 'x' }).success).toBe(false);
  });
});

describe('recoveryCodeSchema', () => {
  it.each(['K7QM-2XHD-9RWP', 'k7qm-2xhd-9rwp', 'K7QM2XHD9RWP', ' k7qm 2xhd 9rwp ', 'K7-QM-2X-HD-9R-WP', 'k7qm\t2xhd\n9rwp'])('reads %j as the one code', (typed) => {
    expect(recoveryCodeSchema.parse(typed)).toBe('K7QM2XHD9RWP');
  });

  it.each([
    ['one character short', 'K7QM-2XHD-9RW'],
    ['one character long', 'K7QM-2XHD-9RWPA'],
    ['a zero, which no code has', 'K7QM-2XHD-9RW0'],
    ['a letter O', 'K7QM-2XHD-9RWO'],
    ['a one', 'K7QM-2XHD-9RW1'],
    ['a letter I', 'K7QM-2XHD-9RWI'],
    ['a letter L', 'K7QM-2XHD-9RWL'],
    ['other separators', 'K7QM_2XHD_9RWP'],
    ['nothing', ''],
    ['more than anyone would type', `K7QM2XHD9RWP${' '.repeat(60)}`],
    ['a number', 123_456_789_012],
    ['nothing at all', undefined],
  ])('rejects %s', (_name, typed) => {
    expect(recoveryCodeSchema.safeParse(typed).success).toBe(false);
  });
});

describe('recoveryClaimSchema', () => {
  const claim = (change: Record<string, unknown> = {}) => ({ username: ' NEEL ', recoveryCode: 'k7qm 2xhd 9rwp', ...change });

  it('normalises the username and the code, and leaves the rest of the request for whoever reads it next', () => {
    expect(recoveryClaimSchema.parse(claim({ newPassword: 'a new password' }))).toEqual({ username: 'neel', recoveryCode: 'K7QM2XHD9RWP', newPassword: 'a new password' });
  });

  it('takes a name made before the rules on underscores and words, so its owner can still recover it', () => {
    expect(recoveryClaimSchema.safeParse(claim({ username: '_abc' })).success).toBe(true);
  });

  it('takes a request to restore, which is yes or no', () => {
    expect(recoveryClaimSchema.parse(claim({ restore: true })).restore).toBe(true);
    expect(recoveryClaimSchema.safeParse(claim({ restore: 'yes' })).success).toBe(false);
  });

  it('rejects a malformed username and a code that could not be one', () => {
    expect(recoveryClaimSchema.safeParse(claim({ username: 'no' })).success).toBe(false);
    expect(recoveryClaimSchema.safeParse(claim({ recoveryCode: 'K7QM' })).success).toBe(false);
    expect(recoveryClaimSchema.safeParse({ username: 'neel' }).success).toBe(false);
  });
});

describe('savedGameSchema', () => {
  it('accepts a finished game', () => {
    expect(savedGameSchema.parse(game())).toEqual(game());
  });

  it.each(['world', 'europe', 'americas', 'asia-oceania'])('accepts the map %s', (map) => {
    expect(savedGameSchema.safeParse(game({ map })).success).toBe(true);
  });

  it.each(['move', 'no-move', 'nmpz'])('accepts the mode %s', (mode) => {
    expect(savedGameSchema.safeParse(game({ mode })).success).toBe(true);
  });

  it('drops anything extra, such as a total worked out by the client', () => {
    const parsed = savedGameSchema.parse(game({ score: 999_999, maxScore: 1, userId: 'someone-else' }));
    expect(parsed).toEqual(game());
  });

  it.each([
    ['an unknown map', { map: 'mars' }],
    ['an unknown mode', { mode: 'fly' }],
    ['a negative time limit', { timeLimit: -1 }],
    ['a time limit over ten minutes', { timeLimit: 601 }],
    ['a fractional time limit', { timeLimit: 30.5 }],
    ['a seed with capitals', { seed: 'ABC' }],
    ['an empty seed', { seed: '' }],
    ['a seed over 32 characters', { seed: 'a'.repeat(33) }],
    ['no rounds', { rounds: [] }],
    ['more than ten rounds', { rounds: Array.from({ length: 11 }, () => round({})) }],
    ['a round that does not say which place it was', { rounds: [{ lng: 2.35, lat: 48.85, guessLng: 2.4, guessLat: 48.9 }] }],
    ['a place with an empty id', { rounds: [round({ id: '' })] }],
    ['a place with an id over 64 characters', { rounds: [round({ id: 'p'.repeat(65) })] }],
    ['a place id that is not text', { rounds: [round({ id: 7 })] }],
    ['a place with no longitude', { rounds: [{ id: 'place-1', lat: 48.85 }] }],
    ['a place off the east of the map', { rounds: [round({ lng: 180.1 })] }],
    ['a place past the pole', { rounds: [round({ lat: -90.1 })] }],
    ['a coordinate sent as text', { rounds: [round({ lat: '48.85' })] }],
    ['a guess off the map', { rounds: [round({ guessLat: 91 })] }],
    ['half a guess', { rounds: [round({ guessLng: null })] }],
    ['a hint that is neither yes nor no', { rounds: [round({ hinted: 'yes' })] }],
  ])('rejects %s', (_name, change) => {
    expect(savedGameSchema.safeParse(game(change)).success).toBe(false);
  });

  it('accepts the limits themselves', () => {
    const rounds = Array.from({ length: 10 }, (_unused, index) => round({ id: `place-${index}`, lng: 180, lat: -90, guessLng: -180, guessLat: 90, hinted: true }));
    expect(savedGameSchema.safeParse(game({ timeLimit: 0, seed: 'a'.repeat(32), rounds })).success).toBe(true);
    expect(savedGameSchema.safeParse(game({ timeLimit: 600, seed: '0', rounds: [round({ id: 'p'.repeat(64) })] })).success).toBe(true);
  });

  it('takes a round with no guess, said with nulls or by leaving the guess out', () => {
    expect(savedGameSchema.safeParse(game({ rounds: [round({ guessLng: null, guessLat: null })] })).success).toBe(true);
    expect(savedGameSchema.safeParse(game({ rounds: [{ id: 'place-1', lng: 2.35, lat: 48.85 }] })).success).toBe(true);
  });

  it('does not read the country, the distance, the score or a scale a browser still sends', () => {
    const sent = game({ scaleKm: 100, rounds: [round({ country: 'fr', distanceKm: -1, score: 999_999 })] });
    expect(savedGameSchema.parse(sent)).toEqual(game({ rounds: [round({})] }));
  });
});
