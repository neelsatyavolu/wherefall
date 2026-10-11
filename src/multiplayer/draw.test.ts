import { describe, expect, it } from 'vitest';
import { UNREACHABLE } from '../account/testing.ts';
import { PLACES_REFUSALS } from './client.ts';
import { FREE_REDRAWS, afterFailedPost, drawSeed, needsSpread } from './draw.ts';
import { KIND_SETTINGS, matchState, rankedState, settings, teamState } from './testing.ts';

describe('needsSpread', () => {
  it('holds a public game, a ranked duel and a 2v2 on the world map to three continents', () => {
    expect(needsSpread(matchState({ kind: 'unranked', settings: KIND_SETTINGS.unranked }))).toBe(true);
    expect(needsSpread(rankedState())).toBe(true);
    expect(needsSpread(teamState())).toBe(true);
  });

  it('leaves a party alone, on the world map as on any other', () => {
    expect(needsSpread(matchState())).toBe(false);
    expect(needsSpread(matchState({ settings: settings({ rounds: 20 }) }))).toBe(false);
    expect(needsSpread(matchState({ settings: settings({ map: 'europe' }) }))).toBe(false);
  });

  it('asks nothing of a game of fewer than three rounds, or on another map', () => {
    expect(needsSpread(rankedState({ settings: settings({ rounds: 2 }) }))).toBe(false);
    expect(needsSpread(rankedState({ settings: settings({ rounds: 3 }) }))).toBe(true);
    expect(needsSpread(rankedState({ settings: settings({ map: 'country:FR' }) }))).toBe(false);
  });
});

describe('drawSeed', () => {
  it("is the match's own seed for the first draw", () => {
    expect(drawSeed('e2e00001', 0)).toBe('e2e00001');
  });

  it('is another seed for each set the server refused, the same one every time', () => {
    const seeds = [0, 1, 2, 3].map((refused) => drawSeed('e2e00001', refused));
    expect(new Set(seeds).size).toBe(4);
    expect(drawSeed('e2e00001', 2)).toBe(seeds[2]);
    expect(drawSeed('other', 1)).not.toBe(seeds[1]);
  });
});

describe('afterFailedPost', () => {
  it('draws a fresh set by itself the first time the places are refused', () => {
    expect(FREE_REDRAWS).toBe(1);
    expect(afterFailedPost(PLACES_REFUSALS.notOnMap, 0)).toBe('redraw');
    expect(afterFailedPost(PLACES_REFUSALS.tooFewContinents, 0)).toBe('redraw');
    expect(afterFailedPost('This match needs exactly 5 places.', 0)).toBe('redraw');
  });

  it('asks the player once a fresh set was refused too', () => {
    expect(afterFailedPost(PLACES_REFUSALS.notOnMap, 1)).toBe('ask');
    expect(afterFailedPost(PLACES_REFUSALS.tooFewContinents, 4)).toBe('ask');
  });

  it('sends the same places again after any other failure: they were not what was wrong', () => {
    expect(afterFailedPost(UNREACHABLE, 0)).toBe('resend');
    expect(afterFailedPost('Too many requests. Slow down a little.', 0)).toBe('resend');
    expect(afterFailedPost('Only the player picking the places can post them.', 2)).toBe('resend');
  });
});
