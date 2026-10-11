# Plonk wave 6: API contract

Date: 2026-10-11. Written by the server builder for the browser builder. It covers the **S+B** items of `2026-10-11-plonk-wave-6.md` (2, 5, 6, 7, 8, 9, 10, 11, 14, 22) and everything in its section C that changes what the browser sends or receives (16, 17, 18, 19, 21, 23, 24, 25, 26, 27, 28). Where it differs from `2026-10-11-plonk-wave-5-api.md`, this wins. Anything not mentioned is unchanged.

Conventions as before: JSON, the envelope `{ success: true, data } | { success: false, error }`, ISO 8601 times, Origin check on writes. Still nine functions; no new route file.

**What the browser must change, in one list** (details in the sections named):

1. Send a place `id` with every round of a saved game, and stop relying on `scaleKm` (section 5).
2. Start a streak or guesser run on the server before it begins, and finish it with the places and answers, not a count (section 6).
3. Send `start` for the daily as a visitor too, keep the token it returns, and send it with a claim (section 7).
4. Expect `MatchState.places` to hold only the rounds reached so far (section 4).
5. Draw the places of a public, ranked or 2v2 game from at least three continents (section 4).
6. Post places when `you.isResolver` is true even as a guest (section 4).
7. Treat a 401 on a session that used to work as "signed out" (section 1).
8. Poll a match at the interval its player count asks for (section 3).

## 1. Sessions (item 22)

- A session now ends when the account changes its password, uses a recovery code, is deleted, is banned, or chooses "Sign out everywhere". A browser whose session has ended is answered exactly as a visitor is: 401 `Sign in first.` wherever a session is needed (match polls included), and `GET /api/account` says `account: null` and clears the cookie.
- Sessions made before this wave keep working until one of those things happens.
- `POST /api/account { action: 'password', current, next }`: unchanged reply `{ changed: true }`, and the reply now sets a new session cookie. This browser stays signed in; every other browser is signed out.
- `POST /api/account { action: 'signOutEverywhere' }` → `{ signedOut: true }`. It clears this browser's cookie too. `POST /api/account/logout` is unchanged and signs out this browser only.
- A ban signs the account out everywhere. It can sign in again and is still banned.

## 2. Account recovery (item 5)

A recovery code is 12 characters shown in three groups of four, `K7QM-2XHD-9RWP`, from the letters and digits `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0 O 1 I L`). Wherever the browser sends one back, case, spaces and hyphens do not matter. The server keeps only a hash; a code is shown once, in the reply that makes it.

- `POST /api/account/register`: the reply becomes `{ username, recoveryCode }`.
- `GET /api/account`: `account` gains `hasRecoveryCode: boolean` (false for accounts made before this wave until they issue one).
- `POST /api/account { action: 'recoveryCode', password }` → `{ recoveryCode }`. It replaces any earlier code. A wrong or missing password is 403 `That is not your current password.` and counts against the same 10 tries an hour as `password` and `delete`.
- Forgot password is the sign-in route with other fields: `POST /api/account/login { username, recoveryCode, newPassword }`.
  - Success: 200 `{ username, recoveryCode }`, the session cookie set. The password is now `newPassword`, `recoveryCode` is a **new** code (the one used is spent), and every other browser is signed out.
  - 401 `Wrong username or recovery code.` for an unknown name, an account with no code, or a wrong code.
  - 400 `Choose a new password of 8 to 200 characters.` (checked before the code).
  - 429 `Too many attempts. Try again in 15 minutes.`, the same limits as signing in, counted together with them.
  - A deleted account: 409 `This account was deleted. Restore it to sign in.` when the code is right; the same request with `restore: true` restores it and signs in.

## 3. Parties (items 6, 7)

