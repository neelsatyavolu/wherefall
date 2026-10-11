import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';
import type { LngLat } from '../game/geo.ts';
import { hintRing, type HintCircle } from '../game/hint.ts';
import type { RoundResult } from '../game/session.ts';
import { t } from '../i18n/index.ts';
import { GROUND_TOKENS, overPictures, repaint, themeStyle, withoutRelief, type Ground } from './basemap-theme.ts';
import { el } from './dom.ts';
import { mustSee, near, onMap, pointsToFit, roomIn, viewOf } from './map-fit.ts';
import { showMapType, type MapType } from './map-types.ts';
import { workerCountFor } from './map-workers.ts';
import { boxAround, namesThatFit } from './pin-labels.ts';

/**
 * OpenFreeMap: free vector tiles with no key and no usage cap. The "liberty" style carries street
 * names, roads and places down to building level, which is what pinpointing a guess needs. Its
 * layers are kept as they are and its colours are replaced from the page's tokens
 * (`basemap-theme.ts`): an ink-dark map in the dark scheme, a paper one in the light.
 */
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const LINES = 'guess-lines';
const HINT = 'hint-circle';
const PLACES = 'map-places';
/** deep enough to tell one side of a street from the other */
const MAX_ZOOM = 19;
/** the accent of each scheme, as `styles.css` has it: what the game draws on the map is in the colours of the ground under it */
const ACCENTS: Readonly<Record<Ground, string>> = { dark: '#4c8dff', light: '#2f6fe0' };
const LIGHT_SCHEME = '(prefers-color-scheme: light)';

/** The scheme the page is drawn in, read off the page itself, so the map follows whatever the stylesheet decides. */
const pageScheme = (): Ground => (getComputedStyle(document.documentElement).colorScheme === 'light' ? 'light' : 'dark');
/** Satellite pictures are dark, with names over them or without, and the terrain map is pale, whatever the page; the street map follows the page. */
const groundOf = (type: MapType): Ground => (type === 'streets' ? pageScheme() : type === 'terrain' ? 'light' : 'dark');
/** the inhabited world, so the whole map is visible even in the small corner panel */
const WORLD_BOUNDS: Bounds = [
  [-168, -56],
  [178, 74],
];
const RESULT_MAX_ZOOM = 13;
const FIT_MS = 600;
/** a fit made again because a panel over the map changed its size: quicker than the first */
const REFIT_MS = 300;
/** how many pixels across the world is drawn at zoom 0 */
const WORLD_AT_ZERO = 512;
const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };

export type Bounds = [[number, number], [number, number]];
export type FitPadding = maplibregl.PaddingOptions;

/** A player's guess in a match, as drawn on the reveal. */
export interface PlayerPin {
  point: LngLat;
  /** a short form of the player's name */
  label: string;
  /** the viewer's own pin, drawn in the accent colour */
  own: boolean;
}

/** A teammate's pin while a round is being played. */
export interface MatePin {
  point: LngLat;
  /** the teammate's name */
  label: string;
  /** true once it is their guess, which no longer moves */
  final: boolean;
}

/** A dashed line from a guess to the true place. */
type Segment = readonly [LngLat, LngLat];

/**
 * What the map is fitted to, kept until the player moves the map or a new round clears it: the fit
 * is made again when the map's box changes its size, or what covers it does (`repad`).
 */
