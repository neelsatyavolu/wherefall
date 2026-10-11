import { expect, test, type Page } from '@playwright/test';
import type { DailyServer } from './daily-server.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { boardEntries, friend, profile } from './social-server.ts';
import { DESKTOP, NAMES, PHONE, box, history, open, setUp, written } from './wave6-panes-scenes.ts';

// The home screen's panes after the second design review, part one: a chart's headline and the
// stat cell beside it never disagree unexplained (M11), and the daily's streak cell keeps to two
// lines. The review's smaller findings are in `wave6-panes-review.spec.ts`; the map editor's file
// of places and the click of a button in `wave6-panes-editor.spec.ts`.

// --- M11: one figure, one number ---------------------------------------------------------------------------------

/**
 * Every figure the page shows twice, as each place shows it: in the level line and the stat cells,
 * and in the headline of its chart. `lag` is the line a chart adds when its latest point is not
 * the figure now.
 */
const twice = (page: Page) =>
  page.evaluate(() => {
    const digits = (text: string | null | undefined) => (text ?? '').replace(/[^\d]/g, '');
    const own = (node: Element | null | undefined) => [...(node?.childNodes ?? [])].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join('');
    const cell = (label: string) => [...document.querySelectorAll('.account-stats .figure')].find((figure) => figure.querySelector('.label')?.textContent === label);
    const chart = (label: string) => {
      const found = [...document.querySelectorAll('.chart')].find((each) => each.querySelector('.chart-head .label')?.textContent === label);
      return { now: digits(found?.querySelector('.chart-now')?.textContent), lag: found?.querySelector('.chart-lag')?.textContent ?? null };
    };
    const rating = cell('Rating');
    // the account pane writes the place under the rating ("rank 5"); a profile gives it a cell of its own
    const rank = cell('Rating rank') ? own(cell('Rating rank')?.querySelector('.figure-value')) : (rating?.querySelector('.figure-detail')?.textContent ?? '');
    return {
      xp: { cell: digits(/^[^·]*/.exec(document.querySelector('.level .settings-line')?.textContent ?? '')?.[0]), chart: chart('XP') },
      rating: { cell: digits(own(rating?.querySelector('.figure-value'))), chart: chart('Rating') },
      rank: { cell: digits(rank), chart: chart('Rating rank') },
    };
  });

/**
 * The rule the review asked for: a figure and its chart's headline are the same number, or the
 * chart says in words why its latest point is not the figure now, naming that figure.
 */
function expectOneNumber(shown: Awaited<ReturnType<typeof twice>>): void {
  for (const [name, figure] of Object.entries(shown)) {
    expect(figure.cell, `${name}: the stat cell`).not.toBe('');
    expect(figure.chart.now, `${name}: the chart headline`).not.toBe('');
    if (figure.chart.now === figure.cell) {
      expect(figure.chart.lag, `${name}: the two agree, so nothing is explained`).toBeNull();
    } else {
      expect(figure.chart.lag ?? '', `${name}: ${figure.cell} beside ${figure.chart.now} is explained, with the figure now`).toContain(figure.cell);
    }
  }
}

test('M11: on the account pane a chart headline is the figure in the stat cell beside it', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const { account, social } = await setUp(page, { account: { xp: 35_600, level: 12, duels: { wins: 24, losses: 14, ties: 2, winRate: 60, rank: 5 } } });
  account.change({ rating: 1459 });
  social.profiles = { ...social.profiles, neel: profile('neel', { friend: 'self', xp: 35_600, rating: 1459, history: history(35_600, 1459, 5) }) };
  await open(page, '/#account');
  await expect(page.locator('.chart')).toHaveCount(4);

  const shown = await twice(page);
  expect(shown.xp).toEqual({ cell: '35600', chart: { now: '35600', lag: null } });
  expect(shown.rating).toEqual({ cell: '1459', chart: { now: '1459', lag: null } });
  expect(shown.rank).toEqual({ cell: '5', chart: { now: '5', lag: null } });
  expectOneNumber(shown);
});

