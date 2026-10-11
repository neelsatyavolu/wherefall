import type { Mode } from '../game/settings.ts';
import { t } from '../i18n/index.ts';
import { fetchCrossings, fetchPano, type Pano, type PanoLink } from '../imagery/panoramax.ts';
import type { StreetView, ViewHandlers } from '../imagery/provider.ts';
import { PanoView, type MoveLink } from './pano-view.ts';
import type { ViewControls } from './view-controls.ts';

/**
 * Street view on Panoramax pictures. Panoramax has no built-in walking, so this class does it:
 * it loads the neighbouring picture, keeps the player facing the same way, and offers arrows
 * along the sequence and onto crossing ones.
 */
export class PanoramaxView implements StreetView<Pano>, ViewControls {
  private readonly view: PanoView;
  private readonly handlers: ViewHandlers;
  private readonly moving: boolean;
  private readonly cache = new Map<string, Promise<Pano>>();
  private start: Pano | null = null;
  private shown: Pano | null = null;
  /** bumped every time a picture starts loading, so late results from an older load are dropped */
  private token = 0;
  private destroyed = false;

  constructor(container: HTMLElement, mode: Mode, handlers: ViewHandlers) {
    this.handlers = handlers;
    this.moving = mode === 'move';
    this.view = new PanoView(container, { onMove: (link) => void this.moveTo(link), onBearing: handlers.onBearing });
  }

  show(place: Pano): Promise<void> {
    this.start = place;
    return this.display(place, false);
  }

  async returnToStart(): Promise<void> {
    if (this.start) {
      await this.display(this.start, false).catch(() => this.handlers.onNotice(t('pano.blocked')));
    }
  }

  moveByKey(direction: 'forward' | 'back'): void {
    this.view.moveByKey(direction);
  }

  turnBy(degrees: number): void {
    this.view.turnBy(degrees);
  }

  zoomBy(steps: number): void {
    this.view.zoomBy(steps);
  }

  faceNorth(): void {
    this.view.faceNorth();
  }

  destroy(): void {
    this.destroyed = true;
    this.view.destroy();
  }

  private load(id: string): Promise<Pano> {
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }
    const loading = fetchPano(id);
    this.cache.set(id, loading);
    // a failed lookup must not be remembered, or the arrow would stay dead for the whole game
    loading.catch(() => this.cache.delete(id));
    return loading;
  }

  private async display(pano: Pano, keepBearing: boolean): Promise<void> {
    const token = ++this.token;
    await this.view.show(pano, keepBearing);
    if (token !== this.token || this.destroyed) {
      return;
    }
    this.shown = pano;
    this.handlers.onAtStart(pano.id === this.start?.id);
    if (!this.moving) {
      return;
    }
    const along: MoveLink[] = [pano.next, pano.prev].filter((l) => l !== null).map((l) => ({ ...l, kind: 'along' }));
    this.view.setLinks(along);
    if (pano.next) {
      // warm the next step so walking forward feels immediate
      void this.load(pano.next.id).catch(() => undefined);
    }
    // crossing streets arrive in their own time: the round does not wait for them
    void fetchCrossings(pano).then((crossings) => {
      if (token === this.token && !this.destroyed) {
        this.view.setLinks([...along, ...crossings.map((c): MoveLink => ({ ...c, kind: 'crossing' }))]);
      }
    });
  }

  private async moveTo(link: PanoLink): Promise<void> {
    const token = this.token;
    const from = this.shown;
    try {
      const pano = await this.load(link.id);
      // a new round began, or another move got there first, while this one was loading
      if (token !== this.token || this.destroyed) {
        return;
      }
      await this.display(pano, true);
    } catch {
      const superseded = this.token > token + 1;
      if (this.destroyed || superseded) {
        return;
      }
      this.handlers.onNotice(t('pano.blocked'));
      const viewBroken = this.token === token + 1;
      if (viewBroken && from) {
        // the picture itself failed to draw: put the player back where they were
        await this.display(from, true).catch(() => undefined);
      }
    }
  }
}
