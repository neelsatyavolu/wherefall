import './maps.css';
import { communityMap } from '../game/locations.ts';
import { language, t } from '../i18n/index.ts';
import { previewPlaces } from '../social/map-preview.ts';
import { MAP_LIMITS, deleteMap, getMap, likeMap, reportMap, toLocationSet, type MapDetail } from '../social/maps.ts';
import { el, formatScore, withNodes } from './dom.ts';
import { mapFrame } from './map-frame.ts';
import { streetPreview, type StreetSource } from './map-preview.ts';
import { presetState } from './map-preset.ts';
import { editorHref, hrefFor } from './nav.ts';
import { backButton, errorLine, statusLine, type Pane } from './pane.ts';
import { appLink, playerName } from './profile-link.ts';
import { imageryProviders } from './providers.ts';
import { sayRefusal } from './session-ended.ts';
import { statGrid } from './stat-grid.ts';
import { errorBox } from './status-box.ts';

interface MapPageHandlers {
  onNavigate: (href: string, state?: unknown) => void;
  /** false when this site has no Google imagery set up, which is all a community map is made of */
  googleReady: boolean;
  /** where the preview's Street View comes from; left out, it is Google within the day's allowance */
  street?: StreetSource;
}

/** Google as a game gets it: behind the day's allowance, which is asked about once, when the preview is started. */
const googleStreet: StreetSource = () => imageryProviders().find((provider) => provider.name === 'google') ?? null;

