# Wherefall

Live at https://wherefall.vercel.app. The game was called Plonk until 2026-10-11: the folder, the Vercel project, the cookie and the browser storage keys keep that name, and https://plonk-two.vercel.app still serves it.

A free street-view guessing game. You are dropped into a street panorama somewhere on Earth, you can look around and walk the street, and you put a pin on the map where you think you are. Up to 5,000 points a round.

What is in it:

- **Solo:** singleplayer (world, four regions, any country with enough places, or a community map; 3, 5 or 10 rounds; timer off or 10 to 300 seconds; move, no-move, or no move/pan/zoom; up to two hints a game, each halving its round), country streak, Country Guesser and Continent Guesser, a tutorial, and a daily challenge (three rounds, one attempt a day, a streak, a leaderboard and a shareable result).
- **Online:** ranked duels on a health system with ratings and leagues, public unranked games for up to 10 that can be joined under way, 2v2 with shared team health, and parties for up to 40 joined by code or friend invite, with host controls, team mode, chat and reactions. Visitors without an account can play public unranked and join parties as guests (a host can turn guests off).
- **Community:** maps anyone can make from places with Street View (search, likes, a preview of the places), leaderboards, friends with online status, public profiles, reports and a moderation pane.
- **Account (optional):** XP and levels, progress charts, game history for every mode with a replay map, a country flag, kilometres or miles, sound volume, password change, a one-time recovery code for a forgotten password (there is no email), "Sign out everywhere", and account deletion with a 30-day restore window.
- **Everywhere:** five languages (English, Spanish, French, German, Russian), sounds, a pin map with streets, satellite, hybrid and terrain, and an installable app (web app manifest and service worker).
- Every game has a challenge link that gives a friend the same places, and an Exit on every screen.

The Spanish, French, German and Russian translations are machine-written and have not been checked by native speakers. Messages that come from the server stay in English.

The rules follow WorldGuessr's code where the two differ from its documentation. `docs/superpowers/specs/2026-10-11-plonk-wave-5.md` lists them, and what was left out and why (ads and shop, sign-in through Google or Apple, native apps, and operations for a large live service).

## Imagery

