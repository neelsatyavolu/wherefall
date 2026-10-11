import { expect, test, type Page } from '@playwright/test';
import { EMOTES } from '../src/multiplayer/client.ts';
import { CATALOGS, expectTranslated, type Catalog } from './language-checks.ts';
import { boxOf, boxesOf, clashes, hiddenPins, misfits, smallTargets, token } from './match-boxes.ts';
import { SEEN_MS, finishScene, guessInScene, openScene, othersGuess, revealScene, typedIn, type Scene, type SceneName } from './match-scenes.ts';

// A match in progress and its panels, measured: at a phone's size and two desktop sizes, in the two
// languages with the longest words, nothing a match adds to the round screen lies on anything else
// or leaves the screen, in the round, over a reveal and over the final standing, for a ranked duel,
// a public game of eight, a party of twenty with its host's controls, a full party of forty and a
// 2v2 with team health.
// And the rules its panels keep to: the one panel slot, the action that goes on playing first and
// in the accent, tables that fit their panel in every language, and controls a finger can hit.

const PHONE = { width: 390, height: 800 };
const DESKTOPS = [
  { width: 1360, height: 840 },
  { width: 1440, height: 900 },
] as const;
const LONG_LANGUAGES = ['de', 'ru'] as const;
const OTHER_LANGUAGES = ['en', 'es', 'fr'] as const;
const MEASURED: readonly SceneName[] = ['ranked', 'eight', 'twenty', 'forty', 'team'];
/** where the rail ends: its 296px between two margins of 16. The guess map never comes left of it, see `--rail` in play.css */
const RAIL = { left: 16, right: 16 + 296, end: 16 + 296 + 16 };

/** what a match stands in the rail, and in its corner */
const SIDE = ['.net-banner', '.round-bar', '.roster'];
const CORNER = ['.chat-toggle', '.host-toggle'];
/** everything over the street view while a round is played */
const OVER_VIEW = ['.hud', '.health', ...SIDE, '.compass', '.pano-tools .return', '.credit', '.map-panel', '.map-toggle', ...CORNER, '.move-arrow'];
/** the guess map's own tools, and the bar under it */
const MAP_TOOLS = ['.map-sizes', '.map-hold', '.map-types', '.map-zoom', '.guess-bar .guess', '.map-close', '.map .maplibregl-ctrl-attrib-button'];
/** everything over the map once a round or the match is over */
const OVER_RESULT = ['.hud', '.health', '.net-banner', '.panel-host > *', '.map-zoom', '.map .maplibregl-ctrl-attrib-button', ...CORNER];
/** what a pin on the map must not be under */
const COVERS = ['.hud', '.health', '.panel-host > *', '.map-zoom', ...CORNER];

const panel = (page: Page) => page.locator('.panel-host > *');
const still = (selectors: readonly string[]) => selectors.filter((each) => each !== '.move-arrow');
const overMap = async (page: Page) => {
  await page.locator('.map-panel').hover();
  await page.waitForTimeout(400);
};
/** Takes the pointer and the focus off the guess map, and lets it finish changing size. */
const leaveMap = async (page: Page) => {
  await page.mouse.move(RAIL.end + 40, 40);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(400);
};

/** The panel is in the one slot: the rail under the HUD on a wide screen, a sheet of at most 45% of a phone at its foot. */
async function expectSlot(page: Page): Promise<void> {
  const screen = page.viewportSize()!;
  const [at, hud] = [await boxOf(page, '.panel-host > *'), await boxOf(page, '.hud')];
  expect(at.top).toBeGreaterThanOrEqual(hud.bottom);
  if (screen.width <= 720) {
    expect([at.left, at.right, at.bottom]).toEqual([16, screen.width - 16, screen.height - 16]);
    expect(at.bottom - at.top).toBeLessThanOrEqual(screen.height * 0.45 + 1);
  } else {
    expect([at.left, at.top, at.right - at.left]).toEqual([16, 88, 440]);
    expect(at.bottom).toBeLessThanOrEqual(screen.height - 16);
  }
  // its foot is at the panel's foot, and nothing in it is a filled button
  const foot = await boxOf(page, '.panel-host .panel-actions');
  expect(Math.abs(foot.bottom - at.bottom)).toBeLessThanOrEqual(1.5);
  await expect(panel(page).locator('.button.primary')).toHaveCount(0);
}

