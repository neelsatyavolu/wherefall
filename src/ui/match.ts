import './match.css';
import { REFUSALS, getAccount } from '../account/client.ts';
import { t } from '../i18n/index.ts';
import type { ImageryProvider } from '../imagery/provider.ts';
import { NO_SUCH_MATCH, getMatch, leaveMatch, mutePlayer, queueAsPair, sendChat, sendEmote, startMatch, type MatchState, type Reply } from '../multiplayer/client.ts';
import { chatView, returnsToQueue } from '../multiplayer/match-view.ts';
import { backToLobby, chooseTeam, configureParty, endRound, kickPlayer, lockParty, makeHost, shuffleTeams } from '../multiplayer/party.ts';
import { partyJoinRound } from '../multiplayer/party-view.ts';
import { abortable, pollInterval, startPolling } from '../multiplayer/poll.ts';
import type { QueueEntry } from '../multiplayer/queue-view.ts';
import { askAfterReveal, revealKey } from '../multiplayer/reveal-ask.ts';
import { isCancelled, latest, outcomeLine } from '../multiplayer/state.ts';
import type { ChatHandlers } from './chat.ts';
import { el } from './dom.ts';
import type { HostHandlers } from './host-controls.ts';
import { mountLobby, type Lobby } from './lobby.ts';
import type { MatchPlay } from './match-play.ts';
import type { NavId } from './nav.ts';
import { statusLine } from './pane.ts';
import { noticePanel } from './panels.ts';
import { statusBox } from './status-box.ts';

export interface MatchDeps {
  providers: readonly ImageryProvider[];
  /** back to the home screen, on one of its panes when given */
  onHome: (item?: NavId) => void;
  /** to a queue's pane with the player on their way into that queue: playing again, or put back by the server */
  onQueue: (entry: QueueEntry) => void;
  /** called once with the party's code, for a party, so the address can become its join link */
  onParty: (code: string) => void;
  /** true when entered straight from the public queue, which can drop a player into a game under way */
  fromQueue: boolean;
}

type Action = { name: string; run: () => void };

/**
 * Runs one match in `root` from wherever it is entered (a party's lobby, or the id a queue gave)
 * to its final standing, and for a party back to its lobby when the host says so. It polls the
 * match, shows the lobby while there is one, and hands every later state to the round screen.
 * Returns a function that tears it down; leaving a match that is still running tells the server.
 */
