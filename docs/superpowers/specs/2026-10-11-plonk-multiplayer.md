# Plonk: sidebar home, multiplayer and daily challenge

Date: 2026-10-11

## What was asked

Neel sent a screenshot of WorldGuessr's menu (Singleplayer; Ranked Duel, Unranked Match, 2v2 Match; Create Party, Join Party; Daily Challenge) and asked to "make it more sidebar based with options like these including multiplayer support so its equivalent to worldguessr".

Decisions below are mine; he has pre-approved building without a review round.

## Decisions

- **Accounts are required for multiplayer and for the daily leaderboard.** Singleplayer and playing the daily stay open to visitors.
- **Polling, not sockets.** Vercel Functions cannot hold connections. Clients poll the match every 1.5 s; the server advances the match inside a transaction on each request ("lazy tick"). Server time is authoritative and sent with every state so clients can correct their clocks.
- **One scoring format for every multiplayer kind:** highest total over the rounds wins. No health bars.
- **Who picks the places.** The server picks the seed. One client, the *resolver* (party host, or the first player matched), picks candidates from `locations.json` with that seed exactly as singleplayer does, resolves them on its imagery source, and posts the final list with exact coordinates. Every other client shows those same places. The server scores guesses against the posted coordinates. Any client can read the answers from its own memory; that is inherent to rendering in the browser and is accepted.
- **Function count.** The Vercel plan allows 12 functions; 5 exist. Multiplayer adds exactly two: `api/match.ts` and `api/daily.ts`.

## Kinds of match

| Kind | Players | How it starts | Settings |
|---|---|---|---|
| `party` | 2 to 8 | host creates, others join with a 6-character code, host starts | host chooses map, mode, rounds (3/5/10), time (30/60/120 s) |
| `unranked` | 2 | matchmaking queue | world, move, 5 rounds, 60 s |
| `ranked` | 2 | matchmaking queue | world, no-move, 5 rounds, 60 s; Elo updated at the end |
| `team` (2v2) | 4 | matchmaking queue, teams assigned at random | world, move, 5 rounds, 60 s; a team's round score is its best member's |

Every multiplayer round is timed. A round ends early once every active player has guessed.

Ratings: Elo, start 1000, K = 32, shown on the account screen. Only `ranked` changes it.

## Phases

`lobby` (party only) → `preparing` (resolver is resolving places) → `playing` → `reveal` → `playing` … → `finished`.

- `preparing` → `playing` when the resolver posts places. If it does not within 45 s the match is cancelled (`finished` with no winner).
- Round `n` starts at `roundStartsAt` (3 s after the previous phase ends, so clients can load the view) and ends at `roundEndsAt = roundStartsAt + timeLimit`, or as soon as all active players have guessed.
- `reveal` lasts 10 s, then the next round is scheduled; after the last round the match is `finished`.
- A player who has not polled for 30 s is inactive. Inactive players score 0 for rounds they miss. A matchmade match with fewer than 2 active players finishes at once and the remaining player (or team) wins. A party ends when no one is active.
- Queue entries need a poll every 10 s or they lapse.

## API

All bodies and replies are JSON in the existing envelope `{ success: true, data } | { success: false, error }`. All routes need a session unless noted.

### `POST /api/match`

Body `{ action, ... }`:

| action | fields | reply `data` |
|---|---|---|
| `create` | `settings: { map, mode, timeLimit: 30\|60\|120, rounds: 3\|5\|10 }` | `MatchState` (phase `lobby`) |
| `join` | `code` | `MatchState` |
| `start` | `matchId` (host only, at least 2 players) | `MatchState` (phase `preparing`) |
| `places` | `matchId`, `places: Place[]` (length = rounds), `scaleKm` (100 to 20000) | `MatchState` (resolver only) |
| `guess` | `matchId`, `round`, `lng`, `lat` | `MatchState` (one guess per player per round; later ones are ignored) |
| `leave` | `matchId` | `{ left: true }` |
| `queue` | `kind: 'unranked' \| 'ranked' \| 'team'` | `QueueState` |
| `leaveQueue` | | `{ queued: false }` |

