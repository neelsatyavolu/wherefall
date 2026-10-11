import type { Page, Route } from '@playwright/test';
import type { Account, AccountState } from '../src/account/client.ts';

type Body = Record<string, unknown>;
type Answer = { status?: number; json: unknown };

const envelope = (data: unknown, status = 200): Answer => ({ status, json: { success: true, data } });
const refusal = (error: string, status: number): Answer => ({ status, json: { success: false, error } });

/** The server's own words, verbatim. */
const SAYS = {
  signIn: 'Sign in first.',
  guests: 'Guests cannot do that. Make an account first.',
  wrongPassword: 'That is not your current password.',
  badNewPassword: 'Choose a new password of 8 to 200 characters.',
  tooManyTries: 'Too many tries at your password in the last hour. Try again later.',
  moderator: "A moderator's account cannot be deleted.",
  badCountry: 'Choose a country by its two-letter code, or none.',
  badSetting: 'A setting is either on or off.',
  unknown: 'That is not something that can be asked here.',
  deleted: 'This account was deleted. Restore it to sign in.',
  badUsername: 'Choose a username of 3 to 20 letters, numbers or single underscores, not starting or ending with one.',
  badPassword: 'Choose a password of at least 8 characters.',
  taken: 'That username is taken. Choose another, or sign in.',
  wrongRecovery: 'Wrong username or recovery code.',
  locked: 'Too many attempts. Try again in 15 minutes.',
  slowDown: 'Too many requests. Slow down a little.',
} as const;

/** What a recovery code is written in: no 0, O, 1, I or L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** The nth recovery code this stand-in makes: twelve characters in three groups of four, a different one each time. */
const codeNumber = (n: number): string =>
  Array.from({ length: 12 }, (_, i) => CODE_ALPHABET[(n * 7 + i * 11 + n * i) % CODE_ALPHABET.length])
    .join('')
    .replace(/(.{4})(?=.)/g, '$1-');

/** A code as it is compared: capitals, with the spaces and hyphens it was typed with taken out. */
const normalised = (code: unknown): string => String(code ?? '').replace(/[\s-]/g, '').toUpperCase();

const PASSWORD_TRIES = 10;
const RESTORE_DAYS = 30;
const DAY_MS = 86_400_000;
const COUNTRY = /^[A-Z]{2}$/;
/** 3 to 20 of a-z, 0-9 and _, not starting or ending with _, and no two in a row */
const USERNAME = /^(?!_)(?!.*__)[a-z0-9_]{3,20}(?<!_)$/;

const LEAGUES: ReadonlyArray<[from: number, name: string]> = [
  [1800, 'Legend'],
  [1300, 'Nomad'],
  [1000, 'Voyager'],
  [800, 'Explorer'],
  [0, 'Trekker'],
];

/** The league a rating falls in, as the server names it. */
export const leagueOf = (rating: number): string => LEAGUES.find(([from]) => rating >= from)?.[1] ?? 'Trekker';

/** An account as `/api/account` describes it: level 3, no country, no duels, both switches as a new account has them. */
export const account = (username: string, rating = 1000, change: Partial<Account> = {}): Account => ({
  username,
  country: null,
  rating,
  xp: 1200,
  level: 3,
  league: leagueOf(rating),
  bestStreak: 7,
  bestCountry: 0,
  bestContinent: 0,
  loginStreak: 1,
  duels: { wins: 0, losses: 0, ties: 0, winRate: 0, rank: null },
  teams: { wins: 0, losses: 0, ties: 0, winRate: 0 },
  moderator: false,
  banned: false,
  allowFriendRequests: true,
  hideChat: false,
  hideLastSeen: false,
  hasRecoveryCode: true,
  email: `${username}@example.com`,
  ...change,
});

const STATS: NonNullable<AccountState['stats']> = {
  gamesPlayed: 4,
  roundsPlayed: 20,
  averageRoundScore: 3100,
  bestRoundScore: 4990,
  perfectRounds: 0,
  bestGame: { score: 19_000, maxScore: 25_000 },
  ratedGames: 3,
};

