import type { Result } from '../account/client.ts';
import { t, tn } from '../i18n/index.ts';
import { PROFILE_RANGES, type ProfileRange } from '../social/client.ts';
import { choiceRow } from './choice-row.ts';
import { progressFrame, type HistoryPoint, type LiveFigures } from './line-chart.ts';
import { errorLine, type Pane } from './pane.ts';

const rangeName = (range: ProfileRange) => (range === 'all' ? t('social.allTime') : tn('chart.days', range));

/**
 * A player's progress with a choice of how far back to look: 7 days, 30 days or all time. `history`
 * is what came with the profile, for `initial`; another range is asked for with `load`. While it is
 * on its way the charts drawn stay, dimmed; if it fails they come back and the reason is shown.
 * `live` is where the page around it says the player stands now, which every range is held against.
 */
export function progressSection(history: readonly HistoryPoint[], load: (range: ProfileRange) => Promise<Result<readonly HistoryPoint[]>>, live?: LiveFigures, initial: ProfileRange = 30): Pane {
  const error = errorLine();
  let shown = initial;
  let disposed = false;

  async function pick(range: ProfileRange): Promise<void> {
    shown = range;
    error.textContent = '';
    frame.hold(true);
    const result = await load(range);
    if (disposed || shown !== range) {
      return;
    }
    if (result.ok) {
      frame.show(result.data);
    } else {
      frame.hold(false);
      error.textContent = result.error;
    }
  }

  const controls = choiceRow<ProfileRange>(t('social.period'), 'range', PROFILE_RANGES.map((range) => ({ value: range, name: rangeName(range) })), initial, (range) => void pick(range));
  const frame = progressFrame(controls, live);
  frame.show(history);
  frame.node.append(error);

  return {
    node: frame.node,
    dispose: () => {
      disposed = true;
    },
  };
}