test('M11: on a profile a chart headline is the figure in the stat cell, over every range', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const { social } = await setUp(page);
  await open(page, '/?user=sam');
  await expect(page.locator('.chart')).toHaveCount(4);
  const first = await twice(page);
  expect(first.xp.cell).toBe('36000');
  expect(first.rating.cell).toBe('1540');
  expect(first.rank.cell).toBe('1');
  expectOneNumber(first);

  for (const range of ['7 days', 'All time']) {
    await page.getByRole('radio', { name: range, exact: true }).check({ force: true });
    await expect(page.locator('.chart-body')).toHaveAttribute('aria-busy', 'false');
    await page.waitForLoadState('networkidle');
    if ((await page.locator('.chart').count()) === 4) {
      expectOneNumber(await twice(page));
    }
  }
  expect(social.asked.filter((query) => query.includes('profile=sam')).length).toBeGreaterThanOrEqual(3);
});

test('M11: a place that has moved since it was recorded is said to have, with the place now', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const { social } = await setUp(page);
  // others overtook sam after sam's rating last changed: the board says 4, the day's point still says 1
  social.profiles = { ...social.profiles, sam: { ...social.profiles.sam!, duels: { ...social.profiles.sam!.duels, rank: 4 } } };
  await open(page, '/?user=sam');
  const chart = page.locator('.chart').filter({ has: page.locator('.chart-head .label').getByText('Rating rank', { exact: true }) });
  await expect(chart.locator('.chart-read')).toHaveText('Oct 101');
  await expect(chart.locator('.chart-lag')).toHaveText('The latest place is from Oct 10, when the rating last changed. On the board now: 4.');
  // only the place can lag: XP and rating are written with their day's point
  await expect(page.locator('.chart-lag')).toHaveCount(1);
  expectOneNumber(await twice(page));

  // a player the board has dropped (not seen for 14 days) has no place now, and the chart says that
  social.profiles = { ...social.profiles, sam: { ...social.profiles.sam!, duels: { ...social.profiles.sam!.duels, rank: null } } };
  await open(page, '/?user=sam');
  await expect(chart.locator('.chart-lag')).toHaveText('The latest place is from Oct 10, when the rating last changed. Not on the board now.');
});

// --- the daily's streak cell, and its 14 days ------------------------------------------------------------------------

const atRisk = (daily: DailyServer) => {
  daily.streak = { current: 4, best: 128, atRisk: true };
  daily.records = { played: 11, best: 14_200, average: 9860 };
  daily.history = ['09-29', '09-30', '10-01', '10-03', '10-04', '10-05', '10-07', '10-08', '10-09', '10-10'].map((day, i) => ({ date: `2026-${day}`, score: 8450 + i * 550 }));
};

