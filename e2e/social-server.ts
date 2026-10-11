import type { Page, Route } from '@playwright/test';
import type { Board, Friend, Friends, Leaderboard, Moderation, MyReport, Period, Profile } from '../src/social/client.ts';
import { leagueOf } from './account-server.ts';

type Body = Record<string, unknown>;
type Answer = { status?: number; json: unknown };
type Entry = Leaderboard['entries'][number];

const envelope = (data: unknown, status = 200): Answer => ({ status, json: { success: true, data } });
const refusal = (error: string, status: number): Answer => ({ status, json: { success: false, error } });

/** The server's own words, verbatim. */
const SAYS = {
  signIn: 'Sign in first.',
  guests: 'Guests cannot do that. Make an account first.',
  badPeriod: 'Ask for a period of all or day.',
  badRange: 'Ask for a range of 7, 30 or all.',
  requestsOff: 'That player is not accepting friend requests.',
  noPlayer: 'No player has that name.',
  noCategory: 'Say what the report is about: cheating, name, chat or other.',
  longReason: 'A reason is up to 200 characters.',
  ownReport: 'You cannot report yourself.',
  noSuchPlayer: 'No player by that name.',
  taken: 'That username is taken. Choose another.',
  slowDown: 'Too many requests. Slow down a little.',
} as const;

const CATEGORIES = ['cheating', 'name', 'chat', 'other'];
const MAX_REASON = 200;
const REPORTS_SHOWN = 50;

const NO_FRIENDS: Friends = { friends: [], incoming: [], outgoing: [], invites: [] };
const TOP = 100;
const RANGES: Record<string, number> = { '7': 7, '30': 30, all: 365 };

/** A friend as the lists hold them: level 1, no country, in no party, never seen. */
export const friend = (username: string, change: Partial<Friend> = {}): Friend => ({
  username,
  country: null,
  level: 1,
  league: 'Trekker',
  party: null,
  online: false,
  lastSeenAt: null,
  ...change,
});

const entry = (rank: number, username: string, value: number, level: number, league: string, country: string | null = null): Entry => ({ rank, username, country, value, level, league });

/** A board of `count` players, each one point behind the last, for a list long enough to scroll. */
export const boardEntries = (count: number, top = 2000): Entry[] =>
  Array.from({ length: count }, (_, i) => entry(i + 1, `player${String(i + 1).padStart(3, '0')}`, top - i, 1 + (i % 9), leagueOf(top - i), i % 4 === 0 ? 'DE' : null));

type Boards = Record<Period, Record<Board, Pick<Leaderboard, 'entries' | 'you'>>>;

const BOARDS: Boards = {
  all: {
    rating: { entries: [entry(1, 'sam', 1540, 12, 'Nomad', 'GB'), entry(2, 'neel', 1016, 3, 'Voyager'), entry(3, 'ana', 990, 2, 'Explorer', 'BR')], you: { rank: 2, value: 1016 } },
    xp: { entries: [entry(1, 'ana', 52_000, 15, 'Explorer', 'BR'), entry(2, 'sam', 36_000, 13, 'Nomad', 'GB')], you: { rank: 74, value: 1200 } },
    streak: { entries: [], you: null },
  },
  // what was gained today
  day: {
    rating: { entries: [entry(1, 'ana', 31, 2, 'Explorer', 'BR'), entry(2, 'neel', 16, 3, 'Voyager')], you: { rank: 2, value: 16 } },
    xp: { entries: [entry(1, 'sam', 640, 13, 'Nomad', 'GB')], you: null },
    streak: { entries: [], you: null },
  },
};

/** A profile as another signed-in player sees it: a stranger, offline, with no country, duels or history. */
export const profile = (username: string, change: Partial<Profile> = {}): Profile => ({
  username,
  country: null,
  joinedAt: '2026-10-01T10:00:00.000Z',
  xp: 1200,
  level: 3,
  rating: 1016,
  league: 'Voyager',
  ratedGames: 3,
  gamesPlayed: 4,
  bestStreak: 7,
  bestCountry: 0,
  bestContinent: 0,
  duels: { wins: 0, losses: 0, ties: 0, winRate: 0, rank: null },
  teams: { wins: 0, losses: 0, ties: 0, winRate: 0 },
  views: 0,
  friend: 'none',
  online: false,
  lastSeenAt: null,
  recentGames: [],
  history: [],
  ...change,
});

