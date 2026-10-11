import type { LngLat } from '../game/geo.ts';
import type { Location, LocationSet } from '../game/locations.ts';
import type { Mode } from '../game/settings.ts';

/** A resolved starting point: where it really is, and who to credit for the picture. */
export interface Place extends LngLat {
  credit: string;
}

export interface ViewHandlers {
  /** compass bearing the player is looking along */
  onBearing: (bearing: number) => void;
  onAtStart: (atStart: boolean) => void;
  /** a short message for the player, such as a blocked move */
  onNotice: (text: string) => void;
}

/** The street-level view of one game. One implementation per imagery source. */
export interface StreetView<P extends Place> {
  /** Starts a round at a place. Rejects when the picture cannot be shown. */
  show(place: P): Promise<void>;
  returnToStart(): Promise<void>;
  moveByKey(direction: 'forward' | 'back'): void;
  destroy(): void;
}

export interface ImageryProvider<P extends Place = Place> {
  readonly name: 'google' | 'panoramax';
  /** credit line shown during play, or null when the view draws its own */
  readonly attribution: string | null;
  /**
   * The list of places this source plays from. Each source has its own: Google's is drawn from its
   * official coverage worldwide, Panoramax's from open imagery. The same seed therefore gives
   * different places on different sources.
   */
  places(): Promise<LocationSet>;
  /** Turns a place (from this source's list, or one another client posted) into something this source can show. */
  resolve(location: Location): Promise<P>;
  /** True when the place itself is unusable, as opposed to the source being unreachable. */
  isGone(error: unknown): boolean;
  createView(container: HTMLElement, mode: Mode, handlers: ViewHandlers): Promise<StreetView<P>>;
}
