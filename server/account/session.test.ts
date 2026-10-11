import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TTL_MS,
  accountCookieName,
  accountOf,
  clearedCookie,
  createAccountSession,
  readCookie,
  sessionCookie,
  sign,
} from './session.js';

const NOW = 1_800_000_000_000;
const USER = '3f0c2f6e-5b1a-4c8e-9d2a-7e6f5a4b3c2d';
const SECRET = Buffer.alloc(32, 1);
const OTHER_SECRET = Buffer.alloc(32, 2);

describe('account session', () => {
  it('names its user until it expires', () => {
    const token = createAccountSession(USER, NOW, SECRET);
    expect(accountOf(token, NOW, SECRET)).toBe(USER);
    expect(accountOf(token, NOW + ACCOUNT_TTL_MS - 1, SECRET)).toBe(USER);
    expect(accountOf(token, NOW + ACCOUNT_TTL_MS, SECRET)).toBeNull();
  });

  it('rejects a forged token', () => {
    expect(accountOf(`account.${USER}.${NOW + 1_000}.forged`, NOW, SECRET)).toBeNull();
    expect(accountOf(`account.${USER}.${NOW + 1_000}`, NOW, SECRET)).toBeNull();
    expect(accountOf('no-dots', NOW, SECRET)).toBeNull();
  });

  it('rejects a token whose user or expiry was changed after signing', () => {
    const token = createAccountSession(USER, NOW, SECRET);
    const later = token.replace(String(NOW + ACCOUNT_TTL_MS), String(NOW + ACCOUNT_TTL_MS * 2));
    expect(later).not.toBe(token);
    expect(accountOf(later, NOW, SECRET)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    expect(accountOf(createAccountSession(USER, NOW, OTHER_SECRET), NOW, SECRET)).toBeNull();
  });

  it('rejects a signed token that does not name a user', () => {
    expect(accountOf(sign(`account.not-a-user.${NOW + 1_000}`, SECRET), NOW, SECRET)).toBeNull();
    expect(accountOf(sign(`account.${USER}.soon`, SECRET), NOW, SECRET)).toBeNull();
    expect(accountOf(sign('something-else', SECRET), NOW, SECRET)).toBeNull();
  });

  it('rejects no token', () => {
    expect(accountOf(undefined, NOW, SECRET)).toBeNull();
    expect(accountOf('', NOW, SECRET)).toBeNull();
  });
});

describe('session cookie', () => {
  it('is hidden from scripts, sent on same-site requests only, and lasts as long as the session', () => {
    const cookie = sessionCookie('token-value', true);
    expect(cookie.startsWith('__Host-plonk_account=token-value; ')).toBe(true);
    const attributes = cookie.split('; ').slice(1);
    expect(attributes).toEqual(expect.arrayContaining(['Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure']));
    expect(attributes).toContain(`Max-Age=${ACCOUNT_TTL_MS / 1000}`);
  });

  it('meets the rules browsers set for a __Host- cookie: Secure, the root path, and no Domain', () => {
    for (const cookie of [sessionCookie('token-value', true), clearedCookie(true)]) {
      expect(cookie.split('; ')).toEqual(expect.arrayContaining(['Secure', 'Path=/']));
      expect(cookie).not.toMatch(/domain=/i);
    }
  });

  it('drops Secure and the prefix when asked, so it works over plain http on localhost', () => {
    const cookie = sessionCookie('token-value', false);
    expect(cookie.startsWith('plonk_account=token-value; ')).toBe(true);
    expect(cookie).not.toContain('Secure');
    expect(cookie).toContain('HttpOnly');
  });

  it('is cleared by an empty value that expires at once', () => {
    const cookie = clearedCookie(true);
    expect(cookie.startsWith('__Host-plonk_account=; ')).toBe(true);
    expect(cookie.split('; ')).toEqual(expect.arrayContaining(['Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax', 'Secure']));
    expect(clearedCookie(false).startsWith('plonk_account=; ')).toBe(true);
    expect(clearedCookie(false)).not.toContain('Secure');
  });

  it('is read back under the name it was set with', () => {
    expect(accountCookieName(true)).toBe('__Host-plonk_account');
    expect(accountCookieName(false)).toBe('plonk_account');
  });
});

describe('readCookie', () => {
  const request = (cookie?: string) => new Request('https://plonk.example/api/account', { headers: cookie ? { cookie } : {} });

  it('finds one cookie among several', () => {
    expect(readCookie(request('theme=dark; plonk_account=abc.def; other=1'), 'plonk_account')).toBe('abc.def');
    expect(readCookie(request('plonk_account=abc'), 'plonk_account')).toBe('abc');
  });

  it('keeps everything after the first equals sign', () => {
    expect(readCookie(request('plonk_account=abc=def'), 'plonk_account')).toBe('abc=def');
  });

  it('is undefined when the cookie or the header is absent', () => {
    expect(readCookie(request('theme=dark'), 'plonk_account')).toBeUndefined();
    expect(readCookie(request('not_plonk_account=abc'), 'plonk_account')).toBeUndefined();
    expect(readCookie(request(), 'plonk_account')).toBeUndefined();
  });
});
