import type { LngLat } from '../game/geo.ts';
import { countryName } from '../game/locations.ts';
import { t } from '../i18n/index.ts';
import { addPlace, emptyDraft, problemWith, removePlace, toContent, type Draft } from '../social/map-editor.ts';
import type { Lookups } from '../social/map-paste-run.ts';
import { MAP_LIMITS, getMap, saveMap, type MapRow } from '../social/maps.ts';
import { actionBar } from './action-bar.ts';
import { loadCountryFinder } from './country-finder.ts';
import { el } from './dom.ts';
import { GuessMap } from './guess-map.ts';
import { editorFields } from './map-editor-fields.ts';
import { fileForm } from './map-editor-file.ts';
import { pasteForm } from './map-editor-paste.ts';
import { placesList } from './map-editor-places.ts';
import { mapFrame } from './map-frame.ts';
import { mapHref } from './nav.ts';
import { errorLine, statusLine, type Pane } from './pane.ts';
import type { Snap } from './providers.ts';
import { sayRefusal } from './session-ended.ts';
import { errorBox } from './status-box.ts';

const toPoint = ([, lng, lat]: MapRow): LngLat => ({ lng, lat });

/** The button that publishes the map or saves it, and the line that says what stopped it: a limit here, or the server's own words. */
function saving(slug: string | null, current: () => Draft, onNavigate: (href: string) => void) {
  const error = errorLine();
  const button = el('button', { class: 'button accent', text: slug === null ? t('editor.publish') : t('editor.save'), attrs: { type: 'button' } });
  button.addEventListener('click', async () => {
    const draft = current();
    error.textContent = problemWith(draft) ?? '';
    if (error.textContent !== '') {
      return;
    }
    button.disabled = true;
    const saved = await saveMap(toContent(draft), slug);
    if (saved.ok) {
      onNavigate(mapHref(saved.data.slug));
      return;
    }
    button.disabled = false;
    // a session that ended elsewhere must not cost the map being made: the editor stays, and signing in opens in a new tab
    sayRefusal(error, saved.error, { keepPage: true });
  });
  return { button, error };
}

/**
 * The editor proper: a world map to click, the map's name and descriptions, a box to paste places
 * into, a file of places to choose, and the places so far. A click, a pasted place and a place from
 * a file are each matched to the nearest official Street View panorama within 500 m, the same
 * lookup the game uses to open a place, so whatever is added can be played.
 */
export function mapEditor(slug: string | null, snapper: () => Promise<Snap>, onNavigate: (href: string) => void): Pane {
  const host = el('div', { class: 'pane-stack' });
  let map: GuessMap | null = null;
  let disposed = false;
  let stopPaste: (() => void) | null = null;

  /** What finds a place: the nearest Street View to a point, and the country that is in. */
  const lookups = async (): Promise<Lookups> => {
    const [snap, countryAt] = await Promise.all([snapper(), loadCountryFinder()]);
    return { snap, countryAt };
  };

  function build(first: Draft): void {
    let draft = first;
    let looking = false;
    let pasting = false;
    const form = editorFields(first, slug !== null);
    const frame = mapFrame('editor-map', t('editor.mapLabel'));
    const status = el('p', { class: 'settings-line', text: t('editor.clickToAdd'), attrs: { role: 'status' } });
    // the words are read from their fields when the map is saved
    const save = saving(slug, () => ({ ...draft, ...form.read() }), onNavigate);
    const list = placesList((id) => !pasting && change(removePlace(draft, id), false));
    // a pasted list and a file are looked up the same way, and one at a time: while either runs, the other waits and nothing else changes the map
    const runHooks = (other: () => { setLocked: (locked: boolean) => void }) => ({
      draft: () => draft,
      onChange: (next: Draft) => change(next, true),
      onRunning: (running: boolean) => {
        pasting = running;
        save.button.disabled = running;
        other().setLocked(running);
      },
      lookups,
    });
    const paste = pasteForm(runHooks(() => file));
    const file = fileForm(runHooks(() => paste));
    stopPaste = () => {
      paste.stop();
      file.stop();
    };

    function change(next: Draft, toEnd: boolean): void {
      if (disposed) {
        return;
      }
      draft = next;
      list.show(draft.places, toEnd);
      map?.showPlaces(draft.places.map(toPoint), false);
    }

    /** What to say about a place that was found, having put it in the map if it can be. */
    function placed(found: { id: string; lng: number; lat: number }, country: string): string {
      const next = addPlace(draft, [found.id, found.lng, found.lat, country]);
      if (next === draft) {
        return draft.places.length >= MAP_LIMITS.maxPlaces ? t('editor.full') : t('editor.duplicate');
      }
      change(next, true);
      return t('editor.added', { country: countryName(country) });
    }

    /** A click on the map: find the Street View nearest it, and the country that is in, and add it. */
    async function add(point: LngLat): Promise<void> {
      if (looking || pasting) {
        return;
      }
      looking = true;
      paste.setLocked(true);
      file.setLocked(true);
      status.textContent = t('editor.looking');
      try {
        const { snap, countryAt } = await lookups();
        const found = await snap(point);
        const country = found ? countryAt(found) : null;
        status.textContent = !found ? t('editor.none') : !country ? t('editor.noCountry') : placed(found, country);
      } catch {
        status.textContent = t('editor.unreachable');
      }
      looking = false;
      paste.setLocked(false);
      file.setLocked(false);
    }

    // the map is what the editor is worked on, so it leads: on the first screen of a desktop, and straight under the lede on a phone
    host.replaceChildren(el('section', { class: 'account-section wide' }, status, frame.node), form.node, paste.node, file.node, list.node, actionBar(save.error, save.button));
    // the map measures its box, so it is made once the box is on the page
    map = new GuessMap(frame.host);
    frame.attach(map);
    map.onPin((point) => void add(point));
    map.startRound();
    list.show(draft.places, false);
    map.showPlaces(draft.places.map(toPoint), draft.places.length > 0);
  }

  async function load(mapSlug: string): Promise<void> {
    host.replaceChildren(statusLine(t('editor.loadingMap')));
    const result = await getMap(mapSlug);
    if (disposed) {
      return;
    }
    if (!result.ok) {
      host.replaceChildren(errorBox(result.error, () => void load(mapSlug)));
    } else if (!result.data.mine) {
      host.replaceChildren(el('p', { class: 'prose', text: t('editor.notYours') }));
    } else {
      build({ name: result.data.name, description: result.data.description, details: result.data.details, places: result.data.locations });
    }
  }

  if (slug === null) {
    // built after the caller has put `host` on the page
    queueMicrotask(() => !disposed && build(emptyDraft()));
  } else {
    void load(slug);
  }

  return {
    node: host,
    dispose: () => {
      disposed = true;
      stopPaste?.();
      map?.destroy();
    },
  };
}