/**
 * The player's own row is in sight wherever the table is scrolled to, and never by lying on another
 * row (N2): it is either in the table, whole, under the headings, or else in the strip under the
 * scrolling box, which is outside the box, opaque, and as wide as the table. Never both, never neither.
 */
async function expectOwnRowInSight(page: Page): Promise<void> {
  const look = () =>
    page.evaluate(() => {
      const scroll = document.querySelector('.panel-host .match-scroll')!.getBoundingClientRect();
      const row = document.querySelector('.panel-host .match-scroll .rounds:not(.team-table) tr.own')!.getBoundingClientRect();
      const strip = document.querySelector<HTMLElement>('.panel-host .own-strip')!;
      const box = strip.getBoundingClientRect();
      const shown = !strip.hidden && box.height > 0;
      const inTable = row.top >= scroll.top - 1 && row.bottom <= scroll.bottom + 1;
      // every row of the tables that can be seen at all, against the strip: none of them is under it
      const rows = [...document.querySelectorAll('.panel-host .match-scroll tr')].map((each) => each.getBoundingClientRect()).filter((each) => each.bottom > scroll.top && each.top < scroll.bottom);
      const covered = shown && (box.top < scroll.bottom - 0.5 || rows.some((each) => Math.min(each.bottom, scroll.bottom) > box.top + 0.5));
      const opaque = getComputedStyle(strip).backgroundColor === getComputedStyle(document.querySelector('.panel-host > *')!).backgroundColor;
      return { shown, inTable, covered, opaque, text: shown ? (strip.textContent ?? '') : '' };
    });
  const expectOne = () =>
    expect
      .poll(async () => {
        const seen = await look();
        return { one: seen.shown !== seen.inTable, covered: seen.covered, opaque: seen.opaque };
      })
      .toEqual({ one: true, covered: false, opaque: true });
  await expectOne();
  await page.locator('.panel-host .match-scroll').evaluate((box) => box.scrollTo(0, box.scrollHeight));
  await expectOne();
  await page.locator('.panel-host .match-scroll').evaluate((box) => box.scrollTo(0, 0));
  await expectOne();
  // the strip, when it is what shows the row, says who it is
  const seen = await look();
  expect(seen.shown ? seen.text : 'neel').toContain('neel');
}

/** The guess and the place are both on the part of the map nothing covers. The map takes a moment to fit. */
const expectPinsInSight = (page: Page) => expect.poll(() => hiddenPins(page, ['.map .pin-guess', '.map .pin-actual'], COVERS), { timeout: 5000 }).toEqual([]);

async function expectReveal(page: Page, scene: Scene): Promise<void> {
  expect(await clashes(page, OVER_RESULT)).toEqual([]);
  await expectSlot(page);
  expect(await misfits(page, scene.names)).toEqual([]);
  await expectOwnRowInSight(page);
  await expectPinsInSight(page);
  // a reveal moves on by itself: no button goes on, the countdown stands where one would, and the way out is a ghost in the colour of danger
  await expect(panel(page).locator('.button.accent')).toHaveCount(0);
  await expect(panel(page).locator('.panel-actions > *')).toHaveClass([/countdown/, /button danger/]);
}

