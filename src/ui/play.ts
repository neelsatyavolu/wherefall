import { hintCircle, hintsLeft } from '../game/hint.ts';
import { communitySlugOf, mapName, type LocationSet } from '../game/locations.ts';
import { earnsConfetti } from '../game/marks.ts';
import type { ResolvedRound } from '../game/rounds.ts';
import { createRng } from '../game/rng.ts';
import { createSession, hintsUsed, isComplete, replaceRound, submitGuess, totalScore, type Session } from '../game/session.ts';
import { toSearch, type Challenge } from '../game/settings.ts';
import { loadGamePlaces, type GamePlaces } from '../imagery/game-places.ts';
import type { ImageryProvider, Place } from '../imagery/provider.ts';
import { countPlay, getMap, toLocationSet } from '../social/maps.ts';
import { t, tn } from '../i18n/index.ts';
import { confettiBurst } from './confetti.ts';
import type { DailyGame } from './daily-game.ts';
import type { FitPadding } from './guess-map.ts';
import { communityUnavailable, noticePanel, resultPanel, summaryPanel } from './panels.ts';
import { RoundScreen, homeBounds } from './round-screen.ts';
import { sounds } from './sound.ts';
import type { SaveNote } from './status.ts';
import { TUTORIAL_ROUNDS, createCoach, tutorialFact, tutorialPlaces, tutorialWays, type Coach, type TutorialEnd } from './tutorial.ts';
import { trackWorldStreak, type StreakRuns } from './world-streak.ts';

const TICK_MS = 250;
/** how far under the tutorial's tip a pin keeps: half a pin, and a little air */
const COACH_GAP = 24;

interface PlayHandlers {
  onHome: () => void;
  onPlayAgain: () => void;
  /** called once, when the last round has been scored; resolves to a note about saved stats */
  onFinished: (session: Session) => Promise<SaveNote>;
  /** set for the daily challenge: played without hints, on its own draw of places, once, with its own text to share */
  daily?: Pick<DailyGame, 'places' | 'shareText' | 'extras'>;
  /**
   * How the country streak a world game keeps in the background is a run on the server. Left out,
   * no streak is counted.
   */
  streakRuns?: StreakRuns;
  /** set for the tutorial: its summary ends on the ways into the game, in place of Play again and Home */
  tutorialEnd?: TutorialEnd;
}

type Action = { name: string; run: () => void };

/**
 * Runs one local game on the round screen, on the first imagery provider that can serve it from
 * its own list of places: the places, the clock and the scoring all live in this browser. Returns
 * a function that tears it down.
 */
