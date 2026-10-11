import { expect, test, type Page } from '@playwright/test';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { profile } from './social-server.ts';
import { NAMES, PHONE, open, section, setUp, written } from './wave6-panes-scenes.ts';

// Wave 6, other players: a report says what it is about and its sender can follow it (item 10),
// and the boards can show the players they leave out (item 14).

const CATEGORIES = [
  ['cheating', 'Cheating'],
  ['name', 'Offensive name'],
  ['chat', 'Offensive chat'],
  ['other', 'Other'],
] as const;

const longDay = (iso: string) => new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso));
const myReports = (page: Page) => section(page, 'My reports');
const reportRows = (page: Page) => myReports(page).locator('.report-row');
const reportForm = (page: Page) => page.locator('.report-form');

/** Reports a player from their profile: what it is about, and the note. */
async function report(page: Page, username: string, category: string, note: string): Promise<void> {
  await open(page, `/?user=${username}`);
  await page.getByRole('button', { name: 'Report player' }).click();
  await reportForm(page).getByRole('radio', { name: category, exact: true }).check();
  await page.getByLabel(`Report ${username}`).fill(note);
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Reported. A moderator will look at it.')).toBeVisible();
}

// --- item 10: a report has a category ----------------------------------------------------------------------

test('a report from a profile asks what it is about, and sends each of the four categories with its note', async ({ page }) => {
  const { social } = await setUp(page);
  social.profiles = { ...social.profiles, kit: profile('kit'), lee: profile('lee'), ana: profile('ana') };
  await open(page, '/?user=sam');
  await page.getByRole('button', { name: 'Report player' }).click();
  const about = reportForm(page).getByRole('group', { name: 'What is it about' });
  await expect(about.getByRole('radio')).toHaveCount(4);
  await expect(about.locator('.choice')).toHaveText(CATEGORIES.map(([, name]) => name));
  // nothing is chosen for the player, and nothing is sent without a choice
  await expect(about.getByRole('radio', { checked: true })).toHaveCount(0);
  await page.getByLabel('Report sam').fill('made-up scores');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(reportForm(page).getByRole('alert')).toHaveText('Choose what the report is about.');
  expect(social.posted('report')).toHaveLength(0);
  await about.getByRole('radio', { name: 'Cheating' }).check();
  await expect(reportForm(page).getByRole('alert')).toHaveCount(0);

  const players = ['sam', 'kit', 'lee', 'ana'];
  for (const [index, [, name]] of CATEGORIES.entries()) {
    await report(page, players[index]!, name, index === 3 ? '' : `note ${index}`);
  }
  expect(social.posted('report')).toEqual([
    { action: 'report', username: 'sam', category: 'cheating', reason: 'note 0' },
    { action: 'report', username: 'kit', category: 'name', reason: 'note 1' },
    { action: 'report', username: 'lee', category: 'chat', reason: 'note 2' },
    { action: 'report', username: 'ana', category: 'other', reason: '' },
  ]);
});

test("a report the server will not take is refused in the server's words", async ({ page }) => {
  const { social } = await setUp(page);
  await open(page, '/?user=sam');
  await page.getByRole('button', { name: 'Report player' }).click();
  await reportForm(page).getByRole('radio', { name: 'Other', exact: true }).check();
  social.refuse = 'A reason is up to 200 characters.';
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(reportForm(page).getByRole('alert')).toHaveText('A reason is up to 200 characters.');
  await expect(page.getByRole('button', { name: 'Send report' })).toBeEnabled();
});

// --- item 10: My reports -----------------------------------------------------------------------------------