async function expectStanding(page: Page, scene: Scene, say: Catalog): Promise<void> {
  expect(await clashes(page, OVER_RESULT)).toEqual([]);
  await expectSlot(page);
  expect(await misfits(page, scene.names)).toEqual([]);
  await expectOwnRowInSight(page);
  await expectPinsInSight(page);
  // what goes on playing is first and the one accent button; the way home is a ghost beside it
  const forward = scene.state.kind === 'party' ? say['match.backToLobby'] : say['play.again'];
  await expect(panel(page).locator('.panel-actions > *')).toHaveText([forward!, say['common.home']!]);
  await expect(panel(page).locator('.panel-actions > *')).toHaveClass([/button accent/, /button ghost/]);
  await expect(panel(page).locator('.button.accent')).toHaveCount(1);
  const [foot, first] = [await boxOf(page, '.panel-host .panel-actions'), await boxOf(page, '.panel-host .panel-actions > :first-child')];
  expect(first.left - foot.left).toBeLessThanOrEqual(21);
  // reporting is a button at the end of a row, one for each player with an account but the viewer
  const reportable = scene.names.filter((name) => name !== 'neel' && !name.includes('#')).length;
  await expect(panel(page).locator('tbody td:last-child .report-button')).toHaveCount(reportable);
  await expect(panel(page).locator('.player-name button')).toHaveCount(0);
}

for (const code of LONG_LANGUAGES) {
  for (const viewport of DESKTOPS) {
    for (const name of MEASURED) {
      test(`${name} in ${code} at ${viewport.width}x${viewport.height}: nothing a match adds lies on the map, its tools or anything else`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize(viewport);
        const { server, scene, say } = await openScene(page, name, code);
        expect(await clashes(page, OVER_VIEW)).toEqual([]);

        // the guess sent: who has guessed comes up in the rail, open, under what the round has to say
        await guessInScene(page, say);
        othersGuess(server, scene, 3);
        await leaveMap(page);
        await expect(page.locator('.roster-row')).toHaveCount(scene.names.length);
        await expect(page.locator('.roster-list')).toBeVisible();
        expect(await clashes(page, OVER_VIEW)).toEqual([]);

        for (const size of ['small', 'medium', 'large'] as const) {
          await overMap(page);
          await page.getByRole('button', { name: say[`guessMap.size.${size}`] }).click();
          await page.getByRole('button', { name: say['guessMap.keepOpen'] }).click();
          await leaveMap(page);
          // kept open at this size: the map stops short of the rail and of the HUD, so the side and the health are clear of it and of its tools
          expect(await clashes(page, still(OVER_VIEW))).toEqual([]);
          expect(await clashes(page, [...MAP_TOOLS, ...SIDE, '.health', ...CORNER])).toEqual([]);
          const [map, side] = [await boxOf(page, '.map-panel'), await boxesOf(page, SIDE)];
          expect(map.left).toBeGreaterThanOrEqual(RAIL.end);
          expect(map.top).toBeGreaterThanOrEqual(88);
          side.forEach((part) => expect([part.left >= RAIL.left, part.right <= RAIL.right, part.top >= 88]).toEqual([true, true, true]));
          await overMap(page);
          await page.getByRole('button', { name: say['guessMap.keepOpen'] }).click();
        }
        // full screen, the map's own buttons have the top of the rail, and the side stands under them
        await page.getByRole('button', { name: say['guessMap.fullScreen'] }).click();
        await page.waitForTimeout(300);
        expect(await clashes(page, ['.hud', '.health', ...SIDE, ...CORNER, ...MAP_TOOLS])).toEqual([]);
        await page.getByRole('button', { name: say['guessMap.fullScreen'] }).click();
        await leaveMap(page);

        await revealScene(page, server, scene);
        await expectReveal(page, scene);
        await finishScene(page, server, scene);
        await expectStanding(page, scene, say);
      });
    }
  }

  for (const name of MEASURED) {
    test(`${name} in ${code} on a phone: everything has a place, the list of names is one line, and a reveal leaves the map its room`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(PHONE);
      const { server, scene, say } = await openScene(page, name, code);
      expect(await clashes(page, OVER_VIEW)).toEqual([]);

      // the map's sheet open: the side and the health stay above it, and the corner clear of its bar and its buttons
      await page.getByRole('button', { name: say['round.openMap'] }).click();
      expect(await clashes(page, ['.hud', '.health', ...SIDE, '.map-panel'])).toEqual([]);
      expect(await clashes(page, [...MAP_TOOLS, ...CORNER])).toEqual([]);
      await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 150 } });
      await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
      await expect(page.locator('.roster')).toBeVisible();
      expect(await clashes(page, ['.hud', '.health', ...SIDE, '.map-panel'])).toEqual([]);
      await page.getByRole('button', { name: say['round.closeMap'] }).click();
      othersGuess(server, scene, 3);

      // who has guessed is one line that says how many have, not a block over the view
      const players = scene.names.length;
      const chip = page.locator('.roster-toggle');
      await expect(chip).toHaveText(say['match.roster.count']!.replace('{guessed}', String(Math.min(4, players))).replace('{players}', String(players)), { timeout: SEEN_MS });
      await expect(chip).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('.roster-list')).toBeHidden();
      const folded = await boxOf(page, '.roster');
      expect(folded.bottom - folded.top).toBeLessThanOrEqual(46);
      expect(await clashes(page, OVER_VIEW)).toEqual([]);
      expect(await smallTargets(page)).toEqual([]);

      // a tap opens the names under it, clear of the compass, the walk arrow and the two corners
      await chip.click();
      await expect(chip).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('.roster-row')).toHaveCount(players);
      await expect(page.locator('.roster-row').first()).toBeVisible();
      expect(await clashes(page, OVER_VIEW)).toEqual([]);
      await chip.click();
      await expect(page.locator('.roster-list')).toBeHidden();

      await revealScene(page, server, scene);
      await expectReveal(page, scene);
      expect(await smallTargets(page)).toEqual([]);
      await finishScene(page, server, scene);
      await expectStanding(page, scene, say);
      expect(await smallTargets(page)).toEqual([]);
      await expectTranslated(page, code, typedIn(scene));
    });
  }
}