const RECENT: AccountState['recentGames'] = [{ id: 'g1', playedAt: '2026-10-10T12:00:00.000Z', map: 'world', mode: 'move', rounds: 5, score: 19_000, maxScore: 25_000 }];

/** What `/api/account` holds for a signed-in player, or for a visitor when `username` is null. */
const stateOf = (username: string | null, rating = 1000, change: Partial<Account> = {}): AccountState => ({
  account: username === null ? null : account(username, rating, change),
  guest: null,
  stats: username === null ? null : STATS,
  recentGames: username === null ? [] : RECENT,
});

/** `/api/account` for a signed-in player, or a visitor when `username` is null. `change` sets any field of the account. */
export const accountReply = (username: string | null, rating = 1000, change: Partial<Account> = {}) => ({ success: true, data: stateOf(username, rating, change) });

/** `/api/account` for a browser that holds a guest session. */
export const guestReply = (name = 'Guest #4821') => ({ success: true, data: { ...stateOf(null), guest: name } });

/** The quick way to be someone: answers `GET /api/account` and nothing else. For the account's actions use `AccountServer`. */
export async function signIn(page: Page, username: string | null, rating = 1000, change: Partial<Account> = {}): Promise<void> {
  await page.route('**/api/account', (route) => route.fulfill({ json: accountReply(username, rating, change) }));
}

/**
 * A stand-in for `/api/account` and its `login`, `register` and `logout`, by the wave-6 contract:
 * who is signed in (an account, a guest or nobody), what an account can change about itself, its
 * recovery code, and its sessions: changing the password, using the recovery code, deleting the
 * account and "Sign out everywhere" end every other browser's session, which a test plays from
 * this browser's side with `endedElsewhere()`. It records what was posted, each with the `path` it went to.
 */
export class AccountServer {
  state: AccountState;
  /** the account's password, which `password`, `delete` and `recoveryCode` ask for */
  password = 'correct horse battery';
  /** the account's recovery code, as it was shown the one time; null for an account made before there were codes */
  recoveryCode: string | null = codeNumber(0);
  /** names nobody can register: taken, or a moderator's */
  taken: string[] = [];
  /** true once sign-in was tried too often: every `login`, by password or by code, is 429 */
  locked = false;
  /** true once `country` or `settings` was sent 120 times in the hour */
  slowDown = false;
  /** how many times the account's sessions have been ended: the version a session has to carry to still count */
  sessionVersion = 0;
  /** a deleted account waiting out its 30 days: signing in to it is refused unless it asks to be restored */
  deleted: { state: AccountState; restoreUntil: string } | null = null;
  /** set to make `login` fail with this error (401) whatever is sent */
  loginRefusal: string | null = null;
  /** set to make every post fail with this error (status `refuseStatus`) */
  refuse: string | null = null;
  refuseStatus = 400;
  /** how many times the account was asked for; the first of a day is what counts the login streak */
  reads = 0;
  readonly posts: Body[] = [];
  private tries = 0;
  private codes = 0;
  /** the version this browser's session carries */
  private cookieVersion = 0;
  /** the account as it stands on the server while this browser is signed out of it */
  private owner: AccountState | null = null;

  constructor(username: string | null, rating = 1000, change: Partial<Account> = {}) {
    this.state = stateOf(username, rating, change);
  }

  static async install(page: Page, username: string | null = 'neel', rating = 1000, change: Partial<Account> = {}): Promise<AccountServer> {
    const server = new AccountServer(username, rating, change);
    await page.route('**/api/account**', (route) => server.handle(route));
    return server;
  }

  posted(action: string): Body[] {
    return this.posts.filter((body) => body.action === action);
  }

  /** Changes fields of the signed-in account, as play elsewhere would. */
  change(change: Partial<Account>): void {
    if (this.state.account) {
      this.state = { ...this.state, account: { ...this.state.account, ...change } };
    }
  }

  /** The browser now holds a guest session instead of whatever it had. */
  becomeGuest(name: string): void {
    this.state = { ...stateOf(null), guest: name };
  }

  /** The browser has no session: a visitor. The account itself is still there to sign in to. */
  signOut(): void {
    this.owner = this.state.account ? this.state : this.owner;
    this.state = stateOf(null);
  }

