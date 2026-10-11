import { language, t } from '../i18n/index.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

type Unit = 'minute' | 'hour' | 'day' | 'month' | 'year';

/** largest first: the first one that has passed in full is the one counted in */
const UNITS: ReadonlyArray<[unit: Unit, ms: number]> = [
  ['year', YEAR],
  ['month', MONTH],
  ['day', DAY],
  ['hour', HOUR],
  ['minute', MINUTE],
];

/**
 * A stretch of time as a whole number of the largest unit that has passed in full. Never less than
 * a minute: a player seen seconds ago who is not online was still seen "a minute ago".
 */
export function ago(ms: number): { value: number; unit: Unit } {
  const [unit, size] = UNITS.find(([, each]) => ms >= each) ?? UNITS[UNITS.length - 1]!;
  return { value: Math.max(1, Math.floor(ms / size)), unit };
}

export interface Seen {
  online: boolean;
  /** ISO 8601; null for a player never seen, and for one who hides when they were last seen */
  lastSeenAt: string | null;
}

/**
 * "Online", or when the player was last seen, in the language in use: "Last seen 3 hours ago",
 * "Last seen yesterday". With no time to give it is "Offline" and nothing more: the server sends
 * none for a player who hides it as for one never seen, and the page cannot tell the two apart.
 */
export function presenceText(who: Seen, now: number = Date.now()): string {
  if (who.online) {
    return t('presence.online');
  }
  const seen = who.lastSeenAt === null ? Number.NaN : Date.parse(who.lastSeenAt);
  if (Number.isNaN(seen)) {
    return t('presence.offline');
  }
  const { value, unit } = ago(now - seen);
  return t('presence.lastSeen', { when: new Intl.RelativeTimeFormat(language(), { numeric: 'auto' }).format(-value, unit) });
}
