import { describe, expect, it } from 'vitest';
import { completePasswordReset, requestPasswordReset } from './reset.ts';
import { UNEXPECTED, UNREACHABLE, bodyOf, failure, fakeFetch, success } from './testing.ts';

const TOKEN = 'Zk3v9Qx1LrT8mB2nYc7WdA5sHj0PqUeXoIiGfRtN4wE';

const posted = (calls: ReturnType<typeof fakeFetch>['calls']) => {
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe('/api/account/reset');
  expect(calls[0]?.init?.method).toBe('POST');
  expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
  return bodyOf(calls[0]);
};

describe('requestPasswordReset', () => {
  it('posts the address and the language the page is in, and reads that the request was taken', async () => {
    const { fetchFn, calls } = fakeFetch(success({ requested: true }));
    expect(await requestPasswordReset('neel@example.com', 'fr', fetchFn)).toEqual({ ok: true, data: { requested: true } });
    expect(posted(calls)).toEqual({ action: 'request', email: 'neel@example.com', lang: 'fr' });
  });

  it.each([
    ['Enter a valid email address.', 400],
    ['Too many attempts. Try again in 15 minutes.', 429],
    ['The email could not be sent. Try again later.', 502],
  ])('passes on the refusal "%s"', async (error, status) => {
    expect(await requestPasswordReset('neel@example.com', 'en', fakeFetch(failure(error, status)).fetchFn)).toEqual({ ok: false, error });
  });

  it('refuses a reply that does not say the request was taken', async () => {
    expect(await requestPasswordReset('neel@example.com', 'en', fakeFetch(success({ sent: true })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('says so when the server cannot be reached', async () => {
    const down = (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
    expect(await requestPasswordReset('neel@example.com', 'en', down)).toEqual({ ok: false, error: UNREACHABLE });
  });
});

describe('completePasswordReset', () => {
  it('posts the token of the link with the new password, and reads who is now signed in', async () => {
    const { fetchFn, calls } = fakeFetch(success({ username: 'neel' }));
    expect(await completePasswordReset(TOKEN, 'a brand new password', fetchFn)).toEqual({ ok: true, data: { username: 'neel' } });
    expect(posted(calls)).toEqual({ action: 'complete', token: TOKEN, password: 'a brand new password' });
  });

  it.each([
    ['This reset link is not valid or has expired. Ask for a new one.', 400],
    ['Choose a new password of 8 to 200 characters.', 400],
    ['Too many attempts. Try again in 15 minutes.', 429],
  ])('passes on the refusal "%s"', async (error, status) => {
    expect(await completePasswordReset(TOKEN, 'pw', fakeFetch(failure(error, status)).fetchFn)).toEqual({ ok: false, error });
  });

  it('refuses a reply without a username', async () => {
    expect(await completePasswordReset(TOKEN, 'a brand new password', fakeFetch(success({})).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});
