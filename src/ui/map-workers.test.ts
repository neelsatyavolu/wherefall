import { describe, expect, it } from 'vitest';
import { workerCountFor } from './map-workers.ts';

describe('workerCountFor', () => {
  it('uses half the cores, leaving the rest to the page and the street pictures', () => {
    expect(workerCountFor(6)).toBe(3);
    expect(workerCountFor(8)).toBe(4);
  });

  it('never goes back to the single worker that made tiles queue', () => {
    expect(workerCountFor(1)).toBe(2);
    expect(workerCountFor(2)).toBe(2);
  });

  it('stops at four: more workers than tiles in a burst only cost memory', () => {
    expect(workerCountFor(32)).toBe(4);
  });

  it('takes a browser that does not say how many cores it has for an ordinary one', () => {
    expect(workerCountFor(undefined)).toBe(2);
    expect(workerCountFor(0)).toBe(2);
  });
});