/** The day a map was made, as "October 11, 2026" in the language in use. */
const madeDay = (createdAt: string) => new Intl.DateTimeFormat(language(), { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(createdAt));

const button = (text: string, kind: string, run: () => void) => el('button', { class: `button ${kind}`, text, attrs: { type: 'button' }, on: { click: run } });

/** The figures that change when the map is liked: redrawn in place from the server's answer. */
function figures(map: Pick<MapDetail, 'name' | 'places' | 'plays' | 'likes'>): HTMLElement {
  return statGrid(
    t('mapPage.inNumbers', { name: map.name }),
    [
      [t('label.places'), formatScore(map.places)],
      [t('mapPage.plays'), formatScore(map.plays)],
      [t('mapPage.likes'), formatScore(map.likes)],
    ],
    3,
  );
}

/** Reporting a map: a reason, which may be left empty, and a button. One report per player per map. */
function reportForm(slug: string): HTMLElement {
  const reason = el('input', { class: 'account-input', attrs: { id: 'report-reason', type: 'text', maxlength: String(MAP_LIMITS.maxReason), autocomplete: 'off', placeholder: t('mapPage.reportReason') } });
  const note = el('p', { class: 'fine', attrs: { role: 'status' } });
  const error = errorLine();
  const send = button(t('common.sendReport'), 'ghost', () => void submit());
  const form = el('div', { class: 'inline-form report-form' }, el('label', { class: 'label', text: t('mapPage.reportThis'), attrs: { for: reason.id } }), el('div', { class: 'inline-fields' }, reason, send), note, error);
  form.hidden = true;

  async function submit(): Promise<void> {
    send.disabled = true;
    error.textContent = '';
    const result = await reportMap(slug, reason.value.trim());
    if (result.ok) {
      note.textContent = t('mapPage.reported');
    } else {
      send.disabled = false;
      sayRefusal(error, result.error);
    }
  }
  return form;
}

/** For the maker: edit the map, or delete it after being asked once more. */
function ownerActions(map: MapDetail, handlers: MapPageHandlers, error: HTMLElement): HTMLElement {
  const ask = el('div', { class: 'actions' });
  const remove = async () => {
    const result = await deleteMap(map.slug);
    if (result.ok) {
      handlers.onNavigate(hrefFor('maps'));
    } else {
      sayRefusal(error, result.error);
    }
  };
  // deleting is for good: it is the one in the danger colour, and the safe choice beside it is the filled button
  const idle = () => ask.replaceChildren(appLink(t('common.editMap'), editorHref(map.slug), 'button primary'), button(t('mapPage.delete'), 'danger', confirm));
  const confirm = () =>
    ask.replaceChildren(el('span', { class: 'settings-line', text: t('mapPage.deleteConfirm') }), button(t('mapPage.deleteYes'), 'danger', () => void remove()), button(t('mapPage.deleteNo'), 'primary', idle));
  idle();
  return el('section', { class: 'account-section', attrs: { 'aria-label': t('mapPage.yours') } }, el('h3', { class: 'label', text: t('mapPage.yours') }), ask);
}

/** The long description: plain text, with the line breaks its maker gave it. */
function details(text: string): HTMLElement {
  return el('section', { class: 'account-section', attrs: { 'aria-label': t('mapPage.details') } }, el('h3', { class: 'label', text: t('mapPage.details') }), el('p', { class: 'prose map-details', text }));
}

function pageBody(map: MapDetail, handlers: MapPageHandlers): { nodes: HTMLElement[]; preview: ReturnType<typeof mapFrame>; street: Pane | null } {
  const error = errorLine();
  const stats = el('div', { class: 'stats-host' }, figures(map));
  const preset = presetState({ map: communityMap(map.slug), name: map.name, places: map.locations.length });
  const play = button(t('mapPage.play'), 'accent', () => handlers.onNavigate(hrefFor('singleplayer'), preset));
  const party = button(t('mapPage.party'), 'ghost', () => handlers.onNavigate(hrefFor('create'), preset));
  play.disabled = !handlers.googleReady;
  party.disabled = !handlers.googleReady;
  let liked = map.liked;
  const like = button(liked ? t('mapPage.unlike') : t('mapPage.like'), 'ghost', () => void toggleLike());
  const report = reportForm(map.slug);

  async function toggleLike(): Promise<void> {
    like.disabled = true;
    error.textContent = '';
    const result = await likeMap(map.slug, !liked);
    like.disabled = false;
    if (!result.ok) {
      sayRefusal(error, result.error);
      return;
    }
    liked = result.data.liked;
    like.textContent = liked ? t('mapPage.unlike') : t('mapPage.like');
    stats.replaceChildren(figures(result.data));
  }

  const preview = mapFrame('', t('mapPage.preview', { name: map.name }));
  // without Google there is nothing to preview with, and the line about playing says why
  const street = handlers.googleReady ? streetPreview(map.name, previewPlaces(map.locations), handlers.street ?? googleStreet) : null;
  const nodes = [
    el('p', { class: 'settings-line' }, ...withNodes(t('mapPage.byline', { date: madeDay(map.createdAt) }), { maker: playerName(map.maker) })),
    map.description ? el('p', { class: 'prose', text: map.description }) : null,
    map.details ? details(map.details) : null,
    stats,
    handlers.googleReady ? null : el('p', { class: 'prose', text: t('mapPage.noGoogle') }),
    // two pairs, so that where the row breaks on a phone no button is left on a line of its own
    // a map's maker has nobody to report it to but themselves: their own map offers no Report
    el('div', { class: 'actions' }, el('div', { class: 'actions' }, play, party), el('div', { class: 'actions' }, like, map.mine ? null : button(t('common.report'), 'ghost', () => (report.hidden = !report.hidden)))),
    error,
    map.mine ? null : report,
    street?.node ?? null,
    preview.node,
    map.mine ? ownerActions(map, handlers, error) : null,
  ].filter((node): node is HTMLElement => node !== null);
  return { nodes, preview, street };
}

/** A community map's page: what it is, who made it, a look at its places, where they are, and the ways to play, like or report it. */
export function mapPage(slug: string, handlers: MapPageHandlers): Pane {
  const title = el('h2', { class: 'pane-title', text: t('label.map') });
  const body = el('div', { class: 'pane-stack' });
  let destroy: (() => void) | null = null;
  let street: Pane | null = null;
  let disposed = false;

  async function load(): Promise<void> {
    body.replaceChildren(statusLine(t('mapPage.loading')));
    const result = await getMap(slug);
    if (disposed) {
      return;
    }
    if (!result.ok) {
      body.replaceChildren(errorBox(result.error, () => void load()));
      return;
    }
    title.textContent = result.data.name;
    const page = pageBody(result.data, handlers);
    street = page.street;
    body.replaceChildren(...page.nodes);
    // the preview map is large to load, and measures its box, so it comes last and once the box is on the page
    const { GuessMap } = await import('./guess-map.ts');
    if (disposed) {
      return;
    }
    const map = new GuessMap(page.preview.host);
    page.preview.attach(map);
    map.showPlaces(toLocationSet(result.data).locations, true);
    destroy = () => map.destroy();
  }

  void load();

  return {
    node: el('section', { class: 'pane-section' }, el('header', { class: 'pane-head with-action' }, title, backButton()), body),
    dispose: () => {
      disposed = true;
      street?.dispose?.();
      destroy?.();
    },
  };
}
