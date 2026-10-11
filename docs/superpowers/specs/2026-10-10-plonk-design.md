# Plonk: design

Date: 2026-10-10

## What was asked

Neel asked for "a fully functioning geoguessr thing that is free to use and works just as well", then added that it should allow Street View-style movement "like worldguessr.com", and that it should be published to Vercel when done. He pre-approved all decisions.

My assumptions, not stated by him:

- "Free to use" means free for players and free to run: no paid API, no card on file.
- "Fully functioning" means the single-player loop (rounds, moving, guessing, scoring, summary) plus a way to play the same places as a friend. Accounts, live multiplayer and leaderboards are out of scope.

## The imagery decision

Street-level imagery is the whole product, so this was decided first.

| Source | Cost | Needs | Coverage |
|---|---|---|---|
| Google Street View, JS API | 5,000 free panoramas a month, then $14 per 1,000 | Cloud key and billing card | best |
| Google Street View, Embed API (what WorldGuessr uses) | free, unlimited | Cloud key and billing card | best |
| Mapillary | free | account token | global, mixed quality |
| Panoramax | free, open licences | nothing | 53M 360° photos, 73 countries, strongest in France |

Chosen: **Panoramax**, because it is the only source that works with no key, no account and no card, so the game runs today without anything from Neel. Measured on 2026-10-10 from Panoramax's coverage tiles: 46 countries have at least 1,000 360° photos.

The gap versus GeoGuessr is coverage, not mechanics. Closing it means Google imagery, which needs a key from Neel's own Google Cloud account. Two caveats if that route is taken:

- The Embed API shows an address card over the panorama. WorldGuessr hides it; Google's terms do not allow covering parts of the embed. The JS API has an official switch for hiding it, but is only free up to 5,000 panoramas a month.
- A Google version needs its own location set, checked against Google's coverage.

## Second round of requests (same evening)

After trying the first version Neel asked for four changes: movement as smooth as Google Street View, accounts that save stats, round configuration and modes, and Google Street View imagery. On the imagery he asked for the Embed API "but without address card and street names, figure it out".

What I found by looking at a live Google embed: it draws both the address card and the street name on the road, and has no option for either. The card can only be cropped out of view (against Google's terms) and the street names cannot be removed at all. The Maps JavaScript API has an official switch for each (`addressControl`, `showRoadLabels`). So Google imagery is done through the JavaScript API, not the embed. That decision is mine, made on his "figure it out".

Consequences:

- It needs a key from Neel's Google Cloud account. Until one is set the game runs on Panoramax.
- It is free for 5,000 panorama viewers a month. The game creates one viewer per game, and a daily quota cap keeps it from ever billing. Past the cap, or if Google is unreachable, a game falls back to Panoramax on the same places.
- Movement in Google mode is Google's own, so it is exactly as smooth as Street View. The Panoramax fallback cross-fades between steps.
- Modes: move; no move; no move, pan or zoom. Rounds: 3, 5 or 10.
- Accounts and saved stats add a small backend (Vercel Functions and Postgres), ported from the account system in Neel's Gambit project.

## Shape

Vite + TypeScript site. The game itself is static; accounts are the only server part.

- `src/game/`: pure rules. Seeded random picks make a game a function of `(map, seed, time limit, mode, rounds)`, which is what a challenge link carries. Session state is immutable.
- `src/imagery/provider.ts`: the interface both imagery sources implement (resolve a location, open a street view). `google.ts` and `panoramax.ts` are the two sources.
- `src/imagery/panoramax.ts`: looks a picture up by id, reads its next and previous neighbours, and finds pictures from other sequences within 25 m so the player can turn onto a crossing street. All API data is validated with zod.
- `src/ui/`: `google-view.ts` wraps Google's Street View; `panoramax-view.ts` draws Panoramax pictures with Photo Sphere Viewer and adds walking; MapLibre draws the guess map on OpenFreeMap tiles.
- `scripts/build-locations.ts`: builds `public/locations.json`, about 4,300 places, with a per-country quota so France (70% of Panoramax's 360° photos) is 14% of the game.

Scoring follows the curve GeoGuessr players know: `5000 * exp(-10 * distance / scale)`, with the world scale at 14,917 km and regional maps scaled by the diagonal of their own locations.

## Failure handling

- A picture removed from Panoramax since the dataset was built: each game draws five spare places, used in order, so both players of a challenge still get the same rounds.
- Panoramax unreachable: a message with a retry, never a blank screen.
- A neighbouring picture that fails to load: the player stays put and is told that way is blocked.

## Verification

Unit tests for the rules and the Panoramax client, Playwright tests for the full flow with outside services replaced by local stand-ins, and full live games played in Chrome at desktop and phone sizes against the real services.
