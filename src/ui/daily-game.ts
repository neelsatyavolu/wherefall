import type { SavedRound } from '../account/client.ts';
import { DAILY_MAX_SCORE, getDaily, type DailyResult } from '../daily/client.ts';
import { lostDailies } from '../daily/lost.ts';
import { loadDailyPlaces } from '../daily/places.ts';
import { standingOfGame } from '../daily/view.ts';
import { visitorDailies, withResult } from '../daily/visitor-store.ts';
import { totalScore, type Session } from '../game/session.ts';
import { t } from '../i18n/index.ts';
import type { GamePlaces } from '../imagery/game-places.ts';
import type { ImageryProvider, Place } from '../imagery/provider.ts';
import { summaryExtras, type SummaryExtras } from './daily-extras.ts';
import { dailyShareText, dailyUrl } from './daily-words.ts';

/** What makes a game the daily: its own draw of places, and a summary that shares the result instead of offering another go. */
export interface DailyGame {
  /** the day's three places on one imagery source: three countries, two continents */
  places: <P extends Place>(provider: ImageryProvider<P>) => Promise<GamePlaces<P>>;
  /** what "Share result" copies */
  shareText: (session: Session) => string;
  /**
   * What the summary shows under the line about the save, once the server has answered: a personal
   * best and each round against the day's average, or, for a game the server could not take because
   * the site was updated under it, what happened and the reload that mends it. Empty until then.
   */
  extras: (session: Session) => HTMLElement;
  /** Asks, once the result is saved, where it stands: the share text and the summary say so from then on. */
  learnStanding: () => Promise<void>;
  /** The server refused the result because its places are no longer the day's: the summary says so, and so does the pane after a reload. */
  markStale: () => void;
}

interface Deps {
  /** the server's daily */
  read: () => ReturnType<typeof getDaily>;
  /** this page's address */
  url: () => string;
  /** makes the summary's own part, in the page */
  extras: () => SummaryExtras;
  /** notes a day whose result was lost to an update */
  lost: (date: string) => void;
}

const REAL: Deps = { read: () => getDaily(), url: dailyUrl, extras: () => summaryExtras(), lost: (date) => lostDailies.mark(date) };

/** `deps` are the server, the page and the browser's storage, given by a test in their place. */
export function dailyGame(date: string, seed: string, deps: Partial<Deps> = {}): DailyGame {
  const { read, url, extras, lost } = { ...REAL, ...deps };
  /** the result on the day's leaderboard, once known */
  let saved: DailyResult | null = null;
  let stale = false;
  /** the summary's part and the score of the game it belongs to, once the summary is drawn */
  let shown: { part: SummaryExtras; score: number } | null = null;

  /** What is known so far goes into the summary, whichever came first. */
  const fill = (): void => {
    if (!shown) {
      return;
    }
    // an earlier result that is the one on the leaderboard says nothing about this game
    const standing = standingOfGame(saved, shown.score);
    if (stale) {
      shown.part.showStale();
    } else if (standing) {
      shown.part.showStanding(standing);
    }
  };

  return {
    places: (provider) => loadDailyPlaces(provider, seed),
    shareText: (session) => {
      const score = totalScore(session);
      const beat = standingOfGame(saved, score)?.beat ?? null;
      return dailyShareText({ date, score, maxScore: DAILY_MAX_SCORE, rounds: session.results.map((result) => result.score), beat }, url());
    },
    extras: (session) => {
      shown ??= { part: extras(), score: totalScore(session) };
      fill();
      return shown.part.node;
    },
    learnStanding: async () => {
      const daily = await read();
      saved = daily.ok && daily.data.date === date ? daily.data.yours : null;
      fill();
    },
    markStale: () => {
      stale = true;
      lost(date);
      fill();
    },
  };
}

/**
 * Keeps a visitor's finished daily in this browser, in the shape a new account claims it in, and
 * says so. The first result of a day is the one that stays.
 */
export function keepVisitorDaily(date: string, rounds: SavedRound[]): string {
  visitorDailies.update((kept) => withResult(kept, { daily: date, rounds }));
  return `${t('save.daily.signedOut')} ${t('daily.kept')}`;
}
