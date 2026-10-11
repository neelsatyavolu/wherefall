import { earnsConfetti } from '../game/marks.ts';
import { t } from '../i18n/index.ts';
import type { MatchState } from '../multiplayer/client.ts';
import { outcomeLine, ownResults, shortName } from '../multiplayer/state.ts';
import { reportPlayer } from '../social/client.ts';
import { confettiBurst } from './confetti.ts';
import { revealPanel } from './match-panels.ts';
import { askReport } from './match-report.ts';
import { finalPanel, type FinalHandlers, type ReportResult } from './match-standing.ts';
import { clearOfTop } from './match-status.ts';
import { noticePanel } from './panels.ts';
import type { RoundScreen } from './round-screen.ts';
import { refusalText } from './session-ended.ts';
import { sounds } from './sound.ts';

/** What the round screen shows when a round of a match is over, and when the match is. */

export type EndHandlers = Omit<FinalHandlers, 'onReport'>;

/**
 * Puts one revealed round on the round screen: the round table, everyone's pins on the map, the
 * sound of the player's own score and, for a very good round of their own, confetti as in a game
 * alone. The map is fitted to what the panel, the HUD and the match's own bars leave open, so the
 * guess and the place are both in sight. Returns what writes the countdown to the next round.
 */
export function showRoundResult(screen: RoundScreen, state: MatchState, round: number, onLeave: () => void): (seconds: number) => void {
  screen.setPhase('result');
  screen.setCount(round + 1);
  screen.setClock(null);
  const panel = revealPanel(state, round, onLeave);
  const padding = clearOfTop(screen.view, screen.showPanel(panel.node));
  const { own } = panel;
  screen.setScore(own?.total ?? 0);
  sounds.play('result', own?.score ?? 0);
  if (own && earnsConfetti(own.score)) {
    confettiBurst(screen.view);
  }
  const place = state.places?.[round];
  if (place) {
    const pins = panel.rows.flatMap((row) => (row.guess ? [{ point: row.guess, label: shortName(row.username), own: row.isYou }] : []));
    screen.map.showPlayers(place, pins, padding);
  }
  return panel.setCountdown;
}

/**
 * Puts the end of a match on the round screen: the final standing over the map of the player's own
 * guesses, or, for a match cancelled before it began, a notice and the way home. Returns what
 * follows the match while that is on screen (a party's standing can change hands).
 */
export function showMatchEnd(screen: RoundScreen, state: MatchState, cancelled: boolean, handlers: EndHandlers): (next: MatchState) => void {
  if (cancelled) {
    screen.setPhase('loading');
    screen.showPanel(noticePanel(outcomeLine(state) || t('common.matchOver'), [{ name: t('common.home'), run: handlers.onHome }]));
    return () => {};
  }

  /** Reports a player from the final standing, after asking whether to and what about: a slip of the finger should not report anyone. */
  async function report(username: string): Promise<ReportResult> {
    const category = await askReport(screen.view, username);
    if (category === null) {
      return 'cancelled';
    }
    const sent = await reportPlayer(username, category);
    return sent.ok ? 'sent' : { error: refusalText(sent.error) };
  }

  const panel = finalPanel(state, { ...handlers, onReport: report });
  screen.setPhase('summary');
  screen.map.showSummary(ownResults(state), clearOfTop(screen.view, screen.showPanel(panel.node)));
  return panel.update;
}
