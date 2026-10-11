import { afterEach, describe, expect, it } from 'vitest';
import { useLanguage } from '../i18n/index.ts';
import { ago, presenceText } from './last-seen.ts';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const before = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('ago', () => {
  it('counts in the largest unit that has passed in full', () => {
    expect(ago(5 * MINUTE)).toEqual({ value: 5, unit: 'minute' });
    expect(ago(59 * MINUTE + 59_000)).toEqual({ value: 59, unit: 'minute' });
    expect(ago(HOUR)).toEqual({ value: 1, unit: 'hour' });
    expect(ago(23 * HOUR)).toEqual({ value: 23, unit: 'hour' });
    expect(ago(DAY)).toEqual({ value: 1, unit: 'day' });
    expect(ago(29 * DAY)).toEqual({ value: 29, unit: 'day' });
    expect(ago(30 * DAY)).toEqual({ value: 1, unit: 'month' });
    expect(ago(364 * DAY)).toEqual({ value: 12, unit: 'month' });
    expect(ago(800 * DAY)).toEqual({ value: 2, unit: 'year' });
  });

  it('never says less than a minute, nor a time still to come', () => {
    expect(ago(20_000)).toEqual({ value: 1, unit: 'minute' });
    expect(ago(-5000)).toEqual({ value: 1, unit: 'minute' });
  });
});

describe('presenceText', () => {
  afterEach(() => useLanguage('en'));

  it('says a player who is online is online, whenever they were last seen', () => {
    expect(presenceText({ online: true, lastSeenAt: before(30_000) }, NOW)).toBe('Online');
    expect(presenceText({ online: true, lastSeenAt: null }, NOW)).toBe('Online');
  });

  it('says how long ago a player was last seen', () => {
    expect(presenceText({ online: false, lastSeenAt: before(3 * MINUTE) }, NOW)).toBe('Last seen 3 minutes ago');
    expect(presenceText({ online: false, lastSeenAt: before(3 * HOUR) }, NOW)).toBe('Last seen 3 hours ago');
    expect(presenceText({ online: false, lastSeenAt: before(DAY) }, NOW)).toBe('Last seen yesterday');
    expect(presenceText({ online: false, lastSeenAt: before(40 * DAY) }, NOW)).toBe('Last seen last month');
  });

  it('says only "Offline" when there is no time to give: a player never seen, one who hides it, or a time that cannot be read', () => {
    expect(presenceText({ online: false, lastSeenAt: null }, NOW)).toBe('Offline');
    expect(presenceText({ online: false, lastSeenAt: 'soon' }, NOW)).toBe('Offline');
  });

  it('says "Online" for a player who hides when they were last seen and is here now', () => {
    expect(presenceText({ online: true, lastSeenAt: null }, NOW)).toBe('Online');
  });

  it("writes the time in the player's language", async () => {
    await useLanguage('de');
    expect(presenceText({ online: false, lastSeenAt: before(3 * HOUR) }, NOW)).toBe('Zuletzt online vor 3 Stunden');
    expect(presenceText({ online: false, lastSeenAt: before(DAY) }, NOW)).toBe('Zuletzt online gestern');
    await useLanguage('ru');
    expect(presenceText({ online: false, lastSeenAt: before(3 * HOUR) }, NOW)).toBe('Последний визит: 3 часа назад');
    await useLanguage('fr');
    expect(presenceText({ online: false, lastSeenAt: before(2 * DAY) }, NOW)).toBe('Dernière connexion : avant-hier');
    await useLanguage('es');
    expect(presenceText({ online: true, lastSeenAt: null }, NOW)).toBe('En línea');
    expect(presenceText({ online: false, lastSeenAt: null }, NOW)).toBe('Sin conexión');
  });
});
