import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { continentOf } from '../game/continents.ts';
import { parseLocationSet, type Location } from '../game/locations.ts';
import { createRng, pickDistinct } from '../game/rng.ts';
import { DAILY_ROUNDS, DAILY_WINDOW, dailySpares, drawDaily } from './draw.ts';

const place = (country: string, n: number, lng = 10): Location => ({ id: `${country.toLowerCase()}-${n}`, lng, lat: 0, country });
const many = (country: string, count: number, lng = 10): Location[] => Array.from({ length: count }, (_, i) => place(country, i, lng));

/** France, Germany and Spain are Europe; Kenya is Africa; Japan is Asia; Brazil is South America. */
const WORLD = [...many('FR', 30), ...many('DE', 30), ...many('ES', 30), ...many('KE', 10), ...many('JP', 10), ...many('BR', 10)];
const SEEDS = Array.from({ length: 200 }, (_, i) => `daily202610${i}`);

const countries = (places: readonly Location[]) => new Set(places.map((each) => each.country)).size;
const continents = (places: readonly Location[]) => new Set(places.map(continentOf)).size;

describe('drawDaily', () => {
  it('draws three places in three countries on at least two continents, whatever the seed', () => {
    for (const seed of SEEDS) {
      const drawn = drawDaily(WORLD, seed);
      expect(drawn).toHaveLength(DAILY_ROUNDS);
      expect(countries(drawn)).toBe(3);
      expect(continents(drawn)).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives the same three for the same seed and list, and other places for another seed', () => {
    expect(drawDaily(WORLD, 'daily20261011')).toEqual(drawDaily([...WORLD], 'daily20261011'));
    const days = new Set(SEEDS.map((seed) => drawDaily(WORLD, seed).map((each) => each.id).join()));
    expect(days.size).toBeGreaterThan(150);
  });

  it('does not change the list it is given', () => {
    const before = [...WORLD];
    drawDaily(WORLD, 'daily20261011');
    expect(WORLD).toEqual(before);
  });

  it('leaves out places whose pictures are gone, and still keeps the rule', () => {
    const first = drawDaily(WORLD, 'daily20261011');
    const gone = new Set([first[1]!.id]);
    const again = drawDaily(WORLD, 'daily20261011', gone);
    expect(again.map((each) => each.id)).not.toContain(first[1]!.id);
    expect(again[0]).toEqual(first[0]);
    expect(countries(again)).toBe(3);
    expect(continents(again)).toBeGreaterThanOrEqual(2);
  });

  it('counts Russia east of the Urals as Asia', () => {
    // Russian places at 100°E and French ones: two continents, but a third country is still needed
    const drawn = drawDaily([...many('RU', 5, 100), ...many('FR', 5), ...many('DE', 5)], 'seed');
    expect(countries(drawn)).toBe(3);
    expect(continents(drawn)).toBe(2);
  });

  it('on a list with one continent only, still draws three countries', () => {
    const drawn = drawDaily([...many('FR', 5), ...many('DE', 5), ...many('ES', 5)], 'seed');
    expect(countries(drawn)).toBe(3);
    expect(continents(drawn)).toBe(1);
  });

  it('on a list with two countries only, draws both and then any third place', () => {
    const drawn = drawDaily([...many('FR', 5), ...many('KE', 5)], 'seed');
    expect(drawn).toHaveLength(3);
    expect(countries(drawn)).toBe(2);
    expect(new Set(drawn.map((each) => each.id)).size).toBe(3);
  });

  it('on a list with fewer than three places, draws what there is', () => {
    expect(drawDaily([place('FR', 0), place('KE', 0)], 'seed')).toHaveLength(2);
    expect(drawDaily([], 'seed')).toEqual([]);
  });
});

describe('dailySpares', () => {
  it('offers places that keep the rule whichever of the three they stand in for', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const drawn = drawDaily(WORLD, seed);
      const spares = dailySpares(WORLD, seed, drawn);
      expect(spares.length).toBeGreaterThan(0);
      for (const spare of spares.slice(0, 5)) {
        for (let index = 0; index < drawn.length; index++) {
          const swapped = drawn.map((each, i) => (i === index ? spare : each));
          expect(countries(swapped)).toBe(3);
          expect(continents(swapped)).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('is in the same order every time, and has none of the three in it', () => {
    const drawn = drawDaily(WORLD, 'daily20261011');
    const spares = dailySpares(WORLD, 'daily20261011', drawn);
    expect(spares).toEqual(dailySpares(WORLD, 'daily20261011', drawn));
    expect(spares.filter((spare) => drawn.includes(spare))).toEqual([]);
  });

  it('has nothing to offer where no other place would keep the rule', () => {
    const list = [...many('FR', 3), ...many('DE', 3), ...many('KE', 1)];
    const drawn = drawDaily(list, 'seed');
    expect(dailySpares(list, 'seed', drawn)).toEqual([]);
  });
});

/** What the server holds a daily to: its places are among the first hundred the day's seed puts their list in. */
describe("the server's window", () => {
  const firstHundred = (list: readonly Location[], seed: string) => new Set(pickDistinct(list, list.length, createRng(seed)).slice(0, DAILY_WINDOW).map((each) => each.id));

  it('is a hundred places', () => {
    expect(DAILY_WINDOW).toBe(100);
  });

  it.each(['locations.google.json', 'locations.json'])('holds the draw, a redraw around lost pictures, and every spare, on %s for a year of days', (file) => {
    const { locations } = parseLocationSet(JSON.parse(readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8')));
    const year = Array.from({ length: 365 }, (_, day) => `daily${new Date(Date.UTC(2026, 9, 11) + day * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '')}`);
    for (const seed of year) {
      const window = firstHundred(locations, seed);
      const drawn = drawDaily(locations, seed);
      // the three first drawn have all lost their pictures
      const redrawn = drawDaily(locations, seed, new Set(drawn.map((each) => each.id)));
      const spares = dailySpares(locations, seed, drawn);
      expect(drawn).toHaveLength(DAILY_ROUNDS);
      expect(redrawn).toHaveLength(DAILY_ROUNDS);
      expect(new Set(redrawn.map((each) => each.country)).size).toBe(DAILY_ROUNDS);
      expect(spares.length).toBeGreaterThan(0);
      expect([...drawn, ...redrawn, ...spares].filter((each) => !window.has(each.id))).toEqual([]);
    }
  });

  it('never reaches past the hundred for a place that fits the rule better', () => {
    // a hundred French places and more in the seed's order before the first of anywhere else
    const list = [...many('FR', 400), ...many('KE', 1), ...many('JP', 1)];
    const seed = Array.from({ length: 500 }, (_, i) => `seed${i}`).find((each) => [...firstHundred(list, each)].every((id) => id.startsWith('fr-')))!;
    expect(seed).toBeDefined();
    expect(drawDaily(list, seed).every((each) => each.country === 'FR')).toBe(true);
    expect(dailySpares(list, seed, drawDaily(list, seed))).toEqual([]);
  });
});
