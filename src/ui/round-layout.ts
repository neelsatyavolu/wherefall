import type { LngLat } from '../game/geo.ts';
import type { MapId } from '../game/locations.ts';
import type { Bounds } from './guess-map.ts';
import type { Padding, Room } from './map-fit.ts';

/** Where the round screen's map opens and how it keeps clear of the panel over it. */

const PANEL_GAP = 32;
const MAP_EDGE = 64;
const MAX_PANEL_SHARE = 0.6;
/** under the HUD: half a pin, and a little air */
const HUD_GAP = 24;

/** Where something is on the screen. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The box around a region's or country's places, or null for the world map. */
export function homeBounds(map: MapId, locations: readonly LngLat[]): Bounds | null {
  if (map === 'world' || locations.length === 0) {
    return null;
  }
  const lngs = locations.map((l) => l.lng);
  const lats = locations.map((l) => l.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/**
 * Keeps pins clear of a panel: beside a narrow panel on the left edge or the right one, above a
 * wide bottom one. Beside a panel the padding is capped so there is always room left for the map
 * itself. A panel that runs the width of the screen's foot is a phone's sheet: the HUD runs the
 * width of the screen too then, so pins keep under it, and the sheet is cleared whole, however
 * tall it is (the map draws the world as small as the room that leaves needs).
 */
export function paddingFor(panel: Box, hudFoot: number, screen: Room): Padding {
  const base = { top: MAP_EDGE, right: MAP_EDGE, bottom: MAP_EDGE, left: MAP_EDGE };
  const atLeft = panel.left <= MAP_EDGE;
  const atRight = panel.right >= screen.width - MAP_EDGE;
  const narrow = panel.right - panel.left < screen.width * 0.6;
  if (atLeft && narrow) {
    return { ...base, left: Math.min(panel.right + PANEL_GAP, screen.width * MAX_PANEL_SHARE) };
  }
  if (atRight && narrow) {
    return { ...base, right: Math.min(screen.width - panel.left + PANEL_GAP, screen.width * MAX_PANEL_SHARE) };
  }
  const above = screen.height - panel.top + PANEL_GAP;
  const sheet = atLeft && atRight;
  return sheet ? { ...base, top: Math.max(MAP_EDGE, hudFoot + HUD_GAP), bottom: above } : { ...base, bottom: Math.min(above, screen.height * MAX_PANEL_SHARE) };
}

/** The padding that keeps pins clear of `panel` as it stands on the screen now, under `hud`. */
export function paddingAround(panel: HTMLElement, hud: HTMLElement): Padding {
  return paddingFor(panel.getBoundingClientRect(), hud.getBoundingClientRect().bottom, { width: window.innerWidth, height: window.innerHeight });
}

/** The sides of a padding that are not what they were: what a panel that changed its size asks the map to fit again with. */
export function changedSides(before: Padding, after: Padding): Partial<Padding> {
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  return Object.fromEntries(sides.filter((side) => before[side] !== after[side]).map((side) => [side, after[side]]));
}
