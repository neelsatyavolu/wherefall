import type { Page, Route } from '@playwright/test';
import type { GameDetail } from '../src/account/client.ts';
import type { HistoryGame } from '../src/account/games.ts';
import type { DailyServer } from './daily-server.ts';
import { checkPlaces, communityRows, continentOfPlace, isDailyDraw, knownPlace, listsFor, type PlaceFile, type SentPlace } from './place-rules.ts';

type Body = Record<string, unknown>;
type Answer = { status?: number; json: unknown };
type SavedRound = SentPlace & { score?: number; hinted?: boolean; guessLng?: number | null; guessLat?: number | null };
type RunRound = { id: string; answer: string | null };
type RunKind = 'streak' | 'country' | 'continent';
type RunReply = { best: number; count: number; xpEarned: number; xpCapped: boolean };

const envelope = (data: unknown, status = 200): Answer => ({ status, json: { success: true, data } });
const refusal = (error: string, status: number): Answer => ({ status, json: { success: false, error } });

/** The server's own words, verbatim. */
const SAYS = {
  signIn: 'Sign in first.',
  guests: 'Guests cannot do that. Make an account first.',
  badPage: 'Ask for your games by page.',
  notYours: 'That is not one of your games.',
  invalid: 'That game could not be saved: its details are not valid.',
  notOnMap: 'That game could not be saved: its places are not on its map.',
  notTodays: "That game could not be saved as a daily challenge: it is not today's.",
  notTodaysPlaces: "Those are not today's places.",
  tooManyRuns: 'Too many runs started in the last hour. Try again later.',
  runNotStartedHere: 'That run was not started here.',
  runPlacesUnknown: 'That run could not be saved: its places are not known.',
  runTooSoon: 'That run finished sooner than it could have been played.',
} as const;

const PER_PAGE = 20;
const ROUND_MAX = 5000;
const XP_PER_POINTS = 50;
const RUN_POINTS = 1000;
const RUN_XP = 20;
const MAX_STREAK = 500;
const GUESSER_ROUNDS = 10;
const RUN_KINDS: readonly RunKind[] = ['streak', 'country', 'continent'];
const CONTINENTS = ['africa', 'asia', 'europe', 'north-america', 'oceania', 'south-america'];
/** XP from playing alone stops here for an account each UTC day. */
const SOLO_XP_PER_DAY = 20_000;

const isCoordinate = (value: unknown, limit: number): value is number => typeof value === 'number' && Math.abs(value) <= limit;

/** A round as the server's schema takes it: its place by id and coordinates, and a whole guess or none. */
const isRound = (round: unknown): round is SavedRound => {
  const { id, lng, lat, guessLng, guessLat } = (round ?? {}) as Record<string, unknown>;
  const pinned = guessLng !== null && guessLng !== undefined;
  const whole = pinned ? isCoordinate(guessLng, 180) && isCoordinate(guessLat, 90) : guessLat === null || guessLat === undefined;
  return typeof id === 'string' && id.length >= 1 && id.length <= 64 && isCoordinate(lng, 180) && isCoordinate(lat, 90) && whole;
};

/** A run's rounds as the server's schema takes them, for its kind. */
function areRunRounds(kind: RunKind, rounds: unknown): rounds is RunRound[] {
  const most = kind === 'streak' ? MAX_STREAK + 1 : GUESSER_ROUNDS;
  const answered = (answer: unknown) => answer === null || (typeof answer === 'string' && (kind === 'continent' ? CONTINENTS.includes(answer) : /^[A-Z]{2}$/.test(answer)));
  return Array.isArray(rounds) && rounds.length >= 1 && rounds.length <= most && rounds.every((round: RunRound | null) => typeof round?.id === 'string' && round.id.length >= 1 && answered(round.answer));
}

const sum = (numbers: readonly number[]) => numbers.reduce((total, n) => total + n, 0);

/** One game of the history: a solo game on the world unless changed. */
export const historyGame = (id: string, change: Partial<HistoryGame> = {}): HistoryGame => ({
  id,
  kind: 'solo',
  playedAt: '2026-10-10T12:00:00.000Z',
  map: 'world',
  mode: 'move',
  rounds: 5,
  score: 19_000,
  maxScore: 25_000,
  result: null,
  ratingChange: null,
  xpEarned: 380,
  players: 1,
  ...change,
});