const PROFILES: Record<string, Profile> = {
  sam: profile('sam', {
    country: 'GB',
    joinedAt: '2026-09-01T10:00:00.000Z',
    xp: 36_000,
    level: 13,
    rating: 1540,
    league: 'Nomad',
    ratedGames: 40,
    gamesPlayed: 210,
    bestStreak: 23,
    bestCountry: 9000,
    bestContinent: 10_000,
    duels: { wins: 24, losses: 14, ties: 2, winRate: 60, rank: 1 },
    views: 118,
    online: true,
    lastSeenAt: '2026-10-11T11:59:00.000Z',
    recentGames: [{ id: 'g9', playedAt: '2026-10-10T12:00:00.000Z', map: 'country:JP', mode: 'move', rounds: 5, score: 21_000, maxScore: 25_000 }],
    // the ranks are null for the days recorded before they were kept
    history: [
      { day: '2026-09-20', xp: 30_000, rating: 1480, xpRank: null, ratingRank: null },
      { day: '2026-09-28', xp: 33_500, rating: 1455, xpRank: null, ratingRank: null },
      { day: '2026-10-04', xp: 34_200, rating: 1510, xpRank: 3, ratingRank: 2 },
      { day: '2026-10-10', xp: 36_000, rating: 1540, xpRank: 2, ratingRank: 1 },
    ],
  }),
  // the signed-in player's own profile: an account from before history was kept, so it has none
  neel: profile('neel', { friend: 'self', duels: { wins: 2, losses: 1, ties: 0, winRate: 66, rank: 2 } }),
};

/**
 * A stand-in for `/api/social`, by the wave-6 contract, seen by the signed-in player "neel". It
 * serves the friends lists the test sets, the boards over all time (with or without the players
 * not seen lately) and by today's gain, profiles with a history cut to the range asked for, the
 * count of players online, and the player's own reports with where each stands; and it records
 * what was posted.
 */
export class SocialServer {
  friends: Friends = NO_FRIENDS;
  /** the boards served, by period and name; a test may replace one */
  boards: Boards = { all: { ...BOARDS.all }, day: { ...BOARDS.day } };
  /** what has been reported, as a moderator sees it */
  moderation: Moderation = {
    maps: [{ slug: 'paris-walk-x7k2', name: 'Paris walk', maker: 'sam', reports: 2, reasons: ['half of it is indoors', ''] }],
    players: [
      { username: 'kit', reports: 3, reasons: [{ category: 'chat', note: 'rude in chat' }, { category: 'other', note: 'left every game' }, { category: 'cheating', note: '' }], banned: false },
      { username: 'lee', reports: 1, reasons: [], banned: true },
    ],
  };
  /** the profiles served, by username; a test may change one */
  profiles: Record<string, Profile> = { ...PROFILES };
  /** who is asking: a guest and a visitor may read the boards, profiles and the online count, and nothing else */
  session: 'account' | 'guest' | 'none' = 'account';
  /** how many players are online, as `?online=1` says */
  online = 37;
  /** how many times the page said it is still here: each `?online=1` is the presence heartbeat */
  heartbeats = 0;
  /** players who have turned friend requests off */
  requestsOff: string[] = [];
  /** the player's own reports of players, newest first, as `?reports=1` lists them */
  reports: MyReport[] = [];
  /** players not seen for 14 days: left off the all-time boards unless `inactive=1` asks for them */
  inactive: string[] = [];
  /** players who hide when they were last seen: everyone else is sent `lastSeenAt: null` for them */
  hideLastSeen: string[] = [];
  /** names nobody can take by `rename`: somebody's, or a moderator's */
  taken: string[] = [];
  /** true once `accept`, `decline` or `remove` was sent 120 times in the hour */
  slowDown = false;
  /** the player whose session this is */
  username = 'neel';
  /** every board and profile that was asked for, as its query string */
  readonly asked: string[] = [];
  readonly posts: Body[] = [];
  /** set to make the next posts fail with this error (status `refuseStatus`) */
  refuse: string | null = null;
  refuseStatus = 400;

  static async install(page: Page): Promise<SocialServer> {
    const server = new SocialServer();
    await page.route('**/api/social**', (route) => server.handle(route));
    return server;
  }

  posted(action: string): Body[] {
    return this.posts.filter((body) => body.action === action);
  }

  private act(body: Body): Answer {
    const username = body.username as string;
    const without = (list: readonly string[]) => list.filter((name) => name !== username);
    switch (body.action) {
      case 'request':
        // accepting a request they sent still works; asking them does not
        if (this.requestsOff.includes(username)) {
          return refusal(SAYS.requestsOff, 403);
        }
        this.friends = { ...this.friends, outgoing: [...this.friends.outgoing, username] };
        return envelope(this.friends);
      case 'accept':
        if (this.slowDown) {
          return refusal(SAYS.slowDown, 429);
        }
        this.friends = { ...this.friends, incoming: without(this.friends.incoming), friends: [...this.friends.friends, friend(username)] };
        return envelope(this.friends);
      case 'decline':
        if (this.slowDown) {
          return refusal(SAYS.slowDown, 429);
        }
        this.friends = { ...this.friends, incoming: without(this.friends.incoming) };
        return envelope(this.friends);
      case 'remove':
        if (this.slowDown) {
          return refusal(SAYS.slowDown, 429);
        }
        // also how a player takes back a request of their own
        this.friends = { ...this.friends, friends: this.friends.friends.filter((each) => each.username !== username), outgoing: without(this.friends.outgoing) };
        return envelope(this.friends);
      case 'rename':
        // a moderator's name is answered as any name is that somebody has
        return this.taken.includes(username.toLowerCase()) ? refusal(SAYS.taken, 409) : envelope({ username: username.toLowerCase() });
      case 'report':
        return this.report(body);
      case 'moderate': {
        const { maps, players } = this.moderation;
        if (body.target === 'map') {
          this.moderation = { maps: maps.filter((map) => map.slug !== body.slug), players };
        } else if (body.decision === 'dismiss') {
          this.settle(username, 'dismissed');
          this.moderation = { maps, players: players.filter((player) => player.username !== username) };
        } else if (body.decision === 'ban') {
          // a ban settles the open reports: the row stays for the ban, with none left open
          this.settle(username, 'actioned');
          this.moderation = { maps, players: players.map((player) => (player.username === username ? { ...player, banned: true, reports: 0, reasons: [] } : player)) };
        } else {
          // lifting a ban changes nothing about the reports
          this.moderation = { maps, players: players.map((player) => (player.username === username ? { ...player, banned: false } : player)) };
        }
        return envelope(this.moderation);
      }
      default:
        return envelope(this.friends);
    }
  }

