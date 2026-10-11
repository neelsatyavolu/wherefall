import './lobby.css';
import type { LocationSet } from '../game/locations.ts';
import { t } from '../i18n/index.ts';
import { PARTY_LIMITS, type MatchSettings, type MatchState, type Team } from '../multiplayer/client.ts';
import type { ChatView } from '../multiplayer/match-view.ts';
import { partyOffers } from '../multiplayer/party-view.ts';
import { openChat, type ChatHandlers } from './chat.ts';
import { el } from './dom.ts';
import { requestButton, type HostHandlers, type Report } from './host-controls.ts';
import { invite, inviteList } from './lobby-invite.ts';
import { lobbyPlayers } from './lobby-players.ts';
import { lobbySettings } from './lobby-settings.ts';

export { joinLink } from './lobby-invite.ts';

/** Every request resolves to an error to show, or null when the server took it. */
export interface LobbyHandlers {
  onStart: () => Promise<string | null>;
  onLeave: () => Promise<string | null>;
  /** what the chat sends: a message, a reaction, a mute */
  chat: ChatHandlers;
  /** what the chat shows for a state; its mode is `off` where the match has none or the player has hidden it */
  chatView: (state: MatchState) => ChatView;
  /** the host's own: kick, hand over, lock */
  host: HostHandlers;
  /** the host replaces the settings */
  onConfigure: (settings: MatchSettings) => Promise<string | null>;
  /** the viewer takes a seat on a team */
  onTeam: (team: Team) => Promise<string | null>;
  /** the host splits the players into two even teams */
  onShuffle: () => Promise<string | null>;
  /** the host of a party of two queues both for 2v2 */
  onPair: () => Promise<string | null>;
  /** the list of places the map choice is drawn from */
  loadPlaces: () => Promise<LocationSet>;
}

export interface Lobby {
  update: (state: MatchState) => void;
  /** A message under the buttons, such as a lost connection. An empty string clears it. */
  setError: (message: string) => void;
}

const errorLine = () => el('p', { class: 'account-error', attrs: { role: 'alert' } });

const reportTo =
  (line: HTMLElement): Report =>
  (error) => {
    line.textContent = error;
  };

/** Start, for the host, with what stands in its way; and for a party of two the way into the 2v2 queue together. */
function startBlock(handlers: LobbyHandlers, error: HTMLElement) {
  const report = reportTo(error);
  const hint = el('p', { class: 'fine', attrs: { role: 'status' } });
  const pairNote = el('p', { class: 'fine', text: t('party.pair.note') });
  let starting = false;
  const start = requestButton(
    'button accent',
    t('lobby.start'),
    null,
    async () => {
      starting = true;
      const refused = await handlers.onStart();
      starting = false;
      return refused;
    },
    report,
  );
  const pair = requestButton('button ghost', t('party.pair.button'), null, handlers.onPair, report);
  const actions = el('div', { class: 'actions' }, start, pair);
  return {
    node: el('section', { class: 'account-section lobby-start' }, actions, hint, pairNote, error),
    /** Start gives way while the host's settings form is open: that form's Save is then the one accent button on the screen. */
    setQuiet(quiet: boolean): void {
      start.classList.toggle('accent', !quiet);
      start.classList.toggle('ghost', quiet);
    },
    update(state: MatchState): void {
      const enough = state.players.length >= PARTY_LIMITS.minPlayers;
      const offers = partyOffers(state, 0);
      start.hidden = !state.you.isHost;
      if (!starting) {
        start.disabled = !enough;
      }
      pair.hidden = !offers.pair;
      pairNote.hidden = !offers.pair;
      // a player who is not the host has neither button: the row leaves no gap where they would stand
      actions.hidden = start.hidden && pair.hidden;
      hint.textContent = state.you.isHost ? (enough ? t('lobby.hint.ready') : t('lobby.hint.needPlayers')) : t('lobby.hint.waiting');
    },
  };
}

/** Who is in: how many of the forty, whether the party is locked, the list or the teams, and the host's shuffle. */
function playersBlock(handlers: LobbyHandlers) {
  const error = errorLine();
  const report = reportTo(error);
  const count = el('h2', { class: 'label' });
  const locked = el('span', { class: 'tag', text: t('party.locked.tag') });
  const shuffle = requestButton('button ghost', t('party.team.shuffle'), null, handlers.onShuffle, report);
  const players = lobbyPlayers({ host: handlers.host, onTeam: handlers.onTeam }, report);
  return {
    node: el('section', { class: 'account-section' }, el('div', { class: 'lobby-count' }, count, locked, shuffle), error, players.node),
    update(state: MatchState): void {
      count.textContent = [t('match.players'), t('lobby.playerCount', { count: state.players.length, max: PARTY_LIMITS.maxPlayers })].join(' · ');
      locked.hidden = !state.locked;
      shuffle.hidden = !partyOffers(state, 0).shuffle;
      players.update(state);
    },
  };
}

/**
 * A party before it starts: the code and join link to share, the settings, Start for the host, who
 * is in (on which team, where there are teams), and the chat, which on a wide screen stands beside
 * all of that. Mounts itself in `root`; `update` redraws it from each state.
 */
export function mountLobby(root: HTMLElement, first: MatchState, handlers: LobbyHandlers): Lobby {
  const error = errorLine();
  const report = reportTo(error);
  const leave = requestButton('button danger', t('lobby.leave'), null, handlers.onLeave, report);
  const start = startBlock(handlers, error);
  const settings = lobbySettings({ loadPlaces: handlers.loadPlaces, onConfigure: handlers.onConfigure, onLock: handlers.host.onLock }, report, start.setQuiet);
  const players = playersBlock(handlers);
  const chat = openChat(handlers.chat);
  const chatSection = el('section', { class: 'account-section' }, el('h2', { class: 'label', text: t('label.chat') }), chat.node);
  let latest = first;

  function update(state: MatchState): void {
    latest = state;
    const view = handlers.chatView(state);
    chat.update(view);
    chatSection.hidden = view.mode === 'off';
    settings.update(state);
    start.update(state);
    players.update(state);
  }

  update(first);
  root.replaceChildren(
    el(
      'main',
      { class: 'lobby' },
      el('header', { class: 'screen-head' }, el('h1', { class: 'screen-title', text: t('lobby.title') }), leave),
      el(
        'div',
        { class: 'lobby-grid' },
        el('div', { class: 'lobby-main' }, first.code === null ? null : invite(first.code), settings.node, start.node, players.node),
        el(
          'div',
          { class: 'lobby-side' },
          chatSection,
          // friends are an account's: a guest is not shown a list the server would refuse them
          first.code === null || first.you.guest ? null : inviteList(first.code, () => latest.players.map((player) => player.username)),
        ),
      ),
    ),
  );

  return { update, setError: report };
}
