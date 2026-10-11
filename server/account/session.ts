import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'plonk_account';
export const ACCOUNT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The session cookie's name. Over https it carries the `__Host-` prefix,
 * which browsers accept only from this exact host, so another site on a
 * sibling subdomain cannot plant a session of its own. The prefix needs
 * Secure, so plain-http localhost goes without it.
 */
export const accountCookieName = (secure: boolean): string => (secure ? `__Host-${COOKIE}` : COOKIE);

const PREFIX = 'account.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mac = (value: string, secret: Buffer): Buffer => createHmac('sha256', secret).update(value).digest();

export function sign(value: string, secret: Buffer): string {
  return `${value}.${mac(value, secret).toString('base64url')}`;
}

/** Returns the signed value, or null if the signature does not match. */
export function verify(token: string | undefined, secret: Buffer): string | null {
  if (!token) {
    return null;
  }
  const cut = token.lastIndexOf('.');
  if (cut <= 0) {
    return null;
  }
  const value = token.slice(0, cut);
  const given = Buffer.from(token.slice(cut + 1), 'base64url');
  const expected = mac(value, secret);
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : null;
}

/**
 * A session for an account. `version` is the account's session version when
 * the session is made: raising the account's ends every session made before.
 */
export function createAccountSession(userId: string, now: number, secret: Buffer, version = 0): string {
  return sign(`${PREFIX}${userId}.${now + ACCOUNT_TTL_MS}.${version}`, secret);
}

// A guest's session is the same cookie with another prefix, so everything that
// asks for an account's session passes a guest over without a second look.
const GUEST_PREFIX = 'guest.';
export const GUEST_TTL_MS = 24 * 60 * 60 * 1000;

/** Who a signed session names, and the session version it was made at. */
export interface Session {
  userId: string;
  version: number;
}

/**
 * What a signed value says after `prefix`, or null if it is forged, expired
 * or of another kind. A session made before versions were written into it
 * is one of version 0, which is where every account starts.
 */
function sessionIn(token: string | undefined, prefix: string, now: number, secret: Buffer): Session | null {
  const value = verify(token, secret);
  if (!value?.startsWith(prefix)) {
    return null;
  }
  const [userId, expires, made = '0'] = value.slice(prefix.length).split('.');
  const expiresAt = Number(expires);
  const version = Number(made);
  const sound = userId !== undefined && UUID.test(userId) && Number.isFinite(expiresAt) && now < expiresAt && Number.isSafeInteger(version) && version >= 0;
  return sound ? { userId, version } : null;
}

/** The account session a token is, or null if it is forged, expired or not an account session. */
export const accountSessionOf = (token: string | undefined, now: number, secret: Buffer): Session | null => sessionIn(token, PREFIX, now, secret);

/** The user a session names, or null if it is forged, expired or not an account session. Whether the session has since been ended is the caller's to ask. */
export const accountOf = (token: string | undefined, now: number, secret: Buffer): string | null => accountSessionOf(token, now, secret)?.userId ?? null;

export function createGuestSession(userId: string, now: number, secret: Buffer): string {
  return sign(`${GUEST_PREFIX}${userId}.${now + GUEST_TTL_MS}`, secret);
}

/** The guest a session names, or null if it is forged, expired or an account's. */
export const guestOf = (token: string | undefined, now: number, secret: Buffer): string | null => sessionIn(token, GUEST_PREFIX, now, secret)?.userId ?? null;

function cookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  const attributes = ['Path=/', `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])];
  return [`${accountCookieName(secure)}=${value}`, ...attributes].join('; ');
}

/** The Set-Cookie value that signs a browser in. Scripts cannot read it, and other sites cannot send it with a POST. */
export const sessionCookie = (token: string, secure: boolean): string => cookie(token, ACCOUNT_TTL_MS / 1000, secure);

/** The Set-Cookie value that signs a browser out. */
export const clearedCookie = (secure: boolean): string => cookie('', 0, secure);

export function readCookie(request: Request, name: string): string | undefined {
  const pairs = (request.headers.get('cookie') ?? '').split(';').map((pair) => pair.trim());
  const found = pairs.find((pair) => pair.startsWith(`${name}=`));
  return found?.slice(name.length + 1);
}
