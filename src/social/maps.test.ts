import { describe, expect, it } from 'vitest';
import { MAP_LIMITS, countPlay, deleteMap, getMap, getMaps, likeMap, reportMap, saveMap, toLocationSet, type MapDetail, type MapSummary } from './maps.ts';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const success = (data: unknown, status = 200) => fakeFetch({ success: true, data }, status);
const failure = (error: string, status: number) => fakeFetch({ success: false, error }, status);
const sentBody = (call: Call | undefined) => JSON.parse(String(call?.init?.body));
const UNEXPECTED = 'The server sent a reply this page could not read. Try again in a moment.';

const summary: MapSummary = { slug: 'paris-walk-x7k2', name: 'Paris walk', maker: 'sam', places: 6, plays: 41, likes: 3, liked: true, description: 'Left bank and right, all on foot.' };
const detail: MapDetail = {
  ...summary,
  details: 'Start at the river.\nEvery place is within a mile of it.',
  createdAt: '2026-10-09T10:00:00.000Z',
  mine: false,
  locations: [
    ['pano-a', 2.35, 48.85, 'FR'],
    ['pano-b', 2.36, 48.86, 'FR'],
  ],
};

describe('getMaps', () => {
  it.each(['popular', 'newest', 'mine', 'liked'] as const)('asks for the %s list, first page', async (list) => {
    const { fetchFn, calls } = success({ maps: [summary], page: 1, more: false });
    expect(await getMaps({ list }, fetchFn)).toEqual({ ok: true, data: { maps: [summary], page: 1, more: false } });
    expect(calls[0]?.url).toBe(`/api/maps?list=${list}&page=1`);
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
  });

  it('sends the search and the page', async () => {
    const { fetchFn, calls } = success({ maps: [], page: 3, more: true });
    await getMaps({ list: 'popular', search: '  left bank & more ', page: 3 }, fetchFn);
    expect(calls[0]?.url).toBe('/api/maps?list=popular&page=3&q=left+bank+%26+more');
  });

  it('refuses a list with a map that has no slug', async () => {
    const broken = { maps: [{ ...summary, slug: undefined }], page: 1, more: false };
    expect(await getMaps({ list: 'newest' }, success(broken).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('refuses a list with a map that has no description', async () => {
    const broken = { maps: [{ ...summary, description: undefined }], page: 1, more: false };
    expect(await getMaps({ list: 'popular' }, success(broken).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it.each(['mine', 'liked'] as const)('reports a visitor asking for the %s list', async (list) => {
    expect(await getMaps({ list }, failure('Sign in first.', 401).fetchFn)).toEqual({ ok: false, error: 'Sign in first.' });
  });

  it('reports a guest asking for the maps they like', async () => {
    const error = 'Guests cannot do that. Make an account first.';
    expect(await getMaps({ list: 'liked' }, failure(error, 403).fetchFn)).toEqual({ ok: false, error });
  });
});

describe('getMap', () => {
  it('asks for one map by slug', async () => {
    const { fetchFn, calls } = success(detail);
    expect(await getMap('paris-walk-x7k2', fetchFn)).toEqual({ ok: true, data: detail });
    expect(calls[0]?.url).toBe('/api/maps?slug=paris-walk-x7k2');
  });

  it('says so when there is no such map', async () => {
    expect(await getMap('gone', failure('There is no such map.', 404).fetchFn)).toEqual({ ok: false, error: 'There is no such map.' });
  });

  it('reads a map with no long description', async () => {
    expect(await getMap('x', success({ ...detail, details: '' }).fetchFn)).toEqual({ ok: true, data: { ...detail, details: '' } });
  });

  it('refuses a map without the long description field', async () => {
    expect(await getMap('x', success({ ...detail, details: undefined }).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('refuses a map whose places are not rows', async () => {
    expect(await getMap('x', success({ ...detail, locations: [['pano-a', 2.35]] }).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('map actions', () => {
  it('saves a new map without a slug', async () => {
    const { fetchFn, calls } = success(detail, 201);
    const content = { name: 'Paris walk', description: 'Left bank and right, all on foot.', locations: detail.locations };
    expect(await saveMap(content, null, fetchFn)).toEqual({ ok: true, data: detail });
    expect(calls[0]?.url).toBe('/api/maps');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(sentBody(calls[0])).toEqual({ action: 'save', ...content });
  });

  it('sends the short description and the long one, line breaks kept', async () => {
    const { fetchFn, calls } = success(detail, 201);
    const content = { name: 'Paris walk', description: 'Left bank and right, all on foot.', details: 'Start at the river.\nEvery place is within a mile of it.', locations: detail.locations };
    await saveMap(content, null, fetchFn);
    expect(sentBody(calls[0])).toEqual({ action: 'save', ...content });
  });

  it('saves over a map by sending its slug', async () => {
    const { fetchFn, calls } = success(detail);
    const content = { name: 'Paris walk 2', description: 'Both banks again, the long way round.', locations: detail.locations };
    await saveMap(content, 'paris-walk-x7k2', fetchFn);
    expect(sentBody(calls[0])).toEqual({ action: 'save', slug: 'paris-walk-x7k2', ...content });
  });

  it("passes on the server's word on what a map needs", async () => {
    const error = 'A map needs a name of 3 to 30 characters, a description of 20 to 100, and 5 to 5000 places.';
    const content = { name: 'Paris walk', description: 'Too short.', locations: detail.locations };
    expect(await saveMap(content, null, failure(error, 400).fetchFn)).toEqual({ ok: false, error });
  });

  it('deletes a map', async () => {
    const { fetchFn, calls } = success({ deleted: true });
    expect(await deleteMap('paris-walk-x7k2', fetchFn)).toEqual({ ok: true, data: { deleted: true } });
    expect(sentBody(calls[0])).toEqual({ action: 'delete', slug: 'paris-walk-x7k2' });
  });

  it('likes and unlikes a map', async () => {
    const { fetchFn, calls } = success({ ...summary, likes: 2, liked: false });
    expect(await likeMap('paris-walk-x7k2', false, fetchFn)).toEqual({ ok: true, data: { ...summary, likes: 2, liked: false } });
    expect(sentBody(calls[0])).toEqual({ action: 'like', slug: 'paris-walk-x7k2', liked: false });
  });

  it('counts a play', async () => {
    const { fetchFn, calls } = success({ plays: 42 });
    expect(await countPlay('paris-walk-x7k2', fetchFn)).toEqual({ ok: true, data: { plays: 42 } });
    expect(sentBody(calls[0])).toEqual({ action: 'play', slug: 'paris-walk-x7k2' });
  });

  it('reports a map with a reason', async () => {
    const { fetchFn, calls } = success({ reported: true });
    expect(await reportMap('paris-walk-x7k2', 'not street view', fetchFn)).toEqual({ ok: true, data: { reported: true } });
    expect(sentBody(calls[0])).toEqual({ action: 'report', slug: 'paris-walk-x7k2', reason: 'not street view' });
  });

  it("passes on the server's refusals", async () => {
    expect(await deleteMap('x', failure('You have no map by that name.', 404).fetchFn)).toEqual({ ok: false, error: 'You have no map by that name.' });
    expect(await likeMap('x', true, failure('Too many likes in the last hour. Try again later.', 429).fetchFn)).toEqual({
      ok: false,
      error: 'Too many likes in the last hour. Try again later.',
    });
  });

  it('passes on the wave-6 refusals: an account full of places, a map whose maker is gone, a delete too many', async () => {
    const full = "An account's maps can hold 25,000 places in all. Make this one smaller, or delete another.";
    const content = { name: 'Paris walk', description: 'Left bank and right, all on foot.', locations: detail.locations };
    expect(await saveMap(content, null, failure(full, 409).fetchFn)).toEqual({ ok: false, error: full });
    expect(await getMap('paris-walk-x7k2', failure('There is no such map.', 404).fetchFn)).toEqual({ ok: false, error: 'There is no such map.' });
    expect(await deleteMap('x', failure('Too many requests. Slow down a little.', 429).fetchFn)).toEqual({ ok: false, error: 'Too many requests. Slow down a little.' });
    expect(MAP_LIMITS.accountPlaces).toBe(25_000);
  });

  it('refuses a delete reply that is not a delete', async () => {
    expect(await deleteMap('x', success({ deleted: false }).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('toLocationSet', () => {
  it("turns a map's rows into places a game can pick from", () => {
    expect(toLocationSet(detail)).toEqual({
      regions: {},
      locations: [
        { id: 'pano-a', lng: 2.35, lat: 48.85, country: 'FR' },
        { id: 'pano-b', lng: 2.36, lat: 48.86, country: 'FR' },
      ],
    });
  });
});