// --- B1: the tables fit their panel in every language ----------------------------------------------

for (const code of OTHER_LANGUAGES) {
  for (const name of ['ranked', 'teamParty'] as const) {
    test(`${name} in ${code} on a phone: the round table and the final standing fit their panel`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      const { server, scene, say } = await openScene(page, name, code);
      await guessInScene(page, say);
      await revealScene(page, server, scene);
      await expectReveal(page, scene);
      await finishScene(page, server, scene);
      expect(await clashes(page, OVER_RESULT)).toEqual([]);
      await expectSlot(page);
      expect(await misfits(page, scene.names)).toEqual([]);
    });
  }
}

// --- forty players in two teams: the longest tables a match has, on a phone -------------------------

for (const code of LONG_LANGUAGES) {
  test(`fortyTeams in ${code} on a phone: the team table and forty rows fit their sheet, and the own row is in sight without lying on another`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(PHONE);
    const { server, scene, say } = await openScene(page, 'fortyTeams', code);
    await guessInScene(page, say);
    othersGuess(server, scene, 3);
    await expect(page.locator('.roster-toggle')).toHaveText(say['match.roster.count']!.replace('{guessed}', '4').replace('{players}', '40'), { timeout: SEEN_MS });
    expect(await clashes(page, OVER_VIEW)).toEqual([]);
    await revealScene(page, server, scene);
    await expectReveal(page, scene);
    expect(await smallTargets(page)).toEqual([]);
    await finishScene(page, server, scene);
    await expectStanding(page, scene, say);
    expect(await smallTargets(page)).toEqual([]);
  });
}

// --- M9: the standing's rating, and reporting from it ----------------------------------------------

for (const code of ['en', 'de', 'ru'] as const) {
  test(`a duel's standing in ${code} writes the rating with its separator and the change beside it, signed and coloured`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    const { server, scene, say } = await openScene(page, 'ranked', code);
    await guessInScene(page, say);
    await revealScene(page, server, scene);
    await finishScene(page, server, scene);
    const rows = panel(page).locator('tbody tr');
    const separated = (value: number) => value.toLocaleString(code);
    // rank, name, total, the new rating, how far it moved, and for the other player the button that reports them
    await expect(rows.nth(0).locator('td')).toHaveText(['1', new RegExp(`neel\\s*${say['tag.you']}\\s*${say['tag.won']}$`), separated(4321), separated(1033), '+17', '']);
    await expect(rows.nth(1).locator('td')).toHaveText(['2', /aleksandra_wojcik_92$/, separated(1100), separated(987), '−17', '']);
    expect(separated(1033)).not.toBe('1033');
    const [ok, danger] = [await token(page, '--ok'), await token(page, '--danger')];
    await expect(rows.nth(0).locator('.delta')).toHaveCSS('color', ok);
    await expect(rows.nth(1).locator('.delta')).toHaveCSS('color', danger);
    // the two cells stand under the one heading
    await expect(panel(page).locator('th.col-rating')).toHaveAttribute('colspan', '2');
    await expect(panel(page).locator('th.col-rating')).toHaveText(say['label.rating']!);
  });
}