test('My reports lists each report with its target, date and status, and the status follows what a moderator does', async ({ page }) => {
  const { social } = await setUp(page);
  social.profiles = { ...social.profiles, kit: profile('kit'), lee: profile('lee') };
  await open(page, '/#account');
  // the list waits behind its button, and an account that has reported nobody is told so
  await expect(myReports(page)).toContainText('The players you have reported, and where each report stands.');
  await expect(reportRows(page)).toHaveCount(0);
  const toggle = myReports(page).getByRole('button', { name: 'Show my reports' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(myReports(page)).toContainText('You have not reported anyone.');
  await myReports(page).getByRole('button', { name: 'Hide my reports' }).click();
  await expect(myReports(page)).not.toContainText('You have not reported anyone.');

  await report(page, 'sam', 'Cheating', 'made-up scores');
  await report(page, 'kit', 'Offensive chat', 'rude all game');
  await report(page, 'lee', 'Offensive name', '');
  await open(page, '/#account');
  await myReports(page).getByRole('button', { name: 'Show my reports' }).click();
  const today = longDay(new Date().toISOString());
  // newest first: who, what about, when, where it stands, and the note that went with it
  await expect(reportRows(page)).toHaveText([`leeOffensive name${today}Open`, `kitOffensive chat${today}Openrude all game`, `samCheating${today}Openmade-up scores`]);
  await expect(reportRows(page).first().locator('.report-status')).toHaveAttribute('data-tone', 'live');
  await expect(reportRows(page).first().getByRole('link', { name: 'lee' })).toHaveAttribute('href', '?user=lee');

  // a moderator bans kit and dismisses the reports of lee; sam's waits
  await open(page, '/#moderation');
  const players = section(page, 'Reported players');
  await page.getByRole('button', { name: 'Ban kit from online play' }).click();
  await players.getByRole('button', { name: 'Ban', exact: true }).click();
  await expect(players.locator('.player-row').first()).toContainText('banned · 0 reports');
  await page.getByRole('button', { name: 'Dismiss the reports on lee' }).click();
  await expect(players.locator('.player-row')).toHaveCount(1);

  await open(page, '/#account');
  await myReports(page).getByRole('button', { name: 'Show my reports' }).click();
  await expect(reportRows(page).locator('.report-status')).toHaveText(['Dismissed', 'Action taken', 'Open']);
  await expect(reportRows(page).nth(0).locator('.report-status')).toHaveAttribute('data-tone', 'idle');
  await expect(reportRows(page).nth(1).locator('.report-status')).toHaveAttribute('data-tone', 'ok');
  await expect(reportRows(page).nth(2).locator('.report-status')).toHaveAttribute('data-tone', 'live');

  // reporting a player again opens the report again: opening the list asks afresh
  await report(page, 'kit', 'Cheating', 'at it again');
  await open(page, '/#account');
  await myReports(page).getByRole('button', { name: 'Show my reports' }).click();
  await expect(reportRows(page).first()).toHaveText(`kitCheating${today}Openat it again`);
  await expect(reportRows(page)).toHaveCount(3);
});

test('My reports that will not load say why, and can be asked for again', async ({ page }) => {
  const { social } = await setUp(page);
  social.reports = [{ username: 'sam', category: 'cheating', note: '', at: '2026-10-09T10:00:00.000Z', status: 'actioned' }];
  await page.route('**/api/social?reports=1', (route) => route.abort(), { times: 1 });
  await open(page, '/#account');
  await myReports(page).getByRole('button', { name: 'Show my reports' }).click();
  await expect(myReports(page).getByRole('alert')).toHaveText('Could not reach the server. Check your connection and try again.');
  await myReports(page).getByRole('button', { name: 'Hide my reports' }).click();
  await myReports(page).getByRole('button', { name: 'Show my reports' }).click();
  await expect(reportRows(page)).toHaveText([`samCheating${longDay('2026-10-09T10:00:00.000Z')}Action taken`]);
  await expect(myReports(page).getByRole('alert')).toHaveCount(0);
});

test('on a phone a report keeps to the screen, its note under the row', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { social } = await setUp(page);
  social.reports = [
    { username: 'a_very_long_username', category: 'chat', note: 'said the same rude thing in every round of a twenty round party, and then again in the lobby afterwards', at: '2026-10-09T10:00:00.000Z', status: 'open' },
    { username: 'sam', category: 'name', note: '', at: '2026-09-30T10:00:00.000Z', status: 'dismissed' },
  ];
  await open(page, '/#account');
  await myReports(page).getByRole('button', { name: 'Show my reports' }).click();
  await expect(reportRows(page)).toHaveCount(2);
  for (const row of await reportRows(page).all()) {
    const box = (await row.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

// --- item 10: the moderation pane --------------------------------------------------------------------------

test("the moderation pane shows each report's category with its note, and a report with no note still has its category", async ({ page }) => {
  await setUp(page);
  await open(page, '/#moderation');
  const kit = section(page, 'Reported players').locator('.player-row').filter({ hasText: 'kit' });
  await expect(kit.locator('.reasons li')).toHaveText(['Offensive chatrude in chat', 'Otherleft every game', 'Cheating']);
  await expect(kit.locator('.reasons .reason-category')).toHaveText(['Offensive chat', 'Other', 'Cheating']);
  // a map's reports have no category: they are notes, as before
  await expect(section(page, 'Reported maps').locator('.reasons li')).toHaveText(['half of it is indoors']);
});

// --- item 14: inactive players on the boards ---------------------------------------------------------------

test('"Show inactive players" is off to begin with, says what inactive means, and asks for the board again with them', async ({ page }) => {
  const { social } = await setUp(page);
  social.inactive = ['ana'];
  await open(page, '/#leaderboards');
  const rows = page.locator('.board tbody:not(.board-own-row) tr');
  const inactive = page.getByRole('group', { name: 'Show inactive players' });
  await expect(inactive.getByRole('radio', { name: 'No' })).toBeChecked();
  await expect(page.getByText('All time. Inactive players, not seen for 14 days, are left out.')).toBeVisible();
  await expect(rows.locator('.player-name')).toHaveText([/sam/, /neel/]);
  expect(social.asked.at(-1)).toBe('leaderboard=rating&period=all');

  await inactive.getByRole('radio', { name: 'Yes' }).check();
  await expect(page.getByText('All time. Inactive players, not seen for 14 days, are shown too.')).toBeVisible();
  await expect(rows.locator('.player-name')).toHaveText([/sam/, /neel/, /ana/]);
  expect(social.asked.at(-1)).toBe('leaderboard=rating&period=all&inactive=1');

  // the choice holds from board to board
  await page.getByRole('radio', { name: 'XP' }).check();
  await expect(rows.locator('.player-name')).toHaveText([/ana/, /sam/]);
  expect(social.asked.at(-1)).toBe('leaderboard=xp&period=all&inactive=1');

  // today's board lists only who played today: the switch steps aside, and the board says what today counts
  await page.getByRole('radio', { name: 'Today' }).check();
  await expect(inactive).toBeHidden();
  await expect(page.getByText('XP earned today. The day changes at midnight UTC.')).toBeVisible();
  await expect(page.getByText(/Inactive players/)).toHaveCount(0);
  expect(social.asked.at(-1)).toBe('leaderboard=xp&period=day');

  await page.getByRole('radio', { name: 'All time' }).check();
  await expect(inactive).toBeVisible();
  await expect(inactive.getByRole('radio', { name: 'Yes' })).toBeChecked();
  await inactive.getByRole('radio', { name: 'No' }).check();
  await expect(rows.locator('.player-name')).toHaveText([/sam/]);
  expect(social.asked.at(-1)).toBe('leaderboard=xp&period=all');
});

// --- the languages -----------------------------------------------------------------------------------------

for (const code of ['de', 'ru'] as const) {
  const say = CATALOGS[code]!;

  test.describe(`${code} on a phone`, () => {
    test.use({ viewport: PHONE });

    test('My reports, with a report in each status, is in the language', async ({ page }) => {
      const { social } = await setUp(page, { language: code });
      social.reports = [
        { username: 'sam', category: 'cheating', note: '', at: '2026-10-10T10:00:00.000Z', status: 'open' },
        { username: 'kit', category: 'name', note: '', at: '2026-10-09T10:00:00.000Z', status: 'actioned' },
        { username: 'lee', category: 'chat', note: '', at: '2026-10-08T10:00:00.000Z', status: 'dismissed' },
        { username: 'ana', category: 'other', note: '', at: '2026-10-07T10:00:00.000Z', status: 'open' },
      ];
      await open(page, '/#account');
      const mine = section(page, say['reports.mine']);
      await mine.getByRole('button', { name: say['reports.mine.show'], exact: true }).click();
      await expect(mine.locator('.report-row')).toHaveCount(4);
      await expect(mine.locator('.report-status')).toHaveText([say['report.status.open'], say['report.status.actioned'], say['report.status.dismissed'], say['report.status.open']]);
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
    });

    test('My reports with nothing in it, the report form of a profile and a board with its switch are in the language', async ({ page }) => {
      await setUp(page, { language: code });
      await open(page, '/#account');
      const mine = section(page, say['reports.mine']);
      await mine.getByRole('button', { name: say['reports.mine.show'], exact: true }).click();
      await expect(mine).toContainText(say['reports.mine.empty']);
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);

      await open(page, '/?user=sam');
      await page.getByRole('button', { name: say['profile.report.open'], exact: true }).click();
      await page.getByRole('button', { name: say['common.sendReport'], exact: true }).click();
      await expect(page.locator('.report-form').getByRole('alert')).toHaveText(say['report.category.missing']);
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);

      await open(page, '/#leaderboards');
      await page.getByRole('group', { name: say['leaderboards.inactive'] }).getByRole('radio', { name: say['account.switch.yes'] }).check({ force: true });
      await expect(page.getByText(say['leaderboards.about.all.inactive'])).toBeVisible();
      await expectTranslated(page, code, NAMES);

      await open(page, '/#moderation');
      await expect(page.locator('.reasons .reason-category').first()).toHaveText(say['report.category.offensiveChat']);
      await expectTranslated(page, code, NAMES);
    });
  });
}
