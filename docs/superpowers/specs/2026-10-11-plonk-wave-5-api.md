# Plonk wave 5: API contract

Date: 2026-10-11. Written by the server builder for the browser builder. It covers every **S** and **S+B** item of `2026-10-11-plonk-wave-5.md`. Where it differs from an earlier spec, this wins. Anything not mentioned is unchanged.

Section 11 lists everything that changed in this document after it was first written.

Conventions as before: JSON, the envelope `{ success: true, data } | { success: false, error }`, ISO 8601 times, Origin check on writes. `country` is always a two-letter upper-case code or `null`. Still nine functions; no new route file.

## 1. Identity: accounts and guests (item 13)

- `POST /api/match { action: 'guest' }` needs no session. It makes a guest, sets the same session cookie an account gets, and replies **201** `{ username: 'Guest #4821' }`. If the request already carries a valid session (account or guest) nothing is made, no cookie is set, and that identity's username is returned with **200**. 20 an hour per address, then 429 `Too many guests from this network. Try again in an hour.`
- A guest name always has a space and a `#`, which no account name can, so it cannot collide with or pass for one. A guest session lasts **24 hours from when it was made** and is not renewed: after that every request answers 401 `Sign in first.` and the browser may send `guest` again, which makes a new guest with a new name. The guest's row is removed once it is a day old, has not been seen for a day, and holds no seat in a match that is still going. Signing in or up replaces the guest session.
- A guest **may**: `GET /api/match` (both forms); match actions `queue` with `kind: 'unranked'`, `join`, `guess`, `pin`, `team`, `emote`, `mute`, `leave`, `leaveQueue`; maps `play`; `GET /api/social?online=1`; every route that needs no session.
- Everything else that needs an account answers a guest **403 `Guests cannot do that. Make an account first.`** A visitor with no session still gets 401 `Sign in first.`
- `GET /api/account` for a guest: `{ account: null, guest: 'Guest #4821', stats: null, recentGames: [] }`.
- A session is a signed token and outlives its account. A browser still signed in to an account that has since been deleted is answered as a visitor is, 401 `Sign in first.`, by every write that needs an account (`POST` to `/api/account`, `/api/social`, `/api/games`, `/api/daily` `start` and `claim`, `/api/maps` except `play`, and `create`, `join` and `queue` on `/api/match`), and `GET /api/account` says `account: null`.

## 2. Scoring (item 1)

`distanceKm` is the haversine distance with Earth radius 6371.0088 km. With `scaleKm` the map's scale:

```
score = 5000                                   if distanceKm <= 0.03
      = s > 4997 ? 5000 : s                    otherwise, s = round(5000 * exp(-10 * distanceKm / scaleKm))
```

`scaleKm` is 20000 for the world map (`WORLD_SCALE_KM`), and the diagonal of the map's places for every other map (sent by the browser as before, 100 to 20000). A hinted round is `floor(score / 2)`. `server/match/scoring.test.ts` compares the server's copy with `src/game/scoring.ts` and fails until the browser side is changed to match.

## 3. Rating, leagues, XP (items 7, 8, 9, 16)

- New accounts start at **500**. Floor 100. Existing accounts with no rated game are set to 500; accounts with rated games keep their rating.
- Expected score `E = 1 / (1 + 10 ^ ((opponent - own) / 340))`. `K` is 40 while the player has fewer than 30 rated games, 20 below 100, then 10; never more than 20 from rating 900 and never more than 10 from rating 1000. Change `= round(K * (S - E))` with each player's own `K`; a win or loss always moves by at least 1.
- The nth win over the same opponent on one UTC day pays the winner `max(1, round(gain * (7 - n) / 6))` for n = 1 to 6 and **0** from the seventh. The loser's loss is not reduced.
- Leagues by rating: `Trekker` from 0, `Explorer` 800, `Voyager` 1000, `Nomad` 1300, `Legend` 1800.
- XP: `round(score / 50)` per round in singleplayer, daily, public unranked and 2v2; **double** that in ranked; none in parties or on community maps; 20 per correct country in a streak; 20 per correct answer in Country Guesser and Continent Guesser. Level is still `floor(sqrt(xp / 250)) + 1`. Guests earn none.

## 4. Matches

### Kinds