test('reporting from the standing asks first, then says what became of it under the table', async ({ page }) => {
  const { server, scene, say } = await openScene(page, 'eight', 'en');
  await page.route('**/api/social**', (route) => route.fulfill({ json: { success: true, data: { reported: true } } }));
  await guessInScene(page, say);
  await revealScene(page, server, scene);
  await finishScene(page, server, scene);
  const report = panel(page).getByRole('button', { name: 'Report maximilian_wanderer' });
  await expect(report).toHaveClass(/button ghost/);
  await report.click();
  // the safe answer is the filled one, the report itself a ghost in the colour of danger
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Report maximilian_wanderer to the moderators?');
  await expect(dialog.getByRole('button')).toHaveText(['Cancel', 'Report']);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveClass(/primary/);
  await expect(dialog.getByRole('button', { name: 'Report' })).toHaveClass(/danger/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(report).toBeEnabled();
  await expect(panel(page).getByRole('status')).toBeHidden();

  await report.click();
  // a report says what it is about (wave 6): the question holds the choice
  await page.getByRole('dialog').getByRole('radio', { name: 'Cheating' }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Report' }).click();
  await expect(panel(page).getByRole('status')).toHaveText('maximilian_wanderer was reported. A moderator will look at it.');
  await expect(report).toBeDisabled();
  // the others can still be reported
  await expect(panel(page).getByRole('button', { name: 'Report ana', exact: true })).toBeEnabled();
});

// --- M13: what a match says about itself is status, not small grey print --------------------------

test('a countdown, the no-timer note, a lost connection and a refused guess are lines of status: a dot and readable words', async ({ page }) => {
  const { server, scene, say } = await openScene(page, 'twenty', 'en');
  const [fg, fg2, accent, danger] = [await token(page, '--fg'), await token(page, '--fg-2'), await token(page, '--accent'), await token(page, '--danger')];

  // no timer: a dot and a mono label that opens how the round ends, with the host's End round under it
  const bar = page.locator('.round-bar');
  await expect(bar.locator('.round-label')).toHaveText('No timer');
  await expect(bar.locator('.round-label .status-dot')).toHaveCSS('background-color', accent);
  await expect(bar.locator('.round-label .status-word')).toHaveCSS('font-family', /Geist Mono/);
  await expect(bar.locator('.round-note')).toHaveText('The round ends when everyone has guessed, or when you end it.');
  await expect(bar.locator('.round-note')).toHaveCSS('font-size', '14px');
  await expect(bar.locator('.round-note')).toHaveCSS('color', fg2);
  await expect(bar.getByRole('button', { name: 'End round' })).toHaveClass(/ghost/);

  // a guess the server refuses is said in red-dotted status over the view
  server.refuse = 'That guess could not be taken.';
  await page.locator('.map-panel').hover();
  await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 150 } });
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.locator('.status')).toHaveText('That guess could not be taken.');
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'error');
  server.refuse = null;
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.getByRole('button', { name: say['match.guessSent'] })).toBeDisabled();

  // a lost connection: in the rail, a red dot and the line in mono, in the ink and not in red
  server.down = true;
  const lost = page.locator('.match-side .net-banner');
  await expect(lost).toContainText('Connection lost.', { timeout: 15_000 });
  await expect(lost).toHaveCSS('font-family', /Geist Mono/);
  await expect(lost).toHaveCSS('font-size', '14px');
  await expect(lost).toHaveCSS('color', fg);
  expect(await lost.evaluate((line) => getComputedStyle(line, '::before').backgroundColor)).toBe(danger);
  expect(await clashes(page, still(OVER_VIEW))).toEqual([]);
  server.down = false;
  await expect(lost).toBeHidden({ timeout: 15_000 });

  // the countdown of a reveal: a blue dot, mono, 14px, in the second ink
  await revealScene(page, server, scene);
  const countdown = panel(page).locator('.countdown');
  await expect(countdown).toContainText(/Next round in \d+/);
  await expect(countdown.locator('.status-dot')).toHaveCSS('background-color', accent);
  await expect(countdown.locator('.status-inline')).toHaveCSS('font-family', /Geist Mono/);
  await expect(countdown.locator('.status-inline')).toHaveCSS('font-size', '14px');
  await expect(countdown.locator('.status-inline')).toHaveCSS('color', fg2);

  // and what the host's way back does, at the standing, is a sentence that can be read
  await finishScene(page, server, scene);
  const note = panel(page).locator('.final-notes .status-note');
  await expect(note).toHaveText('Back to lobby takes everyone who is still here with you.');
  await expect(note).toHaveCSS('font-size', '14px');
  await expect(note).toHaveCSS('color', fg2);
});

