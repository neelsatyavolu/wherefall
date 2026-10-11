import { z } from 'zod';
import { t } from '../i18n/index.ts';
import { mapIdSchema, type MapId } from '../game/locations.ts';

const MODES = ['move', 'no-move', 'nmpz'] as const;

/**
 * One round of a finished game, as sent to the server. The server finds the place by its `id` in
 * its own copy of the place lists (or in the community map) and refuses the game when the place is
 * not on the game's map, or is more than 0.0001° from where its list has it.
 */
export interface SavedRound {
  /** the place's id in its list, or on its community map */
  id: string;
  /** where the place's list has it, which is not always where its picture turned out to be */
  lng: number;
  lat: number;
  /** where the pin was; both null when none was placed */
  guessLng: number | null;
  guessLat: number | null;
  /** true when the hint was used, which halved the score */
  hinted?: boolean;
  /**
   * The round as this browser scored it. The server no longer reads these three (it works them out
   * from the place and the guess); a visitor's daily kept in the browser is shown from them.
   */
  country: string;
  /** null when no pin was placed */
  distanceKm: number | null;
  score: number;
}

/**
 * One finished game, as sent to the server. The server scores every round itself, on the scale it
 * gives the map: no scale is sent.
 */
export interface SavedGame {
  map: MapId;
  mode: (typeof MODES)[number];
  /** seconds per round, 0 for no limit */
  timeLimit: number;
  seed: string;
  rounds: SavedRound[];
  /** UTC day (YYYY-MM-DD) when this game is that day's daily challenge */
  daily?: string;
}

const statsSchema = z.object({
  gamesPlayed: z.number(),
  roundsPlayed: z.number(),
  averageRoundScore: z.number(),
  bestRoundScore: z.number(),
  perfectRounds: z.number(),
  bestGame: z.object({ score: z.number(), maxScore: z.number() }).nullable(),
  /** finished ranked duels */
  ratedGames: z.number(),
});

const gameFields = {
  /** ISO 8601 */
  playedAt: z.string(),
  map: mapIdSchema,
  mode: z.enum(MODES),
  rounds: z.number(),
  score: z.number(),
  maxScore: z.number(),
};

export const recentGameSchema = z.object({ id: z.string(), ...gameFields });

/** Every kind of game the history holds: the three ways of playing alone or by the day, and the four kinds of match. */
export const GAME_KINDS = ['solo', 'daily', 'party', 'unranked', 'ranked', 'team'] as const;

/** What the history says about a game beyond its score. */
export const gameOutcomeFields = {
  kind: z.enum(GAME_KINDS),
  /** null for solo, daily and cancelled matches */
  result: z.enum(['win', 'loss', 'draw']).nullable(),
  /** ranked only */
  ratingChange: z.number().nullable(),
  /** 1 for solo and daily */
  players: z.number(),
};

/**
 * What the server answers when a game is saved. XP from playing alone stops at 20,000 a day (UTC):
 * past that the game is saved as usual, `xpEarned` is what was left (0 once it is used up) and
 * `xpCapped` is true.
 */
const savedGameSchema = z.object({ ...gameFields, xpEarned: z.number(), xpCapped: z.boolean() });


/** One saved game in full, for the history view. */
const gameDetailSchema = z.object({
  id: z.string(),
  playedAt: z.string(),
  map: mapIdSchema,
  mode: z.enum(MODES),
  timeLimit: z.number(),
  daily: z.string().nullable(),
  score: z.number(),
  maxScore: z.number(),
  ...gameOutcomeFields,
  /** for a match: the player's own guess in each round */
  rounds: z.array(
    z.object({
      country: z.string(),
      distanceKm: z.number().nullable(),
      score: z.number(),
      hinted: z.boolean(),
      lng: z.number().nullable(),
      lat: z.number().nullable(),
      guessLng: z.number().nullable(),
      guessLat: z.number().nullable(),
    }),
  ),
});

/** A country as the server sends it everywhere: two upper-case letters, or null when the player has none. */
export const countrySchema = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .nullable();

/** A player's ranked duels. */
export const duelsSchema = z.object({
  wins: z.number(),
  losses: z.number(),
  ties: z.number(),
  /** wins as a whole percent of all duels, ties included; 0 with no duels */
  winRate: z.number(),
  /** place on the all-time rating board; null when not on it */
  rank: z.number().nullable(),
});