| kind | players | settings (fixed unless party) | chat |
|---|---|---|---|
| `party` | 2 to 20 | host's choice, see below | host's choice |
| `unranked` | 2 to 10, gathered over a 10 s countdown | world, move, 45 s, 5 rounds | reactions only |
| `ranked` | 2 | world, **move**, 60 s, at most **5** rounds, health | reactions only |
| `team` | 4 | world, move, 60 s, 5 rounds, team health | chat, with a team scope |

### Timing (items 5, 6)

The browser never computes a deadline. It shows `roundStartsAt`, `roundEndsAt` and `revealEndsAt` against `serverNow`, and must expect `roundEndsAt` to move **earlier** between polls.

- Get-ready before every round: **5 s** (`roundStartsAt` is 5 s after the places are posted or the last reveal ends).
- Reveal: 10 s; 8 s in `ranked`; **5 s after the last round of any match** (the last by count, or the one that decides a health match).
- Timer cut: when a guess leaves exactly one player who can still guess in the round, `roundEndsAt` becomes `now + 20 s` if it was later (`now + 15 s` in `ranked`). Not applied when the round has no timer.
- No timer (`timeLimit: 0`, parties only): `roundEndsAt` is `null`; the round ends when everyone playing it has guessed or the host sends `endRound`.
- Unchanged: a guess is taken up to 1 s after `roundEndsAt`; 45 s to post places; 30 s without a poll makes a player inactive; a queue entry lapses after 10 s without a poll.

### `MatchState` (full)

```ts
interface MatchState {
  id: string;
  code: string | null;                         // parties only
  kind: 'party' | 'unranked' | 'ranked' | 'team';
  phase: 'lobby' | 'preparing' | 'playing' | 'reveal' | 'finished';
  settings: {
    map: MapId; mode: Mode;
    timeLimit: number;                         // 0 = no timer, else 10..300 in steps of 10
    rounds: number;                            // 1..20
    communication: 'chat' | 'reactions' | 'off';
    teams: 'none' | 'best' | 'average';        // party team mode; 2v2 is always 'best'
  };
  locked: boolean;                             // parties: closed to new players
  seed: string;
  serverNow: string;
  round: number;
  roundStartsAt: string | null;
  roundEndsAt: string | null;                  // null: no timer
  revealEndsAt: string | null;
  you: { username: string; isHost: boolean; isResolver: boolean; team: 0 | 1 | null; guest: boolean; muted: string[] /* usernames */ };
  players: Array<{ username: string; country: string | null; guest: boolean; team: 0 | 1 | null; total: number;
                   guessed: boolean; active: boolean; rating: number | null /* ranked */; health: number | null /* ranked */ }>;
  teams: Array<{ team: 0 | 1; health: number | null /* 2v2 */; total: number }> | null;   // 2v2 and party team modes, else null
  mates: Array<{ username: string; lng: number; lat: number; guessed: boolean }>;        // see "Team pins"
  places: Place[] | null;
  results: Array<{ round: number; guesses: Array<{ username: string; lng: number | null; lat: number | null; distanceKm: number | null; score: number }> }>;
  outcome: null | {
    winners: string[];                         // usernames; empty for a draw or a cancelled match
    ratingChanges: Array<{ username: string; before: number; after: number }>;   // ranked only
    dodgedBy: string | null;                   // ranked: who left before the first guess; see "Ranked"
  };
  chat: Array<{ id: number; username: string; text: string | null; emote: string | null; at: string; scope: 'all' | 'team' }>;   // last 30 you may see
  movedToQueue: 'team' | null;                 // see "2v2"
}
```

`Place`, `results` and the rule that the round being played is never in `results`, `total` or `health` are unchanged. `teams[].total` and `teams[].health` also count revealed rounds only.

### `QueueState` (full)

```ts
{ queued: boolean; kind: 'unranked' | 'ranked' | 'team' | null; waiting: number; matchId: string | null;
  startsAt: string | null;       // unranked countdown
  since: string | null;          // when you joined this queue; elapsed time is serverNow - since
  serverNow: string;
  window: number | null;         // ranked: your current rating window, plus or minus
  lockedUntil: string | null }   // ranked: end of a dodge lock, when one is running
```

### `POST /api/match` actions (full list)

