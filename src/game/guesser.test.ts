import { describe, expect, it } from 'vitest';
import { CONTINENTS, continentOfCountry } from './continents.ts';
import {
  GUESSER_MAX_SCORE,
  GUESSER_ROUNDS,
  OPTION_COUNT,
  answerOf,
  correctCount,
  drawRun,
  isOver,
  judge,
  listedCountries,
  newRun,
  optionsFor,
  scoreOf,
} from './guesser.ts';
import type { Location } from './locations.ts';

const place = (country: string, n = 0, lng = 10): Location => ({ id: `${country}-${n}`, lng, lat: 0, country });
const many = (country: string, count: number): Location[] => Array.from({ length: count }, (_, i) => place(country, i));

const EUROPE = ['FR', 'DE', 'ES', 'IT', 'PL', 'SE', 'NO', 'FI', 'PT', 'GR', 'AT', 'CH'];
const WORLD = [...EUROPE, 'KE', 'NG', 'JP', 'IN', 'US', 'CA', 'BR', 'AR', 'AU', 'NZ'];
const world = WORLD.flatMap((country) => many(country, 4));

describe('answerOf', () => {
  it('is the country in one game and the continent in the other', () => {
    expect(answerOf('country', place('FR'))).toBe('FR');
    expect(answerOf('continent', place('FR'))).toBe('europe');
  });

  it('has an answer for any country, but no continent for Antarctica', () => {
    expect(answerOf('country', place('AQ'))).toBe('AQ');
    expect(answerOf('continent', place('AQ'))).toBeNull();
  });
});

describe('drawRun', () => {
  it('gives the same places in the same order for the same seed, and others for another', () => {
    const ids = (seed: string) => drawRun('country', world, seed, new Set()).map((each) => each.id);
    expect(ids('seed1')).toEqual(ids('seed1'));
    expect(ids('seed1')).not.toEqual(ids('seed2'));
  });

  it('keeps every usable place, so one whose picture is gone can be replaced', () => {
    expect(drawRun('country', world, 'seed1', new Set())).toHaveLength(world.length);
  });

  it('leaves out places with no continent in the Continent Guesser only', () => {
    const withAntarctica = [...world, ...many('AQ', 5)];
    expect(drawRun('continent', withAntarctica, 'seed1', new Set()).some((each) => each.country === 'AQ')).toBe(false);
    expect(drawRun('country', withAntarctica, 'seed1', new Set()).some((each) => each.country === 'AQ')).toBe(true);
  });

  it('plays ten different countries when the list has that many', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const game = drawRun('country', world, seed, new Set()).slice(0, GUESSER_ROUNDS);
      expect(new Set(game.map((each) => each.country)).size).toBe(GUESSER_ROUNDS);
    }
  });

  it('repeats countries when the list has fewer than ten', () => {
    const game = drawRun('country', [...many('KE', 20), ...many('JP', 20)], 'seed1', new Set()).slice(0, GUESSER_ROUNDS);
    expect(game).toHaveLength(GUESSER_ROUNDS);
    expect(new Set(game.map((each) => each.country))).toEqual(new Set(['KE', 'JP']));
  });

  it('prefers places not seen before', () => {
    const first = drawRun('country', world, 'seed1', new Set()).slice(0, GUESSER_ROUNDS);
    const seen = new Set(first.map((each) => each.id));
    const again = drawRun('country', world, 'seed1', seen).slice(0, GUESSER_ROUNDS);
    expect(again.some((each) => seen.has(each.id))).toBe(false);
  });

  it('fills the game with seen places when too few unseen ones remain', () => {
    const list = many('KE', 12);
    const seen = new Set(list.slice(0, 9).map((each) => each.id));
    const game = drawRun('country', list, 'seed1', seen).slice(0, GUESSER_ROUNDS);
    expect(game).toHaveLength(GUESSER_ROUNDS);
    expect(game.slice(0, 3).every((each) => !seen.has(each.id))).toBe(true);
    expect(game.slice(3).every((each) => seen.has(each.id))).toBe(true);
  });
});

describe('optionsFor', () => {
  const listed = listedCountries(world);

  it('offers six countries, the right one among them, none twice', () => {
    for (let round = 0; round < GUESSER_ROUNDS; round++) {
      const options = optionsFor('country', place('FR'), listed, 'seed1', round);
      expect(options).toHaveLength(OPTION_COUNT);
      expect(new Set(options).size).toBe(OPTION_COUNT);
      expect(options).toContain('FR');
    }
  });

  it('takes the wrong countries from the same continent when the list has enough', () => {
    const options = optionsFor('country', place('FR'), listed, 'seed1', 0);
    expect(options.every((code) => continentOfCountry(code) === 'europe')).toBe(true);
    expect(options.every((code) => listed.includes(code))).toBe(true);
  });

  it('fills up from the rest of the continent, then from elsewhere, when the list is short of neighbours', () => {
    const options = optionsFor('country', place('KE'), listed, 'seed1', 0);
    expect(options).toContain('NG');
    expect(options.filter((code) => continentOfCountry(code) === 'africa')).toHaveLength(OPTION_COUNT);
    const alone = optionsFor('country', place('AQ'), ['AQ', 'FR'], 'seed1', 0);
    expect(alone).toHaveLength(OPTION_COUNT);
    expect(alone).toContain('AQ');
    expect(alone).toContain('FR');
  });

  it('does not put the right answer in the same place every round', () => {
    const positions = new Set(Array.from({ length: 20 }, (_, round) => optionsFor('country', place('FR'), listed, 'seed1', round).indexOf('FR')));
    expect(positions.size).toBeGreaterThan(2);
  });

  it('gives the same buttons for the same seed and round', () => {
    expect(optionsFor('country', place('FR'), listed, 'seed1', 3)).toEqual(optionsFor('country', place('FR'), listed, 'seed1', 3));
  });

  it('offers the six continents, always in the same order', () => {
    expect(optionsFor('continent', place('FR'), listed, 'seed1', 0)).toEqual([...CONTINENTS]);
    expect(optionsFor('continent', place('JP'), listed, 'seed2', 7)).toEqual([...CONTINENTS]);
  });
});

describe('a run', () => {
  it('scores 1,000 points for each right answer, out of 10,000', () => {
    let run = newRun('country');
    run = judge(run, place('FR'), 'FR');
    run = judge(run, place('DE'), 'AT');
    run = judge(run, place('ES'), 'ES');
    expect(correctCount(run)).toBe(2);
    expect(scoreOf(run)).toBe(2000);
    expect(run.answers[1]).toMatchObject({ answer: 'DE', picked: 'AT', correct: false });
    expect(GUESSER_MAX_SCORE).toBe(10_000);
  });

  it('judges a continent by the continent the place is on', () => {
    const run = judge(judge(newRun('continent'), place('RU', 0, 100), 'asia'), place('RU', 1, 30), 'asia');
    expect(run.answers.map((answer) => answer.correct)).toEqual([true, false]);
  });

  it('is over after ten answers and takes no more', () => {
    let run = newRun('country');
    for (let round = 0; round < GUESSER_ROUNDS; round++) {
      expect(isOver(run)).toBe(false);
      run = judge(run, place('FR', round), 'FR');
    }
    expect(isOver(run)).toBe(true);
    expect(scoreOf(run)).toBe(GUESSER_MAX_SCORE);
    expect(judge(run, place('FR', 99), 'DE')).toBe(run);
  });

  it('does not change the run it was given', () => {
    const run = newRun('country');
    judge(run, place('FR'), 'FR');
    expect(run.answers).toHaveLength(0);
  });
});
