import './account.css';
import { getAccount, logout, type AccountState, type AccountStats } from '../account/client.ts';
import { t } from '../i18n/index.ts';
import { getProfile, rename } from '../social/client.ts';
import { emailPrompt, emailSection } from './account-email.ts';
import { duelFigures, statFigures, streakDetail, teamFigures } from './account-figures.ts';
import { recoverySection } from './account-recovery.ts';
import { myReportsSection } from './account-reports.ts';
import { signOutEverywhereSection } from './account-sessions.ts';
import { accountSwitches } from './account-settings.ts';
import { countrySetting } from './country-setting.ts';
import { deleteAccountSection, deletedNotice } from './delete-account.ts';
import { el, formatScore } from './dom.ts';
import { flag } from './flag.ts';
import { historyList } from './history-list.ts';
import { hrefFor } from './nav.ts';
import { progressCharts } from './line-chart.ts';
import { errorLine, pane, statusLine, type Pane } from './pane.ts';
import { figure } from './panels.ts';
import { passwordForm } from './password-form.ts';
import { recoveryCodeBox } from './recovery-code-box.ts';
import { showOrigin } from './referrer.ts';
import { resetForm } from './reset-form.ts';
import { onSessionEnded, sayRefusal } from './session-ended.ts';
import { groupHead, settingsRows } from './settings.ts';
import { signInForm, type CodeFrom } from './sign-in-form.ts';
import { levelBar, statGrid, wide } from './stat-grid.ts';
import { bannedBox, errorBox, statusBox } from './status-box.ts';

type Account = NonNullable<AccountState['account']>;
type SignedIn = AccountState & { account: Account; stats: AccountStats };

/** What the signed-in view can ask of the pane around it. */
interface Handlers {
  /** reads the account again: after signing out, or a change of name */
  reload: () => void;
  /** opens one game round by round */
  openGame: (id: string) => void;
  onTutorial: () => void;
  /** the account is gone, and can be restored until this day */
  onDeleted: (restoreUntil: string) => void;
}

/** How many figures sit across on a wide screen; the grids fill their rows at this. */
const STAT_COLUMNS = 4;

function renameForm(current: string, reload: () => void): HTMLElement {
  const input = el('input', {
    class: 'account-input',
    attrs: { id: 'new-username', name: 'new-username', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '20', placeholder: current },
  });
  const error = errorLine();
  const submit = el('button', { class: 'button ghost', text: t('account.rename'), attrs: { type: 'submit' } });
  const send = async () => {
    const wanted = input.value.trim();
    if (wanted === '') {
      error.textContent = t('account.renameEmpty');
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    const result = await rename(wanted);
    if (result.ok) {
      reload();
      return;
    }
    submit.disabled = false;
    sayRefusal(error, result.error);
  };
  return el(
    'form',
    {
      class: 'inline-form',
      attrs: { novalidate: '' },
      on: {
        submit: (event) => {
          event.preventDefault();
          void send();
        },
      },
    },
    el('label', { class: 'label', text: t('account.newUsername'), attrs: { for: input.id } }),
    el('div', { class: 'inline-fields' }, input, submit),
    el('p', { class: 'fine', text: t('account.renameHint') }),
    error,
  );
}

/** The player's own progress charts. The history comes with their public profile, so it is asked for there. */
function ownProgress(account: Account): HTMLElement {
  const host = el('div', { class: 'progress-host wide' });
  void getProfile(account.username).then((profile) => {
    if (profile.ok) {
      // held against the rank the figures above show, so the two are never left to disagree unexplained
      host.replaceChildren(progressCharts(profile.data.history, { ratingRank: account.duels.rank }));
    }
  });
  return host;
}

/**
 * Who is signed in: the name with the account's flag beside it, as it is shown everywhere, the
 * login streak, and the way out. `setCountry` redraws the flag when the country is changed below.
 */
function whoSection(account: Account, reload: () => void): { node: HTMLElement; setCountry: (country: string | null) => void } {
  const name = el('span', { class: 'player' }, flag(account.country), account.username);
  const error = errorLine();
  const signOut = el('button', { class: 'button ghost', text: t('account.signOut'), attrs: { type: 'button' } });
  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    error.textContent = '';
    const result = await logout();
    if (result.ok) {
      reload();
      return;
    }
    signOut.disabled = false;
    error.textContent = result.error;
  });
  const figures = el(
    'div',
    { class: 'account-who-figures' },
    figure(t('account.signedInAs'), name),
    figure(t('account.loginStreak'), formatScore(account.loginStreak), ` ${streakDetail(account.loginStreak)}`),
  );
  return {
    node: el('section', { class: 'account-who' }, figures, signOut, error),
    setCountry: (country) => name.replaceChildren(...[flag(country), account.username].filter((part) => part !== null)),
  };
}

function signedInView(state: SignedIn, handlers: Handlers): HTMLElement[] {
  const { account, stats } = state;
  const who = whoSection(account, handlers.reload);
  return [
    ...(account.banned ? [bannedBox()] : []),
    // the figures, the charts and the table of games take the wide measure; the settings under them are forms, and narrow
    wide(who.node),
    wide(levelBar(account.xp, account.level)),
    wide(statGrid(t('account.stats'), statFigures(account, stats), STAT_COLUMNS)),
    wide(statGrid(t('account.duelRecord'), duelFigures(account.duels), STAT_COLUMNS)),
    // the 2v2 matches beside the duels, in the same four figures
    wide(statGrid(t('account.teamRecord'), teamFigures(account.teams), STAT_COLUMNS)),
    ownProgress(account),
    wide(historyList(state.recentGames, handlers.openGame)),
    groupHead(t('account.group.account'), t('account.group.account.note')),
    countrySetting(account.country, who.setCountry),
    renameForm(account.username, handlers.reload),
    // getting in and staying in: the email a reset link goes to, the password, the code that stands in for it, and every session at once
    emailSection(account.email),
    passwordForm(),
    recoverySection(account.hasRecoveryCode),
    signOutEverywhereSection(handlers.reload),
    ...accountSwitches(account),
    myReportsSection(),
    deleteAccountSection(handlers.onDeleted),
    ...settingsRows(handlers.onTutorial),
  ];
}