Reply is `MatchState` unless stated. `H` = host only (403 `Only the host can do that.`). An action sent in a phase it does not apply to (`configure`, `team` or `shuffle` outside the lobby, `host` during `preparing`, `endRound` outside a round under way, `lobby` on a party that is not finished) changes nothing and answers 200 with the state as it is. A second `guess` for a round already guessed is answered the same way.

| action | fields | notes |
|---|---|---|
| `guest` | | see section 1; reply `{ username }` |
| `create` | `settings` | accounts only; reply 201. `settings` as in `MatchState`; `communication` and `teams` may be left out (`'chat'`, `'none'`) |
| `configure` H | `matchId`, `settings` | lobby only; replaces the settings |
| `join` | `code` | lobby, or a party under way (below) |
| `start` H | `matchId` | at least 2 players; with teams, each team needs one (409 `Each team needs at least one player.`). Players with no team go to the smaller team |
| `places` | `matchId`, `places` (length = rounds), `scaleKm` | resolver only |
| `guess` | `matchId`, `round`, `lng`, `lat` | |
| `pin` | `matchId`, `round`, `lng`, `lat` | where your pin is now, for teammates; send at most one a second |
| `leave` | `matchId` | reply `{ left: true }` |
| `queue` | `kind`, `matchId?` | reply `QueueState`. `matchId` only with `kind: 'team'`, to queue as a pair |
| `leaveQueue` | | reply `{ queued: false }` |
| `chat` | `matchId`, `text` (1 to 200), `scope?: 'all' \| 'team'` | `'team'` only where there are teams; default `'all'` |
| `emote` | `matchId`, `emote` | one of the twenty below |
| `mute` | `matchId`, `username`, `muted: boolean` | that player's lines and reactions are left out of **your** `chat` for the rest of the match |
| `team` | `matchId`, `team: 0 \| 1` | lobby of a party with teams |
| `shuffle` H | `matchId` | lobby of a party with teams: random even split |
| `kick` H | `matchId`, `username` | any phase. The player is out and cannot come back to this party. From then on they are in nobody's `players`, and their guesses are in no `results`, earlier rounds included |
| `host` H | `matchId`, `username` | any phase but `preparing`; the new host is also the resolver; not a guest (409 `A guest cannot host.`) |
| `lock` H | `matchId`, `locked: boolean` | |
| `endRound` H | `matchId` | `playing`, after `roundStartsAt`: reveal now |
| `lobby` H | `matchId` | finished party: back to its lobby, same code and settings (item 14) |

Reactions (`emote`): `gg`, `gl`, `hi`, `bye`, `nice`, `wow`, `oof`, `close`, `hm`, `lol`, `ty`, `sorry`, `rip`, `yes`, `no`, `think`, `clap`, `fire`, `sad`, `heart`.

Party `settings` limits: `rounds` whole, 1 to 20; `timeLimit` 0 or a multiple of 10 from 10 to 300; `map` any map id; `mode` as before. Bad settings: 400 `Choose a map, a mode, 1 to 20 rounds, and no timer or 10 to 300 seconds a round.`

Errors new in this wave (status, text):

- 403 `Chat is off in this match.` (free chat anywhere but a party with `communication: 'chat'` or 2v2); 403 `Reactions are off in this match.` (party with `communication: 'off'`).
- 403 `You were removed from that party.` to a kicked player, for `join` and for every request on that match, `GET` included.
- 409 `That party is locked.`; 409 `That party is full: it has 20 players.`; 409 `That party is on its last round. Try again when it is back in its lobby.`
- 409 `There is no such player in this match.` (`kick`, `host`, `mute`); 409 `You cannot do that to yourself.`
- 409 `Teams are off in this party.` (`team`, `shuffle`).
- 429 `You left two ranked matches before they began. You can queue again in N seconds.` (N a whole number).
- 409 `To queue as a pair, be the host of a party of exactly two.`

### Party (items 14, 15)

