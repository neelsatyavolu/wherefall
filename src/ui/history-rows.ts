import type { GameKind, GameResult } from '../account/client.ts';
import type { HistoryGame } from '../account/games.ts';
import { mapName } from '../game/locations.ts';
import { formatNumber, language, t, tn } from '../i18n/index.ts';

/** How a game of the history is worded: in a row of the list, and in the line above its rounds. */

const SOLO_KINDS: readonly GameKind[] = ['solo', 'daily'];

export const kindName = (kind: GameKind): string => t(`history.kind.${kind}`);

/** Win, loss or draw; nothing for a game played alone or a match that was cancelled. */
export const resultName = (result: GameResult): string => (result === null ? '' : t(`history.result.${result}`));

/** A rating change with its sign, "+18" or "-12"; nothing where no rating was at stake. */
export const ratingChangeText = (change: number | null): string => (change === null ? '' : new Intl.NumberFormat(language(), { signDisplay: 'exceptZero' }).format(change));

/** The words of one row of the history, apart from its day. An empty string is a cell left empty. */
export interface HistoryRow {
  kind: string;
  map: string;
  score: string;
  maxScore: string;
  result: string;
  rating: string;
  xp: string;
  players: string;
}

export function historyRow(game: HistoryGame): HistoryRow {
  return {
    kind: kindName(game.kind),
    map: mapName(game.map),
    score: formatNumber(game.score),
    maxScore: formatNumber(game.maxScore),
    result: resultName(game.result),
    rating: ratingChangeText(game.ratingChange),
    xp: formatNumber(game.xpEarned),
    players: formatNumber(game.players),
  };
}

/** What a match adds to a game's settings: its kind, how it went, what it did to the rating, how many played. Null for a game played alone. */
export function matchFacts(game: Pick<HistoryGame, 'kind' | 'result' | 'ratingChange' | 'players'>): string | null {
  if (SOLO_KINDS.includes(game.kind)) {
    return null;
  }
  const rating = game.ratingChange === null ? '' : t('history.rating', { change: ratingChangeText(game.ratingChange) });
  return [kindName(game.kind), resultName(game.result), rating, tn('history.players', game.players)].filter((fact) => fact !== '').join(' · ');
}
