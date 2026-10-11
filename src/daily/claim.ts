import { REFUSALS, type Result } from '../account/client.ts';
import { claimDaily, type StoredDaily } from './client.ts';
import { claimable, visitorDailies, withoutDays, type VisitorStore } from './visitor-store.ts';

/**
 * A new account takes over the dailies its player finished as a visitor. The server allows it only
 * on the day the account is made, so it is asked as soon as this browser knows who signed in, and
 * an account that has given its answer is not asked again.
 */

/** The server's refusal for an account more than a day old, verbatim: nothing kept here can ever go to that account. */
export const CLAIM_DAY_ONLY = 'Results can only be claimed on the day an account is made.';

/** `nothing`: nothing was asked. `claimed`: the server answered, and the days it took are cleared. `failed`: the results could not be added. */
export type ClaimOutcome = 'nothing' | 'claimed' | 'failed';

type Claim = (results: readonly StoredDaily[]) => Promise<Result<{ claimed: string[] }>>;

export const utcToday = (): string => new Date().toISOString().slice(0, 10);

/** Offers the account the results kept in this browser. Never throws; what was not taken stays kept. */
export async function claimKept(username: string, today: string = utcToday(), store: VisitorStore = visitorDailies, claim: Claim = claimDaily): Promise<ClaimOutcome> {
  const kept = store.read();
  // only results begun with a start the server answered can be taken: ones kept before that was so stay in this browser
  const results = claimable(kept, today);
  if (results.length === 0 || (kept.claim?.by === username && kept.claim.final)) {
    return 'nothing';
  }
  const reply = await claim(results);
  if (reply.ok) {
    store.update((now) => ({ ...withoutDays(now, reply.data.claimed), claim: { by: username, final: true, failed: false } }));
    return 'claimed';
  }
  if (reply.error === REFUSALS.signIn || reply.error === REFUSALS.guests) {
    // the session ended between knowing who was signed in and asking: nothing failed, and the account is asked when it is back
    return 'nothing';
  }
  // any other refusal may pass (too many claims in an hour, the server out of reach): it is asked again another time
  store.update((now) => ({ ...now, claim: { by: username, final: reply.error === CLAIM_DAY_ONLY, failed: true } }));
  return 'failed';
}

/** True once after a claim for this account failed: the player is told one time, wherever the daily is next shown. */
export function takeClaimNote(username: string, store: VisitorStore = visitorDailies): boolean {
  const claim = store.read().claim;
  if (claim?.by !== username || !claim.failed) {
    return false;
  }
  store.update((now) => ({ ...now, claim: { ...claim, failed: false } }));
  return true;
}

const running = new Map<string, Promise<ClaimOutcome>>();

/** `claimKept` for this browser's store, asked once however many parts of the page want it at the same moment. */
export function claimOnce(username: string): Promise<ClaimOutcome> {
  const asked = running.get(username) ?? claimKept(username).finally(() => running.delete(username));
  running.set(username, asked);
  return asked;
}