- Capacity 20. Joining a party that is `preparing`, `playing` or `reveal` is allowed unless it is locked, full, or on its last round; the player plays from the next round to start and scores 0 for the rest. With teams they go to the smaller team.
- Teams (`settings.teams` not `'none'`): `players[].team` is `null` until chosen (`team`) or shuffled. A team's round score is its best member's (`'best'`) or the rounded mean of its members' scores, a missing guess counting 0 (`'average'`). The team with the higher total wins; its members are `outcome.winners`.
- When the host leaves a lobby the party passes to the next **account** in it. A guest never becomes host: if only guests are left the party ends (`phase: 'finished'`, `outcome.winners: []`).
- A finished match still counts polls as heartbeats, so keep polling the finished party while its results are on screen: that is what keeps a player in it when the host sends `lobby`.
- `lobby`: the match keeps its `id` and `code` and goes to `phase: 'lobby'` with `round` 0, no places, no results, empty chat. Players who polled within the last 30 s and are not in another match stay; the rest are dropped. Polling clients simply see the phase change.

### Ranked (items 7, 10)

- Health as before (5000 each, the lower scorer loses the difference), at most 5 rounds.
- **Dodge:** if a player leaves, or goes inactive, before any guess has been made in the match, the match is cancelled: `outcome = { winners: [], ratingChanges: [], dodgedBy: <their username> }`, no rating change, and the other player is **already back in the ranked queue** when they read that state. Their browser should return to the queue screen and poll `?queue=1`. A second dodge within an hour locks the dodger out of the ranked queue for 120 s (`QueueState.lockedUntil`, and the 429 above from `queue`).
- **Matchmaking:** a player's window is `50 + 10 × whole seconds waited`. Two players are paired when their rating gap is within the larger of their two windows; the closest pair first. Two players whose last ranked match was each other within 30 minutes are not paired while a third player is waiting.

### 2v2 (item 11)

- Each team has 5000 health. Each round the team with the lower best score loses `round((higher - lower) × 1.3)`. The match ends when a team reaches 0 or after 5 rounds; more health wins; equal is a draw. `players[].health` is `null`; use `teams`.
- **Pair queue:** the host of a party lobby holding exactly two accounts, both of whom polled it within the last 30 s, sends `{ action: 'queue', kind: 'team', matchId }` (otherwise the 409 above). The lobby closes (`phase: 'finished'`, `movedToQueue: 'team'`), both are queued and will be teammates. The other player sees `movedToQueue` on their lobby poll and should switch to polling `?queue=1`. If one of them leaves the queue the other stays, alone.
- **Team pins:** during `playing`, `mates` lists your teammates (never opponents) with a pin: the position from their last `pin`, or their guess once made (`guessed: true`). It is `[]` in every other phase and in matches without teams.
- **Team chat:** a `chat` line with `scope: 'team'` is delivered only to the sender's team.

## 5. Queue and presence (items 5, 27)

- Public unranked: up to 10 players. Joining a game under way needs fewer than 10 players, at least 3 rounds not yet started, and, when a round is being played, more than 15 s left in it.
- `GET /api/social?online=1` (no session needed) → `{ online: number }`: accounts and guests seen in the last 2 minutes. With a session it also marks the caller as seen. Call it once a minute while the page is visible; this is the only presence heartbeat, and what `online` and `lastSeenAt` on friends are built from.

## 6. Account (items 13, 16, 21, 24, 25)

### `GET /api/account` (full)

```ts
{ account: null | {
    username: string; country: string | null;
    rating: number; league: string; xp: number; level: number;
    bestStreak: number; bestCountry: number; bestContinent: number;     // best scores, 0 to 10000 for the two guessers
    loginStreak: number;                                                // days in a row, UTC, counted by this route
    duels: { wins: number; losses: number; ties: number; winRate: number /* whole percent */; rank: number | null /* on the rating board */ };
    moderator: boolean; banned: boolean;
    allowFriendRequests: boolean; hideChat: boolean };
  guest: string | null;
  stats: null | { gamesPlayed; roundsPlayed; averageRoundScore; bestRoundScore; perfectRounds; bestGame; ratedGames };   // unchanged
  recentGames: RecentGame[] }                                           // unchanged
```

### `POST /api/account` (new method on the existing route; session)

