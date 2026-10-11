# Plonk: playing takes an account

Date: 2026-10-11. Builds on the earlier specs; where they differ, this one wins. It reverses the first-visit tutorial of wave 6 (B.4), the party guests switch (B.7) and guest play from the multiplayer spec.

## Why

Accounts were optional: a visitor could play every solo mode and the daily, and could play public unranked games and join parties as a guest. Now no game of any kind starts without a signed-in account. Reading stays open: the leaderboards, community maps and their pages, public profiles and About.

## What changes

### Browser

1. **Solo panes.** Singleplayer, Country streak, Country Guesser, Continent Guesser and Daily challenge open with the account check the online panes already had. A signed-in player gets the pane; a visitor gets its name, its one line, and "Playing needs an account" with the way to the account pane. A banned account still gets them: a ban is from online play.
2. **Online panes.** Unranked and Join party are for accounts only, like Ranked, 2v2 and Create party. "Play as a guest" is gone.
3. **Party form.** The "Allow guests" setting is gone.
4. **Welcome.** A new visitor on the plain home page is offered "Sign in or create an account" (the accent action, to the account pane) and "Look around first" (to the home screen). The tutorial is not offered there.
5. **Tutorial.** It is a game, so it takes an account: the signed-out account pane no longer lists it. A signed-in player finds it in the how-to box on Singleplayer and in the account pane's settings, as before.
6. **Links.** A challenge link (`?map=…&seed=…`) and a party link (`?party=CODE`) carry what they need in the query, which signing in on `#account` leaves alone. The visitor signs in, opens Singleplayer or Join party, and the challenge or the code is still there. A map chosen on the Maps pane or a map's page rides in a history entry instead, so the home screen keeps it until the Singleplayer or Create party form is next built, and that form opens on it.
7. **As a game starts.** The session can end after a pane was built (signed out in another tab, or everywhere), so Singleplayer, a streak, a guesser, the daily, the tutorial and every Play again ask once more who is signed in. Without an account no game starts and the pane is shown again with its notice. When the server cannot be asked the game starts, since the pane asked already.

### Server

8. **`POST /api/match`.** `guest` is no longer an action: a visitor who sends it gets 401 "Sign in first.", a signed-in player 400. A guest session made earlier (they last a day) may send `leave` and `leaveQueue` and nothing else; everything else is 403 "Guests cannot do that. Make an account first." `GET /api/match` answers a guest with the same 403, and first takes them out of the queue (`?queue=1`) or of the match they ask for (`?id=`): a guest's tab left open would otherwise be matched with an account, or keep a round without a timer waiting.
9. **`POST /api/daily { action: "start" }`.** Needs an account: 401 for a visitor, 403 for a guest. No token is handed out any more.
10. **`POST /api/maps { action: "play" }`.** Needs an account, with the same two refusals. It is still limited by network address, and a map still gains one play an hour from each account.

### Left open on purpose

- `POST /api/daily { action: "viewer" }`: the map page's street preview asks for a Google viewer, and that page is open to visitors.
- `POST /api/daily { action: "claim" }`: a browser that played the daily as a visitor before this change still holds the result and its token, and the account it makes takes it over.
- Every `GET` that was open (the daily and its board, maps, leaderboards, profiles, the online count).

## What this does not do

- **It does not make solo play impossible without an account.** A solo game runs in the browser on place lists that are public files, so the checks there (as the pane is built, and as a game starts) are the browser's own. What the server holds is everything that records a game: runs, saves, the daily, plays of a map.
- **It does not work offline.** The gate asks the server who is signed in, so an installed Wherefall cannot start a game without a network.

## Left for a later cleanup

The guest plumbing stays until no guest row is left (a day after this ships): the `guest` column and `createGuest`, the guest branches in the routes and in a match's state, the party's `guests` setting on the server (still accepted, since an older page in a browser's cache sends it), the "accounts only" refusal on joining, and the visitor's side of the daily in the browser (the stored result that a claim moves to an account).

## Tests

- Server: the routes' tests cover each new refusal; `server/routes/guests.test.ts` is now about what a guest left over may still do.
- Browser: the Playwright fixture signs in as a player unless a test says otherwise; visitor tests check that each play pane shows the gate and that a challenge link survives signing in.
