import { getAccount } from '../account/client.ts';
import { GUESSER_MAX_SCORE, type GuesserKind } from '../game/guesser.ts';
import { t } from '../i18n/index.ts';
import { actionBar } from './action-bar.ts';
import { el, formatScore } from './dom.ts';
import { navName } from './nav.ts';
import { factLine, pane, type Pane } from './pane.ts';

/**
 * The pane of the Country Guesser or the Continent Guesser: what the game is, the player's best
 * score when signed in, and the button that starts a run. A run has no settings.
 */
export function guesserPane(kind: GuesserKind, onStart: (kind: GuesserKind) => void): Pane {
  const best = factLine('');
  best.hidden = true;
  let disposed = false;

  void getAccount().then((result) => {
    const account = result.ok ? result.data.account : null;
    if (account && !disposed) {
      const score = kind === 'country' ? account.bestCountry : account.bestContinent;
      best.textContent = t('guesser.best', { score: formatScore(score), max: formatScore(GUESSER_MAX_SCORE) });
      best.hidden = false;
    }
  });

  return {
    node: pane(
      navName(kind),
      t(`guesser.${kind}.lede`),
      best,
      actionBar(el('button', { class: 'button accent', text: t('singleplayer.start'), attrs: { type: 'button' }, on: { click: () => onStart(kind) } })),
      kind === 'continent' ? el('p', { class: 'fine', text: t('guesser.continent.note') }) : null,
      el('p', { class: 'fine', text: t('guesser.fine') }),
    ),
    dispose: () => {
      disposed = true;
    },
  };
}
