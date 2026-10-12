import { t } from '../i18n/index.ts';
import type { MatchPlayer, MatchState, Team } from '../multiplayer/client.ts';
import { playerOffers, seating } from '../multiplayer/party-view.ts';
import { isCoop } from '../multiplayer/state.ts';
import { el } from './dom.ts';
import { hostRow, playerActions, type HostHandlers, type Report } from './host-controls.ts';
import { playerName } from './profile-link.ts';
import { teamBoxes } from './team-picker.ts';

/** Who is in a party's lobby: one list, or the two teams and who has none. In co-op the list says who the picker is. The host's controls sit in the rows. */

export interface PlayersHandlers {
  host: Pick<HostHandlers, 'onKick' | 'onMakeHost' | 'onMakePicker'>;
  /** the viewer takes a seat on a team; resolves to an error to show, or null */
  onTeam: (team: Team) => Promise<string | null>;
}

/** What a row is drawn from: a list is only redrawn when one of these changes, so an open question in a row is not wiped by a poll. */
const drawnFrom = (state: MatchState) =>
  JSON.stringify([
    state.players.map((player) => [player.username, player.country, player.guest, player.team, player.active]),
    state.you.username,
    state.you.isHost,
    state.you.team,
    state.phase,
    state.settings.teams,
    state.picker,
  ]);

function tags(state: MatchState, player: MatchPlayer): Array<HTMLElement | null> {
  const isYou = player.username === state.you.username;
  // "you, host": two words of the catalog, each a text of its own
  const own = isYou ? el('span', { class: 'tag' }, t('tag.you'), ...(state.you.isHost ? [', ', t('tag.host')] : [])) : null;
  const picker = player.username === state.picker ? el('span', { class: 'tag', text: t('tag.picker') }) : null;
  return [own, picker, player.active ? null : el('span', { class: 'tag', text: t('tag.away') })];
}

/** One player: flag and name (a guest has no profile, so theirs is not a link), what is to be said of them, and the host's actions. */
function playerRow(state: MatchState, player: MatchPlayer, handlers: PlayersHandlers, report: Report): HTMLElement {
  const name = el('span', { class: 'player-name' }, playerName(player.username, { country: player.country, newTab: true }));
  return hostRow([name, ...tags(state, player)], playerActions(player, playerOffers(state, player), handlers.host, report));
}

/**
 * The players of a lobby. `update` redraws them from each state; `report` is where a refusal is
 * shown. A party holds forty, so a long list scrolls inside itself (lobby.css), and a redraw
 * leaves each list scrolled to where it was.
 */
export function lobbyPlayers(handlers: PlayersHandlers, report: Report) {
  const node = el('div', { class: 'lobby-players' });
  let drawn = '';

  const rows = (state: MatchState, players: readonly MatchPlayer[]) => players.map((player) => playerRow(state, player, handlers, report));
  const lists = () => [...node.querySelectorAll<HTMLElement>('.player-list')];

  return {
    node,
    update(state: MatchState): void {
      const key = drawnFrom(state);
      if (key === drawn) {
        return;
      }
      drawn = key;
      const scrolled = lists().map((list) => list.scrollTop);
      const seats = seating(state);
      node.replaceChildren(
        seats === null ? el('ul', { class: 'player-list' }, ...rows(state, state.players)) : teamBoxes(state, seats, (players) => rows(state, players), handlers.onTeam, report),
        ...(isCoop(state) ? [el('p', { class: 'fine', text: t('coop.hint') })] : []),
      );
      lists().forEach((list, index) => {
        list.scrollTop = scrolled[index] ?? 0;
      });
    },
  };
}