test('a lost connection has a place of its own on a phone, in a round and over a reveal', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { server, scene, say } = await openScene(page, 'team', 'de');
  const lost = page.locator('.match-side .net-banner');
  server.down = true;
  await expect(lost).toBeVisible({ timeout: 15_000 });
  expect(await clashes(page, OVER_VIEW)).toEqual([]);
  server.down = false;
  await expect(lost).toBeHidden({ timeout: 15_000 });

  await guessInScene(page, say);
  await revealScene(page, server, scene);
  server.down = true;
  await expect(lost).toBeVisible({ timeout: 15_000 });
  expect(await clashes(page, OVER_RESULT)).toEqual([]);
});

// --- M7 and the tap targets: the host's panel and the chat on a phone ------------------------------

test("on a phone the host's panel and the chat are big enough for a finger, one open at a time, and a kick is the quiet choice", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { say } = await openScene(page, 'twenty', 'en');
  const host = page.getByRole('complementary', { name: 'Host controls' });
  const chat = page.getByRole('complementary', { name: 'Chat' });

  await host.getByRole('button', { name: 'Host', exact: true }).click();
  await expect(host.locator('.host-panel')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  expect(await clashes(page, ['.host-panel'])).toEqual([]);
  // N3: every row is one line of one height, and its two actions stand behind one button of three dots
  const heights = await host.locator('.player-row').evaluateAll((rows) => [...new Set(rows.map((each) => Math.round(each.getBoundingClientRect().height)))]);
  expect(heights).toEqual([48]);
  await expect(host.getByRole('button', { name: /^Kick / })).toHaveCount(0);
  const row = host.locator('.player-row').filter({ hasText: 'maximilian_wanderer' });
  const more = row.getByRole('button', { name: 'Actions for maximilian_wanderer' });
  expect(await more.evaluate((button) => [button.getBoundingClientRect().width, button.getBoundingClientRect().height])).toEqual([44, 44]);
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  // in the row a kick is as quiet as the hand-over: a ghost in the ink. Only the removal it asks about is in the colour of danger
  const [dangerInk, ink, kick] = [await token(page, '--danger'), await token(page, '--fg'), row.getByRole('button', { name: 'Kick maximilian_wanderer' })];
  await expect(row.getByRole('button', { name: 'Make maximilian_wanderer the host' })).toBeVisible();
  await expect(kick).toHaveClass(/button ghost/);
  await expect(kick).toHaveCSS('color', ink);
  await expect(host.locator('.button.danger')).toHaveCount(0);
  expect(await smallTargets(page)).toEqual([]);
  await kick.click();
  await expect(row.locator('.host-menu').getByRole('button')).toHaveText(['Cancel', 'Remove']);
  await expect(row.getByRole('button', { name: 'Cancel' })).toHaveClass(/primary/);
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(row.getByRole('button', { name: 'Remove' })).toHaveCSS('color', dangerInk);
  expect(await smallTargets(page)).toEqual([]);
  await row.getByRole('button', { name: 'Cancel' }).click();

  // opening the chat closes the host's panel: the corner holds one open panel on a phone
  await chat.getByRole('button', { name: say['label.chat'], exact: true }).click();
  await expect(chat.locator('.chat-panel')).toBeVisible();
  await expect(host.locator('.host-panel')).toBeHidden();
  await chat.locator('.chat-mutes summary').click();
  await expect(chat.getByRole('button', { name: 'Mute ana', exact: true })).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  expect(await clashes(page, ['.chat-panel'])).toEqual([]);
  // while the chat is open the Host button steps aside (it would stand on the view, above the chat's panel), and is back when the chat is closed
  await expect(host.getByRole('button', { name: 'Host', exact: true })).toBeHidden();
  await chat.getByRole('button', { name: say['chat.close'] }).click();
  await expect(chat.locator('.chat-panel')).toBeHidden();
  await expect(host.getByRole('button', { name: 'Host', exact: true })).toBeVisible();
  expect(await clashes(page, ['.host-toggle', '.chat-toggle', '.compass', '.pano-tools .return', '.map-toggle'])).toEqual([]);
});

