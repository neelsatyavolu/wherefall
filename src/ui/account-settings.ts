import { saveAccountSettings, type AccountSettings } from '../account/actions.ts';
import { t } from '../i18n/index.ts';
import { choiceRow } from './choice-row.ts';
import { el } from './dom.ts';
import { errorLine } from './pane.ts';
import { sayRefusal } from './session-ended.ts';

/**
 * One yes-or-no setting of the account, saved the moment it is changed. If the server will not
 * save it, its refusal is shown and the choice goes back to what the account has. `note` says what
 * the setting does where its name alone does not.
 */
function accountSwitch(legend: string, key: keyof AccountSettings, initial: boolean, note?: string): HTMLElement {
  const row = el('div', { class: 'account-switch' });
  const error = errorLine();
  let saved = initial;

  const save = async (value: boolean) => {
    error.textContent = '';
    const result = await saveAccountSettings({ [key]: value });
    if (result.ok) {
      saved = result.data[key];
    } else {
      sayRefusal(error, result.error);
    }
    if (saved !== value) {
      draw();
    }
  };
  const draw = () =>
    row.replaceChildren(
      choiceRow<boolean>(
        legend,
        key,
        [
          { value: true, name: t('account.switch.yes') },
          { value: false, name: t('account.switch.no') },
        ],
        saved,
        (value) => void save(value),
      ),
    );
  draw();

  return el('section', { class: 'account-section settings' }, row, note ? el('p', { class: 'fine', text: note }) : null, error);
}

/**
 * The settings that are saved with the account rather than in this browser, so they hold wherever
 * the player signs in: whether others may send friend requests, whether chat is hidden, and
 * whether friends are told when the player was last seen or only whether they are online.
 */
export function accountSwitches(settings: AccountSettings): HTMLElement[] {
  return [
    accountSwitch(t('account.allowRequests'), 'allowFriendRequests', settings.allowFriendRequests),
    accountSwitch(t('account.hideChat'), 'hideChat', settings.hideChat),
    accountSwitch(t('account.hideLastSeen'), 'hideLastSeen', settings.hideLastSeen, t('account.hideLastSeen.note')),
  ];
}
