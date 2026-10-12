import { mapName } from '../game/locations.ts';
import { t } from '../i18n/index.ts';
import type { ImageryProvider, Place as Picture } from '../imagery/provider.ts';
import { sendGuess, sendPin, type MatchState, type Place } from '../multiplayer/client.ts';
import { versusOf, type ChatView } from '../multiplayer/match-view.ts';
import { mayGuess, pickLine, placesToLoad, secondsLeft, stageOf, type Stage } from '../multiplayer/state.ts';
import { foldedChat, type ChatHandlers } from './chat.ts';
import { el } from './dom.ts';
import type { HostHandlers } from './host-controls.ts';
import { matePins } from './mate-pins.ts';
import { hostFold, roundBar } from './match-host.ts';
import { lateJoin, type Entry } from './match-join.ts';
import { healthStrip } from './match-panels.ts';
import { matchPlaces } from './match-places.ts';
import { reactionFloats } from './match-reactions.ts';
import { placeResolver } from './match-resolver.ts';
import { showMatchEnd, showRoundResult, type EndHandlers } from './match-results.ts';
import { rosterList } from './match-roster.ts';
import { onPhone } from './match-status.ts';
import { noticePanel } from './panels.ts';
import { RoundScreen } from './round-screen.ts';
import { teamHealthStrip } from './team-health.ts';
import { versusIntro } from './versus.ts';

const TICK_MS = 250;
/** A pin that is placed but not sent goes in by itself this long before the round ends. */
const AUTO_SEND_MS = 1000;

type RoundStage = Extract<Stage, { kind: 'starting' | 'guessing' | 'waiting' | 'timeup' }>;

const startsIn = (ms: number) => t('match.roundStartsIn', { seconds: secondsLeft(ms) });

export interface MatchPlayDeps {
  providers: readonly ImageryProvider[];
  /** the server's time now, in ms: rounds start and end on its clock, not this one's */
  serverNow: () => number;
  /** hands a reply from the server back to whoever merges it with the polled state */
  report: (state: MatchState) => void;
  /** leaves the match for good and goes home */
  onLeave: () => void;
  /** how the player came in: from the public queue, or into a party under way, either of which can mean from the next round */
  entry: Entry;
  /** what the chat sends, and what it shows for a state (nothing at all for a player who has hidden chat) */
  chat: ChatHandlers;
  chatView: (state: MatchState) => ChatView;
  /** what a party's host can do: kick, hand over, lock, end the round. Offered to nobody else */
  host: HostHandlers;
  /** what the final screen offers: the way home, the same queue again, a party's way back to its lobby */
  end: EndHandlers;
}

export interface MatchPlay {
  /** Follows the match to a newer state. */
  update: (state: MatchState) => void;
  /** Says the connection is lost, with the reason; null once it is back. */
  setLost: (reason: string | null) => void;
  destroy: () => void;
}

/**
 * Follows a match on the round screen. The server owns the rounds, the clock and the scores; this
 * shows whatever state it is given and sends the player's part: the places when this client is
 * the resolver, and one guess a round.
 */
