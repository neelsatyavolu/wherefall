// What every part of the live check shares: where it runs, who it runs as, what it has seen so far,
// and the handful of moves (sign up, wait for a round, place a pin) the parts are made of.
import { randomBytes } from 'node:crypto';

export const [base, ...flags] = process.argv.slice(2);
if (!base || !/^https?:\/\//.test(base)) {
  console.error('Usage: node e2e-live/features.mjs <base URL> [--headed]');
  process.exit(2);
}
export const origin = base.replace(/\/+$/, '');

export const STEP_MS = 45_000;
export const QUEUE_MS = 90_000;
/** a one-round party from its round to its final standing: 60 seconds to guess at most, then the reveal */
export const PARTY_MS = 2 * 60_000;
export const COUNTRY = 'Kenya';
export const GUESSER_ROUNDS = 10;
export const DAILY_ROUNDS = 3;

export const random = (bytes) => randomBytes(bytes).toString('hex');
export const users = [`check_${random(4)}`, `check_${random(4)}`];
export const password = `pw-${random(12)}`;
/** the password of a user who has changed theirs since signing up */
export const passwords = new Map();
export const passwordOf = (username) => passwords.get(username) ?? password;
export const created = [];
export const maps = [];
export const problems = [];
export const checks = [];
/** refusals the check asks for on purpose, such as opening the map it has just deleted */
export const expected = new Set();
/** how often each page asked the server whether a Google viewer may be made, and what it was told */
export const viewerAsks = new Map();
/** the requests each page has sent to the API and not yet had answered */
const unanswered = new Map();
/** how long the API must have had nothing to answer before a page counts as quiet: one answer often sets off the next request */
const QUIET_MS = 400;

export const say = (who, text) => console.log(`[${who}] ${text}`);

/** Records one thing the check looked for. A failed one is listed again at the end. */
export function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

export const clean = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
export const textOf = async (locator) => clean(await locator.first().textContent({ timeout: 5000 }).catch(() => ''));
export const texts = async (locator) => (await locator.allTextContents()).map(clean);

export function watch(page, who) {
  page.on('console', (message) => {
    // a refused request is listed with its address by the response listener below; the console's copy has none
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      problems.push(`[${who}] console error: ${message.text().slice(0, 300)}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`[${who}] page error: ${String(error).slice(0, 300)}`));
  viewerAsks.set(page, { count: 0, last: '' });
  page.on('response', async (response) => {
    const request = response.request();
    if (new URL(response.url()).pathname === '/api/daily' && request.method() === 'POST' && (request.postData() ?? '').includes('viewer')) {
      const asked = viewerAsks.get(page);
      asked.count += 1;
      asked.last = await response.text().catch(() => '');
    }
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? '';
    // requests the page itself gives up on (a poll cut off by leaving a screen) are not failures
    if (!reason.includes('ERR_ABORTED')) {
      problems.push(`[${who}] request failed: ${request.method()} ${request.url().slice(0, 160)} ${reason}`);
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400 && url.origin === new URL(origin).origin && !expected.has(`${response.status()} ${url.pathname}${url.search}`)) {
      problems.push(`[${who}] HTTP ${response.status()}: ${response.request().method()} ${url.pathname}${url.search}`);
    }
  });
  const open = new Set();
  unanswered.set(page, open);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(origin).origin && url.pathname.startsWith('/api/')) {
      open.add(request);
    }
  });
  page.on('requestfinished', (request) => open.delete(request));
  page.on('requestfailed', (request) => open.delete(request));
}

/**
 * Waits until the API has answered everything a watched page has asked of it. The home screen
 * follows every page load and sign-in with questions of its own (who is waiting on the friends
 * pane, whether a match is open). A step that ends the session those were sent with, a new password
 * or deleting the account, must not overtake them: the server would refuse what was fair when it
 * was sent, and the refusal would be listed as a problem. Gives up after a step's time and goes on.
 */
export async function apiQuiet(page) {
  const open = unanswered.get(page);
  const deadline = Date.now() + STEP_MS;
  let quietSince = null;
  while (open && Date.now() < deadline) {
    quietSince = open.size > 0 ? null : (quietSince ?? Date.now());
    if (quietSince !== null && Date.now() - quietSince >= QUIET_MS) {
      return;
    }
    await page.waitForTimeout(50);
  }
}

/** Runs one part of the check. A part that stops is reported and the next one still runs. */
export async function part(name, run) {
  console.log(`--- ${name}`);
  try {
    await run();
  } catch (error) {
    check(`${name} ran to its end`, false, String(error).split('\n')[0]);
  }
}

export async function signUp(page, username) {
  await page.goto(`${origin}/#account`);
  await page.getByRole('radio', { name: 'Create account' }).check();
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  // sign-up shows the recovery code once, and the account pane only after it is acknowledged
  await page.getByRole('button', { name: 'I have saved it' }).click({ timeout: STEP_MS });
  await page.getByText('Signed in as').waitFor({ timeout: STEP_MS });
  created.push(username);
  say(username, 'signed up and signed in');
}

/** Fills in the sign-in form of the account pane and sends it. What comes of it is the caller's to wait for. */
export async function signIn(page, username, secret) {
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password').fill(secret);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** Waits for a round to be on screen with its view loaded. Stops with the notice's words if the game could not load. */
export async function roundReady(page) {
  await page.waitForFunction(
    () => {
      const play = document.querySelector('.play');
      const notice = document.querySelector('.notice-panel');
      return notice !== null || (play?.getAttribute('data-phase') === 'guessing' && (document.querySelector('.status')?.textContent ?? '') === '');
    },
    null,
    { timeout: STEP_MS },
  );
  const notice = await page.locator('.notice-panel .prose').count();
  if (notice > 0) {
    throw new Error(`the game stopped with: ${await textOf(page.locator('.notice-panel .prose'))}`);
  }
}

export const hud = (page) => textOf(page.locator('.hud'));
export const imagery = (page) => page.locator('.play').getAttribute('data-imagery');

/** Opens the guess map and puts a pin on it: in the middle, or at a fraction of its width and height. */
export async function placePin(page, at = { x: 0.5, y: 0.5 }) {
  await page.locator('.map-panel').hover();
  await page.waitForTimeout(700);
  const canvas = page.locator('.map-panel .maplibregl-canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * at.x, y: box.height * at.y } });
}

export async function sendGuess(page) {
  await page.locator('.map-panel .guess').click();
  await page.locator('.play[data-phase="result"], .play[data-phase="summary"]').waitFor({ timeout: STEP_MS });
}

export async function leaveGame(page, yes) {
  await page.getByRole('button', { name: 'Exit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: yes }).click();
}
