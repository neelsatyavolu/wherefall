import { describe, expect, it } from 'vitest';
import { REFUSALS } from '../account/client.ts';
import { NOT_ON_MAP, NOT_TODAYS_PLACES, RUN_PLACES_UNKNOWN, isOutdated, isStaleDaily, refusalNote, xpWords } from './save-notes.ts';

const GENERIC = 'This game could not be saved to your stats.';
const RELOAD = 'Wherefall was updated while this page was open, and its places changed. Your next game is played on the current ones.';

describe('xpWords', () => {
  it('says what was earned, and nothing when nothing was', () => {
    expect(xpWords({ xpEarned: 120, xpCapped: false })).toBe('+120 XP.');
    expect(xpWords({ xpEarned: 1250, xpCapped: false })).toBe('+1,250 XP.');
    expect(xpWords({ xpEarned: 0, xpCapped: false })).toBe('');
  });

  it("says XP was not added once the day's limit is reached", () => {
    expect(xpWords({ xpEarned: 0, xpCapped: true })).toBe("Today's XP limit for solo games is reached, so no XP was added.");
  });

  it('says only part was added by the game that reaches the limit', () => {
    expect(xpWords({ xpEarned: 40, xpCapped: true })).toBe("+40 XP. That reaches today's XP limit for solo games, so only part of the XP was added.");
  });
});

describe('refusalNote', () => {
  it("says a refusal the player can make sense of in the server's own words, as a failure", () => {
    for (const said of [REFUSALS.dailyUnstarted, REFUSALS.dailyTooSoon, REFUSALS.runTooSoon]) {
      expect(refusalNote(said, GENERIC)).toEqual({ text: said, state: 'error' });
    }
  });

  it('adds the way on when the server no longer knows the places of an official map: the site was updated', () => {
    expect(refusalNote(NOT_ON_MAP, GENERIC)).toEqual({ text: `${NOT_ON_MAP} ${RELOAD}`, state: 'error' });
    expect(refusalNote(RUN_PLACES_UNKNOWN, GENERIC)).toEqual({ text: `${RUN_PLACES_UNKNOWN} ${RELOAD}`, state: 'error' });
  });

  it("leaves a community map's places to the server's words: its maker changed or removed it, and no reload brings it back", () => {
    expect(refusalNote(NOT_ON_MAP, GENERIC, false)).toEqual({ text: NOT_ON_MAP, state: 'error' });
  });

  it('keeps the plain "could not be saved" for everything else', () => {
    for (const other of ['Could not reach the server. Check your connection and try again.', REFUSALS.signIn, 'Too many games saved in the last hour.']) {
      expect(refusalNote(other, GENERIC)).toEqual({ text: GENERIC, state: 'error' });
    }
  });
});

describe('isOutdated', () => {
  it('knows the refusals that mean the server holds another list of places than this page read', () => {
    expect(isOutdated(NOT_ON_MAP)).toBe(true);
    expect(isOutdated(RUN_PLACES_UNKNOWN)).toBe(true);
  });

  it("is not about a community map, whose places are its maker's to change, nor about any other refusal", () => {
    expect(isOutdated(NOT_ON_MAP, false)).toBe(false);
    expect(isOutdated(REFUSALS.runTooSoon)).toBe(false);
    expect(isOutdated(NOT_TODAYS_PLACES)).toBe(false);
  });
});

describe('isStaleDaily', () => {
  it("knows the one refusal that means the day's places changed under the game", () => {
    expect(isStaleDaily(NOT_TODAYS_PLACES)).toBe(true);
    expect(isStaleDaily(NOT_ON_MAP)).toBe(false);
    expect(isStaleDaily(REFUSALS.dailyTooSoon)).toBe(false);
  });
});