  /**
   * The account's sessions were ended from another browser: its password was changed there, its
   * recovery code used, it was banned, or it signed out everywhere. This browser still holds its
   * old session, and is answered as a visitor from its next request on.
   */
  endedElsewhere(): void {
    this.sessionVersion += 1;
  }

  /** A recovery code nobody has been given yet. */
  private newCode(): string {
    this.codes += 1;
    return codeNumber(this.codes);
  }

  /** Ends every session of the account. `keepThis` gives this browser a new one, as a password change does. */
  private endSessions(keepThis: boolean): void {
    this.sessionVersion += 1;
    if (keepThis) {
      this.cookieVersion = this.sessionVersion;
    } else {
      this.signOut();
    }
  }

  /** This browser signs in to `state`'s account, with a session of the version that now counts. */
  private signIn(state: AccountState): void {
    this.state = state;
    this.owner = null;
    this.cookieVersion = this.sessionVersion;
  }

  /** The account `username` names, signed in here or not; null when there is no such account. */
  private accountNamed(username: string): AccountState | null {
    const known = this.state.account ? this.state : this.owner;
    return known?.account?.username === username ? known : null;
  }

  /** A wrong or missing password is refused, and the eleventh try in an hour is refused whatever it is. */
  private passwordProblem(given: unknown): Answer | null {
    this.tries += 1;
    if (this.tries > PASSWORD_TRIES) {
      return refusal(SAYS.tooManyTries, 429);
    }
    return given === this.password ? null : refusal(SAYS.wrongPassword, 403);
  }

  private changePassword(body: Body): Answer {
    const next = body.next;
    if (typeof next !== 'string' || next.length < 8 || next.length > 200) {
      return refusal(SAYS.badNewPassword, 400);
    }
    const problem = this.passwordProblem(body.current);
    if (problem) {
      return problem;
    }
    this.password = next;
    // every other browser is signed out; this one is given a new session
    this.endSessions(true);
    return envelope({ changed: true });
  }

  private remove(body: Body, current: Account): Answer {
    const problem = this.passwordProblem(body.password);
    if (problem) {
      return problem;
    }
    if (current.moderator) {
      return refusal(SAYS.moderator, 409);
    }
    const restoreUntil = new Date(Date.now() + RESTORE_DAYS * DAY_MS).toISOString();
    this.deleted = { state: this.state, restoreUntil };
    this.endSessions(false);
    this.owner = null;
    return envelope({ deleted: true, restoreUntil });
  }

  private act(body: Body, current: Account): Answer {
    switch (body.action) {
      case 'password':
        return this.changePassword(body);
      case 'delete':
        return this.remove(body, current);
      case 'recoveryCode': {
        const problem = this.passwordProblem(body.password);
        if (problem) {
          return problem;
        }
        // it replaces any earlier code, and is sent this once
        this.recoveryCode = this.newCode();
        return envelope({ recoveryCode: this.recoveryCode });
      }
      case 'signOutEverywhere':
        this.endSessions(false);
        return envelope({ signedOut: true });
      case 'country': {
        if (this.slowDown) {
          return refusal(SAYS.slowDown, 429);
        }
        const { country } = body;
        if (country !== null && !(typeof country === 'string' && COUNTRY.test(country))) {
          return refusal(SAYS.badCountry, 400);
        }
        this.change({ country: country as string | null });
        return envelope({ country });
      }
      case 'settings': {
        if (this.slowDown) {
          return refusal(SAYS.slowDown, 429);
        }
        const given = (['allowFriendRequests', 'hideChat', 'hideLastSeen'] as const).filter((key) => body[key] !== undefined);
        if (given.some((key) => typeof body[key] !== 'boolean')) {
          return refusal(SAYS.badSetting, 400);
        }
        this.change(Object.fromEntries(given.map((key) => [key, body[key]])) as Partial<Account>);
        const { allowFriendRequests, hideChat, hideLastSeen } = this.state.account ?? current;
        return envelope({ allowFriendRequests, hideChat, hideLastSeen });
      }
      default:
        return refusal(SAYS.unknown, 400);
    }
  }

