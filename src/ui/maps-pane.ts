import './maps.css';
import { getAccount } from '../account/client.ts';
import { countryMaps, mapName, regionMaps, type LocationSet, type MapId } from '../game/locations.ts';
import { t, tn } from '../i18n/index.ts';
import { MAP_LIMITS, getMaps, type MapList, type MapSummary } from '../social/maps.ts';
import { el, withNodes } from './dom.ts';
import { presetState } from './map-preset.ts';
import { editorHref, hrefFor } from './nav.ts';
import { pane, statusLine, type Pane } from './pane.ts';
import { appLink, mapLink, playerName } from './profile-link.ts';
import { isSessionEnded, refusalLine } from './session-ended.ts';

const SEARCH_DELAY_MS = 300;
const MAX_SEARCH_LENGTH = 40;

interface MapsHandlers {
  /** goes to an address inside the app, optionally carrying a map for the pane it opens */
  onNavigate: (href: string, state?: unknown) => void;
  loadPlaces: () => Promise<LocationSet>;
}

interface Official {
  map: MapId;
  name: string;
  places: number;
}

/** What a map is, in a line: how big, how much played, how well liked. */
export const mapFacts = (map: Pick<MapSummary, 'places' | 'plays' | 'likes'>) => [tn('maps.places', map.places), tn('maps.plays', map.plays), tn('maps.likes', map.likes)].join(' · ');

function officialRow(map: Official, handlers: MapsHandlers): HTMLElement {
  const choose = el('button', {
    class: 'button ghost',
    text: t('maps.choose'),
    attrs: { type: 'button', 'aria-label': t('maps.chooseMap', { name: map.name }) },
    on: { click: () => handlers.onNavigate(hrefFor('singleplayer'), presetState({ map: map.map, name: map.name, places: null })) },
  });
  return el('li', { class: 'player-row' }, el('span', { class: 'player-name', text: map.name }), el('span', { class: 'tag', text: tn('maps.places', map.places) }), el('div', { class: 'row-actions' }, choose));
}

/** The official maps: the world, the regions and the countries the list of places in use is big enough for. */
function officialMaps(set: LocationSet, query: string, handlers: MapsHandlers): HTMLElement {
  const count = (region: string) => set.locations.filter((location) => set.regions[location.country] === region).length;
  const broad: Official[] = [{ map: 'world', name: mapName('world'), places: set.locations.length }, ...regionMaps(set).map((region) => ({ map: region as MapId, name: mapName(region), places: count(region) }))];
  const countries: Official[] = countryMaps(set).map((country) => ({ map: country.map, name: country.name, places: country.places }));
  const wanted = query.toLowerCase();
  const matches = (map: Official) => map.name.toLowerCase().includes(wanted);
  const list = (maps: Official[]) => el('ul', { class: 'player-list' }, ...maps.map((map) => officialRow(map, handlers)));
  const heading = el('h3', { class: 'label', text: t('maps.official') });
  if (wanted !== '') {
    const found = [...broad, ...countries].filter(matches);
    return el('section', { class: 'account-section', attrs: { 'aria-label': t('maps.official') } }, heading, found.length > 0 ? list(found) : el('p', { class: 'fine', text: t('maps.noOfficial') }));
  }
  return el(
    'section',
    { class: 'account-section', attrs: { 'aria-label': t('maps.official') } },
    heading,
    list(broad),
    // a long list, so it waits behind its own heading until asked for
    countries.length > 0 ? el('details', { class: 'more-maps' }, el('summary', { text: tn('maps.allCountries', countries.length) }), list(countries)) : null,
  );
}

function communityRow(map: MapSummary, mine: boolean): HTMLElement {
  return el(
    'li',
    { class: 'player-row' },
    el('span', { class: 'player-name' }, mapLink(map.slug, map.name)),
    mine ? null : el('span', { class: 'by' }, ...withNodes(t('maps.by'), { maker: playerName(map.maker) })),
    el('span', { class: 'tag', text: mapFacts(map) }),
    mine ? el('div', { class: 'row-actions' }, appLink(t('maps.edit'), editorHref(map.slug), 'button ghost')) : null,
    // a map saved before descriptions were required may have none
    map.description ? el('p', { class: 'map-about', text: map.description }) : null,
  );
}

