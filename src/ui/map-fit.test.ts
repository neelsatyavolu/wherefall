import { describe, expect, it } from 'vitest';
import { MAX_LATITUDE, holds, mustSee, near, onMap, pointsToFit, roomIn, together, viewOf } from './map-fit.ts';

const at = (lng: number, lat: number) => ({ lng, lat });
const lngs = (points: readonly { lng: number }[]) => points.map((point) => point.lng);

describe('onMap', () => {
  it('leaves a point the map can draw where it is', () => {
    expect(onMap(at(12, 48))).toEqual(at(12, 48));
  });

  it("draws a point past the map's edge on the edge: a pole has no place on a flat map", () => {
    expect(onMap(at(30, 90))).toEqual(at(30, MAX_LATITUDE));
    expect(onMap(at(30, -89))).toEqual(at(30, -MAX_LATITUDE));
  });
});

describe('near', () => {
  it('leaves a point that is already the short way round', () => {
    expect(near(at(10, 0), at(100, 5))).toEqual(at(100, 5));
  });

  it('carries a point across the date line to the side its partner is on', () => {
    expect(near(at(179, 10), at(-179, 12))).toEqual(at(181, 12));
    expect(near(at(-160, 25), at(130, 20))).toEqual(at(-230, 20));
  });

  it('keeps two points half the world apart half the world apart', () => {
    expect(Math.abs(near(at(5, 0), at(-175, 0)).lng - 5)).toBe(180);
  });
});

describe('together', () => {
  it('keeps the order, and leaves points that do not straddle the date line alone', () => {
    expect(together([at(10, 0), at(-20, 5), at(60, -5)])).toEqual([at(10, 0), at(-20, 5), at(60, -5)]);
  });

  it('puts points either side of the date line on one side of it', () => {
    const all = lngs(together([at(170, 0), at(-170, 0), at(175, 0)]));
    expect(Math.max(...all) - Math.min(...all)).toBe(20);
    expect(all.map((lng) => ((lng % 360) + 360) % 360)).toEqual([170, 190, 175]);
  });

  it('opens the ring at its widest gap, so the points take the least of the map', () => {
    const all = lngs(together([at(-150, 0), at(100, 0), at(140, 0), at(-170, 0)]));
    expect(Math.max(...all) - Math.min(...all)).toBe(110);
  });

  it('has nothing to do for one point or none', () => {
    expect(together([])).toEqual([]);
    expect(together([at(200, 3)])).toEqual([at(200, 3)]);
  });
});

describe('holds', () => {
  const room = { width: 260, height: 180 };

  it('is true of points the room has space for with the world drawn that large', () => {
    expect(holds([at(0, 0), at(40, 20)], room, 800)).toBe(true);
  });

  it('is false of points too far apart along the map', () => {
    expect(holds([at(0, 0), at(150, 0)], room, 800)).toBe(false);
  });

  it('is false of points too far apart up and down it: the map stretches towards the poles', () => {
    expect(holds([at(0, 80), at(5, 0)], room, 800)).toBe(false);
    expect(holds([at(0, 30), at(5, 0)], room, 800)).toBe(true);
  });

  it('is true of one point, and of none', () => {
    expect(holds([at(0, 0)], room, 800)).toBe(true);
    expect(holds([], room, 800)).toBe(true);
  });

  it('is false of a room with no space in it', () => {
    expect(holds([at(0, 0), at(1, 1)], { width: 0, height: 180 }, 800)).toBe(false);
  });
});

describe('mustSee', () => {
  const place = at(2, 48);
  const pin = (lng: number, lat: number, own = false) => ({ point: at(lng, lat), own });

  it("is the place and the player's own pin, however many others there are", () => {
    expect(mustSee(place, [pin(140, -30), pin(10, 45, true), pin(-120, 10)])).toEqual([place, at(10, 45)]);
  });

  it('is the place and everyone when the player made no guess: there is no pin of their own to prefer', () => {
    expect(mustSee(place, [pin(140, -30), pin(-120, 10)])).toEqual([place, at(140, -30), at(-120, 10)]);
  });

  it('is the place alone when nobody guessed', () => {
    expect(mustSee(place, [])).toEqual([place]);
  });
});