export function runMatch(root: HTMLElement, entry: MatchState | string, deps: MatchDeps): () => void {
  const id = typeof entry === 'string' ? entry : entry.id;
  let state: MatchState | null = null;
  let lobby: Lobby | null = null;
  let play: MatchPlay | null = null;
  let playLoading = false;
  let left = false;
  let connectionLost = false;
  let disposed = false;
  /** the reveal the match has been asked about once more as it ends, so no reveal is asked about twice */
  let askedReveal: string | null = null;
  /** this browser's place in the second after a reveal that a party's players spread their requests over */
  const askShare = Math.random();
  /** the account's own "hide chat" setting. Chat stays out of sight until the account has answered, so it never flashes up */
  let chatHidden = true;

  const showMessage = (...children: HTMLElement[]) => root.replaceChildren(el('main', { class: 'home' }, ...children));
  /** `failed` marks the notice as a failure or a refusal: a red dot and the word over the message. */
  const showNotice = (message: string, actions: Action[], failed = false) => showMessage(noticePanel(message, actions, failed));
  const home: Action = { name: t('common.home'), run: () => deps.onHome() };

  /** Sends one action and shows the match it answers with, like any other state. Resolves to an error to show, or null. */
  async function act(sending: Reply<MatchState>): Promise<string | null> {
    const reply = await sending;
    if (!reply.ok) {
      return reply.error;
    }
    accept(reply.data);
    return null;
  }

  const chat: ChatHandlers = {
    onSend: (text, scope) => act(sendChat(id, text, scope)),
    onEmote: (emote) => act(sendEmote(id, emote)),
    onMute: (username, muted) => act(mutePlayer(id, username, muted)),
  };
  const viewOfChat = (current: MatchState) => chatView(current, chatHidden);
  /** what only the host is offered; the server refuses anyone else, in its own words */
  const host: HostHandlers = {
    onKick: (username) => act(kickPlayer(id, username)),
    onMakeHost: (username) => act(makeHost(id, username)),
    onLock: (locked) => act(lockParty(id, locked)),
    onEndRound: () => act(endRound(id)),
  };
  /** a player who joined a party under way by its code comes in on a later round; everyone else is in the one it is on */
  const joinRound = typeof entry === 'string' ? null : partyJoinRound(entry, Date.parse(entry.serverNow));

  /** The host of a party of two queues both for 2v2. The lobby closes, and this player goes to the queue they are now in. */
  async function queuePair(): Promise<string | null> {
    const reply = await queueAsPair(id);
    if (!reply.ok) {
      return reply.error;
    }
    toPairQueue();
    return null;
  }

  /** Out of a lobby that closed because its two players were queued for 2v2 together: on to that queue, which the server has put them in. */
  function toPairQueue(): void {
    if (disposed || left) {
      return;
    }
    // the party is over, so there is nothing to leave
    left = true;
    poller.stop();
    deps.onQueue({ kind: 'team', reason: 'pair' });
  }

  /** The round screen and its map are large, so they load only once a match leaves its lobby. */
  async function mountPlay(): Promise<void> {
    if (playLoading) {
      return;
    }
    playLoading = true;
    lobby = null;
    showMessage(statusLine(t('match.loading')));
    try {
      const { startMatchPlay } = await import('./match-play.ts');
      if (disposed || !state) {
        return;
      }
      if (state.phase === 'lobby') {
        // the party went back to its lobby while this was loading
        playLoading = false;
        return;
      }
      play = startMatchPlay(root, state, {
        providers: deps.providers,
        serverNow: poller.serverNow,
        report: accept,
        // tearing the match down tells the server, whether or not that request gets through
        onLeave: () => deps.onHome(),
        entry: { fromQueue: deps.fromQueue, joinRound },
        chat,
        chatView: viewOfChat,
        host,
        end: { onHome: () => deps.onHome(), onAgain: (kind) => deps.onQueue({ kind, reason: 'again' }), onLobby: () => act(backToLobby(id)) },
      });
      play.update(state);
    } catch {
      playLoading = false;
      showNotice(t('match.loadFailed'), [{ name: t('common.tryAgain'), run: () => void mountPlay() }, home], true);
    }
  }

  async function leave(): Promise<string | null> {
    left = true;
    const reply = await leaveMatch(id);
    if (!reply.ok) {
      left = false;
      return reply.error;
    }
    deps.onHome();
    return null;
  }

  /** A party is in its lobby: at the start, and again when its host takes a finished match back there. */
  function showLobby(current: MatchState): void {
    if (play) {
      play.destroy();
      play = null;
      playLoading = false;
    }
    lobby ??= mountLobby(root, current, {
      onStart: () => act(startMatch(id)),
      onLeave: leave,
      chat,
      chatView: viewOfChat,
      host,
      onConfigure: (settings) => act(configureParty(id, settings)),
      onTeam: (team) => act(chooseTeam(id, team)),
      onShuffle: () => act(shuffleTeams(id)),
      onPair: queuePair,
      // the map choice is drawn from the places of the imagery source in use, as on the Create party pane
      loadPlaces: () => deps.providers[0]?.places() ?? Promise.reject(new Error('No imagery source')),
    });
    lobby.update(current);
  }

  function show(current: MatchState): void {
    if (current.phase === 'lobby') {
      showLobby(current);
    } else if (play) {
      play.update(current);
    } else if (isCancelled(current)) {
      showNotice(outcomeLine(current) || t('common.matchOver'), [home]);
    } else {
      void mountPlay();
    }
  }

  /**
   * During a reveal: asks for the match once more as the reveal ends, ahead of the pace. The next
   * round's place comes with that reply, at the start of its get-ready, and not up to four seconds
   * into it as a full party's pace would have it.
   */
  function askAsRevealEnds(current: MatchState): void {
    const key = revealKey(current);
    const window = askAfterReveal(current, poller.serverNow(), askShare);
    if (key !== null && key !== askedReveal && window !== null) {
      askedReveal = key;
      poller.askBetween(window.fromMs, window.byMs);
    }
  }

  /** Takes a state from a poll or from the reply to an action, and shows it unless it is out of date. */
  function accept(next: MatchState): void {
    if (disposed) {
      return;
    }
    if (state === null && next.code !== null) {
      deps.onParty(next.code);
    }
    if (connectionLost) {
      connectionLost = false;
      lobby?.setError('');
      play?.setLost(null);
    }
    state = latest(state, next);
    if (state.movedToQueue === 'team') {
      // the host queued this party's two players for 2v2: the lobby has closed and the server has queued them both
      toPairQueue();
      return;
    }
    if (returnsToQueue(state)) {
      // the other player left a ranked duel before it began: the server has already put this one back in the queue
      deps.onQueue({ kind: 'ranked', reason: 'dodged' });
      return;
    }
    if (state.phase === 'finished' && (state.kind !== 'party' || isCancelled(state))) {
      // a party that was played is polled on: that is what keeps a player in it when its host goes back to the lobby
      poller.stop();
    }
    askAsRevealEnds(state);
    show(state);
  }

  /** Out of the match for good, by the server's word: nothing more is asked of it, and `notice` says how to go on. */
  function shutOut(notice: () => void): void {
    left = true;
    poller.stop();
    play?.destroy();
    play = null;
    lobby = null;
    notice();
  }

  /** The host put this player out: the server's own words, under a label that says what happened. It is a refusal, like a ban, and nothing that failed. */
  const removedNotice = (message: string) =>
    statusBox('error', t('match.removed.label'), message, el('button', { class: 'button primary', text: home.name, attrs: { type: 'button' }, on: { click: home.run } }));

  /** A refusal that ends the match for this player: removed by the host, a match that is not there (or that they are no longer in), or a session that ran out (a guest's lasts a day). */
  function refused(error: string): void {
    if (disposed || left) {
      return;
    }
    if (error === REFUSALS.removed) {
      shutOut(() => showMessage(removedNotice(error)));
    } else if (error === NO_SUCH_MATCH) {
      // the server's own words, as sent. A match that is not there is not a lost connection: asking again would change nothing
      shutOut(() => showNotice(error, [home], true));
    } else if (error === REFUSALS.signIn) {
      const ended = t(state?.you.guest ? 'match.guestEnded' : 'match.sessionEnded');
      shutOut(() => showNotice(ended, [home, { name: t('common.signIn'), run: () => deps.onHome('account') }], true));
    }
  }

  function lost(error: string): void {
    connectionLost = true;
    if (play) {
      play.setLost(error);
    } else if (lobby) {
      lobby.setError(t('common.connectionLost', { error }));
    } else if (!playLoading) {
      showNotice(t('common.connectionLost', { error }), [home], true);
    }
  }

  const poller = startPolling({
    load: async (signal) => {
      const reply = await getMatch(id, abortable(signal));
      if (!reply.ok) {
        refused(reply.error);
      }
      return reply;
    },
    onData: accept,
    onLost: lost,
    serverNow: (reply) => reply.serverNow,
    // a full party is asked less often than a duel, in its lobby as in its rounds
    interval: (reply) => pollInterval(reply.players.length),
  });
  if (typeof entry === 'string') {
    showMessage(statusLine(t('common.joiningMatch')));
  } else {
    accept(entry);
  }
  void getAccount().then((account) => {
    // a guest and a visitor have no setting, and an account that cannot be read is shown its chat
    chatHidden = account.ok && (account.data.account?.hideChat ?? false);
    if (!disposed && state) {
      lobby?.update(state);
      play?.update(state);
    }
  });

  return () => {
    disposed = true;
    poller.stop();
    play?.destroy();
    if (!left && state?.phase !== 'finished') {
      void leaveMatch(id);
    }
  };
}
