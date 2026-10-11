import { describe, expect, it } from 'vitest';
import { GoogleUnavailableError, bestLink, googleResolver, googleSnap, isNoCoverage, scriptUrl, streetViewUrl } from './google.ts';

const location = { id: 'x', lng: 2.2945, lat: 48.8584, country: 'FR' };

const found = {
  data: {
    location: { pano: 'PANO123', latLng: { lat: () => 48.85844, lng: () => 2.29451 } },
    tiles: { centerHeading: 314.6 },
    copyright: '© 2026 Google',
  },
};

const serviceThat = (behaviour: () => Promise<unknown>) => {
  const requests: unknown[] = [];
  return {
    requests,
    service: {
      getPanorama: (request: unknown) => {
        requests.push(request);
        return behaviour();
      },
    },
  };
};

const sources = { GOOGLE: 'google' };
const preference = { NEAREST: 'nearest' };

describe('googleResolver', () => {
  it('snaps a location to the nearest official panorama and reads where it really is', async () => {
    const { service, requests } = serviceThat(async () => found);
    const place = await googleResolver(service, sources, preference, () => false)(location);

    expect(place).toEqual({ panoId: 'PANO123', lat: 48.85844, lng: 2.29451, heading: 314.6, credit: 'Imagery © 2026 Google' });
    expect(requests[0]).toEqual({ location: { lat: 48.8584, lng: 2.2945 }, radius: 150, sources: ['google'], preference: 'nearest' });
  });

  it('reports a place Google has no imagery for as gone, so a spare round is used', async () => {
    const { service } = serviceThat(async () => {
      throw Object.assign(new Error('none'), { code: 'ZERO_RESULTS' });
    });
    const error = await googleResolver(service, sources, preference, () => false)(location).catch((e: unknown) => e);
    expect(isNoCoverage(error)).toBe(true);
  });

  it.each(['OVER_QUERY_LIMIT', 'REQUEST_DENIED', 'UNKNOWN_ERROR'])('treats %s as Google being unavailable, not as a missing place', async (code) => {
    const { service } = serviceThat(async () => {
      throw Object.assign(new Error('nope'), { code });
    });
    const error = await googleResolver(service, sources, preference, () => false)(location).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleUnavailableError);
    expect(isNoCoverage(error)).toBe(false);
  });

  it('opens a place from the Google list by its panorama id', async () => {
    const { service, requests } = serviceThat(async () => found);
    const listed = { ...location, id: 'CAoSLEFGMVFpcE1fXy1abc' };
    const place = await googleResolver(service, sources, preference, () => false)(listed);
    expect(requests).toEqual([{ pano: 'CAoSLEFGMVFpcE1fXy1abc' }]);
    expect(place.panoId).toBe('PANO123');
  });

  it('looks near the coordinates when a listed panorama is gone', async () => {
    let asked = 0;
    const { service, requests } = serviceThat(async () => {
      asked += 1;
      if (asked === 1) {
        throw Object.assign(new Error('none'), { code: 'ZERO_RESULTS' });
      }
      return found;
    });
    const listed = { ...location, id: 'CAoSLEFGMVFpcE1fXy1abc' };
    const place = await googleResolver(service, sources, preference, () => false)(listed);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual({ location: { lat: 48.8584, lng: 2.2945 }, radius: 150, sources: ['google'], preference: 'nearest' });
    expect(place.panoId).toBe('PANO123');
  });

  it('does not fall back when Google itself is failing', async () => {
    const { service, requests } = serviceThat(async () => {
      throw Object.assign(new Error('nope'), { code: 'OVER_QUERY_LIMIT' });
    });
    const listed = { ...location, id: 'CAoSLEFGMVFpcE1fXy1abc' };
    await expect(googleResolver(service, sources, preference, () => false)(listed)).rejects.toBeInstanceOf(GoogleUnavailableError);
    expect(requests).toHaveLength(1);
  });

  it('looks near the coordinates for a place from the Panoramax list, whose id means nothing to Google', async () => {
    const { service, requests } = serviceThat(async () => found);
    const other = { ...location, id: '0b3f6a52-2f8e-4d1c-9a57-3c1e8d2b7f10' };
    await googleResolver(service, sources, preference, () => false)(other);
    expect(requests).toEqual([{ location: { lat: 48.8584, lng: 2.2945 }, radius: 150, sources: ['google'], preference: 'nearest' }]);
  });

  it('refuses to use Google once the key has been rejected', async () => {
    const { service, requests } = serviceThat(async () => found);
    await expect(googleResolver(service, sources, preference, () => true)(location)).rejects.toBeInstanceOf(GoogleUnavailableError);
    expect(requests).toHaveLength(0);
  });
});