| action | fields | reply |
|---|---|---|
| `password` | `current`, `next` (8 to 200) | `{ changed: true }`; 403 `That is not your current password.`; a bad `next` is 400 `Choose a new password of 8 to 200 characters.`; 10 tries an hour, then 429 `Too many tries at your password in the last hour. Try again later.` Other browsers stay signed in |
| `delete` | `password` | `{ deleted: true, restoreUntil: string }`; clears the session, and the account leaves its queue and its match exactly as if it had sent `leaveQueue` and `leave`. A wrong or missing password is 403 `That is not your current password.` and counts against the same 10 tries an hour as `password`. A moderator's account: 409 `A moderator's account cannot be deleted.` |
| `country` | `country` (code or `null`) | `{ country }`; otherwise 400 `Choose a country by its two-letter code, or none.` |
| `settings` | `allowFriendRequests?: boolean`, `hideChat?: boolean` | `{ allowFriendRequests, hideChat }`, both as they now are; otherwise 400 `A setting is either on or off.` |

Anything else: 400 `That is not something that can be asked here.` A visitor: 401 `Sign in first.` A guest: the 403 of section 1.

- `duels.winRate` is wins as a whole percent of all duels, ties included (0 with no duels). `duels.rank` is the account's place on the all-time rating board, `null` when it is not on it. `loginStreak` is counted by the first `GET /api/account` of each UTC day, which also marks the account as seen.
- **Deleted accounts** keep their username for 30 days and are invisible everywhere (profile 404, off the boards, out of friends lists). `POST /api/account/login` with the right password answers 409 `This account was deleted. Restore it to sign in.`; the same request with `restore: true` restores it and signs in. After 30 days it is gone.
- `POST /api/account/register` accepts an optional `country`; one that is not a two-letter code is stored as `null`, not refused. A bad username gets the message below; any other bad request gets 400 `Choose a password of at least 8 characters.`
- Usernames (register and rename): 3 to 20 of `a-z 0-9 _`, not starting or ending with `_`, no `__`, and none of the masked words (underscores are read as spaces first). Otherwise 400 `Choose a username of 3 to 20 letters, numbers or single underscores, not starting or ending with one.` (rename: `A username is 3 to 20 letters, numbers or single underscores, not starting or ending with one.`). Names made before this rule still sign in.

## 7. Games and history (items 4, 16, 22)

### `POST /api/games`

- Normal game: unchanged request. Scored by section 2 (world scale now 20000).
- Daily (`daily: 'YYYY-MM-DD'`): must be today, on the daily's seed, `world`, `move`, `timeLimit: 60`, **3 rounds**. One result per account per day; a second is answered with the first (200). A hinted round is halved in the daily as anywhere else.
- Runs: `{ kind: 'streak', streak, seed }` → `{ bestStreak, xpEarned }` (unchanged); `{ kind: 'country' | 'continent', correct: 0..10, seed }` → `{ best: number /* points, correct × 1000 */, xpEarned }`. A seed counts once per account across all three kinds of run.

### `GET /api/games?page=<n>` (session; 20 a page, first page 1)

```ts
{ games: Array<{ id: string; kind: 'solo' | 'daily' | 'party' | 'unranked' | 'ranked' | 'team'; playedAt: string;
                 map: string; mode: string; rounds: number; score: number; maxScore: number;
                 result: 'win' | 'loss' | 'draw' | null;          // null for solo, daily and cancelled matches
                 ratingChange: number | null;                     // ranked only
                 xpEarned: number; players: number }>,            // players: 1 for solo and daily
  page: number, more: boolean }
```

Newest first, every mode in one list. A finished match is saved for each account that was in it (not for guests), unless it ended before its places were posted. A `page` that is not a whole number from 1 is 400 `Ask for your games by page.`

### `GET /api/games?id=<id>` (owner only)

As before, for an id from either list or from `recentGames`, plus `kind`, `result`, `ratingChange`, `players` as above. For a match, `rounds` holds the player's own guess in each round (`hinted: false`).

## 8. Daily (items 4, 17)

### `GET /api/daily?page=<n>` (no session needed)

```ts
{ date: string; seed: string;
  settings: { map: 'world'; mode: 'move'; timeLimit: 60; rounds: 3 };
  serverNow: string; nextAt: string;                 // next UTC midnight
  state: 'open' | 'started' | 'done';                // 'open' for visitors
  yours: null | { score: number; maxScore: 15000; rounds: number[] /* score per round */; rank: number;
                  beat: number /* whole percent of today's other players who scored lower */ };
  streak: { current: number; best: number; atRisk: boolean };   // zeros and false for visitors
  records: null | { played: number; best: number; average: number };
  history: Array<{ date: string; score: number | null }>;       // the last 14 days, oldest first, today last; [] for visitors
  leaderboard: { entries: Array<{ rank: number; username: string; country: string | null; score: number }>; page: number; more: boolean };  // 20 a page, top 100
  distribution: number[] }                           // 10 counts of today's results: 0-1499, 1500-2999, ... 13500-15000
