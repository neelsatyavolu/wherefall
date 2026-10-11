import { describe, expect, it } from 'vitest';
import { de } from '../i18n/de.ts';
import { en } from '../i18n/en.ts';
import { es } from '../i18n/es.ts';
import { fr } from '../i18n/fr.ts';
import { ru } from '../i18n/ru.ts';
import { COACH_STEPS, LANDMARKS, advance, factKey, firstStep, waysOn } from './tutorial.ts';

describe("the tutorial's landmarks", () => {
  it('are two, each with the fact its result shows', () => {
    expect(LANDMARKS).toEqual(['eiffel', 'colosseum']);
    expect(factKey(0)).toBe('tutorial.fact.eiffel');
    expect(factKey(1)).toBe('tutorial.fact.colosseum');
    expect(factKey(2)).toBeNull();
  });

  it('have a fact of one plain sentence in every language', () => {
    for (const catalog of [en, es, fr, de, ru]) {
      for (const landmark of LANDMARKS) {
        const fact = catalog[`tutorial.fact.${landmark}`];
        expect(fact).toMatch(/^[^.!?]+\.$/u);
      }
    }
  });
});

describe('the ways on from the tutorial', () => {
  it('are Singleplayer, the daily challenge and signing up for a visitor', () => {
    expect(waysOn(false)).toEqual(['singleplayer', 'daily', 'account']);
  });

  it('leave signing up out for a player who has an account', () => {
    expect(waysOn(true)).toEqual(['singleplayer', 'daily']);
  });
});

describe('the tutorial coach', () => {
  it('goes through the steps in order', () => {
    expect(COACH_STEPS).toEqual(['look', 'move', 'map', 'pin', 'guess', 'result', 'solo']);
    expect(firstStep('move')).toBe('look');
  });

  it('moves on when the player does what the step asks', () => {
    expect(advance('look', 'looked', 'move')).toBe('move');
    expect(advance('move', 'moved', 'move')).toBe('map');
    expect(advance('map', 'mapOpened', 'move')).toBe('pin');
    expect(advance('pin', 'pinned', 'move')).toBe('guess');
    expect(advance('guess', 'guessed', 'move')).toBe('result');
    expect(advance('result', 'nextRound', 'move')).toBe('solo');
  });

  it('stays put for anything else', () => {
    expect(advance('pin', 'moved', 'move')).toBe('pin');
    expect(advance('map', 'looked', 'move')).toBe('map');
    expect(advance('solo', 'pinned', 'move')).toBe('solo');
  });

  it('jumps ahead when the player is ahead of it', () => {
    expect(advance('look', 'guessed', 'move')).toBe('result');
    expect(advance('move', 'pinned', 'move')).toBe('guess');
  });

  it('leaves out moving in a mode that has none', () => {
    expect(advance('look', 'looked', 'no-move')).toBe('map');
  });

  it('is over after the last step, and once dismissed', () => {
    expect(advance('solo', 'nextRound', 'move')).toBeNull();
    expect(advance(null, 'looked', 'move')).toBeNull();
  });
});
