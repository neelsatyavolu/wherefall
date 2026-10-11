import './styles.css';
import { getAccount, saveGame, type Result, type SavedGameReply } from './account/client.ts';
import { beginRun, finishBegunGuesser, finishBegunStreak, type BegunRun, type RunRound } from './account/runs.ts';
import { listedPlaces, notingListed, toSavedGame, type Listed } from './account/saved-game.ts';
import { language, pickLanguage, t, tn, useLanguage } from './i18n/index.ts';
import { startPwa } from './pwa.ts';
import { prefs } from './ui/prefs.ts';
import { wireClickSound } from './ui/click-sound.ts';
import { sounds } from './ui/sound.ts';
import { dailyChallenge } from './daily/client.ts';
import { finishDaily } from './daily/finish.ts';
import type { GuesserKind } from './game/guesser.ts';
import { communitySlugOf, type Location, type LocationSet } from './game/locations.ts';
import { randomSeed } from './game/rng.ts';
import { SEED_TRIES, freshestSeed } from './game/seen-places.ts';
import { totalScore, type Session } from './game/session.ts';
import { toSearch, type Challenge, type GameOptions } from './game/settings.ts';
import { welcomeDue } from './game/welcome.ts';
import { plannedGame, plannedStreak } from './imagery/game-places.ts';
import type { ImageryProvider } from './imagery/provider.ts';
import { notingShown } from './imagery/shown.ts';
import type { MatchState } from './multiplayer/client.ts';
import { queueEntryState, type QueueEntry } from './multiplayer/queue-view.ts';
import { dailyGame, keepVisitorDaily, type DailyGame } from './ui/daily-game.ts';
import { el, formatScore } from './ui/dom.ts';
import { renderHome, type Home } from './ui/home.ts';
import { hrefFor, resetToken, viewFor, type NavId } from './ui/nav.ts';
import { noticePanel } from './ui/panels.ts';
import { googleSnapper, imageryProviders } from './ui/providers.ts';
import { hideAddress } from './ui/referrer.ts';
import { forgetLocationSets } from './ui/location-sets.ts';
import { isOutdated, isStaleDaily, refusalNote, sentences, xpWords } from './ui/save-notes.ts';
import { seenPlaces } from './ui/seen-store.ts';
import type { StreakSetup } from './ui/streak-pane.ts';
import { failedNote, savedNote, type SaveNote } from './ui/status.ts';
import { welcomeScreen } from './ui/welcome.ts';
import { streakRuns } from './ui/world-streak-runs.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Missing #app element');
}
const app = root;

/** the home screen while it is showing; null during a game or a match */
let home: Home | null = null;
/** tears down whatever game or match is running */
let stopGame: (() => void) | null = null;
let booted = false;

/** Leaves the home screen, a game or a match, whichever is showing. */
function leaveScreen(): void {
  home?.dispose();
  home = null;
  stopGame?.();
  stopGame = null;
}

/**
 * Shows what the address asks for: the home screen on the view its hash or query names. Runs at
 * load and whenever the address changes (a nav link, back, forward), so it also ends a game or
 * match the player backs out of.
 */
function route(): void {
  const view = viewFor(location.hash, location.search);
  if (home) {
    home.show(view);
    return;
  }
  leaveScreen();
  // only a fresh page asks about an unfinished match: one just left may not have reached the server yet
  home = renderHome(
    view,
    {
      onStart: (options) => void playFresh(options),
      onAcceptChallenge: (accepted) => void play(accepted),
      onStreak: (setup) => void playStreak(setup),
      onGuesser: (kind) => void playGuesser(kind),
      onMatch: (match) => void enterMatch(match, typeof match === 'string'),
      onRejoin: (matchId) => void enterMatch(matchId, false),
      onTutorial: () => void play(TUTORIAL, null, true),
      onDaily: (daily) => void play(dailyChallenge(daily), daily.date),
      onNavigate: (href, state = null) => {
        history.pushState(state, '', href);
        route();
      },
      snapper: googleSnapper(),
      // the first source is the one a game is played on unless it fails, so its list says which maps exist
      loadPlaces: () => imageryProviders()[0]!.places(),
    },
    !booted,
  );
  booted = true;
  app.replaceChildren(home.node);
  warmPinMap();
}

