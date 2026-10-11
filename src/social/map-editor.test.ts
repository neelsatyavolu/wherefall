import { describe, expect, it } from 'vitest';
import { PLACES_PER_PAGE, addPlace, emptyDraft, lastPage, placesOnPage, problemWith, removePlace, toContent, type Draft } from './map-editor.ts';
import type { MapRow } from './maps.ts';

const row = (n: number): MapRow => [`pano-${n}`, 2 + n * 0.01, 48 + n * 0.01, 'FR'];
const withPlaces = (count: number, change: Partial<Draft> = {}): Draft => ({ name: 'Paris walk', description: 'Left bank and right, all on foot.', details: '', places: Array.from({ length: count }, (_, i) => row(i)), ...change });

describe('a map being made', () => {
  it('starts empty', () => {
    expect(emptyDraft()).toEqual({ name: '', description: '', details: '', places: [] });
  });

  it('adds a place to the end without changing the draft it was given', () => {
    const draft = withPlaces(2);
    const next = addPlace(draft, row(9));
    expect(next.places.map((place) => place[0])).toEqual(['pano-0', 'pano-1', 'pano-9']);
    expect(draft.places).toHaveLength(2);
  });

  it('does not add the same panorama twice', () => {
    const draft = withPlaces(2);
    expect(addPlace(draft, row(1))).toBe(draft);
  });

  it('stops at 5000 places', () => {
    const full = withPlaces(5000);
    expect(addPlace(full, row(900))).toBe(full);
  });

  it('removes a place by its id', () => {
    expect(removePlace(withPlaces(3), 'pano-1').places.map((place) => place[0])).toEqual(['pano-0', 'pano-2']);
  });
});

describe('problemWith', () => {
  it('passes a map with a name, a description and five places', () => {
    expect(problemWith(withPlaces(5))).toBeNull();
    expect(problemWith(withPlaces(5, { name: 'abc', description: 'd'.repeat(20) }))).toBeNull();
    expect(problemWith(withPlaces(5000, { name: 'a'.repeat(30), description: 'd'.repeat(100) }))).toBeNull();
  });

  it('asks for a name of 3 to 30 characters, ignoring spaces around it', () => {
    expect(problemWith(withPlaces(5, { name: ' ab ' }))).toBe('Give the map a name of 3 to 30 characters.');
    expect(problemWith(withPlaces(5, { name: 'a'.repeat(31) }))).toBe('Give the map a name of 3 to 30 characters.');
  });

  it('asks for at least five places, and says how many are still missing', () => {
    expect(problemWith(withPlaces(3))).toBe('A map needs at least 5 places. Add 2 more.');
    expect(problemWith(withPlaces(4))).toBe('A map needs at least 5 places. Add 1 more.');
  });

  it('asks for a description of 20 to 100 characters, ignoring spaces around it', () => {
    const problem = 'Give the map a short description of 20 to 100 characters.';
    expect(problemWith(withPlaces(5, { description: '' }))).toBe(problem);
    expect(problemWith(withPlaces(5, { description: `  ${'d'.repeat(19)}  ` }))).toBe(problem);
    expect(problemWith(withPlaces(5, { description: 'd'.repeat(101) }))).toBe(problem);
  });

  it('takes a long description of up to 1000 characters, or none', () => {
    expect(problemWith(withPlaces(5, { details: '' }))).toBeNull();
    expect(problemWith(withPlaces(5, { details: 'd'.repeat(1000) }))).toBeNull();
    expect(problemWith(withPlaces(5, { details: `  ${'d'.repeat(1000)}\n\n` }))).toBeNull();
    expect(problemWith(withPlaces(5, { details: 'd'.repeat(1001) }))).toBe('Keep the long description to 1,000 characters.');
  });

  it('names the first thing wrong: the name, then the descriptions, then the places', () => {
    expect(problemWith(withPlaces(0, { name: '', description: '' }))).toBe('Give the map a name of 3 to 30 characters.');
    expect(problemWith(withPlaces(0, { description: '' }))).toBe('Give the map a short description of 20 to 100 characters.');
  });
});

describe('toContent', () => {
  it('is what gets saved: trimmed text and the places', () => {
    const draft = withPlaces(5, { name: '  Paris walk ', description: ' Left bank and right, all on foot. ' });
    expect(toContent(draft)).toEqual({ name: 'Paris walk', description: 'Left bank and right, all on foot.', details: '', locations: draft.places });
  });

  it('keeps the line breaks inside the long description, and drops the space around it', () => {
    const draft = withPlaces(5, { details: '\n Start at the river.\nEvery place is near it. \n' });
    expect(toContent(draft).details).toBe('Start at the river.\nEvery place is near it.');
  });
});

describe('the list of places, a page at a time', () => {
  it('shows fifty to a page, numbered from where the page starts', () => {
    const page = placesOnPage(withPlaces(120).places, 1);
    expect(PLACES_PER_PAGE).toBe(50);
    expect(page.rows).toHaveLength(50);
    expect(page.rows[0]?.[0]).toBe('pano-50');
    expect(page).toMatchObject({ page: 1, first: 50, total: 120 });
  });

  it('ends on a short page', () => {
    expect(lastPage(120)).toBe(2);
    expect(placesOnPage(withPlaces(120).places, 2).rows).toHaveLength(20);
    expect(lastPage(100)).toBe(1);
    expect(lastPage(5000)).toBe(99);
  });

  it('has one empty page when there are no places', () => {
    expect(lastPage(0)).toBe(0);
    expect(placesOnPage([], 0)).toEqual({ rows: [], page: 0, first: 0, total: 0 });
  });

  it('falls back to the last page when the one asked for is gone', () => {
    expect(placesOnPage(withPlaces(50).places, 3)).toMatchObject({ page: 0, first: 0 });
    expect(placesOnPage(withPlaces(51).places, -1)).toMatchObject({ page: 0 });
  });
});