`Place = { id: string, lng: number, lat: number, country: string /* 2 letters */ }` (the same shape as a dataset location).

### `GET /api/match?id=<matchId>`

Returns `MatchState` and counts as that player's heartbeat.

### `GET /api/match?queue=1`

Returns `QueueState = { queued: boolean, kind: string | null, waiting: number /* players in this queue, you included */, matchId: string | null }` and counts as the queue heartbeat. `matchId` is set once the player has been matched.

### `MatchState`

```ts
interface MatchState {
  id: string;
  code: string | null;                       // parties only
  kind: 'party' | 'unranked' | 'ranked' | 'team';
  phase: 'lobby' | 'preparing' | 'playing' | 'reveal' | 'finished';
  settings: { map: MapId; mode: Mode; timeLimit: 30 | 60 | 120; rounds: 3 | 5 | 10 };
  seed: string;
  serverNow: string;                         // ISO; compare with the local clock
  round: number;                             // 0-based; the round being played or revealed
  roundStartsAt: string | null;
  roundEndsAt: string | null;
  revealEndsAt: string | null;
  you: { username: string; isHost: boolean; isResolver: boolean; team: 0 | 1 | null };
  players: Array<{ username: string; team: 0 | 1 | null; total: number; guessed: boolean; active: boolean; rating: number | null /* ranked only */ }>;
  places: Place[] | null;                    // null until posted
  results: Array<{                           // finished rounds only; the current round appears when it is revealed
    round: number;
    guesses: Array<{ username: string; lng: number | null; lat: number | null; distanceKm: number | null; score: number }>;
  }>;
  outcome: null | {
    winners: string[];                       // usernames; empty for a draw or a cancelled match
    ratingChanges: Array<{ username: string; before: number; after: number }>;   // ranked only
  };
}
```

Other players' guesses for the current round are never sent before the reveal.

### `GET /api/daily` (no session needed)

```ts
{
  date: string;                              // UTC, YYYY-MM-DD
  seed: string;                              // derived from the date
  settings: { map: 'world'; mode: 'move'; timeLimit: 120; rounds: 5 };
  yours: { score: number; maxScore: number } | null;      // null for visitors or not yet played
  leaderboard: Array<{ username: string; score: number }>; // top 20 today
}
```

### Changes to existing routes

- `POST /api/games` accepts an optional `daily: 'YYYY-MM-DD'`. The server accepts it only when it is today (UTC) and `seed` and settings match the daily. One daily result per account per day; a second is answered with the first.
- `GET /api/account` adds `rating: number` to `account` and `ratedGames: number` to `stats`.

## Interface

- **Home** is two panes. A left sidebar lists: Singleplayer; Ranked duel, Unranked match, 2v2 match; Create party, Join party; Daily challenge; Account. The right pane shows the selected item: the existing options form for Singleplayer, a queue panel for the three matchmade kinds, a settings form for Create party, a code field for Join party, today's leaderboard and a Play button for Daily. On a phone the sidebar stacks above the pane.
- Multiplayer items shown to a visitor explain that an account is needed and link to it.
- **Lobby** (party): the code, a copyable join link (`?party=CODE`), the player list, the settings, Start for the host.
- **Queue**: "Looking for players", how many are waiting, Cancel.
- **In a match** the existing round screen is reused. Differences: the timer follows the server; after guessing the player sees who else has guessed; the reveal shows every player's pin and a round table; the summary is the final standing with rating changes for ranked.
- Follows `~/DESIGN.md` like the rest of the site.

## Testing

- Server: vitest against PGlite for every transition, including two players guessing at once, a player going inactive, queue pairing under concurrency, and Elo arithmetic.
- Browser: Playwright with `/api/match` and `/api/daily` mocked, covering create/join/lobby, a full two-player match from one player's side, the queue, and the daily.
- Live: two real browser sessions playing a party and a ranked duel against each other on the deployed site.
