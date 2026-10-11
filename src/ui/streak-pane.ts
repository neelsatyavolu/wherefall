import { getAccount } from '../account/client.ts';
import { MODES, modeName, type Mode, type TimeLimit } from '../game/settings.ts';
import { t } from '../i18n/index.ts';
import { actionBar } from './action-bar.ts';
import { choiceRow } from './choice-row.ts';
import { el } from './dom.ts';
import { factLine, pane, type Pane } from './pane.ts';
import { timeControl } from './time-control.ts';

export interface StreakSetup {
  mode: Mode;
  timeLimit: TimeLimit;
}

/** The country streak: how it works, the player's best, and the two settings a run has. */
export function streakPane(onStart: (setup: StreakSetup) => void): Pane {
  let setup: StreakSetup = { mode: 'move', timeLimit: 0 };
  const best = factLine('');
  best.hidden = true;
  let disposed = false;

  void getAccount().then((result) => {
    const account = result.ok ? result.data.account : null;
    if (account && !disposed) {
      best.textContent = t('streak.best', { streak: account.bestStreak });
      best.hidden = false;
    }
  });

  const form = el(
    'form',
    {
      class: 'setup',
      on: {
        submit: (event) => {
          event.preventDefault();
          onStart(setup);
        },
      },
    },
    choiceRow<Mode>(t('label.mode'), 'streak-mode', MODES.map((mode) => ({ value: mode, name: modeName(mode) })), setup.mode, (mode) => {
      setup = { ...setup, mode };
    }),
    timeControl(t('label.timePerRound'), 'streak-time', setup.timeLimit, (timeLimit) => {
      setup = { ...setup, timeLimit };
    }),
    actionBar(el('button', { class: 'button accent', text: t('streak.start'), attrs: { type: 'submit' } })),
  );

  return {
    node: pane(
      t('nav.item.streak'),
      t('streak.lede'),
      best,
      form,
      el('p', { class: 'fine', text: t('streak.fine') }),
    ),
    dispose: () => {
      disposed = true;
    },
  };
}
