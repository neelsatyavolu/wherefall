import type { Page, Route } from '@playwright/test';
import type { DailyState } from '../src/daily/client.ts';
import { checkPlaces, dailySeed, isDailyDraw, listsFor, type SentPlace } from './place-rules.ts';

type Body = Record<string, unknown>;
type Answer = { status?: number; json: unknown };

const envelope = (data: unknown, status = 200): Answer => ({ status, json: { success: true, data } });
const refusal = (error: string, status: number): Answer => ({ status, json: { success: false, error } });

/** The server's own words, verbatim. */
const SAYS = {
  signIn: 'Sign in first.',
  guests: 'Guests cannot do that. Make an account first.',
  tooManyStarts: 'Too many dailies started in the last hour. Try again later.',
  claimDay: 'Results can only be claimed on the day an account is made.',
  claimSize: 'A claim holds 1 to 14 results.',
  tooManyClaims: 'Too many claims in the last hour. Try again later.',
  unstarted: 'Start the daily before you finish it.',
  tooSoon: 'That daily finished sooner than it could have been played.',
} as const;

const PER_PAGE = 20;
const TOP = 100;
const MAX_SCORE = 15_000;
const BUCKETS = 10;
const ROUNDS = 3;
const MAX_CLAIM = 14;
const HOUR_MS = 3_600_000;
/** The day's average for each round is sent once this many players have finished. */
const AVERAGES_FROM = 5;

export interface DailyEntry {
  username: string;
  country: string | null;
  score: number;
  /** the score of each round; left out, the total is taken as spread evenly over the three */
  rounds?: number[];
}

/** An entry's score in each round. */
const roundsOf = (entry: DailyEntry): number[] => entry.rounds ?? Array.from({ length: ROUNDS }, () => entry.score / ROUNDS);

const sum = (numbers: readonly number[]) => numbers.reduce((total, n) => total + n, 0);

/** `count` other players' results today, from 14,000 down in steps, so each has a rank of its own. */
export const dailyEntries = (count: number): DailyEntry[] =>
  Array.from({ length: count }, (_, i) => ({ username: `player${String(i + 1).padStart(3, '0')}`, country: i % 3 === 0 ? 'FR' : null, score: 14_000 - i * 100 }));

/**
 * A stand-in for `/api/daily`, by the wave-6 contract: three rounds of three minutes, one attempt
 * a day, a leaderboard of the top hundred served twenty to a page, and the `start` and `claim`
 * actions. Both take an account: a start is marked here, and a claim has to carry the token a
 * visitor's start was answered with while a visitor could play. The page's player is "neel" unless
 * `session` says a guest or a visitor is asking.
 */
export class DailyServer {
  date = '2026-10-11';
  seed = 'daily20261011';
  /** who is asking: an account gets everything, a guest and a visitor only what is public */
  session: 'account' | 'guest' | 'none' = 'account';
  username = 'neel';
  country: string | null = null;
  /** everyone else's results today, in any order */
  entries: DailyEntry[] = [
    { username: 'sam', country: 'GB', score: 13_000 },
    { username: 'ana', country: null, score: 9250 },
  ];
  /** the score of each round of the player's one result today, or null when there is none yet */
  rounds: number[] | null = null;
  /** what the result was stored out of */
  maxScore = MAX_SCORE;
  /** true once `start` was sent and until the result is saved */
  started = false;
  /**
   * The daily is refused when it is saved sooner than this after its start. 0 here so a test can
   * play at its own speed; 6000 is the real rule.
   */
  minMs = 0;
  streak: DailyState['streak'] = { current: 0, best: 0, atRisk: false };
  records: NonNullable<DailyState['records']> = { played: 0, best: 0, average: 0 };
  /** the days before today, oldest first; today is added from `rounds` */
  history: DailyState['history'] = [];
  /** how long until the next daily opens */
  nextInMs = 6 * HOUR_MS;
  /** false once the account is more than a day old: `claim` is then refused */
  claimable = true;
  /** true once 30 dailies an hour were started, or 10 claims made */
  startsRefused = false;
  claimsRefused = false;
  /** what `viewer` answers */
  viewer = { google: false, usedToday: 0, limit: 150 };
  /** set to make every post fail with this error (status `refuseStatus`) */
  refuse: string | null = null;
  refuseStatus = 400;
  readonly posts: Body[] = [];
  /** the pages of the leaderboard that were asked for, in order */
  readonly pages: number[] = [];
  private page: Page | null = null;
  /** when the account's start came, by the server's clock */
  private startedAt = 0;
  /** how far the server's clock has been moved on */
  private ahead = 0;
  /** the tokens given for visitors' starts, each with the UTC day it was given on */
  private readonly tokens = new Map<string, string>();