/** A history with one game of every kind, newest first, then `extra` more solo games to fill later pages. */
export function historyGames(extra = 0): HistoryGame[] {
  const kinds: HistoryGame[] = [
    historyGame('m-ranked', { kind: 'ranked', playedAt: '2026-10-11T11:00:00.000Z', score: 12_400, result: 'win', ratingChange: 18, xpEarned: 496, players: 2 }),
    historyGame('m-team', { kind: 'team', playedAt: '2026-10-11T10:00:00.000Z', score: 9800, result: 'loss', xpEarned: 196, players: 4 }),
    historyGame('m-unranked', { kind: 'unranked', playedAt: '2026-10-11T09:00:00.000Z', score: 15_100, result: 'draw', xpEarned: 302, players: 7 }),
    historyGame('m-party', { kind: 'party', playedAt: '2026-10-11T08:00:00.000Z', map: 'community:paris-walk-x7k2', mode: 'nmpz', rounds: 12, score: 30_000, maxScore: 60_000, result: 'win', xpEarned: 0, players: 14 }),
    historyGame('g-daily', { kind: 'daily', playedAt: '2026-10-11T07:00:00.000Z', rounds: 3, score: 11_250, maxScore: 15_000, xpEarned: 225 }),
    historyGame('g1'),
  ];
  const older = Array.from({ length: extra }, (_, i) => historyGame(`old-${i + 1}`, { playedAt: new Date(Date.parse('2026-10-09T12:00:00.000Z') - i * 3_600_000).toISOString(), score: 10_000 + i }));
  return [...kinds, ...older];
}

/** A game in full, as `?id=` answers: two rounds, the second with no guess. */
export const gameDetail = (game: HistoryGame, change: Partial<GameDetail> = {}): GameDetail => ({
  id: game.id,
  playedAt: game.playedAt,
  map: game.map,
  mode: game.mode,
  timeLimit: 60,
  daily: game.kind === 'daily' ? game.playedAt.slice(0, 10) : null,
  score: game.score,
  maxScore: game.maxScore,
  kind: game.kind,
  result: game.result,
  ratingChange: game.ratingChange,
  players: game.players,
  rounds: [
    { country: 'FR', distanceKm: 12.5, score: game.score, hinted: false, lng: 2.35, lat: 48.85, guessLng: 2.5, guessLat: 48.9 },
    { country: 'JP', distanceKm: null, score: 0, hinted: false, lng: 139.69, lat: 35.69, guessLng: null, guessLat: null },
  ],
  ...change,
});

/**
 * A stand-in for `/api/games`, by the wave-6 contract: the history a page at a time, one game in
 * full, and the saves. A game (or the daily) is saved only when every round names a place of the
 * game's map, by id, where its list has it; a run of the streak or a guesser is begun
 * (`{ action: 'start', kind }`) and finished with its rounds, which the server counts. It records
 * every save and every start. Give it a `DailyServer` and a saved daily shows on the daily too.
 *
 * Scores are taken as the browser sent them (the real server works them out from the guess and the
 * place): the test pictures all stand in one spot, so a recount would never agree with the page.
 */
export class GamesServer {
  /** the whole history, newest first */
  history: HistoryGame[] = historyGames();
  /** who is asking: only an account has games */
  session: 'account' | 'guest' | 'none' = 'account';
  bestStreak = 7;
  /** the best Country Guesser and Continent Guesser scores so far */
  best = { country: 0, continent: 0 };
  daily: DailyServer | null = null;
  /** how much of the day's 20,000 XP from playing alone is left: a save past it is cut, and says `xpCapped` */
  xpLeft = SOLO_XP_PER_DAY;
  /**
   * A run's finish is refused when it comes sooner than this after its start for each round sent.
   * 0 here so a test can play a run at its own speed; 2000 is the real rule.
   */
  roundMs = 0;
  /** true once 120 runs an hour were started */
  startsRefused = false;
  /** set to make every save fail with this error (status `refuseStatus`) */
  refuse: string | null = null;
  refuseStatus = 400;
  /** every game and finished run posted, in order */
  readonly saved: Body[] = [];
  /** every run that was asked to be begun, in order */
  readonly starts: Body[] = [];
  /** the pages of the history that were asked for, in order */
  readonly pages: number[] = [];
  private page_: Page | null = null;
  /** how far the server's clock has been moved on */
  private ahead = 0;
  private readonly runs = new Map<string, { kind: RunKind; at: number; reply: RunReply | null }>();

