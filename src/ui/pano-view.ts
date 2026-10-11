import { Viewer } from '@photo-sphere-viewer/core';
import { EquirectangularTilesAdapter } from '@photo-sphere-viewer/equirectangular-tiles-adapter';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import { bearingDeg } from '../game/geo.ts';
import { t } from '../i18n/index.ts';
import { yawTowards, type Pano, type PanoLink } from '../imagery/panoramax.ts';

/** How far below the horizon the move arrows sit, so they read as lying on the road. */
const ARROW_PITCH = -0.42;
const ARROW_SIZE = 56;
/** A key press moves along the arrow closest to where the player is looking, within this angle. */
const KEY_MOVE_TOLERANCE_DEG = 75;
const START_ZOOM = 25;
/** how far one press of plus or minus zooms, on the viewer's scale of 0 to 100 */
const ZOOM_STEP = 10;
const STEP_TRANSITION = { effect: 'fade', speed: 300, rotation: false } as const;
/** Stand-in grid for pictures served as one image: the base image shows and no tiles load. */
const UNTILED = { width: 8192, cols: 16, rows: 8 };

const ARROW_SVG =
  '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" aria-hidden="true"><polyline points="5,15 12,8 19,15"/></svg>';

export type MoveKind = 'along' | 'crossing';

export interface MoveLink extends PanoLink {
  kind: MoveKind;
}

interface PanoViewHandlers {
  onMove: (link: PanoLink) => void;
  onBearing: (bearing: number) => void;
}

const toDeg = (rad: number) => (rad * 180) / Math.PI;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export class PanoView {
  private readonly viewer: Viewer;
  private readonly markers: MarkersPlugin;
  private pano: Pano | null = null;
  private links: readonly MoveLink[] = [];
  private readonly handlers: PanoViewHandlers;

  constructor(container: HTMLElement, handlers: PanoViewHandlers) {
    this.handlers = handlers;
    this.viewer = new Viewer({
      container,
      adapter: [EquirectangularTilesAdapter, { showErrorTile: false, baseBlur: false }],
      plugins: [[MarkersPlugin, { defaultHoverScale: false }]],
      navbar: false,
      keyboard: false,
      mousewheelCtrlKey: false,
      touchmoveTwoFingers: false,
      defaultZoomLvl: START_ZOOM,
      // the viewer's own words while a picture loads; left empty it falls back to its English default
      loadingTxt: t('pano.loading'),
      canvasBackground: 'transparent',
    });
    this.markers = this.viewer.getPlugin(MarkersPlugin);
    this.markers.addEventListener('select-marker', ({ marker }) => {
      const link = this.links.find((l) => l.id === marker.id);
      if (link) {
        this.handlers.onMove(link);
      }
    });
    this.viewer.addEventListener('position-updated', () => this.handlers.onBearing(this.bearing()));
    // the zoom is written on the view's element, where a style or a test can read it
    this.viewer.addEventListener('zoom-updated', ({ zoomLevel }) => {
      container.dataset.zoom = String(Math.round(zoomLevel));
    });
  }

  /** Compass bearing the player is looking along. */
  bearing(): number {
    const heading = this.pano?.heading ?? 0;
    return (heading + toDeg(this.viewer.getPosition().yaw) + 360) % 360;
  }

  /**
   * Shows a panorama. When moving along a street the player keeps facing the same compass
   * direction; a fresh round starts looking down the direction of travel.
   */
  async show(pano: Pano, keepBearing: boolean): Promise<void> {
    // some cameras are mounted sideways, so a new round faces along the road, not the image centre
    const ahead = pano.next ? yawTowards(pano, pano.next) : 0;
    const yaw = keepBearing ? ((this.bearing() - pano.heading) * Math.PI) / 180 : ahead;
    const pitch = keepBearing ? this.viewer.getPosition().pitch : 0;
    const zoom = keepBearing ? this.viewer.getZoomLevel() : START_ZOOM;
    this.setLinks([]);
    await this.viewer.setPanorama(
      {
        ...(pano.tiles ?? UNTILED),
        baseUrl: pano.baseUrl,
        tileUrl: (col: number, row: number) => pano.tiles?.url(col, row) ?? null,
      },
      // a short cross-fade while walking; a new round simply appears
      { position: { yaw, pitch }, zoom, transition: keepBearing ? STEP_TRANSITION : false, showLoader: false },
    );
    // adopted only now: if the load fails, bearings keep referring to the picture still on screen
    this.pano = pano;
    this.handlers.onBearing(this.bearing());
  }

  setLinks(links: readonly MoveLink[]): void {
    const pano = this.pano;
    this.links = links;
    if (!pano) {
      return;
    }
    this.markers.setMarkers(
      links.map((link) => ({
        id: link.id,
        position: { yaw: yawTowards(pano, link), pitch: ARROW_PITCH },
        html: ARROW_SVG,
        size: { width: ARROW_SIZE, height: ARROW_SIZE },
        anchor: 'center center',
        className: `move-arrow move-arrow-${link.kind}`,
      })),
    );
  }

  /** Moves along the arrow nearest the view direction (`forward`) or directly behind it. */
  moveByKey(direction: 'forward' | 'back'): void {
    const pano = this.pano;
    if (!pano) {
      return;
    }
    const wanted = (this.bearing() + (direction === 'forward' ? 0 : 180)) % 360;
    const ranked = this.links
      .map((link) => ({ link, off: angleBetween(bearingDeg(pano, link), wanted) }))
      .sort((a, b) => a.off - b.off);
    const best = ranked[0];
    if (best && best.off <= KEY_MOVE_TOLERANCE_DEG) {
      this.handlers.onMove(best.link);
    }
  }

  /** Turns the view by some degrees, to the right when positive. */
  turnBy(degrees: number): void {
    const { yaw, pitch } = this.viewer.getPosition();
    this.viewer.rotate({ yaw: yaw + toRad(degrees), pitch });
  }

  /** Zooms by some steps, in when positive. The viewer stops at its own ends. */
  zoomBy(steps: number): void {
    this.viewer.zoom(this.viewer.getZoomLevel() + steps * ZOOM_STEP);
  }

  faceNorth(): void {
    this.viewer.rotate({ yaw: toRad(-(this.pano?.heading ?? 0)), pitch: this.viewer.getPosition().pitch });
  }

  destroy(): void {
    this.viewer.destroy();
  }
}
