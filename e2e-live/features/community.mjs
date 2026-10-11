// What players make and see of each other: a community map, the boards and a profile, a report, moderation.
import { check, expected, hud, imagery, leaveGame, maps, origin, placePin, random, roundReady, say, sendGuess, STEP_MS, textOf, texts, watch } from './setup.mjs';

// --- 5. a community map: make, like, play, delete -------------------------------------------------

/**
 * Zooms the editor's world map in on a city with the wheel, which keeps the spot under the pointer.
 * The map is under the editor's fields, below the fold of a 1360x840 window: it is scrolled into
 * sight first, or the pointer would be sent to a spot off the screen and nothing would be zoomed
 * or clicked. Returns the spot and the map's box, both as the window has them after scrolling.
 */
async function zoomEditorOn(page, at) {
  const canvas = page.locator('.editor-map .maplibregl-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const spot = { x: box.x + box.width * at.x, y: box.y + box.height * at.y };
  await page.mouse.move(spot.x, spot.y);
  for (let step = 0; step < 9; step += 1) {
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(2000);
  return { spot, box };
}

/** how far inside the map's edge a click has to stay to be a click on the map */
const MAP_EDGE = 12;
const within = (value, from, to) => Math.min(Math.max(value, from + MAP_EDGE), to - MAP_EDGE);

export async function communityMap(page, who) {
  await page.goto(`${origin}/?edit=new`);
  await page.getByRole('button', { name: 'Publish map' }).waitFor({ timeout: STEP_MS });
  await page.waitForTimeout(2500);
  // Paris: dense coverage, so most clicks around it find a panorama within 500 m
  const { spot: centre, box } = await zoomEditorOn(page, { x: 0.492, y: 0.33 });
  const places = page.locator('[aria-label="Places"] .player-row');
  const status = page.locator('.settings-line[role="status"]');
  const seen = [];
  for (let attempt = 0; attempt < 24 && (await places.count()) < 5; attempt += 1) {
    const angle = attempt * 2.4;
    const reach = 40 + attempt * 9;
    await page.mouse.click(within(centre.x + Math.cos(angle) * reach, box.x, box.x + box.width), within(centre.y + Math.sin(angle) * reach * 0.7, box.y, box.y + box.height));
    await page.waitForFunction(() => !(document.querySelector('.settings-line[role="status"]')?.textContent ?? '').startsWith('Looking'), null, { timeout: STEP_MS });
    seen.push(await textOf(status));
    await page.waitForTimeout(250);
  }
  const added = await places.count();
  say(who, `editor clicks: ${[...new Set(seen)].join(' / ')}`);
  check('five places were added by clicking the map', added >= 5, `${added} places after ${seen.length} clicks`);

  const name = `Check map ${random(3)}`;
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Short description').fill('Made by the live check. Safe to delete.');
  await page.getByRole('button', { name: 'Publish map' }).click();
  await page.waitForURL(/\?community=/, { timeout: STEP_MS });
  const slug = new URL(page.url()).searchParams.get('community') ?? '';
  maps.push(slug);
  await page.locator('.pane-title', { hasText: name }).waitFor({ timeout: STEP_MS });
  const numbers = page.locator('.stats-host .figure');
  say(who, `published ${slug}: ${await textOf(page.locator('.pane-stack > .settings-line'))}; ${(await texts(numbers)).join(' | ')}`);
  check('the map page shows the new map', (await texts(numbers))[0] === `Places${added}`);

  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await page.getByRole('button', { name: 'Unlike' }).waitFor({ timeout: STEP_MS });
  check('liking it raises the likes to 1', (await texts(numbers))[2] === 'Likes1', (await texts(numbers)).join(' | '));

  await page.getByRole('button', { name: 'Play this map' }).click();
  await page.getByRole('radio', { name }).waitFor({ timeout: STEP_MS });
  check('Singleplayer opens with the map chosen', await page.getByRole('radio', { name }).isChecked());
  await page.getByRole('button', { name: 'Start game' }).click();
  await roundReady(page);
  check('the game on the map shows its name and plays on Google', (await hud(page)).includes(name) && (await imagery(page)) === 'google', await hud(page));
  await placePin(page);
  await sendGuess(page);
  say(who, `community map round 1: ${(await texts(page.getByRole('region', { name: 'Round result' }).locator('.figure'))).join(' | ')}`);
  await leaveGame(page, 'Leave game');
  await page.getByRole('button', { name: 'Start game' }).waitFor({ timeout: STEP_MS });

  await page.goto(`${origin}/?community=${slug}`);
  await page.locator('.stats-host .figure').first().waitFor({ timeout: STEP_MS });
  check('starting the game counted one play', (await texts(page.locator('.stats-host .figure')))[1] === 'Plays1', (await texts(page.locator('.stats-host .figure'))).join(' | '));
  await page.getByRole('button', { name: 'Delete map' }).click();
  await page.getByRole('button', { name: 'Yes, delete it' }).click();
  await page.locator('.pane-title', { hasText: 'Maps' }).waitFor({ timeout: STEP_MS });
  maps.splice(maps.indexOf(slug), 1);
  check('the maker deleted the map', true);
  expected.add(`404 /api/maps?slug=${slug}`);
  await page.goto(`${origin}/?community=${slug}`);
  await page.getByRole('alert').waitFor({ timeout: STEP_MS });
  check('the deleted map is gone', (await textOf(page.getByRole('alert'))).includes('There is no such map.'), await textOf(page.getByRole('alert')));
}

// --- 8. leaderboards and a profile ---------------------------------------------------------------

export async function community(page, who) {
  await page.goto(`${origin}/#leaderboards`);
  for (const board of ['Rating', 'XP', 'Best streak']) {
    await page.getByRole('radio', { name: board, exact: true }).check();
    await page.waitForFunction(() => document.querySelector('.rounds tbody tr, .pane-stack .prose') !== null && document.querySelector('.status-inline') === null, null, { timeout: STEP_MS });
    const rows = await texts(page.locator('.rounds tbody tr'));
    const place = await textOf(page.locator('.pane-stack > .settings-line'));
    say(who, `${board} board: ${rows.length} rows; first: ${rows[0] ?? await textOf(page.locator('.pane-stack .prose'))}${place ? `; ${place}` : ''}`);
    check(`the ${board} board renders`, rows.length > 0 || (await page.locator('.pane-stack .prose').count()) > 0);
  }
  await page.goto(`${origin}/?user=${who}`);
  await page.getByRole('region', { name: `${who}'s stats` }).waitFor({ timeout: STEP_MS });
  const figures = await texts(page.getByRole('region', { name: `${who}'s stats` }).locator('.figure'));
  say(who, `profile: ${await textOf(page.locator('.pane-stack > .settings-line'))}; ${figures.join(' | ')}; games ${(await texts(page.locator('.account-table tbody tr'))).length}`);
  // the title is the name with the account's flag before it; the figures now include the duels and the two guessers
  check('the profile page renders with its figures', (await textOf(page.locator('.pane-title'))).endsWith(who) && figures.length >= 6, `${await textOf(page.locator('.pane-title'))}, ${figures.length} figures`);
  check('the profile lists the game that was played', (await page.locator('.account-table tbody tr').count()) >= 1);
}

// --- 10 and 11. a report, and (with a moderator's sign-in) the moderation pane -----------------------

export async function report(page, who, other) {
  await page.goto(`${origin}/?user=${other}`);
  await page.getByRole('button', { name: 'Report player' }).click({ timeout: STEP_MS });
  await page.getByRole('radio', { name: 'Other' }).check();
  await page.getByLabel(`Report ${other}`).fill('Reported by the live check. Safe to dismiss.');
  await page.getByRole('button', { name: 'Send report' }).click();
  await page.getByText('Reported. A moderator will look at it.').waitFor({ timeout: STEP_MS });
  check(`${who} reported ${other} from their profile`, true);
}

export async function moderation(browser, reported) {
  const { MOD_USER, MOD_PASS } = process.env;
  if (!MOD_USER || !MOD_PASS) {
    console.log('  skipped: set MOD_USER and MOD_PASS to a moderator account to check the Moderation pane');
    return;
  }
  const context = await browser.newContext({ viewport: { width: 1360, height: 840 } });
  const page = await context.newPage();
  watch(page, MOD_USER);
  await page.goto(`${origin}/#account`);
  await page.getByLabel('Username', { exact: true }).fill(MOD_USER);
  await page.getByLabel('Password').fill(MOD_PASS);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText('Signed in as').waitFor({ timeout: STEP_MS });
  await page.getByRole('link', { name: 'Moderation' }).click({ timeout: STEP_MS });
  const players = page.getByRole('region', { name: 'Reported players' });
  await players.waitFor({ timeout: STEP_MS });
  const row = players.locator('.player-row').filter({ hasText: reported });
  say(MOD_USER, `moderation: ${(await texts(players.locator('.player-row'))).join(' ; ') || 'no reported players'}`);
  check('the moderator sees the report with its reason', (await textOf(row)).includes('Reported by the live check.'), await textOf(row));
  await page.getByRole('button', { name: `Dismiss the reports on ${reported}` }).click();
  await page.waitForFunction((name) => ![...document.querySelectorAll('[aria-label="Reported players"] .player-row')].some((each) => each.textContent.includes(name)), reported, { timeout: STEP_MS });
  check('dismissing clears it from the pane', true);
  await context.close();
}
