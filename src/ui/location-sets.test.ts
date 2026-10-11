import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetLocationSets, loadLocationSet } from './location-sets.ts';

const LIST = { version: 1, regions: { FR: 'europe' }, locations: [['a', 2, 48, 'FR']] };

/** A `fetch` that answers every request with `list` and notes what it was asked. */
function fetching(list: unknown = LIST, status = 200) {
  const asked: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    return new Response(JSON.stringify(list), { status });
  });
  return asked;
}

afterEach(() => {
  forgetLocationSets();
  vi.unstubAllGlobals();
});

describe('loadLocationSet', () => {
  it("asks the server whether its copy is still good, whatever the browser's cache holds", async () => {
    const asked = fetching();
    const set = await loadLocationSet('/locations.json');
    expect(set.locations).toEqual([{ id: 'a', lng: 2, lat: 48, country: 'FR' }]);
    expect(asked).toEqual([{ url: '/locations.json', init: { cache: 'no-cache' } }]);
  });

  it('fetches a list once a page, and each list on its own', async () => {
    const asked = fetching();
    await loadLocationSet('/locations.json');
    await loadLocationSet('/locations.json');
    await loadLocationSet('/locations.google.json');
    expect(asked.map((each) => each.url)).toEqual(['/locations.json', '/locations.google.json']);
  });

  it('forgets a load that failed, so it can be tried again', async () => {
    const failed = fetching(LIST, 503);
    await expect(loadLocationSet('/locations.json')).rejects.toThrow('HTTP 503');
    expect(failed).toHaveLength(1);
    const asked = fetching();
    await expect(loadLocationSet('/locations.json')).resolves.toMatchObject({ locations: [{ id: 'a' }] });
    expect(asked).toHaveLength(1);
  });

  it('reads every list afresh once they are forgotten: the daily is drawn from the list as the server has it now', async () => {
    const asked = fetching();
    await loadLocationSet('/locations.json');
    forgetLocationSets();
    const deeper = { ...LIST, locations: [...LIST.locations, ['b', 36, -1, 'KE']] };
    const again = fetching(deeper);
    expect((await loadLocationSet('/locations.json')).locations).toHaveLength(2);
    expect(asked).toHaveLength(1);
    expect(again).toHaveLength(1);
  });
});
