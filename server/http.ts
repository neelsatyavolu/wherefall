import { createHmac } from 'node:crypto';
import { isIPv6 } from 'node:net';
import type { z } from 'zod';

export type ApiResponse<T> = { success: true; data: T } | { success: false; error: string };

const NO_STORE = { 'Cache-Control': 'no-store' };
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function ok<T>(data: T, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json({ success: true, data } satisfies ApiResponse<T>, { status, headers: { ...NO_STORE, ...headers } });
}

export function fail(error: string, status: number, headers: Record<string, string> = {}): Response {
  return Response.json({ success: false, error } satisfies ApiResponse<never>, { status, headers: { ...NO_STORE, ...headers } });
}

/** The host the visitor asked for, with its port. Behind a proxy that is the forwarded one. */
function requestHost(request: Request): string {
  return request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
}

/** The scheme the visitor asked over, as `https:`. Behind a proxy that is the forwarded one. */
function requestScheme(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return forwarded ? `${forwarded}:` : new URL(request.url).protocol;
}

/** True on a developer's own machine, where there is no https and a Secure cookie would be dropped. */
export function isLocalRequest(request: Request): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(`http://${requestHost(request)}`).hostname);
  } catch {
    return false;
  }
}

/**
 * False when a state-changing request names another site as its origin: a
 * different host, or this host over another scheme. A browser always names
 * the origin of a cross-site POST; a request with no Origin header was not
 * sent by a page. On a developer's own machine only the host is compared.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) {
    return true;
  }
  try {
    const named = new URL(origin);
    return named.host === requestHost(request) && (isLocalRequest(request) || named.protocol === requestScheme(request));
  } catch {
    return false;
  }
}

const IPV4_IN_IPV6 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
const GROUPS = 8;
const NETWORK_GROUPS = 4;

/** The first four groups of an IPv6 address, written one way: the /64 it is in. */
function ipv6Network(ip: string): string {
  const [head = '', tail] = ip.toLowerCase().split('::');
  const before = head === '' ? [] : head.split(':');
  const after = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups = [...before, ...Array.from({ length: Math.max(0, GROUPS - before.length - after.length) }, () => '0'), ...after];
  return `${groups.slice(0, NETWORK_GROUPS).map((group) => Number.parseInt(group, 16).toString(16)).join(':')}::/64`;
}

/**
 * The address a request is counted against. An IPv6 address is counted as
 * its /64: that is what one customer is given, and holds more addresses
 * than any limit could be spread over.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip') || 'unknown';
  const carried = IPV4_IN_IPV6.exec(ip)?.[1];
  if (carried) {
    return carried;
  }
  return isIPv6(ip) ? ipv6Network(ip) : ip;
}

/** Addresses are only ever stored and compared as keyed hashes. */
export function hashIp(ip: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(`ip:${ip}`).digest('hex');
}

/** True when a NUL character is anywhere in a value: in a string, or in a key or value of anything it holds. */
function hasNul(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('\u0000');
  }
  if (Array.isArray(value)) {
    return value.some(hasNul);
  }
  return typeof value === 'object' && value !== null && Object.entries(value).some(([key, held]) => hasNul(key) || hasNul(held));
}

/**
 * The request's JSON body, validated. Null when it is missing, malformed,
 * the wrong shape, not declared as JSON (which a plain HTML form cannot do),
 * or holds a NUL character, which no text column can store.
 */
export async function readBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S> | null> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return null;
  }
  try {
    const sent: unknown = await request.json();
    if (hasNul(sent)) {
      return null;
    }
    const parsed = schema.safeParse(sent);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
