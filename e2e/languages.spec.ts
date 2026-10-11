import { expect, test } from '@playwright/test';
import { matchState, player, queueState, settings } from '../src/multiplayer/testing.ts';
import { de } from '../src/i18n/de.ts';
import { fr } from '../src/i18n/fr.ts';
import { ru } from '../src/i18n/ru.ts';
import { mockServices } from './fixtures.ts';
import { roundReady, scrollsSideways } from './helpers.ts';
import { CATALOGS, expectTranslated, spilling } from './language-checks.ts';
import { MapsServer } from './maps-server.ts';
import { FIVE_PLACES, MatchServer, signIn } from './match-server.ts';
import { SocialServer } from './social-server.ts';

// The rest of the suite runs in English. Here each other language is put through three screens on a
// phone: the home pane, a round's result, and a view that will not load. Every piece of text on
// them has to come from that language's catalog, and nothing may spill out of the screen.

const CHALLENGE = 'map=world&seed=e2e00001&t=0&mode=move&n=3';

test.use({ viewport: { width: 390, height: 800 } });

for (const code of ['en', 'es', 'fr', 'de', 'ru']) {
  const say = CATALOGS[code]!;

  test(`${code}: the home pane is in the language, with nothing left over and nothing spilling`, async ({ page }) => {
    await mockServices(page);
    await page.goto(`/?lang=${code}`);
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(page.locator('.pane-title')).toHaveText(say['nav.item.singleplayer']);
    await expect(page.getByRole('button', { name: say['singleplayer.start'] })).toBeVisible();
    await expect(page.getByRole('region', { name: say['intro.title'] })).toBeVisible();
    await expectTranslated(page, code);

    await page.getByRole('button', { name: say['home.menu'] }).click();
    await expect(page.getByRole('link', { name: say['nav.item.daily'] })).toBeVisible();
    await expectTranslated(page, code);
  });

  test(`${code}: a round and its result are in the language`, async ({ page }) => {
    await mockServices(page);
    await page.goto(`/?${CHALLENGE}&lang=${code}`);
    await page.getByRole('button', { name: say['singleplayer.playChallenge'] }).click();
    await roundReady(page);
    await expectTranslated(page, code);

    await page.getByRole('button', { name: say['round.openMap'] }).click();
    await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 220 } });
    await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
    const result = page.getByRole('region', { name: say['result.label'] });
    await expect(result.getByRole('button', { name: say['result.next'] })).toBeVisible();
    await expect(result.getByRole('link', { name: say['result.openInMaps'] })).toBeVisible();
    await expectTranslated(page, code);
  });

  test(`${code}: a view that will not load says so in the language`, async ({ page }) => {
    await mockServices(page);
    await page.route('https://img.plonk.test/**/sd.jpg', (route) => route.abort());
    await page.goto(`/?${CHALLENGE}&lang=${code}`);
    await page.getByRole('button', { name: say['singleplayer.playChallenge'] }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(say['play.viewFailed']);
    await expect(alert.getByRole('button')).toHaveText([say['common.tryAgain'], say['play.skipPlace'], say['round.exit']]);
    await expectTranslated(page, code);
  });
}

/** every pane a signed-in moderator can open, and the views reached from them */
const PANES = ['/', '/#streak', '/#daily', '/#ranked', '/#unranked', '/#team', '/#create', '/#join', '/#maps', '/?community=paris-walk-x7k2', '/?edit=new', '/#leaderboards', '/#friends', '/#account', '/?user=sam', '/#moderation'];

for (const code of ['es', 'fr', 'de', 'ru']) {
  test(`${code}: no pane spills on a phone`, async ({ page }) => {
    await mockServices(page);
    await signIn(page, 'neel', 1000, { moderator: true });
    await MatchServer.install(page);
    await SocialServer.install(page);
    await MapsServer.install(page);
    await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
    for (const address of PANES) {
      await page.goto('about:blank');
      await page.goto(address);
      await expect(page.locator('.pane-title')).toBeVisible();
      // what the pane asks the server for has arrived and been drawn
      await page.waitForLoadState('networkidle');
      expect(await spilling(page), address).toEqual([]);
      expect(await scrollsSideways(page), address).toBe(false);
    }
  });
}

/** the two players, and the three letters each has on the result map */
const NAMES = ['neel', 'sam', 'NEE', 'SAM'];

for (const code of ['es', 'fr', 'de', 'ru']) {
  const say = CATALOGS[code]!;

  test(`${code}: a match's round table and final standing are in the language and fit a phone`, async ({ page }) => {
    await mockServices(page);
    await signIn(page, 'neel', 1016);
    const match = await MatchServer.install(page);
    await SocialServer.install(page);
    await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
    match.state = matchState({
      id: 'm7',
      code: null,
      kind: 'ranked',
      phase: 'playing',
      settings: settings({ mode: 'no-move', timeLimit: 60, rounds: 10, communication: 'reactions' }),
      you: { username: 'neel', isHost: false, isResolver: false, team: null, guest: false, muted: [] },
      places: [...FIVE_PLACES, ...FIVE_PLACES],
      players: [player('neel', { rating: 1016, health: 5000 }), player('sam', { rating: 1000, health: 5000 })],
    });
    match.startRound(0);
    match.queue = queueState({ matchId: 'm7', serverNow: match.time(0) });
    await page.goto('/');
    await page.getByRole('button', { name: say['home.resume.rejoin'] }).click();
    await roundReady(page);
    await expectTranslated(page, code, NAMES);

    await page.getByRole('button', { name: say['round.openMap'] }).click();
    await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 220 } });
    await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
    match.reveal(1200, 3000);
    await expect(page.getByRole('region', { name: say['match.roundResult'] })).toBeVisible();
    await expectTranslated(page, code, NAMES);

    match.finish({ winners: ['sam'], ratingChanges: [{ username: 'neel', before: 1016, after: 999 }, { username: 'sam', before: 1000, after: 1017 }], dodgedBy: null });
    const final = page.getByRole('region', { name: say['match.finalStanding'] });
    await expect(final.getByRole('button', { name: say['common.reportPlayer'].replace('{name}', 'sam') })).toBeVisible();
    await expectTranslated(page, code, NAMES);
  });
}

test('the language follows the browser, and a choice on the account pane wins and is remembered', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'fr-CA', viewport: { width: 1360, height: 840 } });
  const page = await context.newPage();
  await mockServices(page);
  await signIn(page, null);
  await page.goto('/#account');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('.pane-title')).toHaveText(fr['nav.item.account']);

  await page.getByRole('radio', { name: 'Deutsch' }).check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('.pane-title')).toHaveText(de['nav.item.account']);
  await page.goto('/');
  await expect(page.locator('.pane-title')).toHaveText(de['nav.item.singleplayer']);

  // an address that names a language wins for that visit only
  await page.goto('/?lang=ru');
  await expect(page.locator('.pane-title')).toHaveText(ru['nav.item.singleplayer']);
  await page.goto('/');
  await expect(page.locator('.pane-title')).toHaveText(de['nav.item.singleplayer']);
  await context.close();
});
