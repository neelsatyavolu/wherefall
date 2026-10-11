/// <reference types="google.maps" />
import type { Mode } from '../game/settings.ts';

/** Google lets a view zoom this far in. */
const MAX_ZOOM = 4;

/**
 * How Google's view is set up for a game. The address is never shown: it would give the answer
 * away. Street names are drawn only when the player switched "Road names" on.
 */
export function panoramaOptions(mode: Mode, roadNames: boolean): google.maps.StreetViewPanoramaOptions {
  const moving = mode === 'move';
  return {
    visible: false,
    disableDefaultUI: true,
    addressControl: false,
    showRoadLabels: roadNames,
    linksControl: moving,
    clickToGo: moving,
    scrollwheel: mode !== 'nmpz',
    motionTracking: false,
    motionTrackingControl: false,
    enableCloseButton: false,
  };
}

/** A compass heading turned by some degrees, kept between 0 and 360. */
export const turned = (heading: number, degrees: number): number => (((heading + degrees) % 360) + 360) % 360;

/** The zoom after stepping in or out, held between all the way out and all the way in. */
export const nextZoom = (zoom: number, steps: number): number => Math.max(0, Math.min(MAX_ZOOM, zoom + steps));
