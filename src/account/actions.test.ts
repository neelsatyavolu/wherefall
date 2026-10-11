import { describe, expect, it } from 'vitest';
import { changePassword, deleteAccount, issueRecoveryCode, saveAccountSettings, setCountry, signOutEverywhere } from './actions.ts';
import { UNEXPECTED, bodyOf, failure, fakeFetch, success } from './testing.ts';

const posted = (calls: ReturnType<typeof fakeFetch>['calls']) => {
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe('/api/account');
  expect(calls[0]?.init?.method).toBe('POST');
  expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
  return bodyOf(calls[0]);
};

describe('changePassword', () => {
  it('posts the current and the new password', async () => {
    const { fetchFn, calls } = fakeFetch(success({ changed: true }));
    expect(await changePassword('old password', 'new password', fetchFn)).toEqual({ ok: true, data: { changed: true } });
    expect(posted(calls)).toEqual({ action: 'password', current: 'old password', next: 'new password' });
  });

  it.each([
    ['That is not your current password.', 403],
    ['Choose a new password of 8 to 200 characters.', 400],
    ['Too many tries at your password in the last hour. Try again later.', 429],
    ['Guests cannot do that. Make an account first.', 403],
    ['Sign in first.', 401],
  ])('passes on the refusal "%s"', async (error, status) => {
    expect(await changePassword('a', 'b', fakeFetch(failure(error, status)).fetchFn)).toEqual({ ok: false, error });
  });

  it('refuses a reply that does not say the password changed', async () => {
    expect(await changePassword('a', 'b', fakeFetch(success({ changed: false })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('deleteAccount', () => {
  it('posts the password and reads until when the account can be restored', async () => {
    const reply = { deleted: true, restoreUntil: '2026-11-10T12:00:00.000Z' };
    const { fetchFn, calls } = fakeFetch(success(reply));
    expect(await deleteAccount('my password', fetchFn)).toEqual({ ok: true, data: reply });
    expect(posted(calls)).toEqual({ action: 'delete', password: 'my password' });
  });

  it.each([
    ['That is not your current password.', 403],
    ["A moderator's account cannot be deleted.", 409],
  ])('passes on the refusal "%s"', async (error, status) => {
    expect(await deleteAccount('pw', fakeFetch(failure(error, status)).fetchFn)).toEqual({ ok: false, error });
  });

  it('refuses a reply without the restore date', async () => {
    expect(await deleteAccount('pw', fakeFetch(success({ deleted: true })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('setCountry', () => {
  it('posts the country code and reads it back', async () => {
    const { fetchFn, calls } = fakeFetch(success({ country: 'IN' }));
    expect(await setCountry('IN', fetchFn)).toEqual({ ok: true, data: { country: 'IN' } });
    expect(posted(calls)).toEqual({ action: 'country', country: 'IN' });
  });

  it('posts null to have no country', async () => {
    const { fetchFn, calls } = fakeFetch(success({ country: null }));
    expect(await setCountry(null, fetchFn)).toEqual({ ok: true, data: { country: null } });
    expect(posted(calls)).toEqual({ action: 'country', country: null });
  });

  it("passes on the server's refusal of something that is not a code", async () => {
    const error = 'Choose a country by its two-letter code, or none.';
    expect(await setCountry('India', fakeFetch(failure(error, 400)).fetchFn)).toEqual({ ok: false, error });
  });

  it('refuses a reply whose country is not a code', async () => {
    expect(await setCountry('IN', fakeFetch(success({ country: 'india' })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('saveAccountSettings', () => {
  it('posts only the switches that were given and reads all three as they now are', async () => {
    const now = { allowFriendRequests: false, hideChat: false, hideLastSeen: false };
    const { fetchFn, calls } = fakeFetch(success(now));
    expect(await saveAccountSettings({ allowFriendRequests: false }, fetchFn)).toEqual({ ok: true, data: now });
    expect(posted(calls)).toEqual({ action: 'settings', allowFriendRequests: false });
  });

  it('can set several at once', async () => {
    const { fetchFn, calls } = fakeFetch(success({ allowFriendRequests: true, hideChat: true, hideLastSeen: false }));
    await saveAccountSettings({ allowFriendRequests: true, hideChat: true }, fetchFn);
    expect(posted(calls)).toEqual({ action: 'settings', allowFriendRequests: true, hideChat: true });
  });

  it('hides when the player was last seen', async () => {
    const now = { allowFriendRequests: true, hideChat: false, hideLastSeen: true };
    const { fetchFn, calls } = fakeFetch(success(now));
    expect(await saveAccountSettings({ hideLastSeen: true }, fetchFn)).toEqual({ ok: true, data: now });
    expect(posted(calls)).toEqual({ action: 'settings', hideLastSeen: true });
  });

  it('passes on the refusal for too many changes in an hour', async () => {
    const error = 'Too many requests. Slow down a little.';
    expect(await saveAccountSettings({ hideChat: true }, fakeFetch(failure(error, 429)).fetchFn)).toEqual({ ok: false, error });
  });

  it("passes on the server's refusal", async () => {
    const error = 'A setting is either on or off.';
    expect(await saveAccountSettings({}, fakeFetch(failure(error, 400)).fetchFn)).toEqual({ ok: false, error });
  });

  it.each([
    ['friend requests', { hideChat: true, hideLastSeen: false }],
    ['last seen', { allowFriendRequests: true, hideChat: true }],
  ])('refuses a reply that leaves the %s switch out', async (_name, reply) => {
    expect(await saveAccountSettings({ hideChat: true }, fakeFetch(success(reply)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('issueRecoveryCode', () => {
  it('posts the password and reads the new code, which replaces any earlier one', async () => {
    const { fetchFn, calls } = fakeFetch(success({ recoveryCode: 'K7QM-2XHD-9RWP' }));
    expect(await issueRecoveryCode('my password', fetchFn)).toEqual({ ok: true, data: { recoveryCode: 'K7QM-2XHD-9RWP' } });
    expect(posted(calls)).toEqual({ action: 'recoveryCode', password: 'my password' });
  });

  it.each([
    ['That is not your current password.', 403],
    ['Too many tries at your password in the last hour. Try again later.', 429],
    ['Sign in first.', 401],
  ])('passes on the refusal "%s"', async (error, status) => {
    expect(await issueRecoveryCode('pw', fakeFetch(failure(error, status)).fetchFn)).toEqual({ ok: false, error });
  });

  it('refuses a reply without a code', async () => {
    expect(await issueRecoveryCode('pw', fakeFetch(success({ changed: true })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('signOutEverywhere', () => {
  it('posts the action and reads that every browser is signed out, this one too', async () => {
    const { fetchFn, calls } = fakeFetch(success({ signedOut: true }));
    expect(await signOutEverywhere(fetchFn)).toEqual({ ok: true, data: { signedOut: true } });
    expect(posted(calls)).toEqual({ action: 'signOutEverywhere' });
  });

  it('passes on the refusal for a session that has already ended', async () => {
    expect(await signOutEverywhere(fakeFetch(failure('Sign in first.', 401)).fetchFn)).toEqual({ ok: false, error: 'Sign in first.' });
  });

  it('refuses a reply that does not say so', async () => {
    expect(await signOutEverywhere(fakeFetch(success({ signedIn: false })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});
