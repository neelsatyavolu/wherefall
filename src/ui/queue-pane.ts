import './queue.css';
import { REFUSALS } from '../account/client.ts';
import { t, tn } from '../i18n/index.ts';
import { getQueue, joinQueue, leaveQueue, type MatchState, type QueueKind, type QueueState } from '../multiplayer/client.ts';
import { abortable, startPolling, type Poller } from '../multiplayer/poll.ts';
import { isQueuedAlready, lockSeconds, readQueueEntry, typicalWait, waitedSeconds, type QueueReason } from '../multiplayer/queue-view.ts';
import { msUntil, secondsLeft } from '../multiplayer/state.ts';
import { el, formatScore } from './dom.ts';
import { leagueName } from './league.ts';
import { navName } from './nav.ts';
import { accountOnly, errorLine, factLine, guestsWelcome, statusLine, type GateTools, type Pane, type Who } from './pane.ts';
import { clock } from './round-timer.ts';
import { sounds } from './sound.ts';

/** Called with a match to enter: its state when the server already sent it, otherwise its id. */
export type EnterMatch = (match: MatchState | string) => void;

const TICK_MS = 250;

interface QueueOptions {
  kind: QueueKind;
  onMatch: EnterMatch;
  /** why the player arrives already on their way into the queue, or null when they just opened the pane */
  entry: QueueReason | null;
  tools: GateTools;
}

/** The lines of the waiting screen. Each is written only when it changes, so nothing flickers between ticks. */
function waitingLines() {
  const status = el('p', { class: 'queue-status', attrs: { role: 'status' } });
  const waiting = el('p', { class: 'queue-waiting' });
  // not live regions: a time that changes every second would be read out every second
  const waited = el('p', { class: 'queue-waiting queue-waited' });
  const reach = el('p', { class: 'queue-waiting queue-window' });
  const typical = el('p', { class: 'queue-waiting queue-typical' });
  const write = (node: HTMLElement, text: string) => {
    if (node.textContent !== text) {
      node.textContent = text;
    }
  };
  return {
    nodes: [status, waiting, waited, typical, reach],
    isShown: () => status.isConnected,
    /** `queue` is null until the server has said where the player stands. */
    draw(queue: QueueState | null, serverNowMs: number): void {
      const text = queue?.startsAt ? t('queue.startingIn', { seconds: secondsLeft(msUntil(queue.startsAt, serverNowMs)) }) : t('queue.looking');
      if (status.firstChild?.textContent !== text) {
        status.replaceChildren(text, el('span', { class: 'caret', attrs: { 'aria-hidden': 'true' } }));
      }
      write(waiting, queue ? tn('queue.waiting', queue.waiting) : '');
      write(waited, queue?.since ? t('queue.waited', { time: clock(waitedSeconds(queue.since, serverNowMs)) }) : '');
      // ranked: how far from the player's own rating an opponent may be, which widens as the wait goes on
      const points = queue?.window ?? null;
      write(reach, points === null ? '' : t('queue.window', { points: formatScore(points) }));
      // how long players of this queue waited for a match over the last day; the server names no time for a queue it was not asked about
      write(typical, queue && queue.kind !== null ? t('queue.typical', { wait: typicalWait(queue.typicalWaitSeconds) }) : '');
    },
  };
}

