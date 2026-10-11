import { describe, expect, it, vi } from 'vitest';
import { parseLocationSet } from '../game/locations.ts';
import { ViewerBudgetError, withinBudget } from './budget.ts';
import type { ImageryProvider } from './provider.ts';

const set = parseLocationSet({ regions: {}, locations: [['a', 1, 2, 'FR']] });
const place = { id: 'a', lng: 1, lat: 2, country: 'FR' };

function google(): ImageryProvider {
  return {
    name: 'google',
    attribution: null,
    places: vi.fn(async () => set),
    resolve: vi.fn(async (location) => ({ lng: location.lng, lat: location.lat, credit: 'g' })),
    isGone: () => false,
    createView: vi.fn(async () => ({ show: async () => {}, returnToStart: async () => {}, moveByKey: () => {}, destroy: () => {} })),
  };
}

describe('withinBudget', () => {
  it('asks once for a whole game, however many places and views it takes', async () => {
    const ask = vi.fn(async () => true);
    const provider = withinBudget(google(), ask);
    await Promise.all([provider.resolve(place), provider.resolve(place), provider.resolve(place)]);
    await provider.createView({} as HTMLElement, 'move', { onBearing: () => {}, onAtStart: () => {}, onNotice: () => {} });
    await provider.resolve(place);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('does not ask until a place is opened: reading the list of places, as the home screen does, costs nothing', async () => {
    const ask = vi.fn(async () => false);
    const provider = withinBudget(google(), ask);
    expect((await provider.places()).locations).toHaveLength(1);
    expect(ask).not.toHaveBeenCalled();
  });

  it("refuses everything when the day's allowance is used up, so the next source takes the game", async () => {
    const inner = google();
    const provider = withinBudget(inner, async () => false);
    await expect(provider.resolve(place)).rejects.toBeInstanceOf(ViewerBudgetError);
    await expect(provider.createView({} as HTMLElement, 'move', { onBearing: () => {}, onAtStart: () => {}, onNotice: () => {} })).rejects.toBeInstanceOf(ViewerBudgetError);
    expect(inner.resolve).not.toHaveBeenCalled();
    expect(inner.createView).not.toHaveBeenCalled();
  });

  it('treats a failed question as a no', async () => {
    const provider = withinBudget(google(), async () => {
      throw new Error('offline');
    });
    await expect(provider.resolve(place)).rejects.toBeInstanceOf(ViewerBudgetError);
  });

  it('does not call a refusal a missing place', () => {
    const provider = withinBudget(google(), async () => false);
    expect(provider.isGone(new ViewerBudgetError())).toBe(false);
    expect(provider.name).toBe('google');
  });
});