| Source | When it is used | Cost |
|---|---|---|
| Google Street View (Maps JavaScript API) | when `VITE_GOOGLE_MAPS_KEY` is set | 5,000 free panorama viewers a month; restrict the key to the site's addresses so nobody else can spend them |
| [Panoramax](https://panoramax.fr), an open street photo commons | no key set, or Google unavailable or over quota | free, no key |

The guess map is [OpenFreeMap](https://openfreemap.org) (OpenStreetMap data): free, no key.

Google is shown with its address label and street names switched off, using the API's own options (street names can be turned on in the singleplayer options). The game creates one Street View viewer per game and reuses it for every round, which is what Google counts.

The server counts Google viewers per UTC day and tells browsers to use Panoramax once the day's limit is reached (`GOOGLE_VIEWERS_PER_DAY`, default 150, about 4,650 a month). This handles ordinary traffic on this site. Google's console has no per-day quota for Street View panoramas to cap, so the protections against a bill are this counter, an HTTP-referrer restriction on the key (the key is in the browser bundle, and without the restriction any site can use it), and a budget alert on the billing account.

`VITE_GOOGLE_MAPS_KEY=dev` loads Google's watermarked keyless development mode, for local testing only. The production key is restricted to the two site addresses and does not work on localhost (Google's console accepts no wildcard port).

Two location sets, one per source:

- `public/locations.google.json`: about 24,000 places with official Google coverage in 127 countries and territories. Built by `scripts/build-google-locations.ts`, which drops random points in every country and asks Google's free coverage lookup for the nearest outdoor panorama of its own.
- `public/locations.json`: about 4,300 places in 47 countries and territories, sampled from Panoramax and used when the game falls back to it.

## Multiplayer and daily challenge

Parties (up to 40 players, join by code), matchmaking queues for unranked, ranked and 2v2, and a daily challenge with a leaderboard. Vercel Functions cannot hold connections open, so clients poll the match (every 1.5 seconds with up to 10 players, 2.5 with up to 20, 4 above that) and the server advances it on each request. Polling is also why a party stops at 40 players where WorldGuessr allows 200. The design and the API contracts are in `docs/superpowers/specs/` (`…-multiplayer.md`, then `…-wave-2.md` to `…-wave-6.md` with `…-wave-5-api.md` and `…-wave-6-api.md`; a later file wins where two differ).

Moderators are the accounts named in the `MODERATORS` environment variable (comma-separated usernames). A listed name cannot be registered, so create the account first and list it after. A banned account can still play alone but not online.

## Accounts

An account is optional. Signed-in players get each finished game saved, and an account screen with games played, average and best round, perfect rounds, best game and recent games. The backend is ten Vercel Functions in `api/` over Postgres (code in `server/`); the account part is ported from Gambit: scrypt passwords, a signed HttpOnly session cookie, rate limits on sign-up, sign-in and saves, and an Origin check on writes. Sign-in is username and password only.

The server does not store scores as the browser sends them: it looks each place up in its own copy of the two location sets (or the community map), and recomputes each round's distance and score from that place and the guess. Daily, streak and guesser runs begin with a start the server issues, and a finish that arrives faster than two seconds a round is refused. That stops made-up scores. It cannot stop a player who reads the answer out of their own browser, which no browser-rendered game can.

An account has an email, asked for at sign-up and shown to nobody but its owner. An account made before emails is asked for one each time it signs in ("Not now" goes on), and can add or change it on the account screen; changing it takes the current password.

A forgotten password has two ways back. "Forgot password" sends a reset link to the account's email, in the language the page was in: the link works once, for an hour, and setting the new password signs every other browser out. The link carries a random token of which the database keeps only the SHA-256, and it is built on `APP_URL`, never on anything a request says. Asking is answered the same whether or not any account has the address, and is limited to five requests a network in 15 minutes, three emails an address in an hour and 50 emails a day for the whole site. The recovery code shown once at sign-up still works as before, for a player who cannot get to that email.

Email goes out through [Resend](https://resend.com) from `Wherefall <no-reply@n3el.dev>` (`server/mail/`). Without `RESEND_API_KEY`, which is only allowed outside production, no email is sent and the reset link is written to the server log instead.

It needs `DATABASE_URL` and `SESSION_SECRET`, and in production `RESEND_API_KEY` and `APP_URL` too (see `.env.example`). In production these are set on the Vercel project; the database is the Neon resource `plonk-db`.

## Run it

```bash
pnpm install
pnpm dev          # the game only; account calls fail quietly
vercel dev        # the game and the account API (needs .env.local, see .env.example)
```

## Check it

```bash
pnpm test         # unit tests (game rules, imagery clients, account server)
pnpm coverage     # the same, with the 80% threshold enforced
pnpm e2e          # browser tests; outside services are replaced with local stand-ins
node e2e-live/two-players.mjs <url>   # real browsers on a deployed site: a party, a ranked duel and a four-player 2v2
node e2e-live/features.mjs <url>      # everything else on a deployed site; both create check_* accounts to delete after
                                      # (MOD_USER and MOD_PASS add the moderation checks)
pnpm build && pnpm preview   # production bundle, served with the production security headers
```

## Rebuild the location set

```bash
pnpm locations              # the Panoramax set; a few thousand polite requests, about ten minutes
ONLY=LU,JP pnpm locations   # a few countries, written to locations.sample.json

GOOGLE_MAPS_KEY=... pnpm locations:google   # the Google set; about 25 minutes of free lookups
LOCATIONS_OUT=/tmp/new.json GOOGLE_MAPS_KEY=... pnpm locations:google   # written elsewhere, to check before it replaces the live set
```

The builder reads Panoramax's coverage grid, gives each country a quota (square root of its covered area, between 40 and 600), and picks spread-out 360° photos with usable resolution and GPS accuracy. Challenge links depend on the dataset, so rebuilding it changes which places an old link leads to. The functions read the same files to check saved games, so a rebuilt set has to be deployed with them.

## Layout

```
src/game/      rules with no DOM: scoring, seeded picks, session state, challenge links
src/imagery/   the two imagery sources behind one interface (provider.ts)
src/ui/        screens, the two street views and the guess map
src/i18n/      the five language catalogs
src/account/, src/multiplayer/, src/social/, src/daily/   browser clients for the API
api/           Vercel Function routes (thin wrappers; the plan allows 12, ten are used)
server/        server code: database, sessions, email, matches, ratings, daily, social, maps
scripts/       the location-set builders
e2e/           Playwright tests against local stand-ins
e2e-live/      scripts that drive real browsers against a deployed site
```

Design decisions and the route to Google Street View imagery are in `docs/superpowers/specs/2026-10-10-plonk-design.md`.
