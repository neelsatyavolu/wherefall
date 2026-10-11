import './maps.css';
import type { Location } from '../game/locations.ts';
import { t } from '../i18n/index.ts';
import type { ImageryProvider, Place, StreetView } from '../imagery/provider.ts';
import { PREVIEW_PLACES, stepped } from '../social/map-preview.ts';
import { reducedMotion } from './count-up.ts';
import { el } from './dom.ts';
import { errorLine, statusLine, type Pane } from './pane.ts';

/** How long a place is shown before the next takes its turn. */
export const CYCLE_MS = 8000;

/** Where the preview's Street View comes from: null when this site has none to show. */
export type StreetSource = () => ImageryProvider | null;

const QUIET = { onBearing: () => undefined, onAtStart: () => undefined, onNotice: () => undefined };

const button = (text: string, run: () => void) => el('button', { class: 'button ghost', text, attrs: { type: 'button' }, on: { click: run } });

/**
 * The places taking turns in one view, with the controls to step through them and to stop on one.
 * `still` is for a player who asked for less motion: nothing then changes but by their own step.
 */
function turns(places: readonly Location[], provider: ImageryProvider, view: StreetView<Place>, host: HTMLElement, still: boolean) {
  const position = el('p', { class: 'settings-line', attrs: { role: 'status' } });
  const note = errorLine();
  const pause = button(t('mapPage.streetPause'), () => setPaused(!paused));
  const found = new Map<number, Promise<Place>>();
  let index = 0;
  let paused = still;
  let asked = 0;
  let over = false;
  let timer: number | undefined;

  const step = (by: number) => void show(stepped(index, by, places.length));
  const wait = () => {
    window.clearTimeout(timer);
    if (!paused && !over) {
      timer = window.setTimeout(() => step(1), CYCLE_MS);
    }
  };
  function setPaused(value: boolean): void {
    paused = value;
    pause.textContent = paused ? t('mapPage.streetResume') : t('mapPage.streetPause');
    // a place that changes by itself is not read out each time; one the player stepped to is
    position.setAttribute('aria-live', paused ? 'polite' : 'off');
    wait();
  }
  const resolved = (at: number): Promise<Place> => {
    const place = found.get(at) ?? provider.resolve(places[at]!);
    found.set(at, place);
    return place;
  };

  async function show(next: number): Promise<void> {
    window.clearTimeout(timer);
    const turn = ++asked;
    index = next;
    position.textContent = t('mapPage.streetPlace', { number: index + 1, total: places.length });
    note.textContent = '';
    try {
      const place = await resolved(next);
      if (turn !== asked || over) {
        // the player has stepped on while this place was being found: the view is not theirs to take back
        return;
      }
      await view.show(place);
    } catch (error) {
      // a lookup that failed is made again the next time round, not remembered
      found.delete(next);
      if (turn !== asked || over) {
        return;
      }
      const gone = provider.isGone(error);
      note.textContent = gone ? t('mapPage.streetPlaceFailed') : t('mapPage.streetUnavailable');
      if (!gone && !still) {
        // Street View itself is out of reach: trying the next place every few seconds would not help
        setPaused(true);
      }
    }
    if (turn === asked) {
      wait();
    }
  }

  if (!still) {
    // looking around is a reason to stay: the place does not change under the player's hand
    host.addEventListener('pointerdown', () => !paused && setPaused(true));
  }
  setPaused(still);
  void show(0);
  // a map of one place has nowhere to step to
  const several = places.length > 1;
  const controls = several ? [button(t('mapPage.streetPrevious'), () => step(-1)), still ? null : pause, button(t('mapPage.streetNext'), () => step(1))] : [];
  return {
    node: el('div', { class: 'street-preview' }, el('div', { class: 'street-controls' }, ...controls, position), several && still ? el('p', { class: 'fine', text: t('mapPage.streetStill') }) : null, note),
    stop: () => {
      over = true;
      window.clearTimeout(timer);
    },
  };
}

/**
 * A look at a community map before playing it: a few of its places in Street View, one after
 * another. It starts only when asked, because each start takes one viewer out of the day's Google
 * allowance, and it makes one panorama for all of its places.
 */
export function streetPreview(name: string, places: readonly Location[], source: StreetSource): Pane {
  const stage = el('div', { class: 'street-preview' });
  let stop: (() => void) | null = null;
  let disposed = false;

  const idle = (problem: string | null) =>
    stage.replaceChildren(
      ...(problem ? [el('p', { class: 'account-error', text: problem, attrs: { role: 'alert' } })] : []),
      el('div', { class: 'actions' }, button(problem ? t('common.tryAgain') : t('mapPage.streetStart'), () => void open())),
    );

  async function open(): Promise<void> {
    const provider = source();
    if (!provider) {
      idle(t('mapPage.streetUnavailable'));
      return;
    }
    const host = el('div', { class: 'street-view', attrs: { role: 'group', 'aria-label': t('mapPage.streetView', { name }) } });
    const below = el('div', { class: 'street-preview' }, statusLine(t('mapPage.streetLoading')));
    // the view measures its box, so the box is on the page before the view is made, and stays where it is
    stage.replaceChildren(host, below);
    try {
      const view = await provider.createView(host, 'no-move', QUIET);
      if (disposed) {
        view.destroy();
        return;
      }
      const shown = turns(places, provider, view, host, reducedMotion());
      stop = () => {
        shown.stop();
        view.destroy();
      };
      below.replaceChildren(shown.node);
    } catch {
      idle(t('mapPage.streetUnavailable'));
    }
  }

  idle(null);
  return {
    node: el(
      'section',
      { class: 'account-section', attrs: { 'aria-label': t('mapPage.street') } },
      el('h3', { class: 'label', text: t('mapPage.street') }),
      el('p', { class: 'fine', text: t('mapPage.streetLede', { count: PREVIEW_PLACES }) }),
      stage,
    ),
    dispose: () => {
      disposed = true;
      stop?.();
    },
  };
}