interface Fitted {
  /** everything drawn */
  all: readonly LngLat[];
  /** what has to be in sight when the map cannot hold it all */
  must: readonly LngLat[];
  padding: FitPadding;
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

// set before the first map is made, which is the only time the library reads it
maplibregl.setWorkerCount(workerCountFor(navigator.hardwareConcurrency));

let warmed = false;

/**
 * Gets the map ready before a game asks for it, while the player is still reading the home screen:
 * the workers are started, and the style and the list of tiles are fetched so the first map finds
 * them in the browser's cache. A warm-up that fails costs nothing: the map fetches them itself.
 */
export function warmMap(): void {
  if (warmed) {
    return;
  }
  warmed = true;
  maplibregl.prewarm();
  void fetch(STYLE)
    .then((response) => response.json())
    .then((style: { sources?: Record<string, { url?: string }> }) =>
      Promise.all(Object.values(style.sources ?? {}).flatMap((source) => (source.url ? [fetch(source.url)] : []))),
    )
    .catch(() => undefined);
}

export class GuessMap {
  private readonly map: maplibregl.Map;
  private readonly container: HTMLElement;
  private readonly ready: Promise<void>;
  private readonly scheme = window.matchMedia(LIGHT_SCHEME);
  private type: MapType = 'streets';
  /** the street map's style as it was served, kept so it can be coloured again when the page's scheme changes */
  private served: maplibregl.StyleSpecification | null = null;
  private readonly resizeObserver: ResizeObserver;
  private markers: maplibregl.Marker[] = [];
  /** the players' pins of a reveal that carry a name, by their place in `markers`, each with the size it has with its name on */
  private named: Array<{ index: number; own: boolean; size: { width: number; height: number } }> = [];
  /** teammates' pins over a round being played; see `showMates` */
  private mateMarkers: maplibregl.Marker[] = [];
  private pin: maplibregl.Marker | null = null;
  private guessing = false;
  /** true once the player has panned, zoomed or pinned this round */
  private touched = false;
  private pinHandler: (point: LngLat) => void = () => {};
  private home: Bounds | null;
  private fitted: Fitted | null = null;
  /** the size of the map's box when it was last fitted, to tell a change of size from a report of the same one */
  private fittedSize = '';
  /** true once the map was taken down: a map type chosen before it loaded has nowhere to go */
  private gone = false;