/** how long a browser without an idle signal (Safari) is given to draw the home screen first */
const WARM_AFTER_MS = 1500;

/**
 * While the home screen is being read, the pin map's code, its workers and its style are fetched,
 * so the first game does not wait for them. A warm-up that fails is left: the game loads the map itself.
 */
function warmPinMap(): void {
  const warm = (): void => {
    void import('./ui/guess-map.ts').then(({ warmMap }) => warmMap()).catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warm);
  } else {
    setTimeout(warm, WARM_AFTER_MS);
  }
}

/** Back to the home screen on one nav item, dropping whatever the address carried for the game. */
function goHome(item: NavId = 'singleplayer'): void {
  leaveScreen();
  history.replaceState(null, '', item === 'singleplayer' ? location.pathname : `${location.pathname}${hrefFor(item)}`);
  route();
}

function showLoading(text: string): void {
  app.replaceChildren(el('main', { class: 'home' }, el('p', { class: 'status-inline', text, attrs: { role: 'status' } })));
}

function showFailure(message: string, retry: () => void): void {
  app.replaceChildren(
    el(
      'main',
      { class: 'home' },
      noticePanel(message, [
        { name: t('common.tryAgain'), run: retry },
        { name: t('common.home'), run: () => goHome() },
      ]),
    ),
  );
}

/**
 * What the summary says of a game or a run the server would not take. When the server no longer
 * knows its places, this page read its lists before the site was updated: they are dropped here, so
 * the next game reads them again and is saved, with no reload asked of the player.
 */
function refused(error: string, generic: string, official = true): SaveNote {
  if (isOutdated(error, official)) {
    forgetLocationSets();
  }
  return refusalNote(error, generic, official);
}

/** The daily being played: its day, the game it is, and when this browser had the server's answer to its start. */
interface DailyPlay {
  date: string;
  game: DailyGame;
  begunAt: number;
}

/**
 * What the summary says about a signed-in player's daily game: on the leaderboard, already there
 * from an earlier go, or not saved and why. A daily refused because its places are no longer the
 * day's was played across an update of the site: the game is told, and says so with the way on.
 */
function dailyNote(session: Session, username: string, saved: Result<SavedGameReply>, daily: DailyGame): SaveNote {
  if (!saved.ok) {
    if (!isStaleDaily(saved.error)) {
      return refusalNote(saved.error, t('save.daily.failed'));
    }
    daily.markStale();
    // whatever is played next on this page, should the player not reload, is drawn from the lists as they are now
    forgetLocationSets();
    return failedNote(t('daily.stale.note'));
  }
  // a second go is answered with the first, which is the one that stays
  return saved.data.score === totalScore(session)
    ? savedNote(sentences(t('save.daily.saved', { name: username }), xpWords(saved.data)))
    : t('save.daily.firstStays', { name: username });
}

/**
 * Saves a finished game for a signed-in player and says what happened. Never blocks the game.
 * `listed` is where each of the game's places is by its own list, which is what the server holds a saved round to.
 */
async function recordGame(session: Session, challenge: Challenge, daily: DailyPlay | null, listed: Listed): Promise<SaveNote> {
  const account = await getAccount();
  if (!account.ok) {
    return '';
  }
  const username = account.data.account?.username ?? null;
  const game = toSavedGame(session, challenge, daily?.date ?? null, listed);
  if (username === null) {
    // a visitor's daily is kept in this browser, for the account they may make
    return daily === null ? t('save.game.signedOut') : keepVisitorDaily(daily.date, game.rounds);
  }
  if (daily !== null) {
    // a daily played quicker than the server allows is sent once more when its six seconds have passed
    return dailyNote(session, username, await finishDaily(game, daily.begunAt), daily.game);
  }
  const saved = await saveGame(game);
  if (!saved.ok) {
    // places the server does not know mean an update of the site on an official map, and a map its maker changed on a community one
    return refused(saved.error, t('save.game.failed'), communitySlugOf(challenge.map) === null);
  }
  // the server scores every game again from the places and the guesses: when its total differs, its total is the one that counts
  const recount = saved.data.score === totalScore(session) ? '' : tn('save.game.recount', saved.data.score);
  return savedNote(sentences(t('save.game.saved', { name: username }), xpWords(saved.data), recount));
}