export function startMatchPlay(root: HTMLElement, first: MatchState, deps: MatchPlayDeps): MatchPlay {
  const { settings } = first;
  const screen = new RoundScreen(
    root,
    { mapName: mapName(settings.map), mode: settings.mode, counter: { label: t('label.round'), of: settings.rounds }, timed: true },
    { onGuess: () => void send(), onNext: () => {}, onExit: () => void leave(), onPin: (point) => mates.moved(state, point) },
  );
  const roster = rosterList();
  /** reactions as they are sent, floating by the roster for a moment */
  const floats = reactionFloats();
  // a duel's health is each player's own; in 2v2 it is the two teams'
  const health = first.kind === 'team' ? teamHealthStrip() : healthStrip();
  const lostBanner = el('p', { class: 'net-banner', attrs: { role: 'alert' } });
  // a phone's corner has room for one open panel: opening the chat closes the host's, and the other way round
  const chat = foldedChat(deps.chat, () => onPhone() && host.close());
  const host = hostFold(deps.host, () => onPhone() && chat.close());
  /** over a round: that it has no timer, and the host's End round */
  const bar = roundBar(deps.host.onEndRound);
  /** shown while a ranked duel's first round gets ready, and gone when the server starts it */
  const versus = versusIntro();
  const places = matchPlaces(screen, first, deps.providers);
  const late = lateJoin(screen, deps.entry, () => void leave());
  /** teammates' pins on the map, and the player's own pin on its way to them */
  const mates = matePins(screen.map, (round, pin) => void sharePin(round, pin));
  screen.view.classList.add('match');
  screen.view.classList.toggle('ranked', first.kind === 'ranked');
  screen.view.classList.toggle('has-health', first.kind === 'ranked' || first.kind === 'team');
  // the side is the rail under the HUD: a lost connection first, then what the round has to say, then who has guessed
  const side = el('div', { class: 'match-side' }, lostBanner, bar.node, el('div', { class: 'roster-slot' }, roster.node, floats.node));
  screen.view.append(health.node, side, versus.node, el('div', { class: 'match-corner' }, chat.node, host.node));

  let state = first;
  /** one picture per round once the places are known; null for a place this client cannot show */
  let pictures: ReadonlyArray<Picture | null> | null = null;
  let loading = false;
  let failed = false;
  let shownRound = -1;
  let viewReady = false;
  let viewMissing = false;
  let sentRound = -1;
  let revealedRound = -1;
  let countdown: ((seconds: number) => void) | null = null;
  let statusText = '';
  /** follows the match while its final standing is on screen; null until then */
  let ended: ((next: MatchState) => void) | null = null;
  let finished = false;
  let disposed = false;

  /** The standing status line. Only written when it changes, so it does not wipe a passing notice. */
  function status(text: string): void {
    if (text !== statusText) {
      statusText = text;
      screen.setStatus(text);
    }
  }

  /** A failure to find or post the places, with one thing to do about it beside the way home. */
  function fail(message: string, retry: { name: string; run: () => void }): void {
    failed = true;
    status('');
    screen.setPhase('loading');
    const again = () => {
      failed = false;
      screen.clearPanel();
      retry.run();
    };
    screen.showPanel(noticePanel(message, [{ name: retry.name, run: again }, { name: t('common.home'), run: deps.end.onHome }], true));
  }

  /** the resolver's job, when this client is the one: pick the places as singleplayer does, from the match's seed, and post them */
  const resolver = placeResolver({ places, match: () => state, alive: () => !disposed && !finished, status, report: deps.report, fail });

  /**
   * Everyone else's job: load the pictures for the places the resolver posted. All that the server
   * has sent, at first; then `owed`, the places it has sent since, for it may send a round's place
   * only when that round comes.
   */
  async function loadPosted(owed: readonly Place[] | null = null): Promise<void> {
    if (loading || resolver.busy) {
      return;
    }
    loading = true;
    if (owed === null && !late.waiting) {
      status(t('match.loadingPlaces'));
    }
    const loaded = owed === null ? await places.load(state.places ?? [], () => !disposed) : await places.more(owed);
    loading = false;
    if (disposed) {
      return;
    }
    pictures = owed === null ? loaded : [...(pictures ?? []), ...loaded];
    apply();
  }

  async function startRound(round: number): Promise<void> {
    shownRound = round;
    viewReady = false;
    viewMissing = false;
    countdown = null;
    screen.beginRound();
    screen.setCount(round + 1);
    roster.show(null);
    const picture = pictures?.[round] ?? null;
    if (picture && screen.hasStreet) {
      status(t('common.loadingView'));
      const shown = await screen.showPlace(picture);
      if (disposed || shownRound !== round || screen.phase !== 'guessing') {
        return;
      }
      viewMissing = !shown;
    } else {
      viewMissing = true;
    }
    viewReady = true;
    tick();
  }

  async function send(): Promise<void> {
    const round = shownRound;
    const pin = screen.pin;
    // in co-op the pin of anyone but the picker is a suggestion, and never goes in as a guess
    if (!pin || sentRound === round || !mayGuess(state) || stageOf(state, deps.serverNow()).kind !== 'guessing') {
      return;
    }
    sentRound = round;
    screen.map.setPinLocked(true);
    // the guess is what teammates see from here on
    mates.stop();
    tick();
    const reply = await sendGuess(state.id, round, pin);
    if (disposed) {
      return;
    }
    if (reply.ok) {
      deps.report(reply.data);
    } else if (shownRound === round && screen.phase === 'guessing') {
      sentRound = -1;
      screen.map.setPinLocked(false);
      screen.flashStatus(reply.error, 'error');
    }
  }

  /** Tells teammates where the pin is now. The reply is the match, with their pins in it. A pin that does not get through is only a pin: the next one, or the guess, makes up for it. */
  async function sharePin(round: number, pin: { lng: number; lat: number }): Promise<void> {
    const reply = await sendPin(state.id, round, pin);
    if (reply.ok && !disposed) {
      deps.report(reply.data);
    }
  }

  function statusFor(stage: RoundStage): string {
    if (!viewReady) {
      return t('common.loadingView');
    }
    if (stage.kind === 'starting') {
      return startsIn(stage.startsInMs);
    }
    // co-op says who places the guess for as long as there is nothing else to say
    return viewMissing ? t('match.viewMissing') : pickLine(state);
  }

  function roundTick(stage: RoundStage): void {
    const sent = sentRound === stage.round || stage.kind === 'waiting';
    // co-op: the Guess button is the picker's alone, and says so to everyone else
    const guessing = mayGuess(state) || state.picker === null ? null : t('coop.lock', { name: state.picker });
    const locks = { starting: t('match.waitForStart'), guessing, waiting: t('match.guessSent'), timeup: t('match.timeUp') };
    // the clock is the server's: what is left is read from its end of the round on every tick, and a round with no timer shows none
    screen.setClock(stage.kind === 'timeup' ? 0 : stage.msLeft === null ? null : secondsLeft(stage.msLeft));
    screen.lockGuess(sent ? t('match.guessSent') : locks[stage.kind]);
    status(statusFor(stage));
    roster.show(sent ? state : null);
    if (stage.kind === 'guessing' && stage.msLeft !== null && stage.msLeft <= AUTO_SEND_MS && screen.pin) {
      void send();
    }
  }

  function tick(): void {
    if (disposed || finished) {
      return;
    }
    const stage = stageOf(state, deps.serverNow());
    // the intro lasts exactly as long as the server's get-ready: it has no clock of its own. It stands over the middle of
    // the screen, where the status line counts the get-ready down, so it is handed the count to show in sight
    versus.show(versusOf(state, stage), stage.kind === 'starting' ? startsIn(stage.startsInMs) : '');
    const inRound = 'round' in stage && stage.kind !== 'reveal' && stage.round === shownRound && screen.phase === 'guessing';
    bar.update(state, inRound ? stage : null, deps.serverNow());
    if (stage.kind === 'reveal') {
      countdown?.(secondsLeft(stage.msLeft));
    } else if (inRound) {
      roundTick(stage);
    }
  }

  function showReveal(round: number): void {
    if (revealedRound === round) {
      return;
    }
    revealedRound = round;
    shownRound = round;
    roster.show(null);
    status('');
    health.update(state, round);
    countdown = showRoundResult(screen, state, round, () => void leave());
  }

  /** Leaving a match that is still running forfeits it, so it asks first. */
  async function leave(): Promise<void> {
    if (finished || (await screen.confirm(t('match.leaveConfirm'), t('common.leaveMatch'), t('match.stay')))) {
      deps.onLeave();
    }
  }

  function showFinal(cancelled: boolean): void {
    finished = true;
    health.update(state, null);
    clearInterval(ticker);
    roster.show(null);
    versus.show(null);
    bar.update(state, null, deps.serverNow());
    status('');
    ended = showMatchEnd(screen, state, cancelled, deps.end);
  }

  /** Brings the screen in line with the current state. Safe to call as often as states arrive. */
  function apply(): void {
    if (disposed || finished) {
      return;
    }
    const stage = stageOf(state, deps.serverNow());
    if (stage.kind === 'finished') {
      showFinal(stage.cancelled);
    } else if (stage.kind === 'preparing') {
      if (stage.resolve && !failed) {
        void resolver.run();
      } else if (!loading && !resolver.busy && !failed) {
        status(t('match.waitingForPlaces'));
      }
    } else if (stage.kind !== 'lobby') {
      if (failed) {
        // the match went on regardless (a post can succeed although its reply was lost)
        failed = false;
        screen.clearPanel();
      }
      pictures ??= resolver.pictures();
      const joining = late.check(state, stage, deps.serverNow(), () => status(''));
      if (!pictures) {
        void loadPosted();
      } else if (joining) {
        return;
      } else if (stage.kind === 'reveal') {
        showReveal(stage.round);
      } else if (stage.round !== shownRound) {
        // the resolver drew every round itself; everyone else may still be owed this round's place
        const owed = resolver.drew ? [] : placesToLoad(state.places, pictures.length, stage.round);
        void (owed.length > 0 ? loadPosted(owed) : startRound(stage.round));
      }
      tick();
    }
  }

  const ticker = window.setInterval(tick, TICK_MS);

  return {
    update: (next) => {
      state = next;
      const said = deps.chatView(state);
      chat.update(said);
      floats.update(said);
      // the host's controls follow the party as it changes hands: the new host has them on the next state, the old one loses them
      host.update(state);
      screen.view.classList.toggle('hosting', !host.node.hidden);
      mates.update(state);
      if (!finished && state.phase !== 'reveal') {
        health.update(state, null);
      }
      ended?.(state);
      apply();
    },
    setLost: (reason) => {
      lostBanner.textContent = reason === null ? '' : t('common.connectionLost', { error: reason });
    },
    destroy: () => {
      disposed = true;
      clearInterval(ticker);
      mates.stop();
      floats.destroy();
      screen.destroy();
    },
  };
}