test('a reaction in the chat is told by its face, not by the accent', async ({ page }) => {
  const { server } = await openScene(page, 'eight', 'en');
  server.say('ana', null, 'gg');
  await page.getByRole('complementary', { name: 'Chat' }).getByRole('button', { name: /Chat/ }).click();
  const word = page.locator('.chat-line.reaction .chat-text');
  await expect(word).toHaveText('gg');
  await expect(word).toHaveCSS('color', await token(page, '--fg'));
  await expect(word).toHaveCSS('font-family', /Geist Mono/);
});

// --- the languages: a ranked duel, a party with teams and a 2v2, walked in German and Russian -------

for (const code of LONG_LANGUAGES) {
  test(`a duel's versus screen is all in ${code} and clear of the health and the HUD on a phone`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    const { scene } = await openScene(page, 'ranked', code, 8000);
    await expect(page.locator('.versus-card')).toHaveCount(2);
    // the box stands over the round screen's own status line, so the get-ready is counted in the box itself, under the two players
    const count = page.locator('.versus-count');
    await expect(count).toHaveText(new RegExp(`^${CATALOGS[code]!['match.roundStartsIn']!.replace('{seconds}', '\\d')}$`));
    await expect(count).toBeVisible();
    await expect(count.locator('.status-inline')).toHaveCSS('font-size', '14px');
    await expectTranslated(page, code, typedIn(scene));
    expect(await clashes(page, ['.hud', '.health', '.versus-box', '.chat-toggle', '.map-toggle'])).toEqual([]);
  });
}

for (const code of LONG_LANGUAGES) {
  for (const name of ['ranked', 'teamParty', 'team'] as const) {
    test(`${name} is all in ${code}, from the round to the standing`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(PHONE);
      const { server, scene, say } = await openScene(page, name, code);
      // what players typed, and the reaction words, which are the same everywhere
      const names = [...typedIn(scene), ...EMOTES];
      const say2 = CATALOGS[code]!;
      await expectTranslated(page, code, names);

      // the chat open, with its switch and its mutes where the match has them
      const chat = page.locator('.chat.folded');
      await chat.locator('.chat-toggle').click();
      server.say(scene.names[1]!, null, 'gg');
      await expect(chat.locator('.chat-line')).toHaveCount(1);
      await chat.locator('.chat-mutes summary').click();
      await expectTranslated(page, code, names);
      await chat.getByRole('button', { name: say2['chat.close'] }).click();

      await guessInScene(page, say);
      othersGuess(server, scene, 1);
      await page.locator('.roster-toggle').click();
      await expect(page.locator('.roster-row').first()).toBeVisible();
      await expectTranslated(page, code, names);

      await revealScene(page, server, scene);
      await expect(panel(page).locator('.countdown')).not.toBeEmpty();
      await expectTranslated(page, code, names);
      await finishScene(page, server, scene);
      await expectTranslated(page, code, names);
    });
  }
}