/**
 * Saves a finished streak run for a signed-in player and says where their best now stands. The run
 * was begun on the server as the game began (`run`), and is finished with its rounds: the server
 * counts the streak itself.
 */
async function recordStreak(rounds: readonly RunRound[], run: BegunRun<'streak'>): Promise<SaveNote> {
  const account = await getAccount();
  if (!account.ok) {
    return '';
  }
  if (!account.data.account) {
    return t('save.streak.signedOut');
  }
  const saved = await finishBegunStreak(run, rounds);
  return saved.ok ? savedNote(sentences(t('save.streak.best', { streak: saved.data.bestStreak }), xpWords(saved.data))) : refused(saved.error, t('save.streak.failed'));
}

/**
 * Saves a finished Country Guesser or Continent Guesser run for a signed-in player and says where
 * their best now stands. Like a streak, the run was begun on the server and is finished with its rounds.
 */
async function recordGuesser(rounds: readonly RunRound[], run: BegunRun<GuesserKind>): Promise<SaveNote> {
  const account = await getAccount();
  if (account.ok && !account.data.account) {
    return t('guesser.save.signedOut');
  }
  const saved = account.ok ? await finishBegunGuesser(run, rounds) : account;
  return saved.ok ? savedNote(sentences(t('guesser.save.best', { score: formatScore(saved.data.best) }), xpWords(saved.data))) : refused(saved.error, t('guesser.save.failed'));
}

/**
 * The imagery sources for one game or match, each noting the places it gets ready to show: that is
 * how this browser comes to remember what it has shown, in every kind of game. `listed` is told
 * each place as its list has it, for a game that will be saved.
 */
const sources = (listed: (location: Location) => void = () => {}): ImageryProvider[] =>
  imageryProviders().map((provider) => notingShown(notingListed(provider, listed), (id) => seenPlaces.add([id])));

/**
 * A seed for a game nobody sent: of a few random ones, the one whose places (`planned`) this
 * browser has seen least. The game is still drawn from its seed alone, so its link gives a friend
 * the same places. A seed that came in a link, the daily's and a match's are never chosen here.
 */
async function freshSeed(planned: (set: LocationSet, seed: string) => readonly Location[]): Promise<string> {
  const seeds = Array.from({ length: SEED_TRIES }, randomSeed);
  const seen = seenPlaces.ids();
  if (seen.size === 0) {
    return seeds[0]!;
  }
  try {
    // the list the game is drawn from unless its source fails, which is also the list the home screen offers maps from
    const set = await imageryProviders()[0]!.places();
    return freshestSeed(seeds, (seed) => planned(set, seed), seen);
  } catch {
    // the list would not load: any seed will do, and the game says what is wrong when it starts
    return seeds[0]!;
  }
}

/**
 * Playing takes an account, and the session can have ended since the pane that offered the game
 * was built: signed out in another tab, or everywhere. So a game asks once more as it starts.
 * Without an account the pane the address names is shown again, and its own check says what is
 * needed. Resolves to whether the game is to start; it does when the server cannot be asked, since
 * the pane asked already.
 */
async function mayPlay(): Promise<boolean> {
  const address = location.href;
  const account = await getAccount();
  if (location.href !== address) {
    // the player went somewhere else while the server was asked
    return false;
  }
  if (account.ok && account.data.account === null) {
    leaveScreen();
    route();
    return false;
  }
  return true;
}

