import { expect, test, type Page } from '@playwright/test';
import { AccountServer } from './account-server.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { friend, profile } from './social-server.ts';
import { NAMES, PHONE, open, section, setUp, written } from './wave6-panes-scenes.ts';

// Wave 6, the account: getting back in by recovery code (item 5), signing out everywhere and the
// copy about other browsers (item 22), the 2v2 record (item 9) and "Hide my last seen" (item 14).

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'another horse staple';
const WRONG_CODE = 'Wrong username or recovery code.';
const DELETED = 'This account was deleted. Restore it to sign in.';
/** twelve characters of the code alphabet, in three groups of four */
const CODE_SHAPE = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;
const WARNING = 'Save it somewhere safe now. It is the only way back into your account if you forget your password, and it is not shown again.';

const who = (page: Page) => page.locator('.account-who');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
/** a recovery code on screen, the one time it is shown */
const codeBox = (page: Page) => page.locator('.recovery-code');
const forgotForm = (page: Page) => page.getByRole('form', { name: 'Forgot password' });

/** Fills in the forgot-password form, which is already open, and sends it. */
async function recover(page: Page, username: string, code: string, password: string): Promise<void> {
  await forgotForm(page).getByLabel('Username').fill(username);
  await forgotForm(page).getByLabel('Recovery code').fill(code);
  await forgotForm(page).getByLabel('New password').fill(password);
  await button(page, 'Set password and sign in').click();
}

/** A visitor's page on which "neel" has an account to get back into. */
async function signedOut(page: Page) {
  const servers = await setUp(page);
  servers.account.signOut();
  await open(page, '/#account');
  return servers;
}

// --- item 5: the code at sign-up ---------------------------------------------------------------------------

test('signing up shows the recovery code once, with Copy and the warning, and the account only after it is acknowledged', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { account } = await setUp(page, { username: null });
  await open(page, '/#account');
  await page.getByRole('radio', { name: 'Create account' }).check();
  // the form no longer says a password cannot be reset
  await expect(page.getByText('At least 8 characters. You are given a recovery code once the account is made: the only way back in if you forget the password.')).toBeVisible();
  await page.getByLabel('Username').fill('neel_s');
  await page.getByLabel('Password').fill(PASSWORD);
  await button(page, 'Create account').click();

  const code = account.recoveryCode ?? '';
  expect(code).toMatch(CODE_SHAPE);
  await expect(codeBox(page)).toContainText('Your account is ready. This is its recovery code.');
  await expect(codeBox(page).locator('.recovery-code-value')).toHaveText(code);
  await expect(codeBox(page)).toContainText(WARNING);
  // nothing of the account is shown, and nothing can be done, until the code is acknowledged
  await expect(who(page)).toHaveCount(0);
  await expect(page.locator('.account-body > *')).toHaveCount(1);

  await codeBox(page).getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(codeBox(page).getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

  await button(page, 'I have saved it').click();
  await expect(who(page)).toContainText('neel_s');
  await expect(codeBox(page)).toHaveCount(0);
  // it is never shown again: the pane only says the account has one
  await expect(section(page, 'Recovery code')).toContainText('Your account has a recovery code. A new one replaces it.');
  await expect(page.getByText(code)).toHaveCount(0);
  await page.reload();
  await expect(who(page)).toContainText('neel_s');
  await expect(page.getByText(code)).toHaveCount(0);
});

test('where the browser will not copy, the code is put in a field to copy by hand', async ({ page }) => {
  const { account } = await setUp(page, { username: null });
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) }, configurable: true }));
  await open(page, '/#account');
  await page.getByRole('radio', { name: 'Create account' }).check();
  await page.getByLabel('Username').fill('neel_s');
  await page.getByLabel('Password').fill(PASSWORD);
  await button(page, 'Create account').click();
  await codeBox(page).getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(codeBox(page).getByRole('textbox', { name: 'Recovery code' })).toHaveValue(account.recoveryCode ?? '');
});

