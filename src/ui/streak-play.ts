import type { RunRound } from '../account/runs.ts';
import type { LngLat } from '../game/geo.ts';
import { countryName, pickRounds, type Location } from '../game/locations.ts';
import { SPARE_ROUNDS } from '../game/rounds.ts';
import type { Mode, TimeLimit } from '../game/settings.ts';
import { MAX_STREAK, judge, newRun, type StreakRun } from '../game/streak.ts';
import { t, tn } from '../i18n/index.ts';
import type { ImageryProvider, Place } from '../imagery/provider.ts';
import { loadCountryFinder } from './country-finder.ts';
import { el } from './dom.ts';
import { figure, noticePanel, panelActions, placeLink } from './panels.ts';
import { RoundScreen } from './round-screen.ts';
import { saveNoteLine, type SaveNote } from './status.ts';

const TICK_MS = 250;
/** How long a right answer stays on screen before the next place takes over, so it can be read. */
const CORRECT_MS = 1200;

export interface StreakOptions {
  mode: Mode;
  /** seconds per round, 0 for no limit */
  timeLimit: TimeLimit;
  seed: string;
}

interface StreakHandlers {
  onHome: () => void;
  onPlayAgain: () => void;
  /**
   * Called once when a run with at least one right answer ends, with every round played (the losing
   * one last), which is what the server counts the streak from; resolves to a note about the saved best.
   */
  onFinished: (streak: number, rounds: readonly RunRound[]) => Promise<SaveNote>;
}

interface Round {
  /** where in the run's list of places this one is */
  index: number;
  location: Location;
  picture: Place;
}

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

function overPanel(run: StreakRun, place: Location, saveNote: Promise<SaveNote>, handlers: StreakHandlers): HTMLElement {
  const answer = run.answer ? countryName(run.answer) : '';
  const story =
    run.guessed === run.answer
      ? t('streakPlay.unbeaten', { streak: run.streak })
      : run.guessed
        ? t('streakPlay.wrong', { answer, guess: countryName(run.guessed) })
        : t('streakPlay.noPick', { answer });
  return el(
    'section',
    { class: 'panel summary-panel', attrs: { 'aria-label': t('streakPlay.overLabel') } },
    figure(t('label.streak'), String(run.streak), ` ${tn('streakPlay.countries', run.streak)}`),
    el('p', { class: 'prose story', text: story }),
    placeLink(place),
    saveNoteLine(saveNote),
    panelActions(
      el('button', { class: 'button accent', text: t('play.again'), attrs: { type: 'button' }, on: { click: handlers.onPlayAgain } }),
      el('button', { class: 'button ghost', text: t('common.home'), attrs: { type: 'button' }, on: { click: handlers.onHome } }),
    ),
  );
}

/**
 * Runs a country streak on the round screen: one place after another on the world map, and each
 * round the player picks the country it is in. The right country adds one; anything else ends the
 * run. Returns a function that tears it down.
 */