/** Plays a game started from the home screen, on a seed of its own. */
async function playFresh(options: GameOptions): Promise<void> {
  // a community map's places come from the server with the game, so its seed is taken as it comes
  const seed = communitySlugOf(options.map) === null ? await freshSeed((set, each) => plannedGame(set, options.map, each, options.rounds)) : randomSeed();
  await play({ ...options, seed });
}

/** Plays a local game. `daily` is the day when the game is that day's daily challenge. */
async function play(challenge: Challenge, daily: string | null = null, tutorial = false): Promise<void> {
  if (!(await mayPlay())) {
    return;
  }
  leaveScreen();
  // a daily game keeps the daily's address, so a reload comes back to the leaderboard, not a plain challenge
  history.replaceState(null, '', tutorial ? location.pathname : daily === null ? toSearch(challenge) : `${location.pathname}${hrefFor('daily')}`);
  showLoading(t('load.places'));
  try {
    // the panorama and map engines are large, so they load only once a game starts
    const { startPlay } = await import('./ui/play.ts');
    if (home) {
      // the player went back to the home screen while this was loading
      return;
    }
    const { seed: _played, ...options } = challenge;
    // the daily's start was answered a moment ago: its result is held to the time since
    const today: DailyPlay | null = daily === null ? null : { date: daily, game: dailyGame(daily, challenge.seed), begunAt: Date.now() };
    const listed = listedPlaces();
    stopGame = startPlay(app, challenge, sources(listed.note), {
      onHome: () => goHome(daily === null ? 'singleplayer' : 'daily'),
      onPlayAgain: () => void playFresh(options),
      // once a daily is saved its standing is asked for, so the result can be shared with the players it beat
      onFinished: (session) => (tutorial ? tutorialDone() : recordGame(session, challenge, today, listed.of).finally(() => today?.game.learnStanding())),
      // the daily is played without hints, on its own draw of places, once
      ...(today ? { daily: today.game } : {}),
      // a world game counts a country streak in the background, as a run on the server (the game itself leaves the daily, the tutorial and other maps out)
      streakRuns,
      // the tutorial ends on the ways into the game; who is looking is asked as it begins, so it is known by its end
      ...(tutorial ? { tutorialEnd: { signedIn: getAccount().then((account) => account.ok && account.data.account !== null), onGo: goHome } } : {}),
    }, tutorial);
  } catch {
    showFailure(t('load.failed'), () => void play(challenge, daily, tutorial));
  }
}

/** The tutorial played through: nothing is saved, and the how-to box, which says the same in three lines, is done with. */
function tutorialDone(): Promise<SaveNote> {
  prefs.dismissIntro();
  return Promise.resolve(t('save.tutorial'));
}

/** A new visitor's welcome, in place of the home screen. Either answer is remembered, so it is asked once. */
function showWelcome(): void {
  const answered = (then: () => void) => () => {
    prefs.markWelcomeSeen();
    then();
  };
  app.replaceChildren(welcomeScreen({ onAccount: answered(() => goHome('account')), onLook: answered(route) }));
}

/**
 * The first screen. A new visitor on the plain home page is welcomed, unless the server knows
 * them: a player signed in here is no new visitor, whatever this browser remembers. Everyone else,
 * and every other address, gets what the address asks for.
 */
async function arrive(): Promise<void> {
  const returning = prefs.introSeen() || seenPlaces.ids().size > 0;
  if (!welcomeDue({ hash: location.hash, search: location.search, answered: prefs.welcomeSeen(), returning })) {
    route();
    return;
  }
  showLoading(t('pano.loading'));
  const account = await getAccount();
  if (home) {
    // the address changed while the server was asked, and was followed
    return;
  }
  if (account.ok && account.data.account !== null) {
    prefs.markWelcomeSeen();
    route();
    return;
  }
  showWelcome();
}