- Capacity is **40**. 409 `That party is full: it has 40 players.`
- Poll `GET /api/match?id=` every **1.5 s** while `players.length` is 10 or fewer, every **2.5 s** up to 20, every **4 s** above. `roundEndsAt` can still move earlier between polls; the cut for the last player to guess (20 s) is longer than any interval.
- `MatchState.settings` gains `guests: boolean`. `create` and `configure` accept it in `settings`; left out it is `true`. Queue games always say `true`.
- With `guests: false`, a guest's `join` (lobby or game under way) is 403 `This party is for accounts only. Make an account to join.` Guests already in the lobby when the host turns it off stay; the host can remove them with `kick`.
- A player who was banned since they sat down is left behind when the party starts a game or returns to its lobby (they then get 404 from that match like anyone not in it).
- A host who leaves a party, in its lobby or with a game under way, is no longer its host. The party passes to the next account still in it (never a guest), who sees `you.isHost: true` and `you.isResolver: true` on their next poll and must post the places if the match is still `preparing`. The player who left gets 403 `Only the host can do that.` for `kick`, `lock`, `endRound`, `lobby`, `host` and `configure`. With no account left to take it, a game under way plays on with no host.

## 4. Matches and queues (items 2, 8, 16, 18, 19, 20, 23, 26, 27)

### `MatchState.places` (item 26)

`places` is `null` until the first round's get-ready begins, then holds the places of rounds `0` to `round` only: `places.length === round + 1`. The place of the next round appears when `round` moves on, which is at the start of its 5 s get-ready, so there is still time to load it. `places[round]` is the one being played. The resolver's own browser knows the rest because it drew them.

### `places` action (items 2, 16, 18, 19)

`{ action: 'places', matchId, places: Place[] }`, `Place = { id, lng, lat, country }`, one per round. `scaleKm` is no longer read and may be left out.

- Every place must be a place of the match's map, by `id`, with the coordinates the list gives it (within 0.0001°):
  - official maps: in `locations.google.json` or `locations.json`, all from the **same** file, and for a country or region map, of that country or region;
  - a community map: in that map as it is stored now.
  - Otherwise 400 `Those places are not on this match's map.` No place twice: 400, same text.
- **Spread (item 2):** in `unranked`, `ranked` and `team` matches (always the world map), when the match has three or more rounds, the places must be on at least **three** of the six continents. A place's continent is `continentOf` of `src/game/continents.ts` (by country code, Russia split at 60°E). Otherwise 400 `A world game needs places on at least three continents.` Parties are not held to this.
- The scoring scale is the server's: 20000 km on the world map; on a country or region map, the diagonal of that map's places in the file the posted places came from; on a community map, the diagonal of its places, at least 100 km. This is what `scaleForMap` already gives the browser, so scores shown locally still agree.
- **A guest may be the resolver** of a public (`unranked`) game: when `you.isResolver` is true, post the places, guest or not. `places` is no longer refused to a guest.
- **Ranked:** if the resolver has not posted places when the 45 s run out, the match is cancelled as a dodge by the resolver: `outcome = { winners: [], ratingChanges: [], dodgedBy: <resolver> }`, the other player is back in the ranked queue, and it counts towards the resolver's dodge lock.

### `QueueState` (items 8, 20)

```ts
{ queued, kind, waiting, matchId, startsAt, since, serverNow, window, lockedUntil,   // as before
  typicalWaitSeconds: number | null }
```

- `typicalWaitSeconds`: the median time players waited in **this** queue (`kind`) before a match was found, over matches found in the last 24 hours, in whole seconds. `null` when `kind` is `null` or no match was found in that queue in the last 24 hours ("no recent games"). The browser words it ("usually under a minute" below 60, "about N minutes" otherwise).
- `window` no longer grows past **400**.
- A banned account is not put back in the ranked queue after an opponent's dodge. Queueing as a pair with a banned partner is the existing 409 `To queue as a pair, be the host of a party of exactly two.`

### Limits on match writes (item 27)

Every `POST /api/match` action that names a `matchId` is limited to **240 a minute per player per match**; then 429 `Too many requests. Slow down a little.` `leaveQueue` is limited to 60 a minute per session with the same 429. Nothing on `/api/match` is limited by address except `guest` (20 new guests an hour, now **60**, so a class can arrive together). Polls (`GET`) are not limited.

### Rating (items A1, 20; nothing to send, for the record)

- The nth win over the same opponent on one UTC day is worth the full change for n = 1, 2, 3, then ×0.75, ×0.5, ×0.25, and nothing from the seventh. The same factor now trims the loser's loss.
- A win or loss moves a rating by at least 1, except when the factor is 0 and except when the winner was rated 400 or more above the loser.

