import { describe, expect, it } from 'vitest';
import { continentOf } from './continents.ts';
import type { Location } from './locations.ts';
import { pickRounds } from './locations.ts';
import { SPREAD_CONTINENTS, continentCount, drawSpread, isSpread } from './spread.ts';

const place = (id: string, country: string, lng = 10): Location => ({ id, lng, lat: 20, country });
const many = (prefix: string, country: string, count: number): Location[] => Array.from({ length: count }, (_, i) => place(`${prefix}${i}`, country));
const ids = (places: readonly Location[]) => places.map((each) => each.id);

// France and Germany are Europe, Japan is Asia, Kenya is Africa, Brazil is South America
const EUROPE = [place('fr1', 'FR'), place('de1', 'DE'), place('fr2', 'FR'), place('de2', 'DE'), place('fr3', 'FR'), place('de3', 'DE')];

describe('continentCount', () => {
  it('counts the continents the places are on, each once', () => {
    expect(continentCount([place('a', 'FR'), place('b', 'DE'), place('c', 'JP'), place('d', 'KE')])).toBe(3);
    expect(continentCount([])).toBe(0);
  });

  it('counts a place on none of the six for nothing, and Russia by its side of the Urals', () => {
    expect(continentCount([place('a', 'AQ'), place('b', 'FR')])).toBe(1);
    expect(continentCount([place('a', 'RU', 37), place('b', 'RU', 105)])).toBe(2);
  });
});

describe('isSpread', () => {
  it('is true from three continents on', () => {
    expect(isSpread([place('a', 'FR'), place('b', 'JP'), place('c', 'KE')])).toBe(true);
    expect(isSpread([place('a', 'FR'), place('b', 'JP'), place('c', 'JP')])).toBe(false);
    expect(SPREAD_CONTINENTS).toBe(3);
  });
});

describe('drawSpread', () => {
  it('is the first places of the order when they are on three continents already', () => {
    const ordered = [place('fr1', 'FR'), place('jp1', 'JP'), place('fr2', 'FR'), place('ke1', 'KE'), place('de1', 'DE'), place('br1', 'BR')];
    expect(ids(drawSpread(ordered, 5))).toEqual(['fr1', 'jp1', 'fr2', 'ke1', 'de1']);
    expect(ids(drawSpread(ordered, 4))).toEqual(['fr1', 'jp1', 'fr2', 'ke1']);
  });

  it('passes over a place that would leave too few rounds for the continents still missing', () => {
    const ordered = [...EUROPE, place('jp1', 'JP'), place('jp2', 'JP'), place('ke1', 'KE'), place('br1', 'BR')];
    // five rounds: three may be anywhere, then the last two must each bring a new continent
    expect(ids(drawSpread(ordered, 5))).toEqual(['fr1', 'de1', 'fr2', 'jp1', 'ke1']);
    // three rounds: every one of them has to be on a continent of its own
    expect(ids(drawSpread(ordered, 3))).toEqual(['fr1', 'jp1', 'ke1']);
  });

  it('always ends on three continents when the list has them, whatever the order', () => {
    const list = [...many('fr', 'FR', 40), ...many('us', 'US', 30), ...many('jp', 'JP', 3), ...many('aq', 'AQ', 5)];
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      for (const rounds of [3, 5, 10, 20]) {
        const drawn = drawSpread(pickRounds(list, seed, list.length), rounds);
        expect(drawn).toHaveLength(rounds);
        expect(new Set(ids(drawn)).size).toBe(rounds);
        expect(continentCount(drawn)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('is the same draw every time for one order', () => {
    const list = [...many('fr', 'FR', 20), ...many('us', 'US', 20), ...many('jp', 'JP', 2)];
    const ordered = pickRounds(list, 'seed0001', list.length);
    expect(drawSpread(ordered, 5)).toEqual(drawSpread(pickRounds(list, 'seed0001', list.length), 5));
  });

  it('draws again around places whose pictures are gone, and still ends on three continents', () => {
    const ordered = [place('fr1', 'FR'), place('jp1', 'JP'), place('ke1', 'KE'), place('fr2', 'FR'), place('de1', 'DE'), place('br1', 'BR'), place('jp2', 'JP')];
    expect(ids(drawSpread(ordered, 3))).toEqual(['fr1', 'jp1', 'ke1']);
    // Kenya's picture is gone: France again would leave two continents, so the next new one stands in
    expect(ids(drawSpread(ordered, 3, new Set(['ke1'])))).toEqual(['fr1', 'jp1', 'br1']);
    expect(ids(drawSpread(ordered, 3, new Set(['ke1', 'br1', 'fr1'])))).toEqual(['jp1', 'fr2', 'de1']);
    expect(continentCount(drawSpread(ordered, 4, new Set(['jp1', 'ke1'])))).toBe(3);
  });

  it('still gives a game from a list on too few continents: as many as it has, then any other place', () => {
    const ordered = [...EUROPE.slice(0, 3), place('jp1', 'JP'), place('de2', 'DE')];
    const drawn = drawSpread(ordered, 4);
    expect(ids(drawn)).toEqual(['fr1', 'de1', 'jp1', 'fr2']);
    expect(isSpread(drawn)).toBe(false);
    expect(ids(drawSpread(EUROPE, 3))).toEqual(['fr1', 'de1', 'fr2']);
  });

  it('counts a place on no continent as a place, never as a continent', () => {
    const ordered = [place('aq1', 'AQ'), place('aq2', 'AQ'), place('aq3', 'AQ'), place('fr1', 'FR'), place('jp1', 'JP'), place('ke1', 'KE')];
    expect(ids(drawSpread(ordered, 4))).toEqual(['aq1', 'fr1', 'jp1', 'ke1']);
    expect(drawSpread(ordered, 4).map(continentOf)).toEqual([null, 'europe', 'asia', 'africa']);
  });

  it('gives the places there are when the list is shorter than the game', () => {
    expect(ids(drawSpread([place('fr1', 'FR'), place('jp1', 'JP')], 5))).toEqual(['fr1', 'jp1']);
    expect(drawSpread([], 3)).toEqual([]);
    expect(ids(drawSpread([place('fr1', 'FR'), place('jp1', 'JP'), place('ke1', 'KE')], 3, new Set(['jp1'])))).toEqual(['fr1', 'ke1']);
  });

  it('asks for no more continents than there are rounds', () => {
    const ordered = [place('fr1', 'FR'), place('de1', 'DE'), place('jp1', 'JP')];
    expect(ids(drawSpread(ordered, 2))).toEqual(['fr1', 'jp1']);
    expect(ids(drawSpread(ordered, 1))).toEqual(['fr1']);
  });
});