export function startPlay(
  root: HTMLElement,
  challenge: Challenge,
  providers: readonly ImageryProvider[],
  handlers: PlayHandlers,
  /** true plays the tutorial: its own two places, a coach, and nothing saved */
  tutorial = false,
): () => void {
  const coach: Coach | null = tutorial ? createCoach(challenge.mode) : null;
  const screen = new RoundScreen(
    root,
    {
      mapName: mapName(challenge.map),
      mode: challenge.mode,
      counter: { label: t('label.round'), of: tutorial ? TUTORIAL_ROUNDS : challenge.rounds },
      timed: challenge.timeLimit !== 0,
      // two hints a game; none in the daily, and the tutorial does not teach them
      hint: !tutorial && !handlers.daily,
    },
    {
      onGuess: finishRound,
      onNext: next,
      onExit: () => void exit(),
      onHint: showHint,
      onPin: () => coach?.event('pinned'),
      onLook: () => coach?.event('looked'),
      onMove: () => coach?.event('moved'),
      onMapOpen: () => coach?.event('mapOpened'),
    },
  );
  if (coach) {
    screen.view.append(coach.node);
  }

  const slug = communitySlugOf(challenge.map);
  // the country streak in the background is the world map's alone: not the daily's, the tutorial's, a country's or a community map's
  const streak = handlers.streakRuns && challenge.map === 'world' && !tutorial && !handlers.daily ? trackWorldStreak(handlers.streakRuns) : null;
  /** a community map's own places, once fetched */
  let community: LocationSet | null = null;
  let rounds: ResolvedRound<Place>[] = [];
  /** hands out a stand-in for a place whose picture will not load */
  let takeSpare: GamePlaces['takeSpare'] = async () => null;
  let session: Session | null = null;
  /** true once the hint was asked for in the round being played */
  let hinted = false;
  /** when the round being played began, restarted once its view has loaded: what a round's time is counted from */
  let roundBegan = 0;
  /** what the map is called: a community map's own name once it is known */
  let playedOn = mapName(challenge.map);
  let deadline = 0;
  let ticker: number | undefined;
  let saveNote: Promise<SaveNote> = Promise.resolve('');
  let disposed = false;

  function stopTimer(): void {
    clearInterval(ticker);
    ticker = undefined;
  }

  function tick(): void {
    const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    screen.setClock(remaining);
    if (remaining === 0) {
      finishRound();
    }
  }

  function startTimer(): void {
    stopTimer();
    if (challenge.timeLimit === 0) {
      return;
    }
    deadline = performance.now() + challenge.timeLimit * 1000;
    tick();
    ticker = window.setInterval(tick, TICK_MS);
  }

  function updateHud(): void {
    if (!session) {
      return;
    }
    const shown = Math.min(session.results.length + (screen.phase === 'guessing' ? 1 : 0), session.rounds.length);
    screen.setCount(Math.max(1, shown));
    screen.setScore(totalScore(session));
  }

  async function startRound(): Promise<void> {
    const roundIndex = session?.results.length ?? 0;
    const round = rounds[roundIndex];
    if (!session || !round || !screen.hasStreet) {
      return;
    }
    hinted = false;
    roundBegan = performance.now();
    screen.beginRound();
    screen.setHintsLeft(hintsLeft(hintsUsed(session)));
    updateHud();
    screen.setStatus(t('common.loadingView'));
    const loaded = await screen.showPlace(round.pano);
    // the map is live while the view loads, so the player may already have guessed and moved on
    const stillThisRound = !disposed && screen.phase === 'guessing' && session?.results.length === roundIndex;
    if (!stillThisRound) {
      return;
    }
    if (!loaded) {
      showFailure(t('play.viewFailed'), [
        { name: t('common.tryAgain'), run: () => void startRound() },
        { name: t('play.skipPlace'), run: () => void skip() },
      ]);
      return;
    }
    screen.setStatus('');
    roundBegan = performance.now();
    startTimer();
  }

  /**
   * Swaps the place whose picture will not load for the next spare. The lost place scores nothing
   * and the game keeps its number of rounds. With no spare left it says so, and the way out is Exit.
   */
  async function skip(): Promise<void> {
    if (!session) {
      return;
    }
    const roundIndex = session.results.length;
    screen.clearPanel();
    screen.setStatus(t('play.findingAnother'));
    const spare = await takeSpare().catch(() => null);
    if (disposed || !session || session.results.length !== roundIndex) {
      return;
    }
    if (!spare) {
      showFailure(t('play.noSpare'), [{ name: t('common.tryAgain'), run: () => void startRound() }]);
      return;
    }
    rounds = rounds.map((round, index) => (index === roundIndex ? spare : round));
    session = replaceRound(session, roundIndex, { ...spare.location, lng: spare.pano.lng, lat: spare.pano.lat });
    await startRound();
  }

  /**
   * The map's padding over a result with the tutorial's tip cleared too: the tip stands under the
   * HUD, over the map, where the place or the guess could otherwise be drawn under it.
   */
  function clearOfCoach(padding: FitPadding): FitPadding {
    const tip = coach?.node.getBoundingClientRect();
    return tip && tip.height > 0 ? { ...padding, top: Math.max(padding.top ?? 0, tip.bottom + COACH_GAP) } : padding;
  }

  function finishRound(): void {
    if (screen.phase !== 'guessing' || !session) {
      return;
    }
    stopTimer();
    const roundIndex = session.results.length;
    session = submitGuess(session, screen.pin, hinted, performance.now() - roundBegan);
    const result = session.results[roundIndex]!;
    sounds.play('result', result.score);
    if (earnsConfetti(result.score)) {
      confettiBurst(screen.view);
    }
    coach?.event('guessed');
    screen.setPhase('result');
    screen.setStatus('');
    // the clock has stopped: it is out of the HUD until the next round starts it again
    screen.setClock(null);
    updateHud();
    const panel = resultPanel(result, rounds[roundIndex]!.pano.credit, isComplete(session), next, streak?.round(result), tutorial ? tutorialFact(roundIndex) : undefined);
    screen.map.showResult(result, clearOfCoach(screen.showPanel(panel)));
    panel.querySelector('button')?.focus();
    if (isComplete(session)) {
      saveNote = handlers.onFinished(session).catch(() => '');
    }
  }

  function next(): void {
    if (screen.phase !== 'result' || !session) {
      return;
    }
    coach?.event('nextRound');
    if (!isComplete(session)) {
      void startRound();
      return;
    }
    screen.setPhase('summary');
    const played = session;
    const daily = handlers.daily;
    const panel = summaryPanel(session, {
      ...(daily ? { daily: { shareText: () => daily.shareText(played), extras: daily.extras(played) } } : {}),
      onPlayAgain: handlers.onPlayAgain,
      onHome: handlers.onHome,
      challengeUrl: `${location.origin}${location.pathname}${toSearch(challenge)}`,
      mapName: playedOn,
      // rounds earn XP on the official maps only, and the tutorial is never saved
      xp: !tutorial && slug === null,
      saveNote,
      ...(tutorial && handlers.tutorialEnd ? { ways: tutorialWays(handlers.tutorialEnd) } : {}),
    });
    screen.map.showSummary(session.results, screen.showPanel(panel));
  }

  /** Draws a circle that contains the place. The round then scores half, and the game has one hint fewer. */
  function showHint(): void {
    const place = session?.rounds[session.results.length];
    if (screen.phase !== 'guessing' || !session || !place || hinted || hintsLeft(hintsUsed(session)) === 0) {
      return;
    }
    hinted = true;
    screen.setHintUsed(true);
    screen.setHintsLeft(hintsLeft(hintsUsed(session) + 1));
    screen.map.showHint(hintCircle(place, session.scaleKm, createRng(`${challenge.seed}:hint:${session.results.length}`)));
  }

  /** Leaving a game that is under way asks first: its rounds are not saved until the last one. */
  async function exit(): Promise<void> {
    const underWay = session !== null && !isComplete(session);
    if (!underWay || (await screen.confirm(handlers.daily ? t('daily.leaveConfirm') : t('play.leaveConfirm'), t('play.leave'), t('play.keepPlaying')))) {
      handlers.onHome();
    }
  }

  /** A notice over the screen. Trying again comes first; the way out comes last, always. */
  function showFailure(message: string, actions: Action[] = [{ name: t('common.tryAgain'), run: () => void begin() }]): void {
    stopTimer();
    screen.setStatus('');
    screen.setPhase('loading');
    screen.showPanel(noticePanel(message, [...actions, { name: t('round.exit'), run: handlers.onHome }], true));
  }

  /** Fetches a community map's places. False, with the reason on screen, when it cannot be played. */
  async function loadCommunity(mapSlug: string): Promise<boolean> {
    const map = await getMap(mapSlug);
    if (disposed) {
      return false;
    }
    if (!map.ok) {
      showFailure(map.error);
      return false;
    }
    screen.setMapName(map.data.name);
    playedOn = map.data.name;
    if (map.data.locations.length < challenge.rounds) {
      showFailure(tn('play.tooFewPlaces', map.data.locations.length, { name: map.data.name, rounds: challenge.rounds }));
      return false;
    }
    community = toLocationSet(map.data);
    return true;
  }

  async function begin(): Promise<void> {
    screen.clearPanel();
    screen.setPhase('loading');
    screen.setStatus(t('common.findingPlaces'));
    if (slug !== null && !community && !(await loadCommunity(slug))) {
      return;
    }
    const places = await screen.openStreet(providers, (provider) =>
      tutorial
        ? tutorialPlaces(provider)
        : handlers.daily
          ? handlers.daily.places(provider)
          : loadGamePlaces(provider, challenge.map, challenge.seed, challenge.rounds, community ?? undefined),
    );
    if (disposed) {
      return;
    }
    if (!places) {
      showFailure(slug === null ? t('load.failed') : communityUnavailable());
      return;
    }
    if (slug !== null) {
      // one play is counted as the game starts; the server sees to it that a player counts once an hour
      void countPlay(slug);
    }
    rounds = places.rounds;
    takeSpare = places.takeSpare;
    screen.map.setHome(homeBounds(challenge.map, places.locations));
    // score against where the picture really is, which can be a little off the listed coordinate
    session = createSession(
      rounds.map(({ location, pano }) => ({ ...location, lng: pano.lng, lat: pano.lat })),
      places.scaleKm,
    );
    await startRound();
  }

  void begin();

  return () => {
    disposed = true;
    stopTimer();
    screen.destroy();
  };
}
