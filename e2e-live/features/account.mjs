// The account: its pane, the language, the password, and deleting and restoring it.
import { apiQuiet, check, expected, origin, password, passwordOf, passwords, problems, random, say, signIn, STEP_MS, textOf, texts } from './setup.mjs';

// --- 4. account ----------------------------------------------------------------------------------

export async function account(page, who) {
  await page.goto(`${origin}/#account`);
  const stats = page.getByRole('region', { name: 'Your stats' });
  await stats.waitFor({ timeout: STEP_MS });
  const level = await textOf(page.getByRole('region', { name: 'Level' }));
  const figures = await texts(stats.locator('.figure'));
  say(who, `level: ${level}`);
  say(who, `stats: ${figures.join(' | ')}`);
  check('the level and XP are shown', /^Level\d+.*XP · .* to level \d+$/.test(level), level);
  for (const name of ['League', 'Rating', 'Best streak', 'Games']) {
    check(`the ${name} figure is shown`, figures.some((figure) => figure.startsWith(name) && figure.length > name.length));
  }
  const progress = await textOf(page.getByRole('region', { name: 'Progress' }));
  check('a new account has the empty state for its progress charts', progress.includes('Not enough history to draw yet.'), progress.slice(0, 80));

  await page.getByRole('radio', { name: 'Miles' }).check();
  const games = page.locator('.account-table tbody tr');
  check('the finished game is in recent games', (await games.count()) >= 1, (await texts(games)).join(' ; '));
  await page.getByRole('button', { name: /^Rounds of the game/ }).first().click();
  await page.locator('.pane-title', { hasText: 'Game' }).waitFor({ timeout: STEP_MS });
  await page.locator('.history-map .pin-actual').first().waitFor({ timeout: STEP_MS });
  const rows = await texts(page.locator('.rounds tbody tr'));
  say(who, `history: ${rows.join(' ; ')}`);
  check('the history view lists the three rounds', rows.length === 3);
  check('the history map has a pin for each place', (await page.locator('.history-map .pin-actual').count()) === 3);
  check('distances read in miles after the switch', rows.every((row) => / (mi|ft)\d/.test(row) || row.includes('No guess')), rows[0]);
  await page.getByRole('button', { name: 'Back to account' }).click();
  await page.getByRole('radio', { name: 'Kilometres' }).check();
}

// --- 9. the language: to Spanish, over a reload, and back -------------------------------------------

export async function languages(page, who) {
  await page.goto(`${origin}/#account`);
  await page.getByRole('radio', { name: 'Español' }).check();
  await page.waitForFunction(() => document.documentElement.lang === 'es', null, { timeout: STEP_MS });
  await page.getByRole('region').first().waitFor({ timeout: STEP_MS });
  const spanish = await textOf(page.locator('.pane-title'));
  const nav = await texts(page.locator('.nav-item'));
  say(who, `in Spanish: pane "${spanish}", nav ${nav.slice(0, 4).join(', ')}`);
  check('switching to Spanish reloads the page in Spanish', spanish !== 'Account' && !nav.includes('Singleplayer'), spanish);
  await page.reload();
  // a page is loaded before it has its language: the catalog is fetched first, and only then is <html lang> set and
  // the screen drawn. So the pane is waited for; asking straight after the reload reads the "en" index.html starts with
  await page.locator('.pane-title').waitFor({ timeout: STEP_MS });
  const kept = { lang: await page.evaluate(() => document.documentElement.lang), pane: await textOf(page.locator('.pane-title')) };
  check('the choice is remembered over a reload', kept.lang === 'es' && kept.pane === spanish, `lang ${kept.lang}, pane "${kept.pane}"`);
  await page.getByRole('radio', { name: 'English' }).check();
  await page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: STEP_MS });
  await page.locator('.pane-title', { hasText: 'Account' }).waitFor({ timeout: STEP_MS });
  check('and back to English', true);
}

// --- 16 and 17. the password, then deleting the account and restoring it ----------------------------

