import './host.css';
import { t } from '../i18n/index.ts';
import type { MatchState } from '../multiplayer/client.ts';
import { partyOffers, playerOffers } from '../multiplayer/party-view.ts';
import type { Stage } from '../multiplayer/state.ts';
import { el } from './dom.ts';
import { plainName } from './guest-parts.ts';
import { hostRow, lockButton, playerActions, requestButton, type HostHandlers } from './host-controls.ts';
import { onPhone, statusParts } from './match-status.ts';

/**
 * What a party's host has over the round screen: a Host button that opens the lock and, for each
 * other player, a kick, a hand-over and in co-op the pick; and, while a round is played, the button that ends it. A
 * round with no timer says so here, to everyone. Nobody but the host is shown a control.
 */

const hosting = (state: MatchState) => state.kind === 'party' && state.you.isHost;

/**
 * The Host button in the corner of a match, and the panel it opens. Hidden from everyone but the
 * host. `onOpen` is told when the panel opens, and `close` shuts it: on a phone the corner has
 * room for one open panel, so whoever owns both this and the chat closes the other.
 */
export function hostFold(handlers: HostHandlers, onOpen: () => void = () => {}) {
  const error = el('p', { class: 'account-error', attrs: { role: 'alert' } });
  const report = (message: string) => {
    error.textContent = message;
  };
  const toggle = el('button', { class: 'button ghost host-toggle', text: t('host.title'), attrs: { type: 'button', 'aria-expanded': 'false' } });
  const lock = lockButton(handlers.onLock, report);
  const list = el('ul', { class: 'player-list host-list', attrs: { 'aria-label': t('match.players') } });
  const panel = el('div', { class: 'host-panel' }, el('div', { class: 'actions' }, lock.node), list, error);
  const node = el('aside', { class: 'host-fold', attrs: { 'aria-label': t('host.label') } }, toggle, panel);
  panel.hidden = true;
  node.hidden = true;
  let drawn = '';

  const open = (shown: boolean) => {
    panel.hidden = !shown;
    toggle.setAttribute('aria-expanded', String(shown));
  };
  toggle.addEventListener('click', () => {
    open(Boolean(panel.hidden));
    if (!panel.hidden) {
      onOpen();
    }
  });

  /** The other players, each with what the host may do to them. Redrawn only when it would differ, so a question that is open stays open. */
  function drawPlayers(state: MatchState): void {
    const others = state.players.filter((player) => player.username !== state.you.username);
    const key = JSON.stringify([others.map((player) => [player.username, player.country, player.guest]), state.phase === 'preparing', state.picker]);
    if (key === drawn) {
      return;
    }
    drawn = key;
    list.replaceChildren(
      ...others.map((player) => hostRow([plainName(player.username, player.country, 'player-name')], playerActions(player, playerOffers(state, player), handlers, report))),
    );
  }

  return {
    node,
    close: () => open(false),
    update(state: MatchState): void {
      node.hidden = !hosting(state);
      if (node.hidden) {
        // the party changed hands: the controls go, and a question left open goes with them
        drawn = '';
        list.replaceChildren();
        return;
      }
      lock.update(state.locked);
      lock.node.hidden = !partyOffers(state, 0).lock;
      drawPlayers(state);
    },
  };
}

/**
 * Over a round being played: that it has no timer, when it has none, and the host's End round.
 * Hidden when there is nothing to say and nothing to offer.
 */
export function roundBar(onEndRound: HostHandlers['onEndRound']) {
  const note = el('p', { class: 'round-note', attrs: { role: 'status' } });
  const error = el('p', { class: 'account-error', attrs: { role: 'alert' } });
  const end = requestButton('button ghost', t('host.endRound'), null, onEndRound, (message) => {
    error.textContent = message;
  });
  // "No timer" as a line of status, which opens how the round ends then: open on a wide screen, one line on a phone
  const label = el('summary', { class: 'round-label status-note', attrs: { 'data-state': 'live' } }, ...statusParts(el('span', { class: 'status-word', text: t('party.noTimer.label') })));
  const fold = el('details', { class: 'round-fold' }, label, note);
  fold.open = !onPhone();
  const node = el('aside', { class: 'round-bar' }, fold, end, error);
  node.hidden = true;

  return {
    node,
    /** `stage` is null when no round is on screen: between rounds, at a reveal, at the end. */
    update(state: MatchState, stage: Stage | null, serverNowMs: number): void {
      const inRound = stage !== null && (stage.kind === 'starting' || stage.kind === 'guessing' || stage.kind === 'waiting');
      const untimed = inRound && stage.msLeft === null;
      const text = untimed ? t(hosting(state) ? 'party.noTimerHost' : 'party.noTimer') : '';
      if (note.textContent !== text) {
        note.textContent = text;
      }
      fold.hidden = !untimed;
      end.hidden = !inRound || !partyOffers(state, serverNowMs).endRound;
      if (end.hidden) {
        error.textContent = '';
      }
      node.hidden = !untimed && end.hidden;
    },
  };
}