/** Plays a country streak run on a fresh seed. */
async function playStreak(setup: StreakSetup): Promise<void> {
  if (!(await mayPlay())) {
    return;
  }
  leaveScreen();
  history.replaceState(null, '', `${location.pathname}${hrefFor('streak')}`);
  showLoading(t('load.places'));
  try {
    const { startStreak } = await import('./ui/streak-play.ts');
    if (home) {
      return;
    }
    const seed = await freshSeed(plannedStreak);
    if (home) {
      return;
    }
    // the run is begun on the server before its first place is shown: a finish is held to how long the run took
    const run = beginRun('streak');
    stopGame = startStreak(app, { ...setup, seed }, sources(), {
      onHome: () => goHome('streak'),
      onPlayAgain: () => void playStreak(setup),
      onFinished: (_streak, rounds) => recordStreak(rounds, run),
    });
  } catch {
    showFailure(t('load.failed'), () => void playStreak(setup));
  }
}

/** Plays a Country Guesser or a Continent Guesser run on a fresh seed, steering clear of places this browser has shown. */
async function playGuesser(kind: GuesserKind): Promise<void> {
  if (!(await mayPlay())) {
    return;
  }
  leaveScreen();
  history.replaceState(null, '', `${location.pathname}${hrefFor(kind)}`);
  showLoading(t('load.places'));
  try {
    const { startGuesser } = await import('./ui/guesser-play.ts');
    if (home) {
      return;
    }
    const seed = randomSeed();
    const run = beginRun(kind);
    stopGame = startGuesser(app, { kind, seed, seen: seenPlaces.ids() }, sources(), {
      onHome: () => goHome(kind),
      onPlayAgain: () => void playGuesser(kind),
      onFinished: (_correct, rounds) => recordGuesser(rounds, run),
    });
  } catch {
    showFailure(t('load.failed'), () => void playGuesser(kind));
  }
}

/**
 * To a queue's pane with the player on their way into that queue: asking for the same kind of match
 * again, or already put back in it by the server. The pane reads why from the history entry, once.
 */
function toQueue(entry: QueueEntry): void {
  leaveScreen();
  history.replaceState(queueEntryState(entry), '', `${location.pathname}${hrefFor(entry.kind)}`);
  route();
}

/** Enters a match: a party's lobby (its state) or a match by its id (from a queue, or one being rejoined). */
async function enterMatch(match: MatchState | string, fromQueue: boolean): Promise<void> {
  leaveScreen();
  showLoading(t('common.joiningMatch'));
  const { runMatch } = await import('./ui/match.ts');
  if (home) {
    return;
  }
  stopGame = runMatch(app, match, {
    providers: sources(),
    onHome: (item) => goHome(item),
    onQueue: toQueue,
    fromQueue,
    // a reload then opens Join party with this party's code filled in
    onParty: (code) => history.replaceState(null, '', `${location.pathname}?party=${encodeURIComponent(code)}`),
  });
}

/** The tutorial's settings: the world, walking allowed, no clock. Its two places are fixed, so the seed is only a name. */
const TUTORIAL: Challenge = { map: 'world', mode: 'move', timeLimit: 0, rounds: 3, seed: 'tutorial' };

// sounds wait for the player's first touch or key, as browsers require
window.addEventListener('pointerdown', () => sounds.unlock(), { once: true });
window.addEventListener('keydown', () => sounds.unlock(), { once: true });
// one listener for the soft click of every button, under the same Sound setting and volume
wireClickSound(document, () => sounds.play('click'));
startPwa();

// the browser fires one or both of these for a nav link, back and forward; `route` does nothing the second time
window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);
// the language is settled before anything is drawn: forced by `?lang=`, else the player's choice, else the browser's
await useLanguage(pickLanguage(new URLSearchParams(location.search).get('lang'), prefs.language(), navigator.languages));
document.documentElement.lang = language();
// A password-reset link carries its token in the address: until the account pane has taken it out,
// no request this page makes says where it came from.
if (resetToken(location.search) !== '') {
  hideAddress();
}

void arrive();
