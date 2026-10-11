/// <reference types="google.maps" />
import type { Mode } from '../game/settings.ts';
import { t } from '../i18n/index.ts';
import { bestLink, type GooglePlace } from '../imagery/google.ts';
import type { StreetView, ViewHandlers } from '../imagery/provider.ts';
import { nextZoom, panoramaOptions, turned } from './google-view-options.ts';
import { prefs } from './prefs.ts';
import type { ViewControls } from './view-controls.ts';

const SHOW_TIMEOUT_MS = 12000;
/** the keys Street View walks and turns on by itself, which a game without moving does not allow */
const WALK_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 's']);
/** the keys the round screen turns and zooms on: Street View must not act on them a second time */
const SCREEN_KEYS = new Set(['a', 'd', '+', '=', '-', '_']);

/**
 * Google Street View through the Maps JavaScript API. One panorama object serves the whole game:
 * Google bills per object created, not per place shown in it.
 */
export class GoogleView implements StreetView<GooglePlace>, ViewControls {
  private readonly panorama: google.maps.StreetViewPanorama;
  private readonly container: HTMLElement;
  private readonly handlers: ViewHandlers;
  private readonly moving: boolean;
  private readonly sizeWatch: ResizeObserver;
  private start: GooglePlace | null = null;

  constructor(container: HTMLElement, library: google.maps.StreetViewLibrary, mode: Mode, handlers: ViewHandlers) {
    this.container = container;
    this.handlers = handlers;
    this.moving = mode === 'move';
    // the setting is read here, as a view is made: a change takes effect from the next game
    this.panorama = new library.StreetViewPanorama(container, panoramaOptions(mode, prefs.roadNames()));
    this.panorama.addListener('pov_changed', () => handlers.onBearing(this.panorama.getPov().heading));
    this.panorama.addListener('pano_changed', () => handlers.onAtStart(this.panorama.getPano() === this.start?.panoId));
    // Street View acts on keys by itself, even with its arrows hidden, so some are stopped on the way in
    container.addEventListener('keydown', this.blockKeys, true);
    // the view's box is not one size for the whole game (a guesser's buttons take the foot of a phone's screen): Street View is told when it changes
    this.sizeWatch = new ResizeObserver(() => google.maps.event.trigger(this.panorama, 'resize'));
    this.sizeWatch.observe(container);
  }

  show(place: GooglePlace): Promise<void> {
    this.start = place;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error('Street View took too long to load')), SHOW_TIMEOUT_MS);
      const listener = this.panorama.addListener('status_changed', () => {
        if (this.panorama.getPano() === place.panoId) {
          finish(this.panorama.getStatus() === 'OK' ? null : new Error(`Street View status ${this.panorama.getStatus()}`));
        }
      });
      const finish = (error: Error | null) => {
        window.clearTimeout(timeout);
        listener.remove();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      this.reset(place);
    });
  }

  async returnToStart(): Promise<void> {
    if (this.start) {
      this.reset(this.start);
    }
  }

  moveByKey(direction: 'forward' | 'back'): void {
    if (!this.moving) {
      return;
    }
    const wanted = (this.panorama.getPov().heading + (direction === 'forward' ? 0 : 180)) % 360;
    const next = bestLink(this.panorama.getLinks() ?? [], wanted);
    if (next) {
      this.panorama.setPano(next);
    } else {
      this.handlers.onNotice(t('pano.blocked'));
    }
  }

  turnBy(degrees: number): void {
    const pov = this.panorama.getPov();
    this.panorama.setPov({ ...pov, heading: turned(pov.heading, degrees) });
  }

  zoomBy(steps: number): void {
    this.panorama.setZoom(nextZoom(this.panorama.getZoom(), steps));
  }

  faceNorth(): void {
    this.panorama.setPov({ ...this.panorama.getPov(), heading: 0 });
  }

  destroy(): void {
    this.sizeWatch.disconnect();
    this.container.removeEventListener('keydown', this.blockKeys, true);
    google.maps.event.clearInstanceListeners(this.panorama);
    this.panorama.setVisible(false);
    this.container.replaceChildren();
  }

  private reset(place: GooglePlace): void {
    this.panorama.setPano(place.panoId);
    this.panorama.setPov({ heading: place.heading, pitch: 0 });
    this.panorama.setZoom(0);
    this.panorama.setVisible(true);
    this.handlers.onBearing(place.heading);
    this.handlers.onAtStart(true);
  }

  private readonly blockKeys = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (SCREEN_KEYS.has(key) || (!this.moving && WALK_KEYS.has(key))) {
      event.stopPropagation();
    }
  };
}