/** One list of community maps, a page at a time. A list with nothing in it says so in its own words. */
function communityList(title: string, list: MapList, search: string, empty: string): HTMLElement {
  const rows = el('ul', { class: 'player-list' });
  const foot = el('div', { class: 'list-foot' });
  let page = 0;

  async function more(): Promise<void> {
    foot.replaceChildren(statusLine(t('maps.loading')));
    const result = await getMaps({ list, search, page: page + 1 });
    if (!result.ok) {
      // asking again cannot bring back a session that has ended: that refusal comes with the way to sign in instead
      foot.replaceChildren(refusalLine(result.error), isSessionEnded(result.error) ? '' : el('button', { class: 'button ghost', text: t('common.tryAgain'), attrs: { type: 'button' }, on: { click: () => void more() } }));
      return;
    }
    page = result.data.page;
    rows.append(...result.data.maps.map((map) => communityRow(map, list === 'mine')));
    foot.replaceChildren(
      rows.childElementCount === 0
        ? el('p', { class: 'fine', text: empty })
        : result.data.more
          ? el('button', { class: 'button ghost', text: t('maps.showMore'), attrs: { type: 'button', 'aria-label': t('maps.showMoreOf', { list: title }) }, on: { click: () => void more() } })
          : '',
    );
  }

  void more();
  return el('section', { class: 'account-section', attrs: { 'aria-label': title } }, el('h3', { class: 'label', text: title }), rows, foot);
}

/** What a visitor or a guest sees where the liked maps would be: what an account adds, and the way to one. */
function likedNotice(): HTMLElement {
  return el(
    'section',
    { class: 'account-section', attrs: { 'aria-label': t('maps.liked') } },
    el('h3', { class: 'label', text: t('maps.liked') }),
    el('p', { class: 'fine', text: t('maps.likedNeedsAccount') }),
    el('div', { class: 'actions' }, el('a', { class: 'button ghost', text: t('common.signIn'), attrs: { href: hrefFor('account') } })),
  );
}

/** The lists that are a player's own: the maps they made and the maps they like. */
const ownLists = (): HTMLElement[] => [communityList(t('maps.mine'), 'mine', '', t('maps.mineEmpty')), communityList(t('maps.liked'), 'liked', '', t('maps.likedEmpty'))];

function searchField() {
  const hint = el('p', { class: 'fine', text: t('maps.searchHint', { min: MAP_LIMITS.minSearch }), attrs: { id: 'map-search-hint' } });
  const input = el('input', {
    class: 'account-input',
    attrs: { id: 'map-search', type: 'search', autocomplete: 'off', spellcheck: 'false', maxlength: String(MAX_SEARCH_LENGTH), placeholder: t('common.typeToSearch'), 'aria-describedby': hint.id },
  });
  return { input, node: el('div', { class: 'inline-form' }, el('label', { class: 'label', text: t('maps.search'), attrs: { for: input.id } }), input, hint) };
}

/** What is searched for: nothing until three characters are typed, as the server ignores anything shorter. */
const queryOf = (typed: string) => (typed.trim().length >= MAP_LIMITS.minSearch ? typed.trim() : '');

/** Maps to play: the player's own and the ones they like, the official ones, and what other players have made: the popular and the new. */
export function mapsPane(handlers: MapsHandlers): Pane {
  const official = el('div', { class: 'pane-stack' });
  const everyone = el('div', { class: 'pane-stack map-lists' });
  // a player's own maps lead the lists; what a visitor is told an account would add comes after them all
  const own = el('div', { class: 'pane-stack map-lists' });
  const offer = el('div', { class: 'pane-stack map-lists' });
  const search = searchField();
  let set: LocationSet | null = null;
  /** null until the account has answered: a visitor and a guest are both `false` */
  let signedIn: boolean | null = null;
  let query = '';
  let timer: number | undefined;
  let disposed = false;

  const drawOfficial = () => official.replaceChildren(set ? officialMaps(set, query, handlers) : statusLine(t('maps.loadingOfficial')));
  // a search looks through every community map, so the player's own lists step aside for it
  const drawOwn = () => {
    own.replaceChildren(...(query === '' && signedIn === true ? ownLists() : []));
    offer.replaceChildren(...(query === '' && signedIn === false ? [likedNotice()] : []));
  };
  function drawCommunity(): void {
    everyone.replaceChildren(
      ...(query === ''
        ? [communityList(t('maps.popular'), 'popular', '', t('maps.popularEmpty')), communityList(t('maps.newest'), 'newest', '', t('maps.newestEmpty'))]
        : [communityList(t('maps.matching', { query }), 'popular', query, t('maps.noCommunity'))]),
    );
    drawOwn();
  }

  search.input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const next = queryOf(search.input.value);
      if (next !== query) {
        query = next;
        drawOfficial();
        drawCommunity();
      }
    }, SEARCH_DELAY_MS);
  });
  drawOfficial();
  drawCommunity();
  void handlers.loadPlaces().then(
    (loaded) => {
      set = loaded;
      if (!disposed) {
        drawOfficial();
      }
    },
    () => official.replaceChildren(el('p', { class: 'fine', text: t('maps.officialFailed') })),
  );
  void getAccount().then((account) => {
    if (account.ok && !disposed) {
      signedIn = account.data.account !== null;
      drawOwn();
    }
  });

  return {
    node: pane(t('nav.item.maps'), t('maps.lede'), el('div', { class: 'actions' }, appLink(t('common.makeMap'), editorHref(null), 'button primary')), search.node, own, official, everyone, offer),
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