  static async install(page: Page, session: DailyServer['session'] = 'account'): Promise<DailyServer> {
    const server = new DailyServer();
    server.session = session;
    server.page = page;
    await page.route('**/api/daily**', (route) => server.handle(route));
    return server;
  }

  /** Moves the server's clock on, as time passing would. */
  advance(ms: number): void {
    this.ahead += ms;
  }

  /** A token as a visitor's `start` on `day` was once answered with: what a result of that day has to carry to be claimed. */
  tokenFor(day: string = this.date): string {
    const token = `daily.${day}.${this.tokens.size + 1}`;
    this.tokens.set(token, day);
    return token;
  }

  /** Why the account's daily cannot be saved now, in the server's words (409), or null when it can. */
  finishProblem(): string | null {
    if (!this.started) {
      return SAYS.unstarted;
    }
    return Date.now() + this.ahead - this.startedAt < this.minMs ? SAYS.tooSoon : null;
  }

  posted(action: string): Body[] {
    return this.posts.filter((body) => body.action === action);
  }

  private get mine(): boolean {
    return this.session === 'account';
  }

  private get score(): number | null {
    return this.mine && this.rounds ? sum(this.rounds) : null;
  }

  /**
   * Saves the player's result, as `POST /api/games` with `daily` does: one a day, and a second is
   * answered with the first. Returns the score that stands.
   */
  save(rounds: readonly number[]): number {
    if (this.rounds === null) {
      this.rounds = [...rounds];
      this.started = false;
      const score = sum(rounds);
      const played = this.records.played + 1;
      this.records = { played, best: Math.max(this.records.best, score), average: Math.round((this.records.average * this.records.played + score) / played) };
      this.streak = { current: this.streak.current + 1, best: Math.max(this.streak.best, this.streak.current + 1), atRisk: false };
    }
    return sum(this.rounds);
  }

  /** Everyone with a result today, best first, the player among them. */
  private ranked(): DailyEntry[] {
    const own = this.score === null ? [] : [{ username: this.username, country: this.country, score: this.score }];
    return [...this.entries, ...own].sort((a, b) => b.score - a.score);
  }

  private yours(): DailyState['yours'] {
    if (this.score === null || this.rounds === null) {
      return null;
    }
    const others = this.entries.length;
    const earlier = this.history.flatMap((day) => (day.score === null ? [] : [day.score]));
    const lower = this.entries.filter((entry) => entry.score < this.score!).length;
    return {
      score: this.score,
      maxScore: this.maxScore,
      rounds: this.rounds,
      rank: this.ranked().findIndex((entry) => entry.username === this.username) + 1,
      // rounded down, and 0 while nobody else has played
      beat: others === 0 ? 0 : Math.floor((lower * 100) / others),
      averages: this.averages(),
      // higher than every earlier daily of the account; never for its first
      personalBest: earlier.length > 0 && this.score > Math.max(...earlier),
    };
  }

  /** The day's mean score for each round over every finished result, the player's own included; null until five have finished. */
  private averages(): number[] | null {
    const finished = [...this.entries.map(roundsOf), ...(this.rounds ? [this.rounds] : [])];
    if (finished.length < AVERAGES_FROM) {
      return null;
    }
    return Array.from({ length: ROUNDS }, (_, round) => Math.round(sum(finished.map((rounds) => rounds[round] ?? 0)) / finished.length));
  }

