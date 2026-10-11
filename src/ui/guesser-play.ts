import './guesser.css';
import {
  GUESSER_ROUNDS,
  correctCount,
  drawRun,
  isOver,
  judge,
  listedCountries,
  newRun,
  optionsFor,
  scoreOf,
  type GuesserAnswer,
  type GuesserKind,
} from '../game/guesser.ts';
import type { RunRound } from '../account/runs.ts';
import type { Location } from '../game/locations.ts';
import { MAX_ROUND_SCORE } from '../game/scoring.ts';
import type { RoundResult } from '../game/session.ts';
import { t } from '../i18n/index.ts';
import type { ImageryProvider, Place } from '../imagery/provider.ts';
import { answerPanel, guesserSummary, type AnswerPanel } from './guesser-panels.ts';
import { noticePanel } from './panels.ts';
import { RoundScreen } from './round-screen.ts';
import { sounds } from './sound.ts';
import type { SaveNote } from './status.ts';

export interface GuesserOptions {
  kind: GuesserKind;
  seed: string;
  /** the places this browser has shown before, which the run steers clear of */
  seen: ReadonlySet<string>;
}

interface GuesserHandlers {
  onHome: () => void;
  onPlayAgain: () => void;
  /** called once, when the tenth answer is in, with the place and the pick of every round, which is what the server counts; resolves to a note about the saved score */
  onFinished: (correct: number, rounds: readonly RunRound[]) => Promise<SaveNote>;
}

interface Round {
  /** where in the run's list of places this one is */
  index: number;
  location: Location;
  picture: Place;
}

type Action = { name: string; run: () => void };

/** The next place in the list whose picture still exists, or null when the list has run out. */
async function nextRound(provider: ImageryProvider, places: readonly Location[], from: number): Promise<Round | null> {
  for (let index = from; index < places.length; index += 1) {
    const location = places[index]!;
    try {
      return { index, location, picture: await provider.resolve(location) };
    } catch (error) {
      if (!provider.isGone(error)) {
        throw error;
      }
    }
  }
  return null;
}

/** An answer as the guess map draws a result: the place alone, since no pin was put down. */
const onMap = (answer: GuesserAnswer): RoundResult => ({ location: answer.place, guess: null, distanceKm: null, score: 0, hinted: false });

/**
 * Runs a Country Guesser or a Continent Guesser on the round screen: ten places, and under each
 * view six buttons in place of the guess map. One press is the answer; the map then shows where
 * the place was. Returns a function that tears it down.
 */