function queueBody({ kind, onMatch, entry, tools }: QueueOptions): Pane {
  const body = el('div', { class: 'queue' });
  const note = errorLine();
  /** why the player is in the queue without asking: the other player left a ranked duel before it began, or their party's host queued the two of them for 2v2 */
  const notice = el('p', { class: 'prose queue-notice', attrs: { role: 'status' } });
  const lock = el('p', { class: 'prose queue-lock' });
  const lines = waitingLines();
  let poller: Poller | null = null;
  let ticker: number | undefined;
  let current: QueueState | null = null;
  /** the server's clock less this one's, from the last reply, until the poller has measured it better */
  let offsetMs = 0;
  let polled = false;
  let lockedUntil: string | null = null;
  let queued = false;
  let disposed = false;

  const now = () => (polled && poller ? poller.serverNow() : Date.now() + offsetMs);

  const sync = (queue: QueueState) => {
    const server = Date.parse(queue.serverNow);
    offsetMs = Number.isNaN(server) ? offsetMs : server - Date.now();
  };

  const stopPolling = () => {
    poller?.stop();
    poller = null;
    polled = false;
    clearInterval(ticker);
    ticker = undefined;
  };

  function showIdle(message = ''): void {
    stopPolling();
    queued = false;
    lockedUntil = null;
    note.textContent = message;
    notice.textContent = '';
    body.replaceChildren(el('button', { class: 'button accent', text: t('queue.find'), attrs: { type: 'button' }, on: { click: () => void find() } }), note);
  }

  /** The lock a second early exit within the hour brings: no way into the queue until it has run down. */
  function drawLock(): void {
    const seconds = lockSeconds(lockedUntil, now());
    if (seconds === 0) {
      showIdle();
      return;
    }
    const text = t('queue.locked', { time: clock(seconds) });
    if (lock.textContent !== text) {
      lock.textContent = text;
    }
  }

  function showLocked(until: string): void {
    stopPolling();
    queued = false;
    lockedUntil = until;
    note.textContent = '';
    body.replaceChildren(lock, note);
    drawLock();
    if (lockedUntil !== null) {
      ticker = window.setInterval(drawLock, TICK_MS);
    }
  }

  function showSearching(): void {
    lines.draw(current, now());
    if (!lines.isShown()) {
      const cancelButton = el('button', { class: 'button ghost', text: t('common.cancel'), attrs: { type: 'button' }, on: { click: () => void cancel() } });
      body.replaceChildren(notice, ...lines.nodes, cancelButton, note);
    }
  }

  function onQueue(queue: QueueState): void {
    sync(queue);
    note.textContent = '';
    if (queue.matchId !== null) {
      stopPolling();
      queued = false;
      sounds.play('match');
      onMatch(queue.matchId);
    } else if (!queue.queued) {
      showIdle(t('queue.ranOut'));
    } else {
      current = queue;
      showSearching();
    }
  }

  /** Polls the queue the player is in. It goes on through a countdown: the game starts on the first poll at or after its end. */
  function watch(): void {
    queued = true;
    poller = startPolling({
      load: async (signal) => {
        const reply = await getQueue(abortable(signal));
        if (!reply.ok && reply.error === REFUSALS.signIn && !disposed) {
          over();
        }
        return reply;
      },
      onData: (queue) => {
        polled = true;
        onQueue(queue);
      },
      onLost: (error) => (note.textContent = t('common.connectionLost', { error })),
      serverNow: (queue) => queue.serverNow,
    });
    ticker = window.setInterval(() => lines.draw(current, now()), TICK_MS);
  }

  /** The session ran out (a guest's lasts a day): the pane closes and says how to go on. */
  function over(): void {
    stopPolling();
    queued = false;
    tools.ended();
  }

  /** A ranked player may be locked out for a while: the lock is shown, counting down, in place of the button. */
  async function lockedOut(): Promise<boolean> {
    if (kind !== 'ranked') {
      return false;
    }
    const state = await getQueue();
    if (disposed || !state.ok) {
      return false;
    }
    sync(state.data);
    const until = state.data.lockedUntil;
    if (until === null || lockSeconds(until, now()) === 0) {
      return false;
    }
    showLocked(until);
    return true;
  }

  async function find(): Promise<void> {
    body.replaceChildren(statusLine(t('queue.joining')));
    const joined = await joinQueue(kind);
    if (disposed) {
      // the player moved on while the request was out: do not leave them queued
      if (joined.ok) {
        void leaveQueue();
      }
      return;
    }
    if (!joined.ok) {
      if (joined.error === REFUSALS.signIn) {
        over();
      } else if (!(await lockedOut()) && !disposed) {
        showIdle(joined.error);
      }
      return;
    }
    current = null;
    queued = true;
    onQueue(joined.data);
    if (queued) {
      watch();
    }
  }

  async function cancel(): Promise<void> {
    stopPolling();
    queued = false;
    const left = await leaveQueue();
    if (!disposed) {
      showIdle(left.ok ? '' : left.error);
    }
  }

  /** What the pane opens on: the wait for a player the server has already queued, a search they asked for, the lock, or the button. */
  async function begin(): Promise<void> {
    if (isQueuedAlready(entry)) {
      // the server has put the player in this queue itself: nothing is asked of it, the wait is only watched
      notice.textContent = t(entry === 'pair' ? 'party.pair.queued' : 'queue.dodged');
      watch();
      showSearching();
      return;
    }
    if (kind === 'ranked') {
      body.replaceChildren(statusLine(t('pane.checkingAccount')));
      if ((await lockedOut()) || disposed) {
        return;
      }
    }
    if (entry === 'again' || tools.fresh) {
      await find();
    } else {
      showIdle();
    }
  }

  void begin();

  return {
    node: body,
    dispose: () => {
      disposed = true;
      stopPolling();
      if (queued) {
        void leaveQueue();
      }
    },
  };
}

/** Reads why the player was sent to this pane, once: a reload must not send them into the queue again. */
function takeEntry(kind: QueueKind): QueueReason | null {
  const entry = readQueueEntry(history.state, kind);
  if (entry !== null) {
    history.replaceState(null, '', location.href);
  }
  return entry;
}

/**
 * Matchmaking for one kind: what it is, a button to start looking, and the wait until matched. A
 * guest can play public unranked games; the other kinds need an account. `onSession` is called
 * when a visitor becomes a guest here.
 */
export function queuePane(kind: QueueKind, onMatch: EnterMatch, onSession?: () => void): Pane {
  const entry = takeEntry(kind);
  // the settings in the facts line are fixed by the server and repeated here to show them
  const facts = kind === 'ranked' ? [t('queue.ranked.facts'), t('queue.ranked.xp')] : [t(`queue.${kind}.facts`)];
  const gate = { title: navName(kind), lede: t(`queue.${kind}.lede`), facts, what: t('match.multiplayer') };
  const build = (who: Who, tools: GateTools): Pane => {
    const queue = queueBody({ kind, onMatch, entry, tools });
    const rating = kind === 'ranked' && who.account ? factLine([t('queue.yourRating', { rating: formatScore(who.account.rating) }), leagueName(who.account.league)].join(' · ')) : null;
    return { node: el('div', { class: 'pane-stack' }, rating, queue.node), dispose: queue.dispose };
  };
  return kind === 'unranked' ? guestsWelcome(gate, build, onSession) : accountOnly(gate, (account, tools) => build({ account, guest: null }, tools));
}