describe('bestLink', () => {
  const links = [
    { pano: 'north', heading: 5 },
    { pano: 'east', heading: 95 },
    { pano: 'south', heading: 185 },
  ];

  it('picks the link closest to the direction asked for', () => {
    expect(bestLink(links, 350)).toBe('north');
    expect(bestLink(links, 170)).toBe('south');
  });

  it('gives nothing when no link points roughly that way', () => {
    expect(bestLink(links, 275)).toBeNull();
    expect(bestLink([], 0)).toBeNull();
  });

  it('skips links that are missing their panorama or heading', () => {
    expect(bestLink([{ pano: null, heading: 0 }, { pano: 'ok', heading: 20 }], 0)).toBe('ok');
  });
});

describe('scriptUrl', () => {
  it('carries the key', () => {
    const url = new URL(scriptUrl('abc123', 'ready'));
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/js');
    expect(url.searchParams.get('key')).toBe('abc123');
    expect(url.searchParams.get('callback')).toBe('ready');
    expect(url.searchParams.get('loading')).toBe('async');
  });

  it('leaves the key off in keyless development mode', () => {
    expect(new URL(scriptUrl('dev', 'ready')).searchParams.has('key')).toBe(false);
  });
});

describe('googleSnap', () => {
  it('finds the nearest official panorama within 500 m of a click', async () => {
    const { service, requests } = serviceThat(async () => found);
    const snapped = await googleSnap(service, sources, preference, () => false)({ lng: 2.2945, lat: 48.8584 });
    expect(requests).toEqual([{ location: { lat: 48.8584, lng: 2.2945 }, radius: 500, sources: ['google'], preference: 'nearest' }]);
    expect(snapped).toEqual({ id: 'PANO123', lng: 2.29451, lat: 48.85844 });
  });

  it('is null where Google has no coverage', async () => {
    const { service } = serviceThat(async () => {
      throw Object.assign(new Error('none'), { code: 'ZERO_RESULTS' });
    });
    expect(await googleSnap(service, sources, preference, () => false)({ lng: 0, lat: 0 })).toBeNull();
  });

  it('fails when Google itself is failing, or the key was rejected', async () => {
    const { service } = serviceThat(async () => {
      throw Object.assign(new Error('nope'), { code: 'OVER_QUERY_LIMIT' });
    });
    await expect(googleSnap(service, sources, preference, () => false)({ lng: 0, lat: 0 })).rejects.toBeInstanceOf(GoogleUnavailableError);
    await expect(googleSnap(service, sources, preference, () => true)({ lng: 0, lat: 0 })).rejects.toBeInstanceOf(GoogleUnavailableError);
  });
});

describe('streetViewUrl', () => {
  it('opens Street View on google.com/maps at the place', () => {
    const url = new URL(streetViewUrl({ lng: 2.2945, lat: 48.8584 }));
    expect(`${url.origin}${url.pathname}`).toBe('https://www.google.com/maps/@');
    expect(Object.fromEntries(url.searchParams)).toEqual({ api: '1', map_action: 'pano', viewpoint: '48.8584,2.2945' });
  });
});