## 5. Saved games (items 16, 17)

`POST /api/games` (a normal game or the daily):

```ts
{ map, mode, timeLimit, seed, daily?,
  rounds: Array<{ id: string;                       // NEW, required: the place's id
                  lng: number; lat: number;         // where the place is; now required
                  guessLng: number | null; guessLat: number | null;   // null, null for no guess
                  hinted?: boolean;
                  country?, distanceKm?, score? }> } // still accepted, no longer read
```

- Every round's place must be on the game's map, by the same rule as the `places` action above (same file for all rounds; the map's country or region; or the community map). Otherwise 400 `That game could not be saved: its places are not on its map.`
- `country`, `distanceKm` and `score` are worked out by the server (the country is the list's). `scaleKm` is no longer read; the scale is the server's, as above.
- The reply gains `xpCapped: boolean`. XP from solo play (games, the daily, runs) stops at **20,000 per account per UTC day**; a game past the cap is saved as usual with `xpEarned` cut to what was left (0 once it is used up) and `xpCapped: true`.
- Not affected: the tutorial (never saved), challenge links (their places are drawn from the same files), and community maps made earlier (their places are checked against the map itself).

## 6. Streak and guesser runs (items 16, 17, and item 3's background streak)

A run is started on the server and finished with what was played. The old body `{ kind, streak | correct, seed }` is no longer accepted (400).

**Start:** `POST /api/games { action: 'start', kind: 'streak' | 'country' | 'continent' }` → 201 `{ run: string }` (an opaque token; keep it with the run). Accounts only. 120 an hour, then 429 `Too many runs started in the last hour. Try again later.`

**Finish:** `POST /api/games { kind, run, rounds: Array<{ id: string; answer: string | null }>, inPlay?: boolean }`

- `id` is the place shown; it must be in one of the two files (400 `That run could not be saved: its places are not known.`). `answer` is what the player chose: a two-letter country code for `streak` and `country`, one of `africa asia europe north-america oceania south-america` for `continent`, `null` for no answer.
- The server counts. `streak`: the number of rounds from the first whose answer is the place's country, stopping at the first that is not; send every round played, the losing one last (1 to 501 rounds). `country` and `continent`: how many of the rounds are right (1 to 10 rounds; a place with no continent cannot be asked).
- Time: a finish is refused with 409 `That run finished sooner than it could have been played.` when it arrives less than **2 seconds per round sent** after its start.
- A run counts once: finishing the same `run` again answers 200 with the first result and `xpEarned: 0`. A `run` that is not one this account started for this `kind` is 400 `That run was not started here.`
- Replies: `streak` → `{ bestStreak, streak, xpEarned, xpCapped }`; `country`/`continent` → `{ best, correct, xpEarned, xpCapped }`.
- `inPlay: true` (streak only) is for the streak counted in the background of ordinary world games (spec item 3): start a run when the streak's first round is played, finish it when the streak ends, with the rounds that made it. It sets the best streak and is on the day's streak board, and pays **no XP**, since the games it ran through paid theirs.

## 7. Daily (items 11, 16, 17)

### `GET /api/daily`

`yours` gains two fields:

```ts
yours: null | { score, maxScore, rounds, rank, beat,          // as before
                averages: number[] | null,   // the day's mean score for each round, rounded; null until 5 players have finished
                personalBest: boolean }      // true when this total is higher than every earlier daily of the account (false for its first)
```

The browser shows `rounds[i] - averages[i]`. `averages` counts every finished result of the day out of 15000, the player's own included.

### `start`, the result, and `claim`

- `POST /api/daily { action: 'start' }` now also works **without a session** (and for a guest): → `{ state: 'started', token: string }`. For an account the reply is as before with `token: null`. A visitor's browser keeps `token` with the result it stores. 120 an hour per address for visitors.
- Saving the daily (`POST /api/games` with `daily`) is refused unless the account sent `start` today (409 `Start the daily before you finish it.`) and at least **6 seconds** have passed since (409 `That daily finished sooner than it could have been played.`).
- The three places must be the day's: all from one file, within the first **100** places that the day's seed puts that file in (`pickDistinct(locations, locations.length, createRng(seed))` of `src/daily/draw.ts`), in three countries on at least two continents. Otherwise 400 `Those are not today's places.` Places redrawn around a missing picture and spares are inside that 100.
- `claim`: `{ action: 'claim', results: Array<{ daily: string; token: string; rounds: Round[] }> }`. A result is taken only when its `token` came from a visitor `start` on that same UTC day and its places are that day's by the rule above; otherwise it is skipped, as before. `Round` is the round of section 5 (with `id`). Results stored by a browser before this wave have no token and cannot be claimed.

## 8. Account and social (items 9, 10, 14, 25, 27)

### 2v2 record (item 9)

`GET /api/account` `account` and `GET /api/social?profile=` both gain, beside `duels`:

```ts
teams: { wins: number; losses: number; ties: number; winRate: number /* whole percent of all 2v2 matches, ties included */ }
```

### Switches (item 14)

- `POST /api/account { action: 'settings', ... }` accepts `hideLastSeen?: boolean`; its reply and `GET /api/account` `account` gain `hideLastSeen: boolean` (default false).
- With it on, everyone else sees `lastSeenAt: null` for that account, in `?friends=1` and `?profile=`. `online` is still sent.
- `GET /api/social?leaderboard=…&period=all&inactive=1` includes accounts not seen for 14 days. Ignored with `period=day`. The reply gains `inactive: boolean` (what was applied).

### Reports (item 10)

- `POST /api/social { action: 'report', username, category, reason? }`. `category` is required: `'cheating' | 'name' | 'chat' | 'other'`. `reason` is the optional note (up to 200). Without a valid category: 400 `Say what the report is about: cheating, name, chat or other.` Reporting the same player again replaces the earlier report and reopens it.
- `GET /api/social?reports=1` (account) → `{ reports: Array<{ username: string; category: string; note: string; at: string; status: 'open' | 'actioned' | 'dismissed' }> }`, newest first, at most 50. These are the account's reports of **players**; reports of maps are not listed (a removed map takes its reports with it, so there would be nothing to show a status on). A report of an account that has since been deleted is not listed.
- Status: `actioned` once a moderator bans the player; `dismissed` when a moderator dismisses the reports. Lifting a ban changes nothing here.
- `GET /api/social?moderation=1` and the `moderate` reply: each entry of `players` has `reasons: Array<{ category: string; note: string }>` (it was `string[]`), newest first, open reports only; `reports` counts open reports. `maps` is unchanged.

### Other

- **Moderator names (item 25):** `register` and `rename` to a name listed in `MODERATORS` answer as for a taken name (409 `That username is taken. Choose another, or sign in.` / `That username is taken. Choose another.`).
- **Limits (item 27):** `accept`, `decline`, `remove` on `/api/social` and `country`, `settings` on `/api/account`: 120 an hour per account, then 429 `Too many requests. Slow down a little.` `delete` on `/api/maps`: 60 an hour, same 429.
- **Maps (items 23, 27):** `save` is refused with 409 `An account's maps can hold 25,000 places in all. Make this one smaller, or delete another.` when the account's maps would hold more. `GET /api/maps?slug=` of a map whose maker is banned or deleted is 404 `There is no such map.` (its maker still gets it).
- **Profile views (item 27):** `views` counts each viewer once per UTC day (an account by its session, a visitor by address).
- **Google viewer (item 21):** `POST /api/daily { action: 'viewer' }` is unchanged in shape. It now answers `google: false` to an address that has asked for **40** viewers today (a class behind one address), and to a visitor or guest once two thirds of the day's allowance is used (the rest is kept for accounts). Send the session cookie with it, as with every call.

## 9. Everywhere (item 28)

- A NUL character (`\u0000`) anywhere in a request body is 400, with the route's usual "not valid" message.
- The Origin check now compares the scheme as well as the host. Nothing changes for a browser on the site itself.

## 10. Changes after first writing

Everything below was added or changed after the first version of this document, while the server was being built.

**Changed**

1. Section 3, a host who leaves. The first version said the leaver's host actions get 404. They get 403 `Only the host can do that.`, and the party passes to the next account still in it (one who is being heard from before one who is not), in a game under way as in the lobby.

**Added**

2. Section 3: `lobby` (taking a finished party back to its lobby) is refused to a banned host with 403 `This account is banned from online play.`, like `start`.
3. Section 4: the walk-out for places that never came is only called when both players were there throughout. If one of them stopped polling first, that player is the one named, as before.
4. Section 4: a refused `places` post changes nothing, and the resolver may post again until the 45 s run out. Of two posts sent at once the first to arrive is kept and the second answers 200 with the state.
5. Section 4: writes by a player who has already left the match are not counted against the 240 a minute, since nothing they send changes anything.
6. Section 2: a sign-in body that has a `recoveryCode` key is a recovery request, even with a `password` beside it. A code that is not 12 characters of the alphabet once tidied is the same 401 as a wrong one.
7. Section 5: `guessLng` and `guessLat` both null, or both left out, is a round with no guess; one without the other is 400 `That game could not be saved: its details are not valid.` A game on a community map that has since been deleted is the 400 for places not on its map (it was saved before this wave). `xpCapped` is false when the game earned nothing to begin with.
8. Section 6, runs:
   - A malformed finish (the old body, no `run`, rounds out of range, an answer that is not a code or a continent) is 400 `That game could not be saved: its details are not valid.`
   - A Continent Guesser round on a place with no continent is 400 `That run could not be saved: its places are not known.`
   - A streak of 501 right answers counts as 500. Rounds sent after the first wrong one are not counted, but must be known places and do count towards the 2 seconds a round.
   - A run's places need not all be from one file, nor all different.
   - A run token does not expire (the background streak can run for days). Starts have their own limit (120 an hour); a finish counts against the 60 saves an hour that games do.
   - `inPlay` on a `country` or `continent` run is ignored. A run finished a second time answers with `xpCapped: false`.
9. Section 7, daily:
   - Any failure of the three places (unknown id, two files, a place twice, not the day's draw) is 400 `Those are not today's places.`
   - Order of checks when saving: is it today's; the places; then the start and the 6 seconds. A day already played is answered with the first result (200) before the start or the time is asked about.
   - A visitor's `start` over the limit is 429 `Too many dailies started in the last hour. Try again later.` A guest's `start` is the visitor's (200 with a token), not a 403; so is that of a browser whose session has ended.
   - A visitor's token is good only for results of its own UTC day, and is not tied to one browser.
   - `averages` is taken over the results on the day's board (accounts that are not banned or deleted) and the asker's own. `personalBest` looks only at earlier dailies out of the same maximum.
10. Section 8, reports: a username that could not be one is 404 `No player by that name.`; a note over 200 characters is 400 `A reason is up to 200 characters.` A moderator's decision changes open reports only: a dismissed report does not become `actioned` by a later ban.
11. Section 8, limits: the 120 an hour is counted for each action on its own (`accept`, `decline`, `remove`, `country`, `settings`), and a refused request counts. `signOutEverywhere` has no limit.
12. Section 8, leaderboards: only exactly `inactive=1` turns it on; with it on, `you` is ranked among everyone.
13. Section 8, maps:
    - An account already over 25,000 places cannot save over any of its maps until it is under.
    - A map whose maker is banned or deleted cannot be liked, reported or counted as played by anyone else either (404 `There is no such map.`), and a party cannot be opened on it (the existing 404 `That map does not exist.`).
14. Section 8, the Google viewer: a visitor or guest is refused once floor(2/3 × the day's allowance) viewers have been given out. The 40 a day per address applies to accounts as well, and counts every ask from that address, granted or not. `usedToday` now counts viewers given out, not asks.
15. Section 8, profile views: a guest is counted as the visitor at its address.
16. Section 8, the Google viewer: the cap per address per UTC day is **40**, not 10, so a class of 40 behind one address all get Google. The older limit on how often one address may ask at all is raised with it, from 30 to 240 an hour (429 `Too many games started from this network in the last hour. Try again later.`), so that class is not refused within one lesson. The last third of the day's allowance is still kept for signed-in accounts.