```

- Streak: days with a result, counted back from today (or from yesterday, when today is not played yet: `atRisk: true`). One missed day is bridged as long as it is the only missed day in the seven days ending at the next played day, which means the five days before the missed one were all played. With today unplayed and yesterday missed, the streak shown is the one that playing today would carry on.
- `yours.beat` is rounded down, and 0 while nobody else has played. `yours.maxScore` is what was stored with the result. `records` counts only results out of 15000 (the daily was five rounds before this wave); it is `{ played: 0, best: 0, average: 0 }` for an account with none, and `null` for a visitor or a guest.
- `page`: anything that is not a whole number from 1 is read as 1. A page past the fifth has no entries and `more: false`.
- The browser picks the three places from the seed; that they are in three countries on two continents is its rule, not checked here.

### `POST /api/daily`

| action | fields | reply |
|---|---|---|
| `viewer` | | unchanged, no session |
| `start` | | account. Marks today's one attempt as begun: `{ state: 'started' \| 'done' }`. After it `GET` says `'started'` until the result is saved, and the browser must not start the daily again from a fresh page. 30 an hour, then 429 `Too many dailies started in the last hour. Try again later.` |
| `claim` | `results: Array<{ daily: string; rounds: Round[] }>` (1 to 14) | account, within 24 hours of signing up: saves a visitor's stored results. `{ claimed: string[] }`, the dates taken. A date is skipped when it is older than 14 days, not 3 checkable rounds, or already played by the account. Of two results for one day the first is taken. Otherwise 403 `Results can only be claimed on the day an account is made.` A body that is not 1 to 14 results: 400 `A claim holds 1 to 14 results.` 10 an hour, then 429 `Too many claims in the last hour. Try again later.` |

`Round` is the round shape of `POST /api/games`; scores are worked out by the server.

## 9. Social (items 21, 23, 24, 27)

### `GET /api/social?leaderboard=rating|xp|streak&period=all|day`

```ts
{ board: string; period: 'all' | 'day';
  entries: Array<{ rank: number; username: string; country: string | null; value: number; level: number; league: string }>,   // top 100
  you: { rank: number; value: number } | null }
```

`period=all` (default) leaves out accounts not seen for 14 days, with no activity on that board, banned or deleted. An account that has never been seen goes by the day it was made, so accounts older than this wave are off the all-time boards until their player next opens the site. `period=day` ranks today's (UTC) gain: the XP earned today, the sum of what today's ranked duels moved the rating by, or the best streak run made today; only accounts with a positive value. A bad `period` is 400 `Ask for a period of all or day.`

### `GET /api/social?profile=<username>&range=7|30|all`

```ts
{ username: string; country: string | null; joinedAt: string;
  xp: number; level: number; rating: number; league: string; ratedGames: number; gamesPlayed: number;
  bestStreak: number; bestCountry: number; bestContinent: number;
  duels: { wins: number; losses: number; ties: number; winRate: number; rank: number | null };
  views: number;                                             // counts views by anyone but the owner
  friend: 'self' | 'friends' | 'outgoing' | 'incoming' | 'none' | null;   // null for visitors and guests
  online: boolean; lastSeenAt: string | null;
  recentGames: RecentGame[];
  history: Array<{ day: string; xp: number; rating: number; xpRank: number | null; ratingRank: number | null }> }   // range, default 30; 'all' is the last 365 points
