import { describe, expect, it } from 'vitest';
import type { Location } from '../game/locations.ts';
import { createSession, replaceRound, submitGuess } from '../game/session.ts';
import type { Challenge } from '../game/settings.ts';
import type { ImageryProvider, Place } from '../imagery/provider.ts';
import { listedPlaces, notingListed, toSavedGame } from './saved-game.ts';

const challenge: Challenge = { map: 'country:FR', mode: 'nmpz', timeLimit: 60, rounds: 3, seed: 'abc123' };

/** as the list has them */
const PARIS: Location = { id: 'fr-01', lng: 2.345678, lat: 48.856789, country: 'FR' };
const LYON: Location = { id: 'fr-02', lng: 4.835, lat: 45.764, country: 'FR' };
/** where a picture turned out to be: a stand-in panorama up to 150 m from the listed place */
const shifted = (place: Location): Location => ({ ...place, lng: place.lng + 0.0012, lat: place.lat - 0.0009 });

const played = () => {
  const session = createSession([shifted(PARIS), shifted(LYON)], 1000);
  return submitGuess(submitGuess(session, { lng: 2.5, lat: 48.9 }, true), null);
};

describe('toSavedGame', () => {
  it('sends each round by its id, on the coordinates its list has, with the guess and the hint', () => {
    const listed = listedPlaces();
    [PARIS, LYON].forEach(listed.note);
    const session = played();
    expect(toSavedGame(session, challenge, null, listed.of)).toEqual({
      map: 'country:FR',
      mode: 'nmpz',
      timeLimit: 60,
      seed: 'abc123',
      rounds: [
        { id: 'fr-01', lng: 2.345678, lat: 48.856789, guessLng: 2.5, guessLat: 48.9, hinted: true, country: 'FR', distanceKm: session.results[0]!.distanceKm, score: session.results[0]!.score },
        { id: 'fr-02', lng: 4.835, lat: 45.764, guessLng: null, guessLat: null, hinted: false, country: 'FR', distanceKm: null, score: 0 },
      ],
    });
  });

  it('sends no scale: the server scores the game on its own', () => {
    expect(toSavedGame(played(), challenge, null, () => null)).not.toHaveProperty('scaleKm');
  });

  it('names the day of a daily challenge, and leaves it out of any other game', () => {
    expect(toSavedGame(played(), challenge, '2026-10-11', () => null).daily).toBe('2026-10-11');
    expect(toSavedGame(played(), challenge, null, () => null)).not.toHaveProperty('daily');
  });

  it('keeps the coordinates the game was played on for a place nobody listed', () => {
    const [first] = toSavedGame(played(), challenge, null, () => null).rounds;
    expect(first).toMatchObject({ id: 'fr-01', lng: shifted(PARIS).lng, lat: shifted(PARIS).lat });
  });

  it('sends a spare that took a round over, not the place it replaced', () => {
    const listed = listedPlaces();
    const NICE: Location = { id: 'fr-03', lng: 7.262, lat: 43.7102, country: 'FR' };
    [PARIS, LYON, NICE].forEach(listed.note);
    const swapped = replaceRound(createSession([shifted(PARIS), shifted(LYON)], 1000), 0, shifted(NICE));
    const session = submitGuess(submitGuess(swapped, null), null);
    expect(toSavedGame(session, challenge, null, listed.of).rounds.map(({ id, lng, lat }) => [id, lng, lat])).toEqual([
      ['fr-03', 7.262, 43.7102],
      ['fr-02', 4.835, 45.764],
    ]);
  });
});

describe('notingListed', () => {
  const picture: Place = { lng: 2.3469, lat: 48.8559, credit: 'fixture' };
  const provider = (resolve: ImageryProvider['resolve']): ImageryProvider => ({
    name: 'panoramax',
    attribution: 'credit',
    places: async () => ({ locations: [PARIS, LYON], regions: {} }),
    resolve,
    isGone: (error) => error === 'gone',
    createView: async () => {
      throw new Error('not in this test');
    },
  });

  it('notes every place the source is asked to make ready, as its list has it, and changes nothing else', async () => {
    const listed = listedPlaces();
    const noting = notingListed(provider(async () => picture), listed.note);
    expect(await noting.resolve(PARIS)).toBe(picture);
    expect(listed.of('fr-01')).toEqual({ lng: 2.345678, lat: 48.856789 });
    expect(listed.of('fr-02')).toBeNull();
    expect(noting.name).toBe('panoramax');
    expect(noting.attribution).toBe('credit');
    expect((await noting.places()).locations).toEqual([PARIS, LYON]);
    expect(noting.isGone('gone')).toBe(true);
  });

  it('passes a failure to resolve on as it came', async () => {
    const noting = notingListed(
      provider(async () => {
        throw new Error('down');
      }),
      listedPlaces().note,
    );
    await expect(noting.resolve(PARIS)).rejects.toThrow('down');
  });
});