export function startStreak(root: HTMLElement, options: StreakOptions, providers: readonly ImageryProvider[], handlers: StreakHandlers): () => void {
  const screen = new RoundScreen(
    root,
    { mapName: t('map.world'), mode: options.mode, counter: { label: t('label.streak'), of: null }, timed: options.timeLimit !== 0, score: false },
    { onGuess: () => void answer(), onNext: () => {}, onExit: () => void exit(), onPin: onPin },
  );
  screen.setCount(0);

  let provider: ImageryProvider | null = null;
  let places: readonly Location[] = [];
  let find: ((point: LngLat) => string | null) | null = null;
  let round: Round | null = null;
  /** the place after this one, being fetched while the player looks at the current one */
  let upcoming: Promise<Round | null> = Promise.resolve(null);
  let run = newRun();
  /** every round answered so far: the place shown and the country picked for it, null for none */
  let played: readonly RunRound[] = [];
  let picked: string | null = null;
  let deadline = 0;
  let ticker: number | undefined;
  let disposed = false;

  function stopTimer(): void {
    clearInterval(ticker);
    ticker = undefined;
  }

  function tick(): void {
    const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    screen.setClock(remaining);
    if (remaining === 0) {
      void answer();
    }
  }

  function startTimer(): void {
    stopTimer();
    if (options.timeLimit !== 0) {
      deadline = performance.now() + options.timeLimit * 1000;
      tick();
      ticker = window.setInterval(tick, TICK_MS);
    }
  }

  /** The button names the country under the pin, so a slip across a border shows before it counts. */
  function onPin(point: LngLat): void {
    picked = find?.(point) ?? null;
    screen.lockGuess(picked ? null : t('streakPlay.notInCountry'));
    screen.setGuessLabel(picked ? t('streakPlay.guessCountry', { country: countryName(picked) }) : null);
  }

  async function show(next: Round): Promise<void> {
    round = next;
    picked = null;
    upcoming = provider ? nextRound(provider, places, next.index + 1).catch(() => null) : Promise.resolve(null);
    screen.beginRound();
    screen.setCount(run.streak);
    screen.setStatus(t('common.loadingView'));
    const loaded = await screen.showPlace(next.picture);
    if (disposed || round !== next || screen.phase !== 'guessing') {
      return;
    }
    if (!loaded) {
      fail(t('play.viewFailed'), () => show(next), true);
      return;
    }
    screen.setStatus('');
    startTimer();
  }

  function finish(pin: LngLat | null): void {
    if (!round) {
      return;
    }
    const saveNote: Promise<SaveNote> = run.streak > 0 ? handlers.onFinished(run.streak, played).catch(() => '') : Promise.resolve('');
    screen.setPhase('summary');
    screen.setStatus('');
    const place = { ...round.location, lng: round.picture.lng, lat: round.picture.lat };
    const padding = screen.showPanel(overPanel(run, place, saveNote, handlers));
    screen.map.showResult({ location: place, guess: pin, distanceKm: null, score: 0, hinted: false }, padding);
  }

  /** Judges the round: on the right country the next place loads, on anything else the run is over. */
  async function answer(): Promise<void> {
    if (screen.phase !== 'guessing' || !round) {
      return;
    }
    stopTimer();
    const pin = screen.pin;
    run = judge(run, round.location.country, pin ? picked : null);
    played = [...played, { id: round.location.id, answer: pin ? picked : null }];
    screen.setCount(run.streak);
    if (run.over) {
      finish(pin);
      return;
    }
    screen.lockGuess(t('streakPlay.correct'));
    screen.setStatus(t('streakPlay.correctCountry', { country: countryName(round.location.country) }), 'ok');
    // the next place is usually ready already: without the pause the word would be gone before it was seen
    const [next] = await Promise.all([upcoming, new Promise((resolve) => setTimeout(resolve, CORRECT_MS))]);
    if (disposed) {
      return;
    }
    if (next) {
      await show(next);
    } else if (round.index + 1 >= places.length) {
      // the list is used up: the run ends unbeaten
      run = { ...run, over: true };
      finish(pin);
    } else {
      fail(t('streakPlay.nextFailed'), retryNext);
    }
  }

  async function retryNext(): Promise<void> {
    const next = provider && round ? await nextRound(provider, places, round.index + 1).catch(() => null) : null;
    if (disposed) {
      return;
    }
    if (next) {
      await show(next);
    } else {
      fail(t('streakPlay.nextFailed'), retryNext);
    }
  }

  /** Ending a run that has a streak asks first; the streak so far is kept. */
  async function exit(): Promise<void> {
    const underWay = !run.over && run.streak > 0;
    if (underWay && !(await screen.confirm(t('streakPlay.endConfirm', { streak: run.streak }), t('streakPlay.end'), t('play.keepPlaying')))) {
      return;
    }
    if (underWay) {
      void handlers.onFinished(run.streak, played).catch(() => '');
    }
    handlers.onHome();
  }

  /** A notice over the screen, `message` saying what failed and what to do. A view that will not load can also be skipped: the run goes on with the next place. */
  function fail(message: string, retry: () => Promise<void>, skippable = false): void {
    stopTimer();
    screen.setStatus('');
    screen.setPhase('loading');
    const run = (action: () => Promise<void>) => () => {
      screen.clearPanel();
      void action();
    };
    screen.showPanel(
      noticePanel(message, [
        { name: t('common.tryAgain'), run: run(retry) },
        ...(skippable ? [{ name: t('play.skipPlace'), run: run(retryNext) }] : []),
        { name: t('round.exit'), run: handlers.onHome },
      ], true),
    );
  }

  /** Picks the run's places from the first source that can show one, and opens its street view. */
  const open = () =>
    screen.openStreet(providers, async (candidate) => {
      const list = (await candidate.places()).locations;
      const order = pickRounds(list, options.seed, Math.min(list.length, MAX_STREAK + SPARE_ROUNDS));
      const first = await nextRound(candidate, order, 0);
      if (!first) {
        throw new Error('This source has no place to show');
      }
      return { provider: candidate, places: order, first };
    });

  async function begin(): Promise<void> {
    screen.clearPanel();
    screen.setPhase('loading');
    screen.setStatus(t('common.findingPlaces'));
    // a retry keeps whichever half already loaded
    const [finder, started] = await Promise.all([find ?? loadCountryFinder().catch(() => null), round ? null : open()]);
    if (disposed) {
      return;
    }
    find = finder;
    if (started) {
      provider = started.provider;
      places = started.places;
      round = started.first;
    }
    if (!find || !round) {
      fail(t('load.failed'), begin);
      return;
    }
    await show(round);
  }

  void begin();

  return () => {
    disposed = true;
    stopTimer();
    screen.destroy();
  };
}