// --- item 5: forgot password -------------------------------------------------------------------------------

test('a recovery code gets back in however it is typed, each time for a new code, and a spent one is refused', async ({ page }) => {
  const { account } = await signedOut(page);
  /** the three ways a player may type the code they were shown */
  const spellings: Array<(code: string) => string> = [(code) => code.replace(/-/g, '').toLowerCase(), (code) => code.replace(/-/g, ' '), (code) => `  ${code.toLowerCase()} `];
  const spent: string[] = [];

  for (const [index, spell] of spellings.entries()) {
    const code = account.recoveryCode ?? '';
    const password = `${NEW_PASSWORD} ${index}`;
    await button(page, 'Forgot password').click();
    await expect(forgotForm(page)).toContainText('Sign in with your recovery code and choose a new password. The code is used up, and you get a new one.');
    await recover(page, 'neel', spell(code), password);

    // signed in, and shown the new code the way the first one was
    await expect(codeBox(page)).toContainText('Your password is changed and you are signed in. The code you used no longer works. This is your new one.');
    const next = account.recoveryCode ?? '';
    expect(next).toMatch(CODE_SHAPE);
    expect(next).not.toBe(code);
    await expect(codeBox(page).locator('.recovery-code-value')).toHaveText(next);
    await expect(codeBox(page)).toContainText(WARNING);
    // whatever was typed, the code went to the server as it was shown
    expect(account.posts.at(-1)).toEqual({ path: '/api/account/login', username: 'neel', recoveryCode: code, newPassword: password });
    expect(account.password).toBe(password);

    await button(page, 'I have saved it').click();
    await expect(who(page)).toContainText('neel');
    spent.push(code);
    await button(page, 'Sign out').click();
    await expect(button(page, 'Forgot password')).toBeVisible();
  }

  // every code that was used is spent
  await button(page, 'Forgot password').click();
  for (const old of spent) {
    await recover(page, 'neel', old, NEW_PASSWORD);
    await expect(forgotForm(page).getByRole('alert')).toHaveText(WRONG_CODE);
  }
  await expect(codeBox(page)).toHaveCount(0);
});

test("forgot password shows every refusal in the server's words, and leads back to the sign-in form", async ({ page }) => {
  const { account } = await signedOut(page);
  const code = account.recoveryCode ?? '';
  await page.getByLabel('Username').fill('neel');
  await button(page, 'Forgot password').click();
  // what was typed into the sign-in form is not typed again
  await expect(forgotForm(page).getByLabel('Username')).toHaveValue('neel');
  await expect(forgotForm(page).getByLabel('Recovery code')).toBeFocused();
  await expect(forgotForm(page)).toContainText('Capitals, spaces and dashes do not matter.');
  await expect(forgotForm(page)).toContainText('8 to 200 characters. Every other browser is signed out.');

  await button(page, 'Set password and sign in').click();
  await expect(forgotForm(page).getByRole('alert')).toHaveText('Enter your username, your recovery code and a new password.');
  expect(account.posts).toHaveLength(0);

  // the new password is looked at before the code
  await recover(page, 'neel', 'not a code', 'short');
  await expect(forgotForm(page).getByRole('alert')).toHaveText('Choose a new password of 8 to 200 characters.');
  await recover(page, 'neel', 'AAAA-BBBB-CCCC', NEW_PASSWORD);
  await expect(forgotForm(page).getByRole('alert')).toHaveText(WRONG_CODE);
  await recover(page, 'nobody', code, NEW_PASSWORD);
  await expect(forgotForm(page).getByRole('alert')).toHaveText(WRONG_CODE);

  account.locked = true;
  await recover(page, 'neel', code, NEW_PASSWORD);
  await expect(forgotForm(page).getByRole('alert')).toHaveText('Too many attempts. Try again in 15 minutes.');
  await expect(button(page, 'Set password and sign in')).toBeEnabled();
  account.locked = false;
  expect(account.password).toBe(PASSWORD);

  await button(page, 'Back to sign in').click();
  await expect(forgotForm(page)).toHaveCount(0);
  await expect(page.getByLabel('Username')).toHaveValue('neel');
  await expect(button(page, 'Forgot password')).toBeFocused();
  // creating an account is not where a password is forgotten
  await page.getByRole('radio', { name: 'Create account' }).check();
  await expect(button(page, 'Forgot password')).toBeHidden();
});

