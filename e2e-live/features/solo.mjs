// Playing alone: singleplayer, the streak, a country map, a Guesser run, the daily, and the map types.
import { check, COUNTRY, DAILY_ROUNDS, GUESSER_ROUNDS, hud, imagery, leaveGame, origin, placePin, roundReady, say, sendGuess, STEP_MS, textOf, texts, viewerAsks, watch } from './setup.mjs';

// --- 1. singleplayer -----------------------------------------------------------------------------

export async function singleplayer(page, context, who) {
  await page.goto(`${origin}/#singleplayer`);
  await page.getByRole('radio', { name: '3', exact: true }).check();
  await page.waitForTimeout(1500);
  const asksBefore = viewerAsks.get(page).count;
  await page.getByRole('button', { name: 'Start game' }).click();
  await roundReady(page);
  say(who, `viewer allowance: asked ${viewerAsks.get(page).count - asksBefore} time(s), told ${viewerAsks.get(page).last}`);
  check('opening the home screen did not spend the viewer allowance', asksBefore === 0, `${asksBefore} asks before the first game`);
  check('singleplayer plays on Google imagery', (await imagery(page)) === 'google', `imagery ${await imagery(page)}, HUD ${await hud(page)}`);

  await page.getByRole('button', { name: 'Hint (half points)' }).click();
  check('Hint is marked as used', await page.getByRole('button', { name: 'Hint shown' }).isDisabled());
  await page.locator('.map-panel').hover();
  await page.waitForTimeout(1200);
  for (let step = 0; step < 12; step += 1) {
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(1500);
  await placePin(page);
  check('a pin is on the map after zooming in twelve steps from the hint circle', (await page.locator('.aim').count()) === 1);
  await sendGuess(page);

  const result = page.getByRole('region', { name: 'Round result' });
  const figures = await texts(result.locator('.figure'));
  say(who, `round 1 result: ${figures.join(' | ')}`);
  check('the result says the hint halved the round', (await textOf(result)).includes('You used the hint, so this round scored half.'));
  const link = result.getByRole('link', { name: 'Open in Google Maps' });
  const href = (await link.getAttribute('href')) ?? '';
  check('the result links to the place on google.com/maps', /^https:\/\/www\.google\.com\/maps\//.test(href), href);
  check('the link opens in a new tab', (await link.getAttribute('target')) === '_blank' && (await link.getAttribute('rel')) === 'noopener');
  const [tab] = await Promise.all([context.waitForEvent('page', { timeout: STEP_MS }), link.click()]);
  await tab.waitForLoadState('domcontentloaded', { timeout: STEP_MS }).catch(() => {});
  check('clicking it opened a Google page in another tab', /google\./.test(tab.url()), tab.url().slice(0, 80));
  await tab.close();

  check('the viewer allowance was asked about exactly once for the game', viewerAsks.get(page).count - asksBefore === 1, `${viewerAsks.get(page).count - asksBefore} asks`);
  await leaveGame(page, 'Leave game');
  await page.getByRole('button', { name: 'Start game' }).waitFor({ timeout: STEP_MS });
  check('Exit from the result screen goes home', true);
}

// --- 2. country streak ---------------------------------------------------------------------------

/** Spots on the world map, as fractions of the guess map, that are well inside large countries. */
const LAND = [
  { x: 0.75, y: 0.25 },
  { x: 0.33, y: 0.57 },
  { x: 0.83, y: 0.72 },
  { x: 0.2, y: 0.3 },
];

export async function streak(page, who) {
  await page.goto(`${origin}/#streak`);
  await page.getByRole('button', { name: 'Start streak' }).click();
  await roundReady(page);
  check('the streak HUD starts at 0', (await hud(page)).includes('Streak0'), await hud(page));

  for (let round = 0; round < 3; round += 1) {
    let label = '';
    for (const spot of LAND) {
      await placePin(page, spot);
      label = await textOf(page.locator('.map-panel .guess'));
      if (label.startsWith('Guess ')) {
        break;
      }
    }
    check(`the Guess button names the country under the pin (round ${round + 1})`, label.startsWith('Guess '), label);
    await page.locator('.map-panel .guess').click();
    // wrong ends the run; right raises the counter in the HUD
    await page.waitForFunction(
      (before) => document.querySelector('[aria-label="Streak over"]') !== null || document.querySelector('.hud .hud-cell:nth-child(2) .value')?.textContent !== before,
      String(round),
      { timeout: STEP_MS },
    );
    if ((await page.getByRole('region', { name: 'Streak over' }).count()) > 0) {
      break;
    }
    say(who, `${label}: right, streak ${await textOf(page.locator('.hud .hud-cell:nth-child(2) .value'))}, status "${await textOf(page.locator('.status'))}"`);
    await roundReady(page);
  }

  const over = page.getByRole('region', { name: 'Streak over' });
  if ((await over.count()) > 0) {
    await page.waitForTimeout(2500);
    say(who, `streak ended: ${await textOf(over)}`);
    check('the end screen says what the country was', /It was .+\./.test(await textOf(over)));
    check('the end screen links to the place', (await over.getByRole('link', { name: 'Open in Google Maps' }).count()) === 1);
    await over.getByRole('button', { name: 'Home' }).click();
  } else {
    say(who, 'three right in a row: ending the run with Exit');
    await leaveGame(page, 'End run');
  }
  await page.locator('.pane-title', { hasText: 'Country streak' }).waitFor({ timeout: STEP_MS });
  check('the streak ends back on its pane', true);
}

// --- 3. a country map, played to the end so there is a finished game -----------------------------

export async function countryGame(page, who) {
  await page.goto(`${origin}/#singleplayer`);
  await page.getByRole('radio', { name: 'A country' }).check({ timeout: STEP_MS });
  await page.getByRole('searchbox', { name: 'Country' }).fill(COUNTRY.slice(0, 4));
  await page.getByRole('radio', { name: new RegExp(`^${COUNTRY} `) }).check();
  await page.getByRole('radio', { name: '3', exact: true }).check();
  const asksBefore = viewerAsks.get(page).count;
  await page.getByRole('button', { name: 'Start game' }).click();
  await roundReady(page);
  check(`the HUD shows the ${COUNTRY} map`, (await hud(page)).includes(COUNTRY), await hud(page));
  check('the country game plays on Google imagery', (await imagery(page)) === 'google');

  for (let round = 1; round <= 3; round += 1) {
    await placePin(page);
    await sendGuess(page);
    const result = page.getByRole('region', { name: 'Round result' });
    const figures = await texts(result.locator('.figure'));
    if (round === 1) {
      // the country's flag stands between the label and its name
      check(`the first place is in ${COUNTRY}`, figures.some((figure) => figure.startsWith('Country') && figure.endsWith(COUNTRY)), figures.join(' | '));
    }
    await page.getByRole('button', { name: round === 3 ? 'See summary' : 'Next round' }).click();
    if (round < 3) {
      await roundReady(page);
    }
  }
  check('three rounds asked about the viewer allowance once, not once a round', viewerAsks.get(page).count - asksBefore === 1, `${viewerAsks.get(page).count - asksBefore} asks`);
  const summary = page.getByRole('region', { name: 'Game summary' });
  await page.waitForFunction(() => (document.querySelector('.save-note')?.textContent ?? '') !== '', null, { timeout: STEP_MS });
  const note = await textOf(summary.locator('.save-note'));
  say(who, `summary: ${await textOf(summary.locator('.figure-value'))}; ${note}`);
  check('the finished game was saved to the account', note.startsWith(`Saved to ${who}'s stats.`), note);
  await summary.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Start game' }).waitFor({ timeout: STEP_MS });
}

// --- 12. Country Guesser: a run, and its best score on the account --------------------------------

export async function guesser(page, who) {
  await page.goto(`${origin}/#country`);
  await page.getByRole('heading', { name: 'Country Guesser', exact: true }).waitFor({ timeout: STEP_MS });
  await page.getByRole('button', { name: 'Start game' }).click();
  const panel = page.getByRole('region', { name: 'Which country is this?' });
  const offered = [];
  let right = 0;
  // the score is sent when the tenth answer is in, and the reply says what the account's best now is
  let saved = Promise.resolve(null);
  for (let round = 1; round <= GUESSER_ROUNDS; round += 1) {
    await roundReady(page);
    await panel.waitFor({ timeout: STEP_MS });
    if (round === 1) {
      check('the run is ten rounds', (await hud(page)).includes(`1 / ${GUESSER_ROUNDS}`), await hud(page));
    }
    if (round === GUESSER_ROUNDS) {
      saved = page
        .waitForResponse((response) => new URL(response.url()).pathname === '/api/games' && response.request().method() === 'POST' && (response.request().postData() ?? '').includes('"kind":"country"'), { timeout: STEP_MS })
        .catch(() => null);
    }
    // the answer is not known beforehand, so the first button is pressed every round
    offered.push(await panel.getByRole('button').count());
    await panel.getByRole('button').first().click();
    const verdict = panel.getByRole('status').filter({ hasText: /\S/ });
    await verdict.waitFor({ timeout: STEP_MS });
    right += (await textOf(verdict)).startsWith('Correct') ? 1 : 0;
    await panel.getByRole('button', { name: round === GUESSER_ROUNDS ? 'See summary' : 'Next round' }).click();
  }
  check('every round offered six countries', offered.every((count) => count === 6), offered.join(' '));

  const summary = page.getByRole('region', { name: 'Game summary' });
  await summary.waitFor({ timeout: STEP_MS });
  const final = await textOf(summary.locator('.figure-value'));
  const [shown] = final.split(' / ');
  check('the end screen scores 1,000 points a right answer', Number(shown.replace(/\D/g, '')) === right * 1000 && final.endsWith(' / 10,000'), `${right} right, ${final}`);
  const reply = await saved;
  const sent = reply ? await reply.json().catch(() => null) : null;
  check('the server saved the run and answers with that score as the best', reply?.status() === 200 && sent?.data?.best === right * 1000 && sent?.data?.xpEarned === right * 20, reply ? `${reply.status()} ${JSON.stringify(sent?.data)}` : 'no reply was seen');
  const note = summary.getByRole('status').filter({ hasText: /\S/ });
  await note.waitFor({ timeout: STEP_MS });
  say(who, `Country Guesser: ${right} right, ${final}; ${await textOf(note)}`);
  check('the end screen says the best score', (await textOf(note)).startsWith(`Your best score is ${shown}.`), await textOf(note));

  await summary.getByRole('button', { name: 'Home' }).click();
  const best = page.getByText(/^Your best score: /);
  await best.waitFor({ timeout: STEP_MS });
  check("the game's own pane shows the best score", (await textOf(best)) === `Your best score: ${shown} of 10,000`, await textOf(best));
  await page.goto(`${origin}/#account`);
  const stats = page.getByRole('region', { name: 'Your stats' });
  await stats.waitFor({ timeout: STEP_MS });
  const figure = await textOf(stats.locator('.figure').filter({ hasText: 'Country Guesser' }));
  check('the account pane shows the best score', figure === `Country Guesser${shown}of 10,000`, figure);
}

// --- 13. the daily: one attempt, and the text it shares --------------------------------------------

const isDailyRead = (response) => new URL(response.url()).pathname === '/api/daily' && response.request().method() === 'GET';
const dataOf = async (response) => (await response.json().catch(() => null))?.data ?? null;
/** The square the share text gives a round: green from four fifths of 5,000, yellow from half, orange from a fifth, else red. */
const squareFor = (score) => (score >= 4000 ? '🟩' : score >= 2500 ? '🟨' : score >= 1000 ? '🟧' : '🟥');

/** What "Share result" gave: the clipboard, or the field shown in the button's place when the browser would not copy. */
async function sharedText(page) {
  const field = page.getByRole('textbox', { name: 'Result to share' });
  await page.bringToFront();
  await page.getByRole('button', { name: 'Share result' }).click();
  await page.getByRole('button', { name: 'Result copied' }).or(field).first().waitFor({ timeout: STEP_MS });
  return (await field.count()) > 0 ? field.inputValue() : page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
}

export async function daily(page, context, who) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(origin).origin });
  const playButton = (on) => on.getByRole('button', { name: "Play today's challenge" });
  const result = (on) => on.locator('.figure').filter({ hasText: 'Your result today' });

  const [opened] = await Promise.all([page.waitForResponse(isDailyRead, { timeout: STEP_MS }), page.goto(`${origin}/#daily`)]);
  const before = await dataOf(opened);
  check('the daily is three rounds of 60 seconds, and not played yet', before?.state === 'open' && before.settings?.rounds === DAILY_ROUNDS && before.settings?.timeLimit === 60, `state ${before?.state}, ${JSON.stringify(before?.settings)}`);
  await playButton(page).click({ timeout: STEP_MS });
  for (let round = 1; round <= DAILY_ROUNDS; round += 1) {
    await roundReady(page);
    if (round === 1) {
      check('the game is three rounds', (await hud(page)).includes(`1 / ${DAILY_ROUNDS}`), await hud(page));
    }
    await placePin(page);
    await sendGuess(page);
    await page.getByRole('button', { name: round === DAILY_ROUNDS ? 'See summary' : 'Next round' }).click();
  }
  const summary = page.getByRole('region', { name: 'Game summary' });
  const note = summary.getByRole('status').filter({ hasText: /\S/ });
  await note.waitFor({ timeout: STEP_MS });
  check("the result is on today's leaderboard", (await textOf(note)).startsWith(`On today's leaderboard as ${who}.`), await textOf(note));
  check('the summary offers no second game', (await summary.getByRole('button', { name: 'Play again' }).count()) === 0);

  // back on the pane: the result in place of the button, and what the server now says of the day
  const [read] = await Promise.all([page.waitForResponse(isDailyRead, { timeout: STEP_MS }), summary.getByRole('button', { name: 'Home' }).click()]);
  const after = await dataOf(read);
  const rounds = after?.yours?.rounds ?? [];
  await result(page).or(playButton(page)).first().waitFor({ timeout: STEP_MS });
  const shown = await textOf(result(page).locator('.figure-value'));
  say(who, `daily: ${shown}, rounds ${rounds.join(', ')}, rank ${after?.yours?.rank}, beat ${after?.yours?.beat}%`);
  check('once played, the daily cannot be started again from its pane', after?.state === 'done' && shown.endsWith(' / 15,000') && (await playButton(page).count()) === 0, `state ${after?.state}, ${shown || 'no result shown'}`);
  check('the pane says there is one attempt a day', (await page.getByText('One attempt a day. The next challenge opens at midnight UTC.').count()) > 0);

  const lines = (await sharedText(page)).split('\n');
  const squares = lines.find((line) => /^[🟩🟨🟧🟥]+$/u.test(line)) ?? '';
  say(who, `shared: ${lines.join(' | ')}`);
  check('the share text is headed as the daily and has the score', lines[0].startsWith('Wherefall daily challenge · ') && shown !== '' && lines.includes(shown), lines.slice(0, 2).join(' | '));
  check('it has one square a round, coloured by the score of each', rounds.length === DAILY_ROUNDS && squares === rounds.map(squareFor).join(''), `${squares || 'no squares'} for ${rounds.join(', ')}`);
  check('it ends with the link to the daily', lines.at(-1) === `${origin}/#daily`, lines.at(-1));

  // a page that never saw the game
  const fresh = await context.newPage();
  watch(fresh, who);
  try {
    const [reread] = await Promise.all([fresh.waitForResponse(isDailyRead, { timeout: STEP_MS }), fresh.goto(`${origin}/#daily`)]);
    const again = await dataOf(reread);
    await result(fresh).or(playButton(fresh)).first().waitFor({ timeout: STEP_MS });
    const there = await textOf(result(fresh).locator('.figure-value'));
    check('a fresh page shows the result and no way to start again', again?.state === 'done' && there === shown && (await playButton(fresh).count()) === 0, `state ${again?.state}, ${there || 'no result shown'}`);
  } finally {
    await fresh.close();
  }
}