export async function changePassword(page, who) {
  const next = `pw-${random(12)}`;
  const signedIn = page.getByText('Signed in as');
  await page.goto(`${origin}/#account`);
  await signedIn.waitFor({ timeout: STEP_MS });
  // a new password ends every session the old one opened: what the page has already asked is let through first
  await apiQuiet(page);
  // the form starts as one button of the same name as its own, and opens in that button's place; what
  // came of it is said in the section, since the form closes again once the password is changed
  const section = page.locator('section').filter({ has: page.getByLabel('Current password') }).last();
  const change = section.getByRole('button', { name: 'Change password', exact: true });
  if (!(await page.getByLabel('Current password').isVisible())) {
    await change.click();
  }
  await page.getByLabel('Current password').fill(passwordOf(who));
  await page.getByLabel('New password', { exact: true }).fill(next);
  await change.click();
  const answer = section.getByRole('status').or(section.getByRole('alert')).filter({ hasText: /\S/ });
  await answer.first().waitFor({ timeout: STEP_MS });
  const changed = (await textOf(answer)) === 'Password changed.';
  check('the password is changed', changed, await textOf(answer));
  if (!changed) {
    return;
  }
  passwords.set(who, next);

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor({ timeout: STEP_MS });
  expected.add('401 /api/account/login');
  await signIn(page, who, password);
  const refusal = page.getByRole('alert').filter({ hasText: /\S/ });
  await refusal.or(signedIn).first().waitFor({ timeout: STEP_MS });
  check('the old password is refused', (await signedIn.count()) === 0 && (await textOf(refusal)) === 'Wrong username or password.', (await textOf(refusal)) || 'it signed in');
  await signIn(page, who, next);
  await signedIn.waitFor({ timeout: STEP_MS });
  check('the new password signs in', (await textOf(page.locator('.figure').filter({ hasText: 'Signed in as' }))).includes(who));
}

/**
 * Asks the server to restore a deleted account, as the sign-in form's Restore button does. Used
 * only when the form did not get there, so that the check does not leave the account deleted.
 */
async function restoreDirectly(page, who, secret) {
  const status = await page
    .evaluate(async (body) => (await fetch('/api/account/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, { username: who, password: secret, restore: true })
    .catch((error) => String(error).split('\n')[0]);
  say(who, `the form did not restore the account; asking the server directly answered ${status}`);
  if (status !== 200) {
    problems.push(`[${who}] is left deleted: the server keeps it for 30 days, and it is in THROWAWAY_USERS`);
  }
}

export async function deleteAndRestore(page, who) {
  const secret = passwordOf(who);
  const signedIn = page.getByText('Signed in as');
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true });
  await page.goto(`${origin}/#account`);
  // the part before this one ends signed in; had it stopped half way, the account is signed in to here
  await signedIn.or(signInButton).first().waitFor({ timeout: STEP_MS });
  if ((await signedIn.count()) === 0) {
    await signIn(page, who, secret);
    await signedIn.waitFor({ timeout: STEP_MS });
  }

  // signing in is followed by the home screen asking who is waiting on the friends pane: deleting the account
  // before that is answered gets it refused, a request that was fair when it was sent
  await apiQuiet(page);
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  const confirm = page.locator('form').filter({ has: page.getByLabel('Password', { exact: true }) });
  await page.getByLabel('Password', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Delete my account' }).click();
  const gone = page.getByRole('alert').filter({ hasText: 'Your account is deleted.' });
  await gone.or(confirm.getByRole('alert')).first().waitFor({ timeout: STEP_MS });
  const deleted = (await gone.count()) > 0;
  const told = deleted ? await textOf(gone) : await textOf(confirm.getByRole('alert'));
  check('the account is deleted with its password, and the pane says until when it can be restored', deleted && /Until .+ you can restore it by signing in\./.test(told), told);
  if (!deleted) {
    return;
  }

  let restored = false;
  try {
    await page.getByRole('button', { name: 'Go to sign in' }).click();
    await signInButton.waitFor({ timeout: STEP_MS });
    expected.add('409 /api/account/login');
    await signIn(page, who, secret);
    const refusal = page.getByRole('alert').filter({ hasText: /\S/ });
    await refusal.or(signedIn).first().waitFor({ timeout: STEP_MS });
    const restore = page.getByRole('button', { name: 'Restore it and sign in' });
    check('signing in to the deleted account is refused, with the offer to restore it', (await textOf(refusal)) === 'This account was deleted. Restore it to sign in.' && (await restore.isVisible()), (await textOf(refusal)) || 'it signed in');
    await restore.click();
    await signedIn.waitFor({ timeout: STEP_MS });
    restored = (await textOf(page.locator('.figure').filter({ hasText: 'Signed in as' }))).includes(who);
    check('restoring signs in to the account again', restored);
  } finally {
    if (!restored) {
      await restoreDirectly(page, who, secret);
    }
  }
}
