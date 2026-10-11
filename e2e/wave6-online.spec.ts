import { expect, test } from '@playwright/test';
import { continentCount } from '../src/game/spread.ts';
import { EMOTES } from '../src/multiplayer/client.ts';
import { settings } from '../src/multiplayer/testing.ts';
import { placePin, play, roundReady } from './helpers.ts';
import { CATALOGS, expectTranslated } from './language-checks.ts';
import { SAYS } from './match-rules.ts';
import { SEEN_MS, openScene, revealScene } from './match-scenes.ts';
import { lobbyTitle, settingsLine } from './party-helpers.ts';
import { SocialServer } from './social-server.ts';
import {
  GUEST,
  LOPSIDED_SEED,
  PHONE,
  PREPARING,
  asNeel,
  asVisitor,
  enterMatch,
  expectLopsided,
  final,
  finishedParty,
  guestInside,
  hostedParty,
  ids,
  nextPoll,
  ownLobby,
  pictureGone,
  pictureLate,
  plainDraw,
  postedPlaces,
  spreadDraw,
  typical,
  watchPolls,
} from './wave6-online-helpers.ts';

// Wave 6 online: places on three continents in the public kinds (item 2), a refused set drawn again,
// the request made as a reveal ends (item 26), a party without "Allow guests" (item 7, withdrawn), the typical wait in a queue
// (item 8), a report's category (item 10) and a server that says to slow down (item 27), and at the
// end the new screens in German and Russian on a phone.

const slowDown = (server: { refuse: string | null; refuseStatus: number }, on: boolean) => {
  server.refuse = on ? SAYS.slowDown : null;
  server.refuseStatus = on ? 429 : 400;
};

// --- item 2: an online world game is drawn on three continents ---------------------------------------

for (const kind of ['unranked', 'ranked', 'team'] as const) {
  test(`the places of a ${kind} game are on three continents, where the plain draw of its seed is not`, async ({ page }) => {
    expectLopsided();
    const server = await enterMatch(page, PREPARING[kind]());
    await roundReady(page);
    const posted = postedPlaces(server);
    expect(posted).toHaveLength(1);
    expect(ids(posted[0]!)).toEqual(ids(spreadDraw(LOPSIDED_SEED)));
    expect(continentCount(posted[0]!)).toBeGreaterThanOrEqual(3);
    // the server took them: it would have refused the plain draw
    expect(server.state.places).toHaveLength(5);
  });
}

test('a party is drawn as before: the plain draw of its seed, on however few continents', async ({ page }) => {
  expectLopsided();
  const server = await enterMatch(page, PREPARING.party());
  await roundReady(page);
  const posted = postedPlaces(server);
  expect(posted).toHaveLength(1);
  expect(ids(posted[0]!)).toEqual(ids(plainDraw(LOPSIDED_SEED)));
  expect(continentCount(posted[0]!)).toBeLessThan(3);
});

test('a public game still ends on three continents when a spare stands in for a place whose picture is gone', async ({ page }) => {
  // the place the rule had to reach furthest for: the last one drawn
  const lost = spreadDraw(LOPSIDED_SEED).at(-1)!.id;
  const server = await asNeel(page);
  await pictureGone(page, lost);
  await enterMatch(page, PREPARING.unranked(), 'en', server);
  await roundReady(page);
  const [posted] = postedPlaces(server);
  expect(ids(posted!)).toEqual(ids(spreadDraw(LOPSIDED_SEED, 0, [lost])));
  expect(ids(posted!)).not.toContain(lost);
  expect(continentCount(posted!)).toBeGreaterThanOrEqual(3);
});

// --- a set of places the server will not take --------------------------------------------------------

