import { beginRun, finishBegunStreak } from '../account/runs.ts';
import { RUN_PLACES_UNKNOWN } from './save-notes.ts';
import type { StreakRuns } from './world-streak.ts';

/**
 * Refusals of a finish that no later try can mend, verbatim: the run is not this account's (another
 * account is signed in here now), its rounds are not ones the server takes, or its places are in
 * neither list any more. Anything else (no network, too many saves in an hour, a session that has
 * ended) may pass, and the finish is kept to be sent again.
 */
const FINAL: readonly string[] = ['That run was not started here.', 'That game could not be saved: its details are not valid.', RUN_PLACES_UNKNOWN];

/**
 * The background country streak as runs on the server (wave 6's contract, section 6). This is the
 * one place it is sent from. A run is begun for a signed-in player only: a visitor and a guest are
 * not asked, and their streak is counted in the browser alone. A finish is marked `inPlay`: it
 * sets the account's best streak and pays no XP, since the games the streak ran through paid theirs.
 */
export const streakRuns: StreakRuns = {
  begin: async () => {
    const started = await beginRun('streak').started;
    return started.ok ? started.data : null;
  },
  // a finish the server finds too soon after its start is sent once more when the time has passed, as a Country streak run's is
  finish: async (begun, rounds) => {
    const sent = await finishBegunStreak({ kind: 'streak', started: Promise.resolve({ ok: true, data: begun }) }, [...rounds], true);
    return sent.ok || FINAL.includes(sent.error) ? 'done' : 'later';
  },
};