  /** Forgot password: the username, its recovery code and a new password. The code is spent, and a new one answered. */
  private recover(body: Body): Answer {
    const username = String(body.username ?? '').toLowerCase();
    const next = body.newPassword;
    // the new password is looked at before the code
    if (typeof next !== 'string' || next.length < 8 || next.length > 200) {
      return refusal(SAYS.badNewPassword, 400);
    }
    const gone = this.deleted?.state.account?.username === username ? this.deleted.state : null;
    const found = gone ?? this.accountNamed(username);
    // one answer for an unknown name, an account with no code, and a wrong code
    if (!found || this.recoveryCode === null || normalised(body.recoveryCode) !== normalised(this.recoveryCode)) {
      return refusal(SAYS.wrongRecovery, 401);
    }
    if (gone && body.restore !== true) {
      return refusal(SAYS.deleted, 409);
    }
    this.deleted = gone ? null : this.deleted;
    this.password = next;
    this.recoveryCode = this.newCode();
    // every other browser is signed out; this one is signed in
    this.sessionVersion += 1;
    this.signIn(found);
    return envelope({ username, recoveryCode: this.recoveryCode });
  }

  private login(body: Body): Answer {
    const username = String(body.username ?? '').toLowerCase();
    if (this.locked) {
      return refusal(SAYS.locked, 429);
    }
    if (this.loginRefusal !== null) {
      return refusal(this.loginRefusal, 401);
    }
    if ('recoveryCode' in body) {
      return this.recover(body);
    }
    if (this.deleted && this.deleted.state.account?.username === username) {
      if (body.restore !== true) {
        return refusal(SAYS.deleted, 409);
      }
      this.signIn(this.deleted.state);
      this.deleted = null;
      return envelope({ username });
    }
    this.signIn(this.accountNamed(username) ?? stateOf(username));
    return envelope({ username });
  }

  private register(body: Body): Answer {
    const username = String(body.username ?? '').toLowerCase();
    if (!USERNAME.test(username)) {
      return refusal(SAYS.badUsername, 400);
    }
    if (typeof body.password !== 'string' || body.password.length < 8) {
      return refusal(SAYS.badPassword, 400);
    }
    // a moderator's name is answered as any name is that somebody has
    if (this.taken.includes(username)) {
      return refusal(SAYS.taken, 409);
    }
    // a country that is not a two-letter code is stored as none, not refused
    const country = typeof body.country === 'string' && COUNTRY.test(body.country) ? body.country : null;
    this.password = body.password;
    this.recoveryCode = this.newCode();
    this.sessionVersion = 0;
    this.signIn({ ...stateOf(username, 500, { country, xp: 0, level: 1, bestStreak: 0 }), stats: { ...STATS, gamesPlayed: 0, roundsPlayed: 0, averageRoundScore: 0, bestRoundScore: 0, bestGame: null, ratedGames: 0 }, recentGames: [] });
    // the code is in this reply and never again
    return envelope({ username, recoveryCode: this.recoveryCode }, 201);
  }

  private post(path: string, body: Body): Answer {
    if (this.refuse !== null) {
      return refusal(this.refuse, this.refuseStatus);
    }
    if (path.endsWith('/login')) {
      return this.login(body);
    }
    if (path.endsWith('/register')) {
      return this.register(body);
    }
    if (path.endsWith('/logout')) {
      this.signOut();
      return envelope({ signedIn: false });
    }
    if (this.state.account) {
      return this.act(body, this.state.account);
    }
    return this.state.guest === null ? refusal(SAYS.signIn, 401) : refusal(SAYS.guests, 403);
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    // a session that was ended from elsewhere is nobody's: the browser is answered as a visitor, and its cookie cleared
    if (this.state.account && this.cookieVersion !== this.sessionVersion) {
      this.signOut();
    }
    if (request.method() !== 'POST') {
      this.reads += 1;
      const { account } = this.state;
      await route.fulfill(envelope(account ? { ...this.state, account: { ...account, hasRecoveryCode: this.recoveryCode !== null } } : this.state));
      return;
    }
    const body = (request.postDataJSON() ?? {}) as Body;
    this.posts.push({ ...body, path });
    await route.fulfill(this.post(path, body));
  }
}