test('a refused set of places is not sent again: a fresh set is drawn at once and the match begins', async ({ page }) => {
  const state = PREPARING.ranked();
  const server = await enterMatch(page, state);
  server.placesRefusedTimes = 1;
  await roundReady(page);
  const posted = postedPlaces(server);
  expect(posted.map(ids)).toEqual([ids(spreadDraw(LOPSIDED_SEED)), ids(spreadDraw(LOPSIDED_SEED, 1))]);
  expect(ids(posted[1]!)).not.toEqual(ids(posted[0]!));
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('when the fresh set is refused too, the player is told and chooses another draw or the way home', async ({ page }) => {
  const server = await enterMatch(page, PREPARING.team());
  server.placesRefusedTimes = 2;
  const notice = page.locator('.notice-panel');
  await expect(notice).toContainText(`The places drawn for this match were not accepted: ${SAYS.notOnMap}`);
  await expect(notice.getByRole('button')).toHaveText(['Draw new places', 'Home']);
  expect(postedPlaces(server)).toHaveLength(2);

  await notice.getByRole('button', { name: 'Draw new places' }).click();
  await roundReady(page);
  expect(postedPlaces(server).map(ids)).toEqual([0, 1, 2].map((refused) => ids(spreadDraw(LOPSIDED_SEED, refused))));
  await expect(notice).toHaveCount(0);

  // and the way out, from the same notice
  const again = await enterMatch(page, PREPARING.team());
  again.placesRefusedTimes = 5;
  await page.locator('.notice-panel').getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  expect(again.posted('leave')).toHaveLength(1);
});

test('a post that failed for another reason sends the same places again', async ({ page }) => {
  const server = await enterMatch(page, PREPARING.ranked());
  slowDown(server, true);
  const notice = page.locator('.notice-panel');
  await expect(notice).toContainText(SAYS.slowDown);
  await expect(notice.getByRole('button')).toHaveText(['Try again', 'Home']);
  slowDown(server, false);
  await notice.getByRole('button', { name: 'Try again' }).click();
  await roundReady(page);
  const posted = postedPlaces(server);
  expect(posted).toHaveLength(2);
  expect(ids(posted[1]!)).toEqual(ids(posted[0]!));
});

// --- item 26: the request made as a reveal ends -------------------------------------------------------

test('a full party asks once more as a reveal ends, and has the next round ready within its get-ready', async ({ page }) => {
  test.setTimeout(90_000);
  const { server, scene } = await openScene(page, 'forty', 'en');
  server.advanceAfterReveal = true;
  server.leadMs = 5000;
  const polls = watchPolls(page);
  // the reveal ends two seconds after a poll is due: the pace of four seconds would next ask two seconds later still
  const seen = await nextPoll(page);
  server.revealScores(scene.scores);
  const ends = seen + 6000;
  server.state = { ...server.state, revealEndsAt: new Date(ends).toISOString() };
  await expect(play(page)).toHaveAttribute('data-phase', 'result', { timeout: SEEN_MS });

  // round two is on screen, its picture loaded, with most of the five seconds still to run
  await expect(page.locator('.hud')).toContainText('2 / 5', { timeout: SEEN_MS });
  await expect(page.locator('.status')).toHaveText(/^Round starts in [345]$/);
  const asked = polls.filter((at) => at >= ends && at <= ends + 1400);
  expect(asked, `polls ${polls.map((at) => at - seen).join(', ')} ms after the one before the reveal`).toHaveLength(1);
  // one request more, not a quicker pace: the next comes four seconds after it
  await expect.poll(() => polls.filter((at) => at > asked[0]!).length, { timeout: SEEN_MS }).toBeGreaterThanOrEqual(1);
  expect(polls.find((at) => at > asked[0]!)! - asked[0]!).toBeGreaterThanOrEqual(3900);
  await roundReady(page);
});

test('a player whose picture is late gets the round as soon as it is there', async ({ page }) => {
  test.setTimeout(60_000);
  const { server, scene } = await openScene(page, 'eight', 'en');
  // the second round's picture takes four seconds: the round has started by then
  await pictureLate(page, 'place-two', 4000);
  server.leadMs = 1000;
  await revealScene(page, server, scene);
  server.startRound(1, 300_000);
  await expect(page.locator('.hud')).toContainText('2 / 5', { timeout: SEEN_MS });
  await roundReady(page);
  // the clock is the server's: the seconds the picture took are gone from it
  await expect(page.locator('.hud')).toContainText(/4:5\d/);
  await placePin(page, { x: 150, y: 150 });
  await expect(page.getByRole('button', { name: 'Guess', exact: true })).toBeEnabled();
});

// --- item 7, withdrawn: a party is for accounts, and has no setting that says otherwise ---------------

test('a party is made and changed without a word about guests', async ({ page }) => {
  const server = await asNeel(page);
  await page.goto('/#create');
  await expect(page.getByRole('group', { name: 'Teams' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Allow guests' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create party' }).click();
  expect(server.posted('create')).toEqual([{ action: 'create', settings: { map: 'world', mode: 'move', timeLimit: 60, rounds: 5, communication: 'chat', teams: 'none', guests: true } }]);

  await expect(lobbyTitle(page)).toBeVisible();
  await expect(settingsLine(page)).not.toContainText('accounts only');
  await page.getByRole('button', { name: 'Change settings' }).click();
  const form = page.getByRole('form', { name: 'Party settings' });
  await expect(form.getByRole('group', { name: 'Teams' })).toBeVisible();
  await expect(form.getByRole('group', { name: 'Allow guests' })).toHaveCount(0);
});

test('a visitor who opens the link of a party is sent to sign in, and nothing is asked of the match server', async ({ page }) => {
  const { server } = await asVisitor(page);
  server.state = hostedParty(true);
  await page.goto('/?party=ABC123');
  await expect(page.locator('.pane-title')).toHaveText('Join party');
  await expect(page.locator('.notice')).toContainText('Multiplayer needs an account');
  await expect(page.getByRole('button', { name: /Join party|Play as a guest/ })).toHaveCount(0);
  expect(server.posts).toEqual([]);
});

test('a guest left in a lobby from before stays in its list, whatever the party says of guests', async ({ page }) => {
  const server = await enterMatch(page, { ...ownLobby(), players: [...ownLobby().players, ...guestInside()] });
  await expect(lobbyTitle(page)).toBeVisible();
  await expect(page.locator('.lobby-players .player-row')).toHaveCount(3);

  server.state = { ...server.state, settings: settings({ guests: false }) };
  const polls = server.polls;
  await expect.poll(() => server.polls).toBeGreaterThan(polls + 1);
  await expect(page.locator('.lobby-players .player-row')).toHaveCount(3);
  await expect(page.locator('.lobby-players')).toContainText(GUEST);
  await expect(settingsLine(page)).not.toContainText('accounts only');
});

// --- item 8: the typical wait of a queue ----------------------------------------------------------------

test('the queue screen says how long players usually wait: under a minute, about so many minutes, or no recent games', async ({ page }) => {
  const server = await asNeel(page);
  await page.goto('/#unranked');
  await expect(page.getByRole('button', { name: 'Find a match' })).toBeVisible();
  // the server names no time for a queue the player is not in
  await expect(typical(page)).toHaveCount(0);

  server.typicalWait = 45;
  await page.getByRole('button', { name: 'Find a match' }).click();
  await expect(typical(page)).toHaveText('Typical wait: usually under a minute');
  for (const [seconds, words] of [[59, 'usually under a minute'], [60, 'about 1 minute'], [185, 'about 3 minutes'], [null, 'no recent games']] as const) {
    server.typicalWait = seconds;
    await expect(typical(page)).toHaveText(`Typical wait: ${words}`);
  }
});

// --- item 10: a report from the final standing says what it is about --------------------------------------

test('a report from the final standing asks what it is about, and sends that category', async ({ page }) => {
  const social = await SocialServer.install(page);
  await enterMatch(page, finishedParty());
  const report = final(page).getByRole('button', { name: 'Report sam' });
  const dialog = page.getByRole('dialog');

  await report.click();
  await expect(dialog).toContainText('Report sam to the moderators?');
  const about = dialog.getByRole('group', { name: 'What is it about' });
  await expect(about.getByRole('radio')).toHaveCount(4);
  await expect(about.locator('.choice')).toHaveText(['Cheating', 'Offensive name', 'Offensive chat', 'Other']);
  await expect(about.getByRole('radio', { checked: true })).toHaveCount(0);
  // nothing is sent without a category, and the question stays open
  await dialog.getByRole('button', { name: 'Report' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose what the report is about.');
  expect(social.posted('report')).toHaveLength(0);
  // thinking better of it sends nothing, with a category chosen or not
  await about.getByRole('radio', { name: 'Cheating' }).check();
  await expect(dialog.locator('.account-error')).toBeEmpty();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(report).toBeEnabled();
  expect(social.posted('report')).toHaveLength(0);

  await report.click();
  await page.getByRole('dialog').getByRole('radio', { name: 'Offensive chat' }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Report' }).click();
  await expect(final(page).getByRole('status')).toHaveText('sam was reported. A moderator will look at it.');
  await expect(report).toBeDisabled();
  expect(social.posted('report')).toEqual([{ action: 'report', username: 'sam', category: 'chat' }]);
});

// --- item 27: the server says to slow down ------------------------------------------------------------------

test('a chat line the server would not take stays in the box under its message, and goes when sent again', async ({ page }) => {
  const server = await enterMatch(page, ownLobby());
  await expect(lobbyTitle(page)).toBeVisible();
  const box = page.getByRole('textbox', { name: 'Message' });
  const error = page.locator('.chat .account-error');

  slowDown(server, true);
  await box.fill('good luck everyone');
  await box.press('Enter');
  await expect(error).toHaveText(SAYS.slowDown);
  await expect(box).toHaveValue('good luck everyone');
  await expect(page.locator('.chat-list li')).toHaveCount(0);

  slowDown(server, false);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.chat-list li')).toContainText(['good luck everyone']);
  await expect(box).toHaveValue('');
  await expect(error).toBeEmpty();
  expect(server.posted('chat')).toHaveLength(2);
});

test('a pin the server would not take is skipped without a word, and a guess it would not take can be sent again', async ({ page }) => {
  const { server } = await openScene(page, 'team', 'en');
  slowDown(server, true);
  await placePin(page, { x: 150, y: 150 });
  await expect.poll(() => server.posted('pin').length).toBeGreaterThanOrEqual(1);
  // nothing is said of it: the next pin, or the guess, makes up for it
  await expect(page.locator('.status')).toBeEmpty();
  await expect(page.locator('.net-banner')).toBeEmpty();
  await expect(page.getByRole('alert').filter({ hasText: SAYS.slowDown })).toHaveCount(0);

  const guess = page.getByRole('button', { name: 'Guess', exact: true });
  await guess.click();
  await expect(page.locator('.status')).toHaveText(SAYS.slowDown);
  await expect(guess).toBeEnabled();
  slowDown(server, false);
  await guess.click();
  await expect(page.getByRole('button', { name: 'Guess sent' })).toBeDisabled();
  expect(server.posted('guess')).toHaveLength(2);
});

// --- the new screens in German and Russian, on a phone ----------------------------------------------------

for (const code of ['de', 'ru'] as const) {
  const say = CATALOGS[code]!;
  const word = (key: string, change: Record<string, string> = {}) => Object.entries(change).reduce((text, [name, value]) => text.replace(`{${name}}`, value), say[key]!);

  test.describe(`${code}, on a phone`, () => {
    test.use({ viewport: PHONE });

    test('the queue screen with each wording of the typical wait is in the language and fits', async ({ page }) => {
      const server = await asNeel(page, code);
      await page.goto('/#ranked');
      server.typicalWait = 45;
      await page.getByRole('button', { name: say['queue.find'] }).click();
      // 185 seconds is "about 3 minutes", which Russian writes in its form for two to four
      const three = word(say['queue.typical.minutes.few'] ? 'queue.typical.minutes.few' : 'queue.typical.minutes.other', { count: '3' });
      for (const [seconds, wait] of [[45, say['queue.typical.underMinute']!], [185, three], [null, say['queue.typical.none']!]] as const) {
        server.typicalWait = seconds;
        await expect(typical(page)).toHaveText(word('queue.typical', { wait }));
        await expect(page.locator('.queue-window')).not.toBeEmpty();
        await expectTranslated(page, code);
      }
    });

    test('the question before a report, with its categories, is in the language and fits', async ({ page }) => {
      await SocialServer.install(page);
      await enterMatch(page, finishedParty(), code);
      await page.getByRole('button', { name: word('common.reportPlayer', { name: 'sam' }) }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('radio')).toHaveCount(4);
      await dialog.getByRole('button', { name: say['common.report'], exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText(say['report.category.missing']!);
      await expectTranslated(page, code, ['neel', 'sam']);
      // the dialog and everything in it are inside the screen
      const box = (await dialog.boundingBox())!;
      expect([box.x >= 0, box.x + box.width <= PHONE.width, box.y >= 0, box.y + box.height <= PHONE.height]).toEqual([true, true, true, true]);
    });

    test('the party form, and a lobby with a guest left in it, are in the language and fit', async ({ page }) => {
      const server = await asNeel(page, code);
      await page.goto('/#create');
      await expect(page.getByRole('group', { name: say['party.teams'] }).getByRole('radio')).toHaveCount(3);
      await page.waitForLoadState('networkidle');
      await expectTranslated(page, code);

      await enterMatch(page, { ...ownLobby(), players: [...ownLobby().players, ...guestInside()] }, code, server);
      await expect(page.locator('.lobby-players')).toContainText(GUEST);
      await page.waitForLoadState('networkidle');
      await expectTranslated(page, code, ['neel', 'sam', GUEST, 'ABC123', ...EMOTES]);
    });

    test('the notice of places that were refused twice is in the language and fits', async ({ page }) => {
      const server = await enterMatch(page, PREPARING.ranked(), code);
      server.placesRefusedTimes = 2;
      const notice = page.locator('.notice-panel');
      await expect(notice.getByRole('button')).toHaveText([say['match.drawAgain']!, say['common.home']!]);
      await expect(notice).toContainText(word('match.placesRefused', { error: SAYS.notOnMap }));
      await expectTranslated(page, code, ['neel', 'sam']);
    });
  });
}
