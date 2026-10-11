import { getGame, type GameDetail } from '../account/client.ts';
import type { RoundResult } from '../game/session.ts';
import { t } from '../i18n/index.ts';
import { describeSettings } from './choice-row.ts';
import { countryName, el, formatScore } from './dom.ts';
import { GuessMap } from './guess-map.ts';
import { matchFacts } from './history-rows.ts';
import { mapFrame } from './map-frame.ts';
import { factLine, statusLine } from './pane.ts';
import { figure } from './panels.ts';
import { showDistance } from './prefs.ts';
import { longDay } from './stat-grid.ts';
import { refusalBox } from './session-ended.ts';

const MAP_PADDING = 48;

/** The rounds that were saved with their place, in the shape the map draws. Games saved before places were kept have none. */
function mapped(game: GameDetail): RoundResult[] {
  return game.rounds.flatMap((round) =>
    round.lng === null || round.lat === null
      ? []
      : [
          {
            location: { id: '', lng: round.lng, lat: round.lat, country: round.country },
            guess: round.guessLng === null || round.guessLat === null ? null : { lng: round.guessLng, lat: round.guessLat },
            distanceKm: round.distanceKm,
            score: round.score,
            hinted: round.hinted,
          },
        ],
  );
}

function roundsTable(game: GameDetail): HTMLElement {
  const rows = game.rounds.map((round, index) =>
    el(
      'tr',
      {},
      el('td', { class: 'num', text: String(index + 1) }),
      el('td', { text: countryName(round.country) }),
      el('td', { class: 'num', text: round.distanceKm === null ? t('label.noGuess') : showDistance(round.distanceKm) }),
      el('td', { class: 'num' }, formatScore(round.score), round.hinted ? el('span', { class: 'tag', text: t('tag.hint') }) : null),
    ),
  );
  return el(
    'table',
    { class: 'rounds' },
    el('thead', {}, el('tr', {}, el('th', { class: 'num', text: '#' }), el('th', { text: t('label.country') }), el('th', { class: 'num', text: t('label.distance') }), el('th', { class: 'num', text: t('label.points') }))),
    el('tbody', {}, ...rows),
  );
}

function gameBody(game: GameDetail): { nodes: HTMLElement[]; draw: () => GuessMap | null } {
  const results = mapped(game);
  const frame = mapFrame('', t('history.mapLabel'));
  const settings = describeSettings({ ...game, rounds: game.rounds.length });
  // a match adds what kind it was and how it went; its rounds are the player's own guesses
  const match = matchFacts(game);
  return {
    nodes: [
      el('div', { class: 'facts' }, factLine([longDay(game.playedAt), settings, ...(game.daily ? [t('history.daily')] : [])].join(' · ')), match === null ? null : factLine(match)),
      figure(t('label.score'), formatScore(game.score), ` / ${formatScore(game.maxScore)}`),
      roundsTable(game),
      results.length > 0 ? frame.node : el('p', { class: 'prose', text: t('history.noMap') }),
    ],
    draw: () => {
      if (results.length === 0) {
        return null;
      }
      const map = new GuessMap(frame.host);
      frame.attach(map);
      map.showSummary(results, { top: MAP_PADDING, right: MAP_PADDING, bottom: MAP_PADDING, left: MAP_PADDING });
      return map;
    },
  };
}

/** One saved game round by round: the table, and a map with each round's place and guess. */
export function historyView(id: string, onBack: () => void): HTMLElement {
  const body = el('div', { class: 'pane-stack' });
  let map: GuessMap | null = null;

  async function load(): Promise<void> {
    body.replaceChildren(statusLine(t('history.loading')));
    const result = await getGame(id);
    if (!result.ok) {
      body.replaceChildren(refusalBox(result.error, () => void load()));
      return;
    }
    const game = gameBody(result.data);
    body.replaceChildren(...game.nodes);
    // the map measures its box, so it is made once the box is on the page
    map = game.draw();
  }

  void load();

  const back = el('button', {
    class: 'button ghost back',
    text: t('history.back'),
    attrs: { type: 'button' },
    on: {
      click: () => {
        map?.destroy();
        onBack();
      },
    },
  });
  return el('section', { class: 'pane-section' }, el('header', { class: 'pane-head with-action' }, el('h2', { class: 'pane-title', text: t('history.title') }), back), body);
}