```

Ranks in `history` are null for days recorded before this wave. A bad `range` is 400 `Ask for a range of 7, 30 or all.`

### `GET /api/social?friends=1`

`friends` entries become `{ username, country, level, league, party, online: boolean, lastSeenAt: string | null }`. The rest is unchanged. `online` is true for two minutes after the friend was last seen; an account is seen when it calls `?online=1` and on its first `GET /api/account` of the day, not when it signs up, so a new account is `online: false`, `lastSeenAt: null` until its browser makes that first call.

### `POST /api/social`

Unchanged, except: `request` to a player who has turned requests off answers 403 `That player is not accepting friend requests.` (accepting a request they sent you still works).

## 10. Maps (item 20)

- `GET /api/maps?list=popular|newest|mine|liked` (`liked` needs a session). `popular` is by likes, then plays, then newest. `q` of 3 or more characters searches name, description and maker; a shorter `q` is ignored. `liked` lists the newest map first.
- `MapSummary` gains `description: string` (the short one). `GET ?slug=` also gains `details: string` (the long one, may be empty).
- `save`: `name` 3 to 30, `description` 20 to 100 (required), `details` up to 1000 (optional; line breaks are kept), `locations` 5 to 5000 rows. 400 `A map needs a name of 3 to 30 characters, a description of 20 to 100, and 5 to 5000 places.` Maps saved earlier keep what they have until they are next saved.

## 11. Changes since first writing

Everything below was added or changed after the first version of this document, while the server was being built. Nothing was taken away; the one line that says something different from what the first version said is marked **changed**. The rest are additions where the first version was silent.

**Changed**

1. Section 1, guests' lifetime. First version: "Guests are deleted after 24 hours without a request." Now: the guest **session** lasts 24 hours from when it was made and is not renewed; after it the browser gets 401 and may send `guest` again for a new guest. The row is removed once a day old, unseen for a day and in no live match.

**Added: statuses and texts**

2. `guest` answers 201 when it makes a guest and 200 (no cookie) when the request already had a session.
3. `POST /api/account`: 400 `Choose a new password of 8 to 200 characters.`; 429 `Too many tries at your password in the last hour. Try again later.`; `delete` with a wrong or missing password 403 `That is not your current password.` (sharing the 10 tries an hour); 409 `A moderator's account cannot be deleted.`; 400 `Choose a country by its two-letter code, or none.`; 400 `A setting is either on or off.`; 400 `That is not something that can be asked here.`
4. `POST /api/account/register`: a bad request that is not a bad username gets 400 `Choose a password of at least 8 characters.`; a `country` that is not a code is stored as `null`.
5. `GET /api/games?page=`: a bad page is 400 `Ask for your games by page.`
6. `POST /api/daily`: `start` 429 `Too many dailies started in the last hour. Try again later.` (30 an hour); `claim` 400 `A claim holds 1 to 14 results.` and 429 `Too many claims in the last hour. Try again later.` (10 an hour).
7. `GET /api/social`: 400 `Ask for a period of all or day.`; 400 `Ask for a range of 7, 30 or all.`
8. A browser still signed in to a deleted account gets 401 `Sign in first.` from every write that needs an account (list in section 1).

**Added: behaviour**

9. A match action sent in the wrong phase, and a second `guess` for the same round, answer 200 with the unchanged state.
10. A removed (`kick`) player is in nobody's `players` and no `results`, in every phase, earlier rounds included.
11. A guest never becomes host; a lobby left with only guests ends.
12. A finished match counts polls as heartbeats (this is what `lobby` goes by).
13. The pair queue needs both players to have polled the lobby within 30 s.
14. Deleting an account takes it out of its queue and match as `leaveQueue` and `leave` would; changing a password leaves other browsers signed in.
15. `duels.winRate` counts ties in the total; `duels.rank` is the all-time rating board place or `null`; `loginStreak` is counted by the day's first `GET /api/account`.
16. Masked words in usernames: underscores are read as spaces first.
17. Run seeds count once per account across `streak`, `country` and `continent`. A finished match is not in the history when it ended before its places were posted. Hinted daily rounds are halved.
18. Daily: the reading of the one-missed-day rule; `beat` rounded down and 0 alone; `yours.maxScore` is the stored value; `records` counts results out of 15000 only; `page` handling; of two claimed results for one day the first is taken.
19. Boards: an account never seen goes by the day it was made, so accounts older than this wave drop off the all-time boards until they return.
20. Friends: when an account counts as seen, and that a new account is not `online` until its browser's first presence call.
21. Maps: `liked` is newest first; `details` keeps line breaks.