/** Over the sign-in form, for a player whose session ended while the pane was open: why they are seeing it. */
const endedNote = (): HTMLElement => statusBox('idle', t('session.ended.label'), t('session.ended'));

/**
 * The account pane: a sign-in form for a visitor; for a player, their level and stats, every game
 * they have played (each opening round by round), what is saved with the account (country, name,
 * email, password, recovery code, its sessions, three switches, its reports, deleting it) and the
 * settings kept in this browser. It loads its own data. `onChange` is called when who is signed in
 * may have changed. `resetToken` is the token of a password-reset link the page was opened by: the
 * pane then begins with the form that sets the new password.
 */
export function accountPane(onChange: () => void, onTutorial: () => void, resetToken = ''): Pane {
  const body = el('div', { class: 'account-body' });
  const host = el('div', { class: 'account' });
  let disposed = false;
  /** true while a signed-in player's pane is showing: the end of the session is then this pane's to show */
  let signedIn = false;

  /** A saved game, round by round, in place of the pane; its map is large, so it loads on demand. */
  async function openGame(id: string): Promise<void> {
    const { historyView } = await import('./history-view.ts');
    host.replaceChildren(historyView(id, () => host.replaceChildren(home)));
  }

  /** The account was deleted and this browser signed out: say until when it can be restored, then offer the sign-in form. */
  function showDeleted(restoreUntil: string): void {
    signedIn = false;
    body.replaceChildren(deletedNotice(restoreUntil, () => void load()));
    onChange();
  }

  /**
   * A recovery code has just been made, and the browser signed in with it: the code is shown before
   * anything else of the account, since the server never sends it again. The pane follows once the
   * player says they have it.
   */
  function showCode(code: string, from: CodeFrom): void {
    body.replaceChildren(recoveryCodeBox(code, t(`recovery.made.${from}`), () => void load(false, false, 'arrived')));
    onChange();
  }

  /** The reset link has done its work, or will not: its token leaves the address, and with it the reason to say nothing of where requests come from. */
  function dropResetToken(): void {
    history.replaceState(null, '', `${location.pathname}${hrefFor('account')}`);
    showOrigin();
  }

  /**
   * The page was opened by a reset link: the new password is chosen before anything else of the
   * pane. Setting it signs the browser in, and the account follows. A link that will not do leads
   * to the sign-in form, opened on the way to ask for another.
   */
  function showReset(token: string): void {
    const leave = (then: () => void) => () => {
      dropResetToken();
      then();
    };
    body.replaceChildren(resetForm({ token, onDone: leave(() => void load(true)), onAgain: leave(() => void load(false, false, 'forgot')) }));
  }

  /**
   * `ended` is set when the pane is read again because the session was found to be over. `then`
   * says what brought the player here: 'arrived' when they have just signed in, which is when an
   * account with no email is asked for one, and 'forgot' to open the sign-in form on its ways back in.
   */
  async function load(changed = false, ended = false, then: 'arrived' | 'forgot' | null = null): Promise<void> {
    body.replaceChildren(statusLine(t('account.loading')));
    const result = await getAccount();
    // the sidebar is told even when the player has moved on: who is signed in changed all the same
    if (changed) {
      onChange();
    }
    if (disposed) {
      return;
    }
    if (!result.ok) {
      body.replaceChildren(errorBox(result.error, () => void load()));
      return;
    }
    const { account, stats } = result.data;
    const reload = () => void load(true);
    if (account && stats) {
      // a pane read again because the session was over, and found signed in after all, is not read a third time for it
      signedIn = !ended;
      if (then === 'arrived' && account.email === null) {
        // asked each time the player signs in, until there is one; either answer goes on to the account
        body.replaceChildren(emailPrompt(() => void load()));
        return;
      }
      body.replaceChildren(...signedInView({ ...result.data, account, stats }, { reload, openGame: (id) => void openGame(id), onTutorial, onDeleted: showDeleted }));
      return;
    }
    signedIn = false;
    const arrived = () => void load(true, false, 'arrived');
    body.replaceChildren(...(ended ? [endedNote()] : []), signInForm({ onSignedIn: arrived, onCode: showCode }, then === 'forgot'), ...settingsRows(onTutorial));
  }

  // The session can end from another browser while this pane is open. Whichever part of the pane
  // is refused first says so, and the pane then becomes what a visitor sees, with the reason over
  // the sign-in form: the way to sign in is this very pane.
  const unwatch = onSessionEnded(() => {
    if (!signedIn) {
      return;
    }
    signedIn = false;
    host.replaceChildren(home);
    void load(false, true);
  });

  if (resetToken === '') {
    void load();
  } else {
    showReset(resetToken);
  }

  const home = pane(t('nav.item.account'), t('account.lede'), body);
  host.append(home);
  return {
    node: host,
    dispose: () => {
      disposed = true;
      unwatch();
    },
  };
}
