import { afterEach, describe, expect, it, vi } from 'vitest';
import { REFUSALS } from '../account/client.ts';
import { useLanguage } from '../i18n/index.ts';
import { announceSessionEnded, isSessionEnded, onSessionEnded, refusalText } from './session-ended.ts';

afterEach(() => useLanguage('en'));

describe('isSessionEnded', () => {
  it('knows the one refusal that means this browser has no session', () => {
    expect(isSessionEnded('Sign in first.')).toBe(true);
    expect(isSessionEnded(REFUSALS.signIn)).toBe(true);
  });

  it('takes every other refusal for what it says', () => {
    expect(isSessionEnded(REFUSALS.guests)).toBe(false);
    expect(isSessionEnded(REFUSALS.deleted)).toBe(false);
    expect(isSessionEnded('That is not your current password.')).toBe(false);
    expect(isSessionEnded('sign in first.')).toBe(false);
    expect(isSessionEnded('')).toBe(false);
  });
});

describe('onSessionEnded', () => {
  it('calls everyone who watches, each time the end of the session is met', () => {
    const [sidebar, pane] = [vi.fn(), vi.fn()];
    const stops = [onSessionEnded(sidebar), onSessionEnded(pane)];
    announceSessionEnded();
    announceSessionEnded();
    expect(sidebar).toHaveBeenCalledTimes(2);
    expect(pane).toHaveBeenCalledTimes(2);
    stops.forEach((stop) => stop());
  });

  it('stops calling a watcher that has gone', () => {
    const [sidebar, pane] = [vi.fn(), vi.fn()];
    const stopSidebar = onSessionEnded(sidebar);
    const stopPane = onSessionEnded(pane);
    stopPane();
    announceSessionEnded();
    expect(sidebar).toHaveBeenCalledTimes(1);
    expect(pane).not.toHaveBeenCalled();
    stopSidebar();
    announceSessionEnded();
    expect(sidebar).toHaveBeenCalledTimes(1);
  });

  it('still reaches the others when one watcher leaves while it is being told', () => {
    const later = vi.fn();
    const stopFirst = onSessionEnded(() => stopFirst());
    const stopLater = onSessionEnded(later);
    announceSessionEnded();
    expect(later).toHaveBeenCalledTimes(1);
    stopLater();
  });
});

describe('refusalText', () => {
  it("gives a refusal back in the server's own words, and tells nobody", () => {
    const watcher = vi.fn();
    const stop = onSessionEnded(watcher);
    expect(refusalText('No player by that name.')).toBe('No player by that name.');
    expect(watcher).not.toHaveBeenCalled();
    stop();
  });

  it('says the player is no longer signed in, in the language in use, and tells whoever watches', async () => {
    const watcher = vi.fn();
    const stop = onSessionEnded(watcher);
    expect(refusalText(REFUSALS.signIn)).toBe('You are no longer signed in.');
    expect(watcher).toHaveBeenCalledTimes(1);
    await useLanguage('de');
    expect(refusalText(REFUSALS.signIn)).toBe('Du bist nicht mehr angemeldet.');
    stop();
  });
});