// --- 14. the guess map as satellite and as terrain -------------------------------------------------

/** Where each type's pictures come from (`src/ui/map-types.ts`), and what its credit on the map has to say. */
const TILE_HOSTS = { satellite: /^tiles\.maps\.eox\.at$/, terrain: /^[abc]\.tile\.opentopomap\.org$/ };
const TILED_TYPES = [
  { name: 'Satellite', type: 'satellite', words: ['EOxCloudless', 'https://cloudless.eox.at', 'EOX IT Services GmbH', 'Contains modified Copernicus Sentinel data', 'CC BY-NC-SA 4.0'], link: 'EOX IT Services GmbH', href: 'https://eox.at' },
  { name: 'Terrain', type: 'terrain', words: ['Map data: © OpenStreetMap contributors, SRTM', 'Map style: © OpenTopoMap (CC-BY-SA)'], link: 'OpenTopoMap', href: 'https://opentopomap.org' },
];
const tileType = (response) => Object.keys(TILE_HOSTS).find((type) => TILE_HOSTS[type].test(new URL(response.url()).hostname)) ?? null;

export async function mapTypes(page, who) {
  /** the status of every tile answered while the part runs */
  const answered = { satellite: [], terrain: [] };
  const count = (response) => {
    const type = tileType(response);
    if (type) {
      answered[type].push(response.status());
    }
  };
  page.on('response', count);
  try {
    await page.goto(`${origin}/#singleplayer`);
    await page.getByRole('radio', { name: '3', exact: true }).check();
    await page.getByRole('button', { name: 'Start game' }).click();
    await roundReady(page);
    await page.locator('.map-panel').hover();
    const types = page.getByRole('group', { name: 'Map type' });
    const credit = page.locator('.map-credit');
    for (const { name, type, words, link, href } of TILED_TYPES) {
      const first = page.waitForResponse((response) => tileType(response) === type, { timeout: STEP_MS }).catch(() => null);
      await types.getByRole('button', { name }).click();
      await types.getByRole('button', { name, pressed: true }).waitFor({ timeout: STEP_MS });
      const said = await textOf(credit);
      const linked = await credit.getByRole('link', { name: link }).getAttribute('href', { timeout: 5000 }).catch(() => null);
      check(`the ${name} credit is on the map, with a link to its maker`, (await credit.isVisible()) && words.every((word) => said.includes(word)) && linked === href, said);
      const tile = await first;
      check(`a ${name} tile comes back from its host with 200`, tile?.status() === 200, tile ? `${tile.status()} from ${new URL(tile.url()).hostname}` : 'no tile was answered');
    }
    const seen = Object.entries(answered).map(([type, statuses]) => `${type}: ${statuses.length} answered, ${[...new Set(statuses)].join(' ') || 'none'}`);
    say(who, `tiles: ${seen.join('; ')}`);
    check('every satellite and terrain tile answered was a 200', Object.values(answered).every((statuses) => statuses.length > 0 && statuses.every((status) => status === 200)), seen.join('; '));

    // back to streets, which is what every other part plays on
    await types.getByRole('button', { name: 'Streets' }).click();
    await types.getByRole('button', { name: 'Streets', pressed: true }).waitFor({ timeout: STEP_MS });
    check('back on streets the credit is gone', await credit.isHidden());
    await leaveGame(page, 'Leave game');
    await page.getByRole('button', { name: 'Start game' }).waitFor({ timeout: STEP_MS });
  } finally {
    page.off('response', count);
  }
}
