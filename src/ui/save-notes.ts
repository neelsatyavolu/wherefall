import { REFUSALS } from '../account/client.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { failedNote, type Note } from './status.ts';

/**
 * What the end of a game says about its save, where the server had something particular to say: a
 * refusal the player can make sense of is given in the server's own words, and XP that stopped at
 * the day's limit is said to have stopped.
 */

/** 400, verbatim: a saved game named a place the server does not have on that map, or not where the game has it. */
export const NOT_ON_MAP = 'That game could not be saved: its places are not on its map.';
/** 400, verbatim: a run named a place that is in neither list of places. */
export const RUN_PLACES_UNKNOWN = 'That run could not be saved: its places are not known.';
/** 400, verbatim: a daily's three places are not the ones the day's seed draws from the list the server holds. */
export const NOT_TODAYS_PLACES = "Those are not today's places.";

/** Refusals that say what happened plainly enough to be shown as they are. */
const SAID: readonly string[] = [REFUSALS.dailyUnstarted, REFUSALS.dailyTooSoon, REFUSALS.runTooSoon, NOT_ON_MAP, RUN_PLACES_UNKNOWN];
/** Refusals that mean this page plays from a list of places the server has since replaced. */
const OUTDATED: readonly string[] = [NOT_ON_MAP, RUN_PLACES_UNKNOWN];

/** A note of one or more sentences, the ones that do not apply (empty) left out. */
export const sentences = (...parts: string[]): string => parts.filter(Boolean).join(' ');

/**
 * What a save says of its XP: what was earned, and that the day's limit for playing alone stopped
 * the rest (`xpCapped`). Nothing when nothing was earned and nothing was held back.
 */
export function xpWords(saved: { xpEarned: number; xpCapped: boolean }): string {
  const earned = saved.xpEarned > 0 ? t('save.xp', { xp: formatNumber(saved.xpEarned) }) : '';
  return saved.xpCapped ? sentences(earned, t(saved.xpEarned > 0 ? 'save.xpCut' : 'save.xpCapped')) : earned;
}

/**
 * True when a refusal means this page plays from a list of places the server has since replaced:
 * the site was updated under an open page. `official` is false for a community map, whose places
 * change when its maker changes it, which no list of this page's has any part in.
 */
export const isOutdated = (error: string, official = true): boolean => official && OUTDATED.includes(error);

/**
 * Why a game or a run was not saved, as a failure. `generic` is what is said of any refusal that
 * would mean nothing to a player. Places the server does not know (`isOutdated`) are said in its
 * words, with what follows: the lists are read again, so the next game is on the current ones.
 */
export function refusalNote(error: string, generic: string, official = true): Note {
  if (!SAID.includes(error)) {
    return failedNote(generic);
  }
  return failedNote(sentences(error, isOutdated(error, official) ? t('save.placesChanged') : ''));
}

/** True for the refusal that means the day's places changed while its daily was being played. */
export const isStaleDaily = (error: string): boolean => error === NOT_TODAYS_PLACES;
