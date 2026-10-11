import { expect, test, type Page } from '@playwright/test';
import { EMOTES } from '../src/multiplayer/client.ts';
import { scrollsSideways } from './helpers.ts';
import { expectTranslated } from './language-checks.ts';
import { boxesOf } from './match-boxes.ts';
import { SCENES, SEEN_MS, lobbyOf, openLobby } from './match-scenes.ts';

// Wave 6 for a party's lobby: forty players (item 6) in rows of one height with quiet actions (the
// second design review's N3), lists that scroll inside themselves so the page stays short on a
// phone, and the review's minors there: one accent button while the host's settings form is open,
// and no mode that goes onto a second line.

const PHONE = { width: 390, height: 800 };
const DESKTOPS = [
  { width: 1360, height: 840 },
  { width: 1440, height: 900 },
] as const;
const SIZES = [PHONE, ...DESKTOPS];
/** a row of players, with its hairline */
const ROW = 48;

// --- N3 and the lobby at forty ----------------------------------------------------------------------

/** What the lobby's lists must keep to, whoever looks at them. */
async function expectListsHold(page: Page, rows: number): Promise<void> {
  const list = page.locator('.lobby-players .player-row');
  await expect(list).toHaveCount(rows);
  // one height, the name on one line: no row is taller because its name or its actions went onto a second
  expect(await list.evaluateAll((all) => [...new Set(all.map((each) => Math.round(each.getBoundingClientRect().height)))])).toEqual([ROW]);
  // in a row nothing lies on anything else, and nothing leaves the row
  const crowded = await list.evaluateAll((all) =>
    all.flatMap((row) => {
      const edge = row.getBoundingClientRect();
      const parts = [...row.querySelectorAll('.player-name, .tag, button')].filter((each) => each.checkVisibility()).map((each) => each.getBoundingClientRect());
      const outside = parts.some((box) => box.left < edge.left - 0.5 || box.right > edge.right + 0.5);
      const overlapping = parts.some((one, index) => parts.slice(index + 1).some((other) => one.left < other.right - 0.5 && other.left < one.right - 0.5));
      return outside || overlapping ? [(row.textContent ?? '').slice(0, 30)] : [];
    }),
  );
  expect(crowded).toEqual([]);
  // no wall of red: a row's actions are quiet, whatever they do
  await expect(page.locator('.lobby-players .button.danger')).toHaveCount(0);
  expect(await scrollsSideways(page)).toBe(false);
}

for (const viewport of SIZES) {
  const size = `${viewport.width}x${viewport.height}`;
  const phone = viewport.width <= 720;

  for (const code of ['de', 'ru'] as const) {
    test(`a lobby of forty in ${code} at ${size}: rows of one height, quiet actions, a list that scrolls inside itself, Start in reach`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { say } = await openLobby(page, lobbyOf('forty'), code);
      await expectListsHold(page, 40);
      await expect(page.locator('.lobby-count .label')).toContainText(say['lobby.playerCount']!.replace('{count}', '40').replace('{max}', '40'));

      // the forty are nine and a half rows tall: the page is not one endless column, and the chat is not forty rows away
      const [list, players, start] = [(await boxesOf(page, ['.lobby-players .player-list']))[0]!, (await boxesOf(page, ['.lobby-players']))[0]!, (await boxesOf(page, ['.lobby-start .button.accent']))[0]!];
      expect(list.bottom - list.top).toBeLessThanOrEqual(9.5 * ROW + 2);
      expect(await page.locator('.lobby-players .player-list').evaluate((box) => box.scrollHeight > box.clientHeight)).toBe(true);
      // Start is before the list and on the first screen; the host's settings are over it
      expect(start.bottom).toBeLessThan(players.top);
      expect(start.bottom).toBeLessThanOrEqual(viewport.height);
      const settings = (await boxesOf(page, ['.lobby-settings .actions .button']))[0]!;
      expect(settings.bottom).toBeLessThan(start.top);
      const chat = (await boxesOf(page, ['.lobby .chat']))[0]!;
      if (phone) {
        expect(chat.top).toBeGreaterThanOrEqual(players.bottom);
        expect(chat.top - start.bottom).toBeLessThan(viewport.height);
        // each row has one button a finger can hit, and no other
        const buttons = await page.locator('.lobby-players button:visible').evaluateAll((all) => all.map((each) => [each.className, Math.round(each.getBoundingClientRect().width), Math.round(each.getBoundingClientRect().height)]));
        expect(buttons).toHaveLength(39);
        expect(buttons.every(([name, width, height]) => String(name).includes('host-more') && width === 44 && height === 44)).toBe(true);
      } else {
        expect(chat.left).toBeGreaterThanOrEqual(players.right);
        // a wide row has both actions at its end and nothing to open
        await expect(page.locator('.lobby-players .host-more:visible')).toHaveCount(0);
        await expect(page.locator('.lobby-players .host-menu .button:visible')).toHaveCount(39 + 39 - 6);
      }
      await expectTranslated(page, code, [...SCENES.forty().names, ...EMOTES, 'ABC123']);
    });

    test(`forty picking teams in ${code} at ${size}: two boxes that scroll inside themselves, every row of one height`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openLobby(page, lobbyOf('fortyTeams', true, true), code);
      await expectListsHold(page, 40);
      const lists = await boxesOf(page, ['.lobby-players .team-box .player-list']);
      expect(lists).toHaveLength(3);
      lists.forEach((list) => expect(list.bottom - list.top).toBeLessThanOrEqual(5.5 * ROW + 2));
      const boxes = await boxesOf(page, ['.team-columns .team-box']);
      // side by side where there is room for two, one under the other on a phone
      expect(boxes[1]!.top === boxes[0]!.top).toBe(!phone);
      // the players block is no taller than two screens on a phone, however many are in
      const players = (await boxesOf(page, ['.lobby-players']))[0]!;
      expect(players.bottom - players.top).toBeLessThan(phone ? 2 * viewport.height : viewport.height);
      await expectTranslated(page, code, [...SCENES.fortyTeams().names, ...EMOTES, 'ABC123']);
    });
  }
}