/** A player's 2v2 matches, shown beside their duels. */
export const teamsSchema = z.object({
  wins: z.number(),
  losses: z.number(),
  ties: z.number(),
  /** wins as a whole percent of all 2v2 matches, ties included; 0 with none */
  winRate: z.number(),
});

const accountStateSchema = z.object({
  account: z
    .object({
      username: z.string(),
      country: countrySchema,
      /** Elo rating; starts at 500 and only ranked duels change it */
      rating: z.number(),
      xp: z.number(),
      level: z.number(),
      /** the league the rating falls in, as the server names it */
      league: z.string(),
      bestStreak: z.number(),
      /** best Country Guesser score, 0 to 10000 */
      bestCountry: z.number(),
      /** best Continent Guesser score, 0 to 10000 */
      bestContinent: z.number(),
      /** days in a row (UTC) the player has opened the site */
      loginStreak: z.number(),
      duels: duelsSchema,
      teams: teamsSchema,
      /** may see the Moderation pane and act on reports */
      moderator: z.boolean(),
      /** banned from online play; playing alone still works */
      banned: z.boolean(),
      /** off: nobody can send this player a friend request */
      allowFriendRequests: z.boolean(),
      /** on: the player has asked not to be shown chat */
      hideChat: z.boolean(),
      /** on: everyone else is told only whether the player is online, not when they were last seen */
      hideLastSeen: z.boolean(),
      /** false for an account made before recovery codes until it issues one. The code itself is never sent here */
      hasRecoveryCode: z.boolean(),
      /** where reset links are sent; null for an account made before emails until it adds one. Sent to its owner only */
      email: z.string().nullable(),
    })
    .nullable(),
  /** the guest name ("Guest #4821") when this browser holds a guest session, else null */
  guest: z.string().nullable(),
  stats: statsSchema.nullable(),
  recentGames: z.array(recentGameSchema),
});

const usernameSchema = z.object({ username: z.string() });
/** A reply that makes a recovery code. The code is shown this once: the server keeps only a hash of it. */
const withCodeSchema = z.object({ username: z.string(), recoveryCode: z.string() });
const signedOutSchema = z.object({ signedIn: z.literal(false) });

const envelopeSchema = z.union([
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({ success: z.literal(false), error: z.string() }),
]);

export type AccountStats = z.infer<typeof statsSchema>;
export type RecentGame = z.infer<typeof recentGameSchema>;
export type SavedGameReply = z.infer<typeof savedGameSchema>;
export type GameDetail = z.infer<typeof gameDetailSchema>;
export type GameKind = (typeof GAME_KINDS)[number];
export type GameResult = GameDetail['result'];
/** Who is signed in. For a visitor or a guest, `account` and `stats` are null and `recentGames` is empty. */
export type AccountState = z.infer<typeof accountStateSchema>;
export type Account = NonNullable<AccountState['account']>;
export type Duels = z.infer<typeof duelsSchema>;
export type Teams = z.infer<typeof teamsSchema>;
/** What signing up, and getting back in by recovery code, answer: the name and a recovery code to show once. */
export type WithRecoveryCode = z.infer<typeof withCodeSchema>;

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * The refusals a screen has to tell apart from the rest, in the server's own words: a failed call
 * carries only its message, so these are what to compare it with. They are shown as sent, like any other.
 */
export const REFUSALS = {
  /**
   * 401. No session, or a guest session past its 24 hours: a visitor may ask to be a guest again.
   * Any call can meet it in a browser that was signed in: a session ends when the account changes
   * its password, uses a recovery code, is deleted, is banned, or signs out everywhere.
   */
  signIn: 'Sign in first.',
  /** 403. A guest asked for something that needs an account */
  guests: 'Guests cannot do that. Make an account first.',
  /** 409. The right password or recovery code for an account deleted in the last 30 days: the same request with `restore` brings it back */
  deleted: 'This account was deleted. Restore it to sign in.',
  /** 403. The host put this player out of the party; every request on it is answered so, polls included */
  removed: 'You were removed from that party.',
  /** 403. A guest opened the code of a party whose host turned "Allow guests" off */
  accountsOnly: 'This party is for accounts only. Make an account to join.',
  /** 409. A streak or guesser run was finished less than 2 seconds a round after it was started */
  runTooSoon: 'That run finished sooner than it could have been played.',
  /** 409. The daily was saved less than 6 seconds after it was started */
  dailyTooSoon: 'That daily finished sooner than it could have been played.',
  /** 409. The daily was saved by an account that did not start it today */
  dailyUnstarted: 'Start the daily before you finish it.',
  /** 429. Too many writes of one kind: the same thing sent again a little later is taken */
  slowDown: 'Too many requests. Slow down a little.',
} as const;