  private distribution(): number[] {
    const counts = Array.from({ length: BUCKETS }, () => 0);
    for (const entry of this.ranked()) {
      const bucket = Math.min(BUCKETS - 1, Math.floor(entry.score / (MAX_SCORE / BUCKETS)));
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return counts;
  }

  /** What `GET /api/daily?page=` answers. Anything that is not a whole number from 1 is read as page 1. */
  read(asked: string | null): DailyState {
    const number = Number(asked);
    const page = asked !== null && Number.isInteger(number) && number >= 1 ? number : 1;
    const top = this.ranked().slice(0, TOP);
    const start = (page - 1) * PER_PAGE;
    return {
      date: this.date,
      seed: this.seed,
      settings: { map: 'world', mode: 'move', timeLimit: 180, rounds: ROUNDS },
      serverNow: new Date().toISOString(),
      nextAt: new Date(Date.now() + this.nextInMs).toISOString(),
      state: this.score !== null ? 'done' : this.mine && this.started ? 'started' : 'open',
      yours: this.yours(),
      streak: this.mine ? this.streak : { current: 0, best: 0, atRisk: false },
      records: this.mine ? this.records : null,
      history: this.mine ? [...this.history, { date: this.date, score: this.score }] : [],
      leaderboard: { entries: top.slice(start, start + PER_PAGE).map(({ username, country, score }, index) => ({ rank: start + index + 1, username, country, score })), page, more: top.length > start + PER_PAGE },
      distribution: this.distribution(),
    };
  }

  /** `claim`: a new account takes over the results its player made as a visitor. */
  private claim(body: Body): Answer {
    const results = body.results;
    if (!Array.isArray(results) || results.length < 1 || results.length > MAX_CLAIM) {
      return refusal(SAYS.claimSize, 400);
    }
    if (this.claimsRefused) {
      return refusal(SAYS.tooManyClaims, 429);
    }
    if (!this.claimable) {
      return refusal(SAYS.claimDay, 403);
    }
    const claimed: string[] = [];
    for (const result of results as Array<{ daily: string; token?: unknown; rounds: Array<SentPlace & { score?: number }> }>) {
      const played = result.daily === this.date ? this.rounds !== null : this.history.some((day) => day.date === result.daily && day.score !== null);
      // skipped: a day already played, taken earlier in this claim, or not three rounds
      if (played || claimed.includes(result.daily) || !Array.isArray(result.rounds) || result.rounds.length !== ROUNDS) {
        continue;
      }
      // skipped: not begun on that day with a start this server answered, or not on that day's three places
      if (typeof result.token !== 'string' || this.tokens.get(result.token) !== result.daily || !this.drawnOn(result.daily, result.rounds)) {
        continue;
      }
      claimed.push(result.daily);
      const scores = result.rounds.map((round) => round.score ?? 0);
      if (result.daily === this.date) {
        this.save(scores);
      } else {
        this.history = [...this.history.filter((day) => day.date !== result.daily), { date: result.daily, score: sum(scores) }].sort((a, b) => a.date.localeCompare(b.date));
      }
    }
    return envelope({ claimed });
  }

  /** True when the rounds are on the three places of that day: known by id where their list has them, and drawn by the day's seed. */
  private drawnOn(day: string, rounds: readonly SentPlace[]): boolean {
    const lists = listsFor(this.page);
    const sent = rounds.every((round) => typeof round?.id === 'string' && typeof round.lng === 'number' && typeof round.lat === 'number');
    const checked = sent ? checkPlaces(lists, 'world', rounds, null) : null;
    return checked !== null && isDailyDraw(lists, checked.places, checked.list, day === this.date ? this.seed : dailySeed(day));
  }

  /** `start`: the account's one attempt of the day is marked as begun. */
  private start(): Answer {
    if (this.startsRefused) {
      return refusal(SAYS.tooManyStarts, 429);
    }
    if (this.rounds === null && !this.started) {
      this.started = true;
      this.startedAt = Date.now() + this.ahead;
    }
    return envelope({ state: this.rounds === null ? 'started' : 'done', token: null });
  }

  private post(body: Body): Answer {
    if (this.refuse !== null) {
      return refusal(this.refuse, this.refuseStatus);
    }
    if (body.action === 'viewer') {
      return envelope(this.viewer);
    }
    if (!this.mine) {
      return this.session === 'guest' ? refusal(SAYS.guests, 403) : refusal(SAYS.signIn, 401);
    }
    return body.action === 'start' ? this.start() : this.claim(body);
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = (request.postDataJSON() ?? {}) as Body;
      this.posts.push(body);
      await route.fulfill(this.post(body));
      return;
    }
    const asked = new URL(request.url()).searchParams.get('page');
    const state = this.read(asked);
    this.pages.push(state.leaderboard.page);
    await route.fulfill(envelope(state));
  }
}