test('a narrow row opens its two actions under the name, a kick asks first, and only the removal is in the colour of danger', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openLobby(page, lobbyOf('forty'));
  const row = page.locator('.lobby-players .player-row').filter({ hasText: 'maximilian_wanderer' });
  const more = row.getByRole('button', { name: 'Actions for maximilian_wanderer' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(row.getByRole('button', { name: 'Kick maximilian_wanderer' })).toBeHidden();
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const [makeHost, kick] = [row.getByRole('button', { name: 'Make maximilian_wanderer the host' }), row.getByRole('button', { name: 'Kick maximilian_wanderer' })];
  await expect(makeHost).toHaveClass(/button ghost/);
  await expect(kick).toHaveClass(/button ghost/);
  await expect(kick).toHaveCSS('color', await makeHost.evaluate((button) => getComputedStyle(button).color));
  // under the name, at the left, and big enough to touch
  const [name, opened] = [(await row.locator('.player-name').boundingBox())!, (await kick.boundingBox())!];
  expect(opened.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(opened.height).toBeGreaterThanOrEqual(44);
  // the three dots close it again
  await more.click();
  await expect(kick).toBeHidden();
  await more.click();
  await kick.click();
  await expect(row.getByRole('alert')).toHaveText('Remove maximilian_wanderer from the party? They cannot come back.');
  await expect(row.locator('.host-menu').getByRole('button')).toHaveText(['Cancel', 'Remove']);
  await expect(row.getByRole('button', { name: 'Cancel' })).toHaveClass(/primary/);
  await expect(row.getByRole('button', { name: 'Remove' })).toHaveClass(/danger/);
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.lobby-players .player-row')).toHaveCount(39, { timeout: SEEN_MS });
});

test('a list scrolled to its end stays there when someone joins or leaves', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { server } = await openLobby(page, { ...lobbyOf('forty'), players: SCENES.forty().state.players.slice(0, 30) });
  const list = page.locator('.lobby-players .player-list');
  await list.evaluate((box) => box.scrollTo(0, box.scrollHeight));
  const at = await list.evaluate((box) => box.scrollTop);
  expect(at).toBeGreaterThan(0);
  server.addPlayer('latecomer');
  await expect(page.locator('.lobby-players .player-row')).toHaveCount(31, { timeout: SEEN_MS });
  expect(await list.evaluate((box) => box.scrollTop)).toBe(at);
});

for (const code of ['en', 'es', 'fr', 'de', 'ru'] as const) {
  test(`with the host's settings form open in ${code}, Save is the one accent button and no mode goes onto a second line that need not`, async ({ page }) => {
    await page.setViewportSize(DESKTOPS[0]);
    const { say } = await openLobby(page, lobbyOf('twenty'), code);
    const start = page.getByRole('button', { name: say['lobby.start'] });
    await expect(start).toHaveClass(/button accent/);
    await page.getByRole('button', { name: say['party.settings.change'] }).click();
    const form = page.locator('.lobby-form form');
    await expect(form).toBeVisible();
    await expect(page.locator('.lobby .button.accent:visible')).toHaveText([say['party.settings.save']!]);
    await expect(start).toHaveClass(/button ghost/);
    await expect(start).toBeEnabled();
    // the three modes are one line of text each, the longest name among them, and no choice of any row leaves the form
    const edge = (await form.boundingBox())!;
    const choices = await form.locator('.choice span').evaluateAll((all) =>
      all.map((each) => {
        const range = document.createRange();
        range.selectNodeContents(each);
        return { text: each.textContent, lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size, right: each.getBoundingClientRect().right };
      }),
    );
    const modes = ['move', 'no-move', 'nmpz'].map((mode) => say[`mode.${mode}`]);
    // Spanish and French name the third mode in more words than the form is wide beside the other two: there the two
    // short ones stay whole and only the longest takes a second line, as it does on the Create party pane
    expect(choices.filter((each) => modes.includes(each.text ?? '')).map((each) => each.lines)).toEqual(code === 'es' || code === 'fr' ? [1, 1, 2] : [1, 1, 1]);
    expect(choices.every((each) => each.right <= edge.x + edge.width + 0.5)).toBe(true);
    expect(await scrollsSideways(page)).toBe(false);
    // closed again, Start is the accent button it was
    await form.getByRole('button', { name: say['common.cancel'] }).click();
    await expect(start).toHaveClass(/button accent/);
    await expect(page.locator('.lobby .button.accent:visible')).toHaveCount(1);
  });
}

test('a player who is not the host has no gap where Start would stand, and a guest has the same lobby', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openLobby(page, lobbyOf('twenty', false));
  await expect(page.locator('.lobby-start .actions')).toBeHidden();
  await expect(page.locator('.lobby-start .fine:visible')).toHaveText(['Waiting for the host to start the match.']);
  await expect(page.locator('.lobby .button.accent:visible')).toHaveCount(0);
  await expect(page.locator('.lobby-players .host-actions')).toHaveCount(0);
  const [line, hint] = [(await page.locator('.lobby-settings .settings-line').boundingBox())!, (await page.locator('.lobby-start .fine').first().boundingBox())!];
  expect(hint.y - (line.y + line.height)).toBeLessThanOrEqual(40);
});
