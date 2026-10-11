// Two players together: the public queue, friends and an invite, a party played to its end.
import { check, hud, imagery, origin, PARTY_MS, placePin, QUEUE_MS, roundReady, say, STEP_MS, textOf, texts, users } from './setup.mjs';

// --- 6. public unranked --------------------------------------------------------------------------

export async function unranked(pages) {
  for (const [index, page] of pages.entries()) {
    await page.goto(`${origin}/#unranked`);
    await page.getByRole('button', { name: 'Find a match' }).click();
    await page.locator('.queue-status').waitFor({ timeout: STEP_MS });
    say(users[index], `in the queue: ${await textOf(page.locator('.queue-status'))}, ${await textOf(page.locator('.queue-waiting'))}`);
  }
  await Promise.all(
    pages.map(async (page, index) => {
      // the countdown starts once the second player is in; either it is seen, or the game has already begun
      const seen = await page
        .waitForFunction(() => (document.querySelector('.queue-status')?.textContent ?? '').startsWith('Starting in') || document.querySelector('.play') !== null, null, { timeout: QUEUE_MS })
        .then(() => page.evaluate(() => ({ status: document.querySelector('.queue-status')?.textContent ?? '', waiting: document.querySelector('.queue-waiting')?.textContent ?? '' })))
        .catch(() => ({ status: '', waiting: '' }));
      say(users[index], `countdown: ${seen.status || '(already started)'}; ${seen.waiting}`);
      check(`${users[index]} sees the countdown`, /^Starting in \d+$/.test(seen.status), seen.status);
      check(`${users[index]} sees two players waiting`, seen.waiting === '2 players waiting', seen.waiting);
    }),
  );
  await Promise.all(pages.map((page) => page.locator('.play').waitFor({ timeout: QUEUE_MS })));
  check('the match starts for both', true);
  await Promise.all(
    pages.map(async (page, index) => {
      await roundReady(page);
      const seen = `${await hud(page)} on ${await imagery(page)}`;
      await page.waitForFunction(() => document.querySelector('.map-panel .guess')?.textContent === 'Place your pin', null, { timeout: STEP_MS });
      await placePin(page, { x: 0.3 + index * 0.3, y: 0.45 });
      await page.locator('.map-panel .guess').click();
      await page.getByRole('region', { name: 'Round result' }).waitFor({ timeout: 80_000 });
      const rows = await texts(page.getByRole('region', { name: 'Round result' }).locator('tbody tr'));
      say(users[index], `round 1: ${seen}; reveal: ${rows.join(' ; ')}`);
      check(`${users[index]} sees both players in the reveal`, rows.length === 2);
    }),
  );
  for (const [index, page] of pages.entries()) {
    await page.getByRole('region', { name: 'Round result' }).getByRole('button', { name: 'Leave match' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Leave match' }).click();
    await page.getByRole('button', { name: 'Start game' }).waitFor({ timeout: STEP_MS });
    say(users[index], 'left the match and is home');
  }
  check('both left the match', true);
}

// --- 7. friends and a party invite ---------------------------------------------------------------

export async function friends([a, b]) {
  const [alice, bob] = users;
  const region = (page, name) => page.getByRole('region', { name, exact: true });
  await a.goto(`${origin}/#friends`);
  await a.getByLabel('Add a friend by username').fill(bob);
  await a.getByRole('button', { name: 'Send request' }).click();
  await region(a, 'Sent, waiting for an answer').waitFor({ timeout: STEP_MS });
  check('the request shows as sent', (await textOf(region(a, 'Sent, waiting for an answer'))).includes(bob));

  await b.goto(`${origin}/#friends`);
  await region(b, 'Requests').waitFor({ timeout: STEP_MS });
  check('the other player sees it incoming, and the badge counts it', (await textOf(region(b, 'Requests'))).includes(alice) && (await textOf(b.locator('.badge'))) === '1', `badge ${await textOf(b.locator('.badge'))}`);
  await b.getByRole('button', { name: `Accept ${alice}` }).click();
  await region(b, 'Friends').waitFor({ timeout: STEP_MS });
  check('accepting lists the friend', (await textOf(region(b, 'Friends'))).includes(alice), await textOf(region(b, 'Friends')));
  await a.reload();
  await region(a, 'Friends').waitFor({ timeout: STEP_MS });
  check('and the friend is listed for the one who asked', (await textOf(region(a, 'Friends'))).includes(bob), await textOf(region(a, 'Friends')));

  await a.goto(`${origin}/#create`);
  await a.getByRole('button', { name: 'Create party', exact: true }).click();
  await a.getByRole('heading', { name: 'Party', exact: true }).waitFor({ timeout: STEP_MS });
  const code = await textOf(a.locator('.lobby-code'));
  await a.getByRole('button', { name: `Invite ${bob}` }).click({ timeout: STEP_MS });
  await a.waitForFunction((name) => document.querySelector(`[aria-label="Invite ${name}"]`)?.textContent === 'Invited', bob, { timeout: STEP_MS });
  say(alice, `created party ${code} and invited ${bob}`);

  await b.goto(`${origin}/#friends`);
  await region(b, 'Party invites').waitFor({ timeout: STEP_MS });
  check('the invite arrives on the friends pane', (await textOf(region(b, 'Party invites'))).includes(alice), await textOf(region(b, 'Party invites')));
  await region(b, 'Party invites').getByRole('button', { name: `Join ${alice}'s party` }).click();
  await b.getByRole('heading', { name: 'Party', exact: true }).waitFor({ timeout: STEP_MS });
  await a.waitForFunction(() => document.querySelectorAll('main .player-list')[0]?.querySelectorAll('.player-row').length === 2, null, { timeout: STEP_MS });
  const lobby = await texts(a.locator('main .player-list').first().locator('.player-row'));
  check('joining from the invite puts both in the lobby', (await textOf(b.locator('.lobby-code'))) === code && lobby.length === 2, lobby.join(', '));
  for (const page of [b, a]) {
    await page.getByRole('button', { name: 'Leave party' }).click();
    await page.getByRole('button', { name: 'Start game' }).waitFor({ timeout: STEP_MS });
  }
  check('both left the party', true);
}

// --- 15. a party of one round, and the game in the history ------------------------------------------

export async function partyGame([a, b]) {
  const [alice, bob] = users;
  await a.goto(`${origin}/#create`);
  await a.getByRole('slider', { name: 'Rounds', exact: true }).fill('1');
  await a.getByRole('button', { name: 'Create party', exact: true }).click();
  await a.getByRole('heading', { name: 'Party', exact: true }).waitFor({ timeout: STEP_MS });
  const code = await textOf(a.locator('.lobby-code'));
  await b.goto(`${origin}/?party=${encodeURIComponent(code)}`);
  await b.getByRole('button', { name: 'Join party', exact: true }).click();
  await b.getByRole('heading', { name: 'Party', exact: true }).waitFor({ timeout: STEP_MS });
  say(alice, `created the one-round party ${code}, and ${bob} joined by its link`);
  // Start is the host's to press once both are in the lobby
  await a.getByRole('button', { name: 'Start match' }).click({ timeout: STEP_MS });

  await Promise.all(
    [a, b].map(async (page, index) => {
      await roundReady(page);
      await page.waitForFunction(() => document.querySelector('.map-panel .guess')?.textContent === 'Place your pin', null, { timeout: STEP_MS });
      await placePin(page, { x: 0.3 + index * 0.3, y: 0.45 });
      await page.locator('.map-panel .guess').click();
      const final = page.getByRole('region', { name: 'Final standing' });
      await final.waitFor({ timeout: PARTY_MS });
      const rows = await texts(final.locator('tbody tr'));
      say(users[index], `final standing: ${rows.join(' ; ')}`);
      check(`${users[index]} sees both players in the final standing`, rows.length === 2);
    }),
  );
  for (const page of [b, a]) {
    await page.getByRole('region', { name: 'Final standing' }).getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Start game' }).waitFor({ timeout: STEP_MS });
  }

  await a.goto(`${origin}/#account`);
  const row = a.getByRole('row').filter({ hasText: 'Party' }).first();
  const listed = await row.waitFor({ timeout: STEP_MS }).then(
    () => true,
    () => false,
  );
  // the cells of a row of the history: day, type and result, map, points, rating, XP, players, Rounds
  const cells = listed ? await texts(row.locator('td')) : [];
  say(alice, `history: ${cells.join(' | ') || 'no party game is listed'}`);
  check("the party is in the first player's history, as a party of two", listed && cells[1].startsWith('Party') && cells[6] === '2', cells.join(' | '));
}