/** Calls one endpoint. Every way it can go wrong comes back as an error to show, never as an exception. */
export async function call<S extends z.ZodType>(fetchFn: typeof fetch, path: string, schema: S, init?: RequestInit): Promise<Result<z.infer<S>>> {
  let response: Response;
  try {
    response = await fetchFn(path, init);
  } catch {
    return { ok: false, error: t('error.unreachable') };
  }
  const envelope = envelopeSchema.safeParse(await response.json().catch(() => null));
  if (!envelope.success) {
    return { ok: false, error: t('error.unexpected') };
  }
  if (!envelope.data.success) {
    return { ok: false, error: envelope.data.error };
  }
  const data = schema.safeParse(envelope.data.data);
  return response.ok && data.success ? { ok: true, data: data.data } : { ok: false, error: t('error.unexpected') };
}

export const post = (body?: unknown): RequestInit =>
  body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };

export function getAccount(fetchFn: typeof fetch = fetch): Promise<Result<AccountState>> {
  return call(fetchFn, '/api/account', accountStateSchema);
}

/**
 * Creates the account and signs this browser in to it. `email` is where a reset link is sent if the
 * password is forgotten: refused with 400 "Enter a valid email address." and 409 when another
 * account has it. `country` is the two-letter code guessed from the browser, or null for none; left
 * out, the request says nothing about a country. The answer carries the account's recovery code
 * (`K7QM-2XHD-9RWP`), which is never sent again: show it now.
 */
export function register(
  username: string,
  password: string,
  email: string,
  country?: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<Result<WithRecoveryCode>> {
  return call(fetchFn, '/api/account/register', withCodeSchema, post({ username, password, email, ...(country === undefined ? {} : { country }) }));
}

/**
 * Forgot password: signs in with the account's recovery code and sets a new password (8 to 200
 * characters). Case, spaces and hyphens in the code do not matter. The code is spent: the answer
 * carries a new one, to show once, and every other browser is signed out. Refused with 401 "Wrong
 * username or recovery code.", 400 for the new password (looked at before the code), 429 after too
 * many tries, and `REFUSALS.deleted` for a deleted account, which `restore` brings back.
 */
export function recoverAccount(
  username: string,
  recoveryCode: string,
  newPassword: string,
  restore = false,
  fetchFn: typeof fetch = fetch,
): Promise<Result<WithRecoveryCode>> {
  return call(fetchFn, '/api/account/login', withCodeSchema, post({ username, recoveryCode, newPassword, ...(restore ? { restore: true } : {}) }));
}

/** Fails with the server's "This account was deleted. Restore it to sign in." for an account deleted in the last 30 days. */
export function login(username: string, password: string, fetchFn: typeof fetch = fetch): Promise<Result<{ username: string }>> {
  return call(fetchFn, '/api/account/login', usernameSchema, post({ username, password }));
}

/** Signs in to an account deleted in the last 30 days and brings it back. */
export function restoreAccount(username: string, password: string, fetchFn: typeof fetch = fetch): Promise<Result<{ username: string }>> {
  return call(fetchFn, '/api/account/login', usernameSchema, post({ username, password, restore: true }));
}

export function logout(fetchFn: typeof fetch = fetch): Promise<Result<{ signedIn: false }>> {
  return call(fetchFn, '/api/account/logout', signedOutSchema, post());
}

/** Saves a finished game for the signed-in player. Fails with the server's "Sign in first." for a visitor. */
export function saveGame(game: SavedGame, fetchFn: typeof fetch = fetch): Promise<Result<SavedGameReply>> {
  return call(fetchFn, '/api/games', savedGameSchema, post(game));
}

/** One of the player's own saved games, round by round. */
export function getGame(id: string, fetchFn: typeof fetch = fetch): Promise<Result<GameDetail>> {
  return call(fetchFn, `/api/games?id=${encodeURIComponent(id)}`, gameDetailSchema);
}