test('a deleted account is offered restoring through the forgot-password form', async ({ page }) => {
  const { account } = await setUp(page, { username: null });
  account.deleted = { state: new AccountServer('neel').state, restoreUntil: '2026-11-10T12:00:00.000Z' };
  const code = account.recoveryCode ?? '';
  await open(page, '/#account');
  await button(page, 'Forgot password').click();
  await expect(button(page, 'Restore it and sign in')).toBeHidden();
  await recover(page, 'neel', code.toLowerCase(), NEW_PASSWORD);
  await expect(forgotForm(page).getByRole('alert')).toHaveText(DELETED);

  await button(page, 'Restore it and sign in').click();
  await expect(codeBox(page).locator('.recovery-code-value')).toHaveText(account.recoveryCode ?? '');
  expect(account.posts.at(-1)).toEqual({ path: '/api/account/login', username: 'neel', recoveryCode: code, newPassword: NEW_PASSWORD, restore: true });
  expect(account.deleted).toBeNull();
  await button(page, 'I have saved it').click();
  await expect(who(page)).toContainText('neel');
});

// --- item 5: a new code from the account pane ----------------------------------------------------------------

test('the account pane issues a new code after the current password, shown once, and the old one stops working', async ({ page }) => {
  const { account } = await setUp(page);
  const old = account.recoveryCode ?? '';
  await open(page, '/#account');
  const recovery = section(page, 'Recovery code');
  const open_ = recovery.getByRole('button', { name: 'New recovery code' });
  await expect(recovery).toContainText('Your account has a recovery code. A new one replaces it.');
  // closed until asked for, as the password form is
  await expect(recovery.getByLabel('Current password')).toHaveCount(0);
  await expect(open_).toHaveAttribute('aria-expanded', 'false');
  await open_.click();
  await expect(recovery.getByLabel('Current password')).toBeFocused();

  await recovery.getByRole('button', { name: 'New recovery code' }).click();
  await expect(recovery.getByRole('alert')).toHaveText('Enter your current password to get a new code.');
  expect(account.posted('recoveryCode')).toHaveLength(0);
  await recovery.getByLabel('Current password').fill('not it');
  await recovery.getByRole('button', { name: 'New recovery code' }).click();
  await expect(recovery.getByRole('alert')).toHaveText('That is not your current password.');
  expect(account.recoveryCode).toBe(old);

  await recovery.getByLabel('Current password').fill(PASSWORD);
  await recovery.getByRole('button', { name: 'New recovery code' }).click();
  await expect(codeBox(page)).toContainText('This is your new recovery code. Any earlier one no longer works.');
  const next = account.recoveryCode ?? '';
  expect(next).not.toBe(old);
  await expect(codeBox(page).locator('.recovery-code-value')).toHaveText(next);
  await expect(codeBox(page)).toContainText(WARNING);
  expect(account.posted('recoveryCode')).toEqual([expect.anything(), { action: 'recoveryCode', password: PASSWORD, path: '/api/account' }]);
  // the rest of the pane is still there: only the section is the code's
  await expect(who(page)).toContainText('neel');

  await button(page, 'I have saved it').click();
  await expect(codeBox(page)).toHaveCount(0);
  await expect(page.getByText(next)).toHaveCount(0);
  await expect(recovery.getByRole('button', { name: 'New recovery code' })).toBeFocused();
  await expect(recovery.getByLabel('Current password')).toHaveCount(0);

  // the code it replaced gets nobody in
  await button(page, 'Sign out').click();
  await button(page, 'Forgot password').click();
  await recover(page, 'neel', old, NEW_PASSWORD);
  await expect(forgotForm(page).getByRole('alert')).toHaveText(WRONG_CODE);
  await recover(page, 'neel', next, NEW_PASSWORD);
  await expect(codeBox(page)).toBeVisible();
});

