# Plonk co-op: rules and API contract

Date: 2026-10-11. A party can be played together instead of against each other. One player, the picker, places the guess that counts for everyone. Where this file and an earlier one differ, this one wins.

Conventions as before: JSON, the envelope `{ success: true, data } | { success: false, error }`, ISO 8601 times, Origin check on writes. No new route file.

## 1. The rules

- Co-op is a party's fourth team mode: `settings.teams` is `none`, `best`, `average` or `coop`. There is no queue for it.
- A co-op party has no teams. `teams` is null, every player's `team` is null, and a start needs two players and nothing else.
- The picker is the host until the host names someone else. The host may name anyone in the party, themselves included, in any phase but `finished`.
- A round is the picker's alone. Their guess ends it at once. A guess from anyone else is answered with the match as it is, unchanged. A round whose time runs out without the picker's guess scores 0.
- Everyone's pin is shared while a round is played, as teammates' pins are: `pin` is accepted from every player, and `mates` holds every other player's pin.
- The match has one score, the sum of each round's guess. It has no winner: `outcome.winners` is empty.
- No XP and no rating, as in every party.
- History: every account in the match has the same line, with `score` the score made together, `result` null, and each round's guess the one the picker placed.

## 2. When the picker is gone

The pick never stays with someone who is not there. On every request the server checks the picker and, when they have left, been removed, or not been heard from for 30 seconds, passes the pick to the next player by seat who is being heard from, coming round to the first seat. A player who joined during the round being played is passed over until the next one.

- In the lobby nothing passes on inactivity. A named picker who leaves the lobby gives the pick back to the host.
- A picker who drops out in the middle of a round loses the pick in that round: the new picker can guess in it.
- The pick does not go back by itself when the old picker returns. The host can name them again.

## 3. A removed picker

`kick` takes a player's guesses out of every round, as before. Co-op is the exception: a guess is everyone's, so the rounds a removed picker placed stay in the results and in the score, under the host's name.

## 4. What the browser sends and reads

- `POST /api/match { action: 'picker', matchId, username }` → the match. Host only (403 `Only the host can do that.`). 409 `This party is not co-op.` in any other party, 409 `There is no such player in this match.` for a name that is not in it, 400 `Name a player in the match.` for a malformed body. In a finished match it changes nothing.
- `MatchState.picker`: the picker's username in a co-op party, in every phase. Null in every other match.
- `team` and `shuffle` in a co-op party: 409 `Teams are off in this party.`
- `configure` to or from `coop` takes every player off their team.
- `results[n].guesses` still has one entry for each player. In co-op at most one of them has a position: the guess made together, under the name of whoever placed it.

## 5. Storage

`matches.picker_id uuid`, null until a picker is named or a match starts. `matches.teams` takes the value `coop`.