  /** A report of a player: a category is needed, the note is optional, and a second report of the same player replaces the first and opens it again. */
  private report(body: Body): Answer {
    const username = String(body.username ?? '').toLowerCase();
    const note = body.reason ?? '';
    // a name that could not be anyone's is nobody's
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return refusal(SAYS.noSuchPlayer, 404);
    }
    if (!CATEGORIES.includes(body.category as string)) {
      return refusal(SAYS.noCategory, 400);
    }
    if (typeof note !== 'string' || note.length > MAX_REASON) {
      return refusal(SAYS.longReason, 400);
    }
    if (username === this.username) {
      return refusal(SAYS.ownReport, 400);
    }
    const made: MyReport = { username, category: body.category as string, note, at: new Date().toISOString(), status: 'open' };
    this.reports = [made, ...this.reports.filter((each) => each.username !== username)];
    return envelope({ reported: true });
  }

  /** A moderator's decision on a player settles this player's open report of them. */
  private settle(username: string, status: 'actioned' | 'dismissed'): void {
    this.reports = this.reports.map((each) => (each.username === username && each.status === 'open' ? { ...each, status } : each));
  }

  private board(name: string, period: string, asked: string | null): Answer {
    if (period !== 'all' && period !== 'day') {
      return refusal(SAYS.badPeriod, 400);
    }
    const board = this.boards[period][name as Board];
    // the day's board holds only players who played today, so there is nobody inactive to add
    const inactive = period === 'all' && asked === '1';
    const hidden = period === 'all' && !inactive ? this.inactive : [];
    const entries = hidden.length === 0 ? board.entries : board.entries.filter((each) => !hidden.includes(each.username)).map((each, index) => ({ ...each, rank: index + 1 }));
    return envelope({ board: name, period, inactive, entries: entries.slice(0, TOP), you: this.session === 'account' ? board.you : null });
  }

  /** When a player was last seen, as someone else is told: nothing for a player who hides it. */
  private lastSeen<T extends { username: string; lastSeenAt: string | null }>(player: T): T {
    return this.hideLastSeen.includes(player.username) && player.username !== this.username ? { ...player, lastSeenAt: null } : player;
  }

  private profile(username: string, range: string): Answer {
    const points = RANGES[range];
    if (points === undefined) {
      return refusal(SAYS.badRange, 400);
    }
    const found = this.profiles[username];
    if (!found) {
      return refusal(SAYS.noPlayer, 404);
    }
    // a visitor and a guest are told nothing about friendship
    return envelope({ ...this.lastSeen(found), friend: this.session === 'account' ? found.friend : null, history: found.history.slice(-points) });
  }

  private get(params: URLSearchParams): Answer {
    const board = params.get('leaderboard');
    const username = params.get('profile');
    if (params.has('online')) {
      this.heartbeats += 1;
      return envelope({ online: this.online });
    }
    if (board !== null) {
      this.asked.push(params.toString());
      return this.board(board, params.get('period') ?? 'all', params.get('inactive'));
    }
    if (username !== null) {
      this.asked.push(params.toString());
      return this.profile(username, params.get('range') ?? '30');
    }
    if (params.has('reports')) {
      return this.barred() ?? envelope({ reports: this.reports.slice(0, REPORTS_SHOWN) });
    }
    return this.barred() ?? envelope(params.has('moderation') ? this.moderation : { ...this.friends, friends: this.friends.friends.map((each) => this.lastSeen(each)) });
  }

  private barred(): Answer | null {
    if (this.session === 'account') {
      return null;
    }
    return this.session === 'guest' ? refusal(SAYS.guests, 403) : refusal(SAYS.signIn, 401);
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Body;
      this.posts.push(body);
      await route.fulfill(this.refuse === null ? (this.barred() ?? this.act(body)) : refusal(this.refuse, this.refuseStatus));
      return;
    }
    await route.fulfill(this.get(new URL(request.url()).searchParams));
  }
}