test('an account made before there were codes is told plainly that it has none, until it makes one', async ({ page }) => {
  const { account } = await setUp(page);
  account.recoveryCode = null;
  await open(page, '/#account');
  const recovery = section(page, 'Recovery code');
  await expect(recovery).toContainText('Your account has no recovery code. Without one there is no way back in if you forget your password.');

  await recovery.getByRole('button', { name: 'New recovery code' }).click();
  await recovery.getByLabel('Current password').fill(PASSWORD);
  await recovery.getByRole('button', { name: 'New recovery code' }).click();
  await expect(codeBox(page).locator('.recovery-code-value')).toHaveText(account.recoveryCode ?? 'none');
  await button(page, 'I have saved it').click();
  await expect(recovery).toContainText('Your account has a recovery code. A new one replaces it.');
});

// --- item 22: sessions -------------------------------------------------------------------------------------

test('Sign out everywhere says what it does, and leaves the page a visitor\'s', async ({ page }) => {
  const { account, social } = await setUp(page);
  social.friends = { friends: [], incoming: ['sam'], outgoing: [], invites: [] };
  await open(page, '/#account');
  const sessions = section(page, 'Sign out everywhere');
  await expect(sessions).toContainText('Signs your account out of every browser and device, this one included.');
  // the sidebar shows what is the account's: a waiting request, and a moderator's pane
  await expect(page.locator('.nav .badge')).toHaveText('1');
  await expect(page.getByRole('link', { name: 'Moderation' })).toBeVisible();

  await sessions.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(button(page, 'Forgot password')).toBeVisible();
  await expect(who(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your account' })).toHaveCount(0);
  await expect(page.locator('.nav .badge')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Moderation' })).toBeHidden();
  expect(account.posted('signOutEverywhere')).toEqual([{ action: 'signOutEverywhere', path: '/api/account' }]);
  expect(account.sessionVersion).toBe(1);
  expect(account.state.account).toBeNull();
  // and it stays so
  await page.reload();
  await expect(button(page, 'Forgot password')).toBeVisible();
});

test('a refusal to sign out everywhere is shown as sent, and the player stays signed in', async ({ page }) => {
  const { account } = await setUp(page);
  await open(page, '/#account');
  const sessions = section(page, 'Sign out everywhere');
  account.refuse = 'That is not something that can be asked here.';
  await sessions.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(sessions.getByRole('alert')).toHaveText('That is not something that can be asked here.');
  await expect(sessions.getByRole('button', { name: 'Sign out everywhere' })).toBeEnabled();
  await expect(who(page)).toContainText('neel');
});

test('the password form says that every other browser is signed out', async ({ page }) => {
  await setUp(page);
  await open(page, '/#account');
  await button(page, 'Change password').click();
  const form = page.locator('form').filter({ has: page.getByLabel('New password', { exact: true }) });
  await expect(form).toContainText('8 to 200 characters. Every other browser is signed out.');
  await expect(page.getByText('stay signed in')).toHaveCount(0);
});

// --- item 9: the 2v2 record --------------------------------------------------------------------------------

test('the 2v2 record sits beside the duel record, in the same form, on the account pane and on a profile', async ({ page }) => {
  const { social } = await setUp(page, { account: { duels: { wins: 2, losses: 1, ties: 0, winRate: 66, rank: 12 }, teams: { wins: 7, losses: 4, ties: 1, winRate: 58 } } });
  social.profiles = { ...social.profiles, sam: profile('sam', { teams: { wins: 31, losses: 12, ties: 3, winRate: 67 } }) };
  await open(page, '/#account');
  const duels = section(page, 'Duel record');
  const teams = section(page, '2v2 record');
  await expect(duels.locator('.figure')).toHaveText(['Wins2', 'Losses1', 'Ties0', 'Win rate66%']);
  await expect(teams.locator('.figure')).toHaveText(['Wins7', 'Losses4', 'Ties1', 'Win rate58%']);
  // the same four cells, one grid under the other
  const [duelBox, teamBox] = [await duels.boundingBox(), await teams.boundingBox()];
  expect(teamBox?.x).toBe(duelBox?.x);
  expect(teamBox?.width).toBe(duelBox?.width);
  expect(teamBox?.y).toBeGreaterThan(duelBox?.y ?? 0);

  await open(page, '/?user=sam');
  await expect(section(page, "sam's 2v2 record").locator('.figure')).toHaveText(['Wins31', 'Losses12', 'Ties3', 'Win rate67%']);
  // a player who has played none has noughts, not a gap
  await open(page, '/?user=neel');
  await expect(section(page, "neel's 2v2 record").locator('.figure')).toHaveText(['Wins0', 'Losses0', 'Ties0', 'Win rate0%']);
});

// --- item 14: hide my last seen ----------------------------------------------------------------------------

test('"Hide my last seen" is switched on the account, with what it does said under it', async ({ page }) => {
  const { account } = await setUp(page);
  await open(page, '/#account');
  const hide = page.getByRole('group', { name: 'Hide my last seen' });
  await expect(hide.getByRole('radio', { name: 'No' })).toBeChecked();
  await expect(page.getByText('Friends then see only whether you are online.')).toBeVisible();

  await hide.getByRole('radio', { name: 'Yes' }).check();
  await expect.poll(() => account.state.account?.hideLastSeen).toBe(true);
  expect(account.posted('settings').at(-1)).toEqual({ action: 'settings', hideLastSeen: true, path: '/api/account' });

  account.slowDown = true;
  await hide.getByRole('radio', { name: 'No' }).check();
  await expect(page.getByRole('alert')).toHaveText('Too many requests. Slow down a little.');
  await expect(hide.getByRole('radio', { name: 'Yes' })).toBeChecked();
  account.slowDown = false;

  await page.reload();
  await expect(hide.getByRole('radio', { name: 'Yes' })).toBeChecked();
});

test('a friend who hides it is only online or offline, on the friends pane and on their profile, with nothing stale', async ({ page }) => {
  const { social } = await setUp(page);
  await page.clock.install({ time: new Date('2026-10-11T12:00:00.000Z') });
  social.hideLastSeen = ['kit', 'lee'];
  social.friends = {
    friends: [friend('ana', { lastSeenAt: '2026-10-11T09:00:00.000Z' }), friend('kit', { lastSeenAt: '2026-10-11T09:00:00.000Z' }), friend('lee', { online: true, lastSeenAt: '2026-10-11T11:59:30.000Z' })],
    incoming: [],
    outgoing: [],
    invites: [],
  };
  social.profiles = { ...social.profiles, kit: profile('kit', { lastSeenAt: '2026-10-11T09:00:00.000Z' }), lee: profile('lee', { online: true, lastSeenAt: '2026-10-11T11:59:30.000Z' }) };
  await page.goto('/#friends');
  const rows = section(page, 'Friends').locator('.player-row');
  await expect(rows.nth(0).locator('.presence')).toHaveText('Last seen 3 hours ago');
  await expect(rows.nth(1).locator('.presence')).toHaveText('Offline');
  await expect(rows.nth(1).locator('.presence')).not.toHaveAttribute('data-seen');
  await expect(rows.nth(2).locator('.presence')).toHaveText('Online');

  // an hour on, the one whose time is known is written again; the others say nothing they do not know
  social.friends = { ...social.friends, friends: social.friends.friends.map((each) => (each.username === 'lee' ? { ...each, online: false } : each)) };
  await page.clock.fastForward('01:00:00');
  await expect(rows.nth(0).locator('.presence')).toHaveText('Last seen 4 hours ago');
  await expect(rows.nth(1).locator('.presence')).toHaveText('Offline');
  await expect(rows.nth(2).locator('.presence')).toHaveText('Offline');
  await expect(page.getByText('Not seen yet')).toHaveCount(0);

  await page.goto('/?user=kit');
  await expect(page.locator('.profile-who .presence')).toHaveText('Offline');
  await page.goto('/?user=lee');
  await expect(page.locator('.profile-who .presence')).toHaveText('Online');
});

// --- the languages -----------------------------------------------------------------------------------------

for (const code of ['de', 'ru'] as const) {
  const say = CATALOGS[code]!;

  test.describe(`${code} on a phone`, () => {
    test.use({ viewport: PHONE });

    test('the recovery code at sign-up, and the account pane after it, are in the language', async ({ page }) => {
      const { account } = await setUp(page, { username: null, language: code });
      await open(page, '/#account');
      await page.getByRole('radio', { name: say['account.register.name'] }).check();
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
      await page.getByLabel(say['account.username']).fill('neel_s');
      await page.getByLabel(say['account.password']).fill(PASSWORD);
      await page.getByRole('button', { name: say['account.register.name'], exact: true }).click();
      await expect(codeBox(page)).toContainText(say['recovery.warning']);
      await expectTranslated(page, code, [...NAMES, account.recoveryCode ?? '']);

      await page.getByRole('button', { name: say['recovery.saved'], exact: true }).click();
      await expect(who(page)).toContainText('neel_s');
      await page.waitForLoadState('networkidle');
      await expectTranslated(page, code, [...NAMES, 'neel_s', ...(await written(page))]);
      // the code issued from the pane, in its section
      const recovery = section(page, say['recovery.title']);
      await recovery.getByRole('button', { name: say['recovery.issue'], exact: true }).click();
      await recovery.getByLabel(say['account.currentPassword']).fill(PASSWORD);
      await recovery.getByRole('button', { name: say['recovery.issue'], exact: true }).click();
      await expect(codeBox(page)).toContainText(say['recovery.made.issued']);
      await expectTranslated(page, code, [...NAMES, 'neel_s', account.recoveryCode ?? '', ...(await written(page))]);
    });

    test('the forgot-password form, its offer to restore, and the new code are in the language', async ({ page }) => {
      const { account } = await setUp(page, { username: null, language: code });
      account.deleted = { state: new AccountServer('neel').state, restoreUntil: '2026-11-10T12:00:00.000Z' };
      const old = account.recoveryCode ?? '';
      await open(page, '/#account');
      await page.getByRole('button', { name: say['recovery.forgot'], exact: true }).click();
      const form = page.getByRole('form', { name: say['recovery.forgot'] });
      await expect(form).toContainText(say['recovery.forgot.lede']);
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
      // with nothing typed the form says what it needs, in the language
      await page.getByRole('button', { name: say['recovery.submit'], exact: true }).click();
      await expect(form.getByRole('alert')).toHaveText(say['recovery.missing']);
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);

      await form.getByLabel(say['account.username']).fill('neel');
      await form.getByLabel(say['recovery.title']).fill(old);
      await form.getByLabel(say['account.newPassword']).fill(NEW_PASSWORD);
      await page.getByRole('button', { name: say['recovery.submit'], exact: true }).click();
      // the server's refusal is its own English; the offer under it is the catalog's
      await expect(page.getByRole('button', { name: say['account.restore'], exact: true })).toBeVisible();
      await expectTranslated(page, code, [...NAMES, DELETED, ...(await written(page))]);

      await page.getByRole('button', { name: say['account.restore'], exact: true }).click();
      await expect(codeBox(page)).toContainText(say['recovery.made.recovered']);
      await expectTranslated(page, code, [...NAMES, account.recoveryCode ?? '']);
    });
  });
}