  static async install(page: Page, daily: DailyServer | null = null): Promise<GamesServer> {
    const server = new GamesServer();
    server.daily = daily;
    server.page_ = page;
    await page.route('**/api/games**', (route) => server.handle(route));
    return server;
  }

  /** Moves the server's clock on, as time passing would: a run begun before can then be finished. */
  advance(ms: number): void {
    this.ahead += ms;
  }

  /** The two place lists the server knows: the real Google list and the open list this page is served. */
  private get lists(): PlaceFile[] {
    return listsFor(this.page_);
  }

  private now(): number {
    return Date.now() + this.ahead;
  }

  private barred(): Answer | null {
    if (this.session === 'account') {
      return null;
    }
    return this.session === 'guest' ? refusal(SAYS.guests, 403) : refusal(SAYS.signIn, 401);
  }

  private page(asked: string): Answer {
    const page = Number(asked);
    if (!Number.isInteger(page) || page < 1) {
      return refusal(SAYS.badPage, 400);
    }
    this.pages.push(page);
    const start = (page - 1) * PER_PAGE;
    return envelope({ games: this.history.slice(start, start + PER_PAGE), page, more: this.history.length > start + PER_PAGE });
  }

  private detail(id: string): Answer {
    const game = this.history.find((each) => each.id === id);
    return game ? envelope(gameDetail(game)) : refusal(SAYS.notYours, 404);
  }

  /** XP added to the account today, cut to what the day has left. */
  private earn(xp: number): { xpEarned: number; xpCapped: boolean } {
    const xpEarned = Math.min(xp, this.xpLeft);
    this.xpLeft -= xpEarned;
    return { xpEarned, xpCapped: xpEarned < xp };
  }

  private startRun(body: Body): Answer {
    if (!RUN_KINDS.includes(body.kind as RunKind)) {
      return refusal(SAYS.invalid, 400);
    }
    if (this.startsRefused) {
      return refusal(SAYS.tooManyRuns, 429);
    }
    const run = `run.${this.runs.size + 1}.${body.kind as string}`;
    this.runs.set(run, { kind: body.kind as RunKind, at: this.now(), reply: null });
    return envelope({ run }, 201);
  }

  /** What a run comes to, counted from the place of each round and what the player chose. Null when a place is not known. */
  private count(kind: RunKind, rounds: readonly RunRound[]): number | null {
    const places = rounds.map((round) => knownPlace(this.lists, round.id));
    const right = rounds.map((round, index) => {
      const place = places[index];
      return place ? round.answer === (kind === 'continent' ? continentOfPlace(place) : place.country) : false;
    });
    if (places.includes(null) || (kind === 'continent' && places.some((place) => place && continentOfPlace(place) === null))) {
      return null;
    }
    const lost = right.indexOf(false);
    return kind === 'streak' ? Math.min(MAX_STREAK, lost === -1 ? right.length : lost) : right.filter(Boolean).length;
  }

  private finishRun(body: Body): Answer {
    const kind = body.kind as RunKind;
    const { rounds } = body;
    if (!RUN_KINDS.includes(kind) || typeof body.run !== 'string' || !areRunRounds(kind, rounds)) {
      // the wave-5 bodies, a count and a seed, end here
      return refusal(SAYS.invalid, 400);
    }
    const run = this.runs.get(body.run);
    if (!run || run.kind !== kind) {
      return refusal(SAYS.runNotStartedHere, 400);
    }
    const count = this.count(kind, rounds);
    if (count === null) {
      return refusal(SAYS.runPlacesUnknown, 400);
    }
    if (this.now() - run.at < rounds.length * this.roundMs) {
      return refusal(SAYS.runTooSoon, 409);
    }
    // a run counts once: finished again, it is answered with the first result and no XP
    const first = run.reply === null;
    const best = kind === 'streak' ? Math.max(this.bestStreak, count) : Math.max(this.best[kind], count * RUN_POINTS);
    // the streak counted behind ordinary games earns nothing of its own
    const paid = !(kind === 'streak' && body.inPlay === true);
    const reply = run.reply ? { ...run.reply, xpEarned: 0, xpCapped: false } : { best, count, ...(paid ? this.earn(count * RUN_XP) : { xpEarned: 0, xpCapped: false }) };
    if (first) {
      run.reply = reply;
      this.bestStreak = kind === 'streak' ? best : this.bestStreak;
      this.best = kind === 'streak' ? this.best : { ...this.best, [kind]: best };
    }
    const { xpEarned, xpCapped } = reply;
    return envelope(kind === 'streak' ? { bestStreak: reply.best, streak: reply.count, xpEarned, xpCapped } : { best: reply.best, correct: reply.count, xpEarned, xpCapped });
  }