  constructor(container: HTMLElement, home: Bounds | null = null) {
    this.home = home;
    this.container = container;
    // what is drawn over the map (pins, the crosshair, the credit) takes its colours from the ground: see map.css
    container.dataset.ground = pageScheme();
    this.map = new maplibregl.Map({
      container,
      bounds: WORLD_BOUNDS,
      maxZoom: MAX_ZOOM,
      attributionControl: { compact: true },
      // names are drawn as soon as their tile is in, not faded in over a third of a second after it
      fadeDuration: 0,
      // the map library's own words: the canvas and a pin for screen readers, and what a map on a page says when it lets the page scroll
      locale: {
        'Map.Title': t('label.map'),
        'Marker.Title': t('guessMap.marker'),
        'CooperativeGesturesHandler.WindowsHelpText': t('guessMap.gesture.ctrl'),
        'CooperativeGesturesHandler.MacHelpText': t('guessMap.gesture.cmd'),
        'CooperativeGesturesHandler.MobileHelpText': t('guessMap.gesture.touch'),
      },
      dragRotate: false,
      pitchWithRotate: false,
    });
    // the style is recoloured on its way in: its relief picture left out, every other layer kept, only its colours changed
    this.map.setStyle(STYLE, {
      transformStyle: (_previous, served) => {
        const lighter = withoutRelief(served);
        this.served = lighter;
        return themeStyle(lighter, pageScheme());
      },
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disable();
    this.scheme.addEventListener('change', this.followScheme);

    this.ready = new Promise((resolve) => {
      this.map.once('load', () => {
        // the attribution opens itself on load and would cover the small map; it stays one click away
        const attribution = container.querySelector('.maplibregl-ctrl-attrib');
        attribution?.classList.remove('maplibregl-compact-show');
        attribution?.removeAttribute('open');
        this.flattenBuildings();
        this.map.addSource(HINT, { type: 'geojson', data: EMPTY });
        this.map.addLayer({ id: `${HINT}-fill`, type: 'fill', source: HINT, paint: { 'fill-opacity': 0.08 } });
        this.map.addLayer({ id: HINT, type: 'line', source: HINT, paint: { 'line-width': 2 } });
        this.map.addSource(PLACES, { type: 'geojson', data: EMPTY });
        this.map.addLayer({ id: PLACES, type: 'circle', source: PLACES, paint: { 'circle-radius': 5, 'circle-stroke-width': 2 } });
        this.map.addSource(LINES, { type: 'geojson', data: EMPTY });
        this.map.addLayer({ id: LINES, type: 'line', source: LINES, paint: { 'line-width': 2, 'line-dasharray': [3, 3] } });
        this.drawOnGround();
        resolve();
      });
    });

    this.map.on('click', (event) => {
      if (!this.guessing) {
        return;
      }
      const { lng, lat } = event.lngLat.wrap();
      this.placePin({ lng, lat });
    });

    this.map.on('movestart', (event) => {
      if ('originalEvent' in event && event.originalEvent) {
        this.takeOver();
      }
    });

    // a fit has come to rest, or the player's own move has: names that would lie on one another are sorted out for where the pins now are
    this.map.on('moveend', (event) => {
      if ('fitted' in event) {
        this.seatPins();
      }
      this.thinNames();
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.map.resize();
      // the panel grows under the pointer: keep the whole map in view until the player takes over
      if (this.guessing && !this.touched) {
        this.fitHome();
      } else if (!this.guessing && this.fittedSize !== this.boxSize()) {
        // a result stays fitted while the screen changes shape around it
        this.fitNow(0);
      }
    });
    this.resizeObserver.observe(container);
  }

  onPin(handler: (point: LngLat) => void): void {
    this.pinHandler = handler;
  }

  /** Where the map opens each round: a region's or country's bounds, or null for the whole world. */
  setHome(home: Bounds | null): void {
    this.home = home;
    if (this.guessing && !this.touched) {
      this.fitHome();
    }
  }

  zoomIn(): void {
    this.takeOver();
    this.map.zoomIn();
  }

  zoomOut(): void {
    this.takeOver();
    this.map.zoomOut();
  }

  /** Draws the map as streets, satellite pictures or terrain. The choice holds for every round after. */
  async setType(type: MapType): Promise<void> {
    await this.ready;
    if (this.gone) {
      return;
    }
    this.type = type;
    showMapType(this.map, type, `${HINT}-fill`);
    this.paintNames();
    this.drawOnGround();
  }

  /**
   * For a map on a page (a game's history, a community map): one finger, or a bare wheel, scrolls
   * the page past it, and the map says how to move it. A map that takes pins takes every gesture.
   */
  yieldToPage(): void {
    if (!this.guessing) {
      this.map.cooperativeGestures.enable();
    }
  }

  /** Draws the hint: a circle that contains the place. It stays until the round is cleared away. */
  showHint(circle: HintCircle): void {
    const ring = hintRing(circle);
    void this.setData(HINT, [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }]);
    const bounds = new maplibregl.LngLatBounds();
    ring.forEach((point) => bounds.extend(point));
    this.touched = true;
    this.map.fitBounds(bounds, { padding: 24, duration: 600 });
  }

  /**
   * Shows a community map's places as dots: the preview on its page, and the list so far in the
   * editor. `fit` frames them; the editor leaves the view where its maker put it.
   */
  showPlaces(points: readonly LngLat[], fit: boolean): void {
    void this.setData(
      PLACES,
      points.map((point) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [point.lng, point.lat] } })),
    );
    if (fit) {
      this.fit(points.map(onMap), { top: 40, right: 40, bottom: 40, left: 40 });
    }
  }

  startRound(): void {
    this.clear();
    this.guessing = true;
    this.map.cooperativeGestures.disable();
    this.map.getCanvas().style.cursor = 'crosshair';
    this.touched = false;
    // while a pin is placed the map is the whole of its box again, and the world fills it, as the library has it
    this.map.setPadding(NO_PADDING);
    this.map.setTransformConstrain(null);
    this.map.resize();
    this.fitHome();
  }

  showResult(result: RoundResult, padding: FitPadding): void {
    this.stopGuessing();
    this.clear();
    this.drawResults([result], padding);
  }

  showSummary(results: readonly RoundResult[], padding: FitPadding): void {
    this.stopGuessing();
    this.clear();
    this.drawResults(results, padding);
  }

  /**
   * One round of a match: the true place and a labelled pin for every player who guessed. The map
   * is fitted to them all when it holds them all; when it does not, to the place and the viewer's
   * own pin, which are in sight whatever the others did.
   */
  showPlayers(actual: LngLat, pins: readonly PlayerPin[], padding: FitPadding): void {
    this.stopGuessing();
    this.clear();
    // the player's own pin goes on last, so it is never hidden under another
    const ordered = [...pins.filter((pin) => !pin.own), ...pins.filter((pin) => pin.own)];
    this.markers = [this.marker('pin pin-actual', actual), ...ordered.map((pin) => this.playerMarker(pin))];
    // each pin is measured with its name on, once: that is the room its name needs wherever the pin is drawn
    this.named = ordered.map((pin, at) => {
      const element = this.markers[at + 1]!.getElement();
      return { index: at + 1, own: pin.own, size: { width: element.offsetWidth, height: element.offsetHeight } };
    });
    this.thinNames();
    void this.setLines(pins.map((pin) => [pin.point, actual]));
    this.fit([actual, ...pins.map((pin) => pin.point)].map(onMap), padding, mustSee(actual, pins).map(onMap));
  }

  /**
   * What covers the map changed its size (a panel got taller): the fit is made again with these
   * sides of its padding. Nothing happens once the player has moved the map, which is theirs then.
   */
  repad(sides: Partial<FitPadding>): void {
    if (this.fitted) {
      this.fitted = { ...this.fitted, padding: { ...this.fitted.padding, ...sides } };
      this.fitNow(REFIT_MS);
    }
  }

  /**
   * Teammates' pins over a round being played, each by name: where a pin is now, or the guess it
   * became (`final`). They are kept apart from the player's own pin and from a result's markers, so
   * neither a new pin nor a new round takes them away: an empty list does.
   */
  showMates(pins: readonly MatePin[]): void {
    this.mateMarkers.forEach((marker) => marker.remove());
    this.mateMarkers = pins.map((pin) => this.marker(pin.final ? 'pin pin-mate final' : 'pin pin-mate', pin.point, pin.label));
  }

  /** Fixes the pin where it is (a guess that was sent cannot move), or frees it again. */
  setPinLocked(locked: boolean): void {
    this.guessing = !locked;
    this.map.getCanvas().style.cursor = locked ? '' : 'crosshair';
  }

  destroy(): void {
    this.gone = true;
    this.scheme.removeEventListener('change', this.followScheme);
    this.resizeObserver.disconnect();
    this.map.remove();
  }

  /**
   * The style draws buildings standing up. Seen from above they lean over the streets around
   * them, which is exactly where a pin has to go, so they are laid flat.
   */
  private flattenBuildings(): void {
    for (const layer of this.map.getStyle().layers ?? []) {
      if (layer.type === 'fill-extrusion') {
        this.map.setPaintProperty(layer.id, 'fill-extrusion-height', 0);
        this.map.setPaintProperty(layer.id, 'fill-extrusion-base', 0);
      }
    }
  }

  /** The page went dark or light: the street map is coloured again, layer by layer, and what is drawn on it follows. */
  private readonly followScheme = (): void => {
    this.paintStreets((layer) => repaint(layer, pageScheme()));
    this.paintNames();
    this.drawOnGround();
  };

  /**
   * The street map's names and borders in the colours of what is under them: pale with a dark halo
   * over the pictures of the hybrid map, whatever the page's scheme, and the page's own otherwise.
   */
  private paintNames(): void {
    const ground = pageScheme();
    const pictures = this.type === 'hybrid';
    this.paintStreets((layer) => {
      const over = overPictures(layer);
      // only what the pictures' colours touch is set, and every such property is one the page's theme sets back
      return Object.fromEntries(Object.keys(over).map((name) => [name, pictures ? over[name] : repaint(layer, ground)[name]]));
    });
  }

  /** Sets paint on the layers the street map was served with that are on the map, each as `paint` says. */
  private paintStreets(paint: (layer: maplibregl.LayerSpecification) => Record<string, unknown>): void {
    for (const layer of this.served?.layers ?? []) {
      if (this.map.getLayer(layer.id)) {
        Object.entries(paint(layer)).forEach(([name, value]) => this.map.setPaintProperty(layer.id, name, value));
      }
    }
  }

  /** Draws the game's own marks in the colours of the ground under them: pale on a dark map, ink on a pale one. */
  private drawOnGround(): void {
    const ground = groundOf(this.type);
    const { bg, fg } = GROUND_TOKENS[ground];
    this.container.dataset.ground = ground;
    if (!this.map.getLayer(LINES)) {
      return;
    }
    this.map.setPaintProperty(`${HINT}-fill`, 'fill-color', ACCENTS[ground]);
    this.map.setPaintProperty(HINT, 'line-color', ACCENTS[ground]);
    this.map.setPaintProperty(PLACES, 'circle-color', ACCENTS[ground]);
    this.map.setPaintProperty(PLACES, 'circle-stroke-color', bg);
    this.map.setPaintProperty(LINES, 'line-color', fg);
  }

  private fitHome(): void {
    this.map.fitBounds(this.home ?? WORLD_BOUNDS, { padding: 16, duration: 0 });
  }

  private placePin(point: LngLat): void {
    this.touched = true;
    this.pin?.remove();
    // a crosshair, open at its centre: the exact spot stays visible under it
    this.pin = this.marker('aim', point);
    this.pinHandler(point);
  }

  /** The player moved the map: it is not fitted to anything for them again until the next round or result. */
  private takeOver(): void {
    this.touched = true;
    this.fitted = null;
  }

  private stopGuessing(): void {
    this.guessing = false;
    this.map.getCanvas().style.cursor = '';
    this.map.setTransformConstrain(this.heldLoosely);
  }

  /**
   * How the map holds its view over a result: the world may be drawn smaller than the map, with
   * nothing above or below it, as long as the middle of the part of the map left open is on the
   * world. So two places a world apart, or one on the map's very edge, fit that part, which the
   * library's own rule (the world fills the map, top to bottom) has no room for on a tall screen.
   */
  private readonly heldLoosely: maplibregl.TransformConstrainFunction = (center, zoom) => ({
    center: new maplibregl.LngLat(center.lng, onMap(center).lat),
    zoom: Math.max(this.map.getMinZoom(), Math.min(this.map.getMaxZoom(), zoom)),
  });

  /** A pin where its point is drawn: a point past the map's edge stands on the edge. */
  private marker(className: string, point: LngLat, label?: string): maplibregl.Marker {
    const element = el('div', { class: className, text: label ?? '' });
    const at = onMap(point);
    return new maplibregl.Marker({ element }).setLngLat([at.lng, at.lat]).addTo(this.map);
  }

  /**
   * A player's pin on a reveal, with a short form of their name. Another player's name is taken
   * off when it would lie on a pin (`thinNames`); a tap puts it back on, and takes it off again.
   */
  private playerMarker(pin: PlayerPin): maplibregl.Marker {
    const marker = this.marker(pin.own ? 'pin pin-guess' : 'pin pin-other', pin.point);
    const element = marker.getElement();
    element.append(el('span', { class: 'pin-name', text: pin.label }));
    if (!pin.own) {
      element.addEventListener('click', () => element.classList.toggle('named'));
    }
    return marker;
  }

  /**
   * Leaves the name off every other player's pin that would lie on the place, on the viewer's own
   * pin or on a name already drawn, for where the pins are now: twenty guesses in one city are
   * twenty marks and the names there is room for, not a heap of boxes. The viewer's own pin always
   * has its name.
   */
  private thinNames(): void {
    const [place] = this.markers;
    if (this.named.length === 0 || !place) {
      return;
    }
    const boxOf = (marker: maplibregl.Marker, size: { width: number; height: number }) => boxAround(this.map.project(marker.getLngLat()), size);
    const placeElement = place.getElement();
    const own = this.named.filter((pin) => pin.own);
    const others = this.named.filter((pin) => !pin.own);
    const fixed = [boxOf(place, { width: placeElement.offsetWidth, height: placeElement.offsetHeight }), ...own.map((pin) => boxOf(this.markers[pin.index]!, pin.size))];
    const fits = namesThatFit(
      fixed,
      others.map((pin) => boxOf(this.markers[pin.index]!, pin.size)),
    );
    others.forEach((pin, at) => this.markers[pin.index]!.getElement().classList.toggle('bare', !fits[at]));
  }

  private clear(): void {
    this.fitted = null;
    this.named = [];
    this.pin?.remove();
    this.pin = null;
    this.markers.forEach((marker) => marker.remove());
    this.markers = [];
    void this.setLines([]);
    void this.setData(HINT, []);
  }

  private drawResults(results: readonly RoundResult[], padding: FitPadding): void {
    const numbered = results.length > 1;
    const drawn: maplibregl.Marker[] = [];
    results.forEach((result, index) => {
      const label = numbered ? String(index + 1) : undefined;
      drawn.push(this.marker('pin pin-actual', result.location, label));
      if (result.guess) {
        drawn.push(this.marker('pin pin-guess', result.guess, label));
      }
    });
    this.markers = drawn;
    void this.setLines(results.flatMap((result): Segment[] => (result.guess ? [[result.guess, result.location]] : [])));
    this.fit(results.flatMap((result) => (result.guess ? [result.location, result.guess] : [result.location])).map(onMap), padding);
  }

  /**
   * Fits the map to `all` the points, or, when it cannot hold them all, to those that `must` be in
   * sight (all of them unless said otherwise).
   */
  private fit(all: readonly LngLat[], padding: FitPadding, must: readonly LngLat[] = all): void {
    if (all.length === 0) {
      return;
    }
    const fitted = { all, must, padding };
    this.fitted = fitted;
    // wait a frame so the panel has taken its full-screen size before fitting
    requestAnimationFrame(() => {
      // a new round, or the player's own hand on the map, has taken the fit away since
      if (this.fitted === fitted) {
        this.fitNow(FIT_MS);
      }
    });
  }

  /**
   * Brings what the map is fitted to into the part of it the padding leaves open, across the date
   * line when that is the short way. The padding stays with the map: its middle is the middle of
   * the open part from then on, which is what the zoom buttons zoom about.
   */
  private fitNow(duration: number): void {
    if (!this.fitted) {
      return;
    }
    this.map.resize();
    const size = { width: this.container.clientWidth, height: this.container.clientHeight };
    this.fittedSize = this.boxSize();
    const padding = roomIn(this.fitted.padding, size);
    const room = { width: size.width - padding.left - padding.right, height: size.height - padding.top - padding.bottom };
    // "holds them all" is with the world no smaller than the map is tall: any smaller and part of the map is empty
    const view = viewOf(pointsToFit(this.fitted.all, this.fitted.must, room, size.height), room);
    const zoom = Math.min(RESULT_MAX_ZOOM, Math.log2(view.world / WORLD_AT_ZERO));
    this.map.easeTo({ center: [view.lng, view.lat], zoom, padding, duration }, { fitted: true });
  }

  /**
   * A map that shows the world small shows it more than once, side by side, and the library draws
   * a pin on the copy it last saw it on, which need not be the one a fit was made on. Once a fit is
   * at rest every pin is put on the copy nearest the middle of the part of the map left open, where
   * the fit put what it was made for.
   */
  private seatPins(): void {
    const middle = this.map.getCenter();
    this.markers = this.markers.map((marker) => {
      const at = marker.getLngLat();
      const seat = near(middle, at);
      if (seat.lng === at.lng) {
        return marker;
      }
      const element = marker.getElement();
      marker.remove();
      return new maplibregl.Marker({ element }).setLngLat([seat.lng, seat.lat]).addTo(this.map);
    });
  }

  private boxSize(): string {
    return `${this.container.clientWidth}x${this.container.clientHeight}`;
  }

  /** Each line runs the short way round from the guess to the place, across the date line if need be. */
  private setLines(segments: readonly Segment[]): Promise<void> {
    return this.setData(
      LINES,
      segments.map(([guess, place]) => {
        const [from, to] = [near(place, onMap(guess)), onMap(place)];
        return {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [from.lng, from.lat],
              [to.lng, to.lat],
            ],
          },
        };
      }),
    );
  }

  private async setData(sourceId: string, features: GeoJSON.Feature[]): Promise<void> {
    await this.ready;
    const source = this.map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features });
  }
}