describe('pointsToFit', () => {
  const room = { width: 260, height: 180 };
  const place = at(2, 48);
  const own = at(10, 45);

  it('is everyone when the map holds them all', () => {
    const all = [place, own, at(20, 40), at(-5, 52)];
    expect(pointsToFit(all, [place, own], room, 800)).toEqual(all);
  });

  it("is the player's own pin and the place when the others are too far off", () => {
    const all = [place, own, at(140, -30), at(-120, 10)];
    expect(pointsToFit(all, [place, own], room, 800)).toEqual([place, own]);
  });

  it('brings what it fits to one side of the date line', () => {
    const fitted = lngs(pointsToFit([at(179, 0), at(-179, 0)], [at(179, 0), at(-179, 0)], room, 800));
    expect(Math.max(...fitted) - Math.min(...fitted)).toBe(2);
  });
});

describe('roomIn', () => {
  it('leaves padding the map has room for as it is', () => {
    const padding = { top: 88, right: 64, bottom: 64, left: 488 };
    expect(roomIn(padding, { width: 1360, height: 840 })).toEqual(padding);
  });

  it('counts a side that was not given as none', () => {
    expect(roomIn({ top: 10 }, { width: 400, height: 400 })).toEqual({ top: 10, right: 0, bottom: 0, left: 0 });
  });

  it('gives way, each side by its share, when the padding would leave the map no room', () => {
    const fitted = roomIn({ top: 100, right: 64, bottom: 700, left: 64 }, { width: 390, height: 800 });
    expect(800 - fitted.top - fitted.bottom).toBeCloseTo(96);
    expect(fitted.bottom / fitted.top).toBeCloseTo(7);
    expect([fitted.left, fitted.right]).toEqual([64, 64]);
  });
});

describe('viewOf', () => {
  const room = { width: 260, height: 180 };
  /** how far down a world `world` pixels tall a latitude is drawn */
  const down = (lat: number, world: number) => (0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)) * world;

  it('draws the world as large as the room holds two points side by side', () => {
    const view = viewOf([at(5, 0), at(185, 0)], room);
    expect(view.world).toBeCloseTo(520);
    expect([view.lng, view.lat]).toEqual([95, expect.closeTo(0)]);
  });

  it('draws it as large as the room holds two points one above the other, half way between them on the map', () => {
    const view = viewOf([at(0, 60), at(0, -60)], room);
    expect(down(-60, view.world) - down(60, view.world)).toBeCloseTo(180);
    expect(view.lat).toBeCloseTo(0);
    const lopsided = viewOf([at(0, 80), at(0, 0)], room);
    // the map stretches towards the pole: the middle of the two on the map is well north of 40 degrees
    expect(lopsided.lat).toBeGreaterThan(55);
    expect(down(lopsided.lat, 1000) - down(80, 1000)).toBeCloseTo(down(0, 1000) - down(lopsided.lat, 1000));
  });

  it('takes the tighter of the two ways', () => {
    const view = viewOf([at(0, 60), at(90, -60)], room);
    expect(down(-60, view.world) - down(60, view.world)).toBeCloseTo(180);
    expect((90 / 360) * view.world).toBeLessThan(260);
  });

  it('holds a point at the pole on the edge of the map, and so in the room', () => {
    const view = viewOf([at(5, 90), at(166.7, -77.8)], room);
    expect(down(-77.8, view.world) - down(MAX_LATITUDE, view.world)).toBeCloseTo(180);
  });

  it('is on the one point, with the world of any size, when there is nothing to hold apart', () => {
    expect(viewOf([at(12, 48)], room)).toEqual({ lng: 12, lat: expect.closeTo(48), world: Infinity });
  });
});