for (const code of ['en', 'es', 'fr', 'de', 'ru'] as const) {
  for (const [name, size] of [['a phone', PHONE], ['a desktop', DESKTOP]] as const) {
    test(`the daily's streak cell is two orderly lines in ${code} on ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      const { daily } = await setUp(page, { language: code });
      atRisk(daily);
      await open(page, '/#daily');
      const say = CATALOGS[code]!;
      const cell = page.locator('.daily-record .figure').first();
      await expect(cell.locator('.label')).toHaveText(say['label.streak']);
      // the streak with its days, then the best one: each on one line, and nothing else in the cell
      const lines = await cell.locator('.daily-streak-count, .figure-detail').evaluateAll((nodes) =>
        nodes.map((node) => ({ rows: new Set([...node.getClientRects()].map((rect) => Math.round(rect.top))).size, spills: node.scrollWidth > node.clientWidth + 1 })),
      );
      expect(lines).toEqual([{ rows: 1, spills: false }, { rows: 1, spills: false }]);
      await expect(cell.locator('.tag')).toHaveCount(0);
      const [inner, outer] = [await box(cell.locator('.figure-value')), await box(cell)];
      expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
      // that it is at risk is said under the figures, as a status: a dot, the word, the sentence
      const note = page.locator('.daily-streak-note');
      await expect(note.locator('.status-word')).toHaveText(say['daily.streak.risk']);
      await expect(note).toContainText(say['daily.streak.atRisk']);
      const rows = await page.locator('.daily-record .figure').evaluateAll((cells) => new Set(cells.map((each) => Math.round(each.getBoundingClientRect().height))).size);
      expect(rows, 'cells of one row are one height').toBeLessThanOrEqual(size === PHONE ? 2 : 1);
    });
  }
}

test('on a phone the 14 days keep air between one score and the next', async ({ page }) => {
  for (const code of ['fr', 'ru']) {
    await page.setViewportSize(PHONE);
    const { daily } = await setUp(page, { language: code });
    atRisk(daily);
    await open(page, '/#daily');
    // each score as it is drawn there (without its thousands separator), measured against its cell
    const spare = await page.locator('.daily-day.played').evaluateAll((cells) =>
      cells.map((cell) => {
        const score = cell.querySelector<HTMLElement>('.daily-day-score')!;
        const drawn = getComputedStyle(score, '::after').content.replace(/"/g, '');
        const pen = document.createElement('canvas').getContext('2d')!;
        pen.font = getComputedStyle(score, '::after').font;
        return { drawn, spare: Math.round(cell.getBoundingClientRect().width - pen.measureText(drawn).width) };
      }),
    );
    expect(spare.length).toBeGreaterThan(8);
    expect(spare.every((each) => /^\d+$/.test(each.drawn)), code).toBe(true);
    expect(spare.filter((each) => each.spare < 12), `${code}: at least 6px either side of a score`).toEqual([]);
  }
  // a wide screen has the room, and writes the score as everywhere else
  await page.setViewportSize(DESKTOP);
  await expect(page.locator('.daily-day.played .daily-day-score').first()).toHaveCSS('font-size', '12px');
});

// --- in German and Russian, on a phone ---------------------------------------------------------------------------

for (const code of ['de', 'ru'] as const) {
  test.describe(`${code} on a phone`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(PHONE);
    });

    test('the account pane with its forms open and a chart that lags, a board with its pager', async ({ page }) => {
      const { social } = await setUp(page, { language: code, account: { duels: { wins: 2, losses: 1, ties: 0, winRate: 66, rank: 9 } } });
      const say = CATALOGS[code]!;
      social.profiles = { ...social.profiles, neel: profile('neel', { friend: 'self', history: history(1200, 1016, 12) }) };
      social.boards.all.rating = { entries: boardEntries(100), you: { rank: 120, value: 900 } };
      await open(page, '/#account');
      await expect(page.locator('.chart-lag')).toHaveCount(1);
      await page.getByRole('button', { name: say['account.country.change'] }).click();
      await page.getByRole('button', { name: say['account.changePassword'] }).click();
      await page.getByRole('button', { name: say['account.changePassword'] }).click();
      await expect(page.getByText(say['account.passwordMissing'])).toBeVisible();
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);

      await open(page, '/#leaderboards');
      await expect(page.locator('.board tbody tr')).toHaveCount(20);
      await page.getByRole('button', { name: say['daily.nextPage'] }).click();
      await expect(page.locator('.pager-page')).toHaveText(say['daily.page'].replace('{page}', '2'));
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
    });

    test('a friend and a reported player asked about in their rows', async ({ page }) => {
      const { social } = await setUp(page, { language: code });
      const say = CATALOGS[code]!;
      social.friends = { friends: [friend('sam', { party: 'ABC123', online: true, country: 'GB' }), friend('ana')], incoming: ['kit'], outgoing: ['zoe'], invites: [] };
      await open(page, '/#friends');
      await page.getByRole('button', { name: say['friends.removeName'].replace('{name}', 'ana') }).click();
      await expect(page.getByRole('alert')).toHaveText(say['friends.removeConfirm'].replace('{name}', 'ana'));
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);

      await open(page, '/#moderation');
      await page.getByRole('button', { name: say['moderation.banLabel'].replace('{name}', 'kit') }).click();
      await page.getByRole('button', { name: say['moderation.removeMapLabel'].replace('{name}', 'Paris walk') }).click();
      await expect(page.getByRole('alert')).toHaveCount(2);
      await expectTranslated(page, code, [...NAMES, ...(await written(page))]);
    });
  });
}