  /** Why a game claiming to be the daily cannot be saved as it, or null when it can. */
  private dailyProblem(body: Body, rounds: readonly SavedRound[], daily: DailyServer): Answer | null {
    const settings = body.map === 'world' && body.mode === 'move' && body.timeLimit === 60 && rounds.length === 3;
    if (body.daily !== daily.date || body.seed !== daily.seed || !settings) {
      return refusal(SAYS.notTodays, 400);
    }
    const checked = checkPlaces(this.lists, 'world', rounds, null);
    return checked && isDailyDraw(this.lists, checked.places, checked.list, daily.seed) ? null : refusal(SAYS.notTodaysPlaces, 400);
  }

  private saveGame(body: Body): Answer {
    const { rounds } = body;
    if (!Array.isArray(rounds) || rounds.length < 1 || rounds.length > 10 || !rounds.every(isRound) || typeof body.map !== 'string') {
      return refusal(SAYS.invalid, 400);
    }
    const isDaily = typeof body.daily === 'string';
    const problem = isDaily && this.daily ? this.dailyProblem(body, rounds, this.daily) : null;
    if (problem) {
      return problem;
    }
    if (!checkPlaces(this.lists, body.map, rounds, communityRows(this.page_, body.map))) {
      return refusal(SAYS.notOnMap, 400);
    }
    const scores = rounds.map((round) => round.score ?? 0);
    // one daily a day: a second is answered with the first
    const first = isDaily && this.daily ? this.daily.rounds === null : true;
    const unfinishable = first && isDaily && this.daily ? this.daily.finishProblem() : null;
    if (unfinishable) {
      return refusal(unfinishable, 409);
    }
    const score = isDaily && this.daily ? this.daily.save(scores) : sum(scores);
    // rounds earn XP on the official maps only
    const { xpEarned, xpCapped } = first && !body.map.startsWith('community:') ? this.earn(Math.round(score / XP_PER_POINTS)) : { xpEarned: 0, xpCapped: false };
    const game = historyGame(`g-${this.saved.length}`, {
      kind: isDaily ? 'daily' : 'solo',
      playedAt: new Date().toISOString(),
      map: body.map as HistoryGame['map'],
      mode: body.mode as HistoryGame['mode'],
      rounds: rounds.length,
      score,
      maxScore: rounds.length * ROUND_MAX,
      xpEarned,
    });
    if (first) {
      this.history = [game, ...this.history];
    }
    const { playedAt, map, mode, maxScore } = game;
    return envelope({ playedAt, map, mode, rounds: rounds.length, score, maxScore, xpEarned, xpCapped }, first ? 201 : 200);
  }

  private post(body: Body): Answer {
    if (this.refuse !== null) {
      return refusal(this.refuse, this.refuseStatus);
    }
    return typeof body.kind === 'string' ? this.finishRun(body) : this.saveGame(body);
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const bar = this.barred();
    if (request.method() === 'POST') {
      const body = (request.postDataJSON() ?? {}) as Body;
      if (body.action === 'start') {
        this.starts.push(body);
        await route.fulfill(bar ?? this.startRun(body));
        return;
      }
      this.saved.push(body);
      await route.fulfill(bar ?? this.post(body));
      return;
    }
    const params = new URL(request.url()).searchParams;
    const id = params.get('id');
    await route.fulfill(bar ?? (id !== null ? this.detail(id) : this.page(params.get('page') ?? '')));
  }
}