export function startGuesser(root: HTMLElement, options: GuesserOptions, providers: readonly ImageryProvider[], handlers: GuesserHandlers): () => void {
  const screen = new RoundScreen(
    root,
    { mapName: t('map.world'), mode: 'move', counter: { label: t('label.round'), of: GUESSER_ROUNDS }, timed: false },
    { onGuess: () => {}, onNext: () => void next(), onExit: () => void exit() },
  );
  // the guess map has no part in a round here: `guesser.css` keeps it away until the answer is in, and stands the buttons where it would be
  screen.view.classList.add('guesser');

  let provider: ImageryProvider | null = null;
  let places: readonly Location[] = [];
  /** the countries the list in use has, which the wrong buttons are taken from first */
  let listed: readonly string[] = [];
  let round: Round | null = null;
  /** the place after this one, being fetched while the player looks at the current one */
  let upcoming: Promise<Round | null> = Promise.resolve(null);
  let run = newRun(options.kind);
  let panel: AnswerPanel | null = null;
  let saveNote: Promise<SaveNote> = Promise.resolve('');
  /** true while the next place is being brought up, so a second press of Next does nothing */
  let moving = false;
  let disposed = false;

  async function show(shown: Round): Promise<void> {
    round = shown;
    panel = null;
    const isLast = run.answers.length + 1 >= GUESSER_ROUNDS;
    upcoming = provider && !isLast ? nextRound(provider, places, shown.index + 1).catch(() => null) : Promise.resolve(null);
    screen.beginRound();
    screen.setCount(run.answers.length + 1);
    screen.setScore(scoreOf(run));
    // the buttons are there from the start, so the view is one size while its picture loads and after; they take presses once it has
    const answers = answerPanel(options.kind, optionsFor(options.kind, shown.location, listed, options.seed, run.answers.length), pick, () => void next());
    panel = answers;
    screen.showPanel(answers.node);
    screen.setStatus(t('common.loadingView'));
    const loaded = await screen.showPlace(shown.picture);
    if (disposed || round !== shown || screen.phase !== 'guessing') {
      return;
    }
    if (!loaded) {
      fail(t('play.viewFailed'), [
        { name: t('common.tryAgain'), run: () => void show(shown) },
        { name: t('play.skipPlace'), run: () => void following() },
      ]);
      return;
    }
    screen.setStatus('');
    answers.enable();
  }

  /** The round's one answer: judged at once, the right button marked, and the place shown on the map. */
  function pick(option: string): void {
    if (screen.phase !== 'guessing' || !round || !panel) {
      return;
    }
    run = judge(run, { ...round.location, lng: round.picture.lng, lat: round.picture.lat }, option);
    const answer = run.answers.at(-1)!;
    sounds.play('result', answer.correct ? MAX_ROUND_SCORE : 0);
    screen.setScore(scoreOf(run));
    screen.setPhase('result');
    panel.reveal(answer, isOver(run));
    screen.map.showResult(onMap(answer), screen.showPanel(panel.node));
    panel.focusNext();
    if (isOver(run)) {
      saveNote = handlers
        .onFinished(
          correctCount(run),
          run.answers.map((each) => ({ id: each.place.id, answer: each.picked })),
        )
        .catch(() => '');
    }
  }

  async function next(): Promise<void> {
    if (screen.phase !== 'result' || moving) {
      return;
    }
    if (isOver(run)) {
      finish();
      return;
    }
    moving = true;
    await following();
    moving = false;
  }

  /** Brings up the place after the current one: the one fetched ahead, or a fresh try at it. */
  async function following(): Promise<void> {
    const current = round;
    screen.clearPanel();
    screen.setStatus(t('common.loadingView'));
    const ready = await upcoming;
    const found = ready ?? (provider && current ? await nextRound(provider, places, current.index + 1).catch(() => null) : null);
    if (disposed) {
      return;
    }
    if (found) {
      await show(found);
    } else if (current && current.index + 1 >= places.length) {
      fail(t('guesser.outOfPlaces'), []);
    } else {
      fail(t('streakPlay.nextFailed'), [{ name: t('common.tryAgain'), run: () => void following() }]);
    }
  }

  function finish(): void {
    screen.setPhase('summary');
    screen.setStatus('');
    const padding = screen.showPanel(guesserSummary(run, saveNote, handlers));
    screen.map.showSummary(run.answers.map(onMap), padding);
  }

  /** Leaving a run that is under way asks first: a score is only kept for all ten rounds. */
  async function exit(): Promise<void> {
    const underWay = run.answers.length > 0 && !isOver(run);
    if (!underWay || (await screen.confirm(t('play.leaveConfirm'), t('play.leave'), t('play.keepPlaying')))) {
      handlers.onHome();
    }
  }

  /** A notice over the screen: what failed, what can be tried, and the way out last, always. */
  function fail(message: string, actions: Action[]): void {
    screen.setStatus('');
    screen.setPhase('loading');
    screen.showPanel(noticePanel(message, [...actions, { name: t('round.exit'), run: handlers.onHome }], true));
  }

  /** Draws the run from the first source that has ten places for it and can show the first. */
  const open = () =>
    screen.openStreet(providers, async (candidate) => {
      const { locations } = await candidate.places();
      const order = drawRun(options.kind, locations, options.seed, options.seen);
      const first = order.length >= GUESSER_ROUNDS ? await nextRound(candidate, order, 0) : null;
      if (!first) {
        throw new Error('This source has too few places for a run');
      }
      return { provider: candidate, places: order, listed: listedCountries(locations), first };
    });

  async function begin(): Promise<void> {
    screen.clearPanel();
    screen.setPhase('loading');
    screen.setStatus(t('common.findingPlaces'));
    const started = await open();
    if (disposed) {
      return;
    }
    if (!started) {
      fail(t('load.failed'), [{ name: t('common.tryAgain'), run: () => void begin() }]);
      return;
    }
    provider = started.provider;
    places = started.places;
    listed = started.listed;
    await show(started.first);
  }

  void begin();

  return () => {
    disposed = true;
    screen.destroy();
  };
}
