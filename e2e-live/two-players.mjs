// A live two-player check, run by hand against a deployed site. Not part of the test suite.
//
//   node e2e-live/two-players.mjs https://plonk.example [--headed]
//
// Four browser contexts sign up as throwaway users. Two of them play a 3-round party against each
// other through the real interface on real imagery, with a visitor who has no account playing in
// it as a guest; the host then takes the party back to its lobby and starts it again. The two then
// find each other in the ranked queue and play that duel, press Play again, and meet in a new one.
// Last, all four queue for 2v2 alone and play it to its end: teammates must see each other's pin,
// and at every reveal the team health on screen is checked against the scores on screen.
// It prints what each player saw at each phase, every console error and failed request, and ends
// with THROWAWAY_USERS=a,b,c,d so the accounts can be deleted (the guest has none).
import { randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';

const [base, ...flags] = process.argv.slice(2);
if (!base || !/^https?:\/\//.test(base)) {
  console.error('Usage: node e2e-live/two-players.mjs <base URL> [--headed]');
  process.exit(2);
}
const origin = base.replace(/\/+$/, '');

const STEP_MS = 60_000;
const PARTY_MS = 4 * 60_000;
const RANKED_MS = 8 * 60_000;
const TEAM_MS = 8 * 60_000;
const QUEUE_MS = 90_000;
const PIN_MS = 30_000;
const POLL_MS = 400;

// 2v2 as the server's contract has it: 5000 health a team, the gap in a round times 1.3, 5 rounds at most
const START_HEALTH = 5000;
const TEAM_DAMAGE = 1.3;
const TEAM_ROUNDS = 5;
const TEAMS = ['1', '2'];

const random = (bytes) => randomBytes(bytes).toString('hex');
const users = [`check_${random(4)}`, `check_${random(4)}`, `check_${random(4)}`, `check_${random(4)}`];
const password = `pw-${random(12)}`;
const created = [];
const problems = [];
const lines = [];
/** the match each page last asked the server for, by player */
const matchOf = new Map();

const say = (who, text) => {
  const line = `[${who}] ${text}`;
  lines.push(line);
  console.log(line);
};

/** Everything a player can see that tells where the match is. */
const look = (page) =>
  page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const all = (selector) => [...document.querySelectorAll(selector)].map((node) => node.textContent.replace(/\s+/g, ' ').trim());
    const cells = (selector) => [...document.querySelectorAll(selector)].map((row) => [...row.cells].map((cell) => cell.textContent.replace(/\s+/g, ' ').trim()));
    const play = document.querySelector('.play');
    return {
      phase: play?.getAttribute('data-phase') ?? null,
      imagery: play?.getAttribute('data-imagery') ?? null,
      round: text('.hud .hud-cell:nth-child(2) .value'),
      clock: text('.hud .hud-cell:nth-child(4) .value'),
      status: text('.status'),
      guess: text('.map-panel .guess'),
      roster: all('.roster:not([hidden]) .roster-row').join(', '),
      health: all('.health:not([hidden]) .health-row').join(' / '),
      result: all('[aria-label="Round result"] [aria-label="Players"] tbody tr'),
      teams: all('[aria-label="Round result"] [aria-label="Teams"] tbody tr'),
      country: text('[aria-label="Round result"] .figure-value'),
      final: all('[aria-label="Final standing"] tbody tr'),
      outcome: text('[aria-label="Final standing"] .outcome'),
      notice: text('.notice-panel .prose'),
      lost: text('.net-banner'),
      // the reveal cell by cell, and the names in it that lead to a profile
      players: cells('[aria-label="Round result"] [aria-label="Players"] tbody tr'),
      teamScores: cells('[aria-label="Round result"] [aria-label="Teams"] tbody tr'),
      linked: all('[aria-label="Round result"] [aria-label="Players"] tbody a'),
      // 2v2: each team's health as its meter has it, and the teammates' pins on the map
      meters: [...document.querySelectorAll('[aria-label="Team health"] [role="meter"]')].map((meter) => [meter.getAttribute('aria-label') ?? '', Number(meter.getAttribute('aria-valuenow'))]),
      mates: [...document.querySelectorAll('.pin-mate')].map((pin) => ({ name: pin.textContent.trim(), final: pin.classList.contains('final') })),
    };
  });

/** Looks every POLL_MS until `read` gives something, and resolves to it; to null when `limitMs` runs out first. */
async function until(read, limitMs) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    const found = await read();
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return null;
}

function watch(page, who) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`[${who}] console error: ${message.text().slice(0, 300)}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`[${who}] page error: ${String(error).slice(0, 300)}`));
  page.on('request', (request) => {
    const url = new URL(request.url());
    const id = url.pathname === '/api/match' ? url.searchParams.get('id') : null;
    if (id) {
      matchOf.set(who, id);
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
    if (response.status() >= 400 && new URL(response.url()).origin === new URL(origin).origin) {
      problems.push(`[${who}] HTTP ${response.status()}: ${response.request().method()} ${new URL(response.url()).pathname}${new URL(response.url()).search}`);
    }
  });
}

async function signUp(page, username) {
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

/** Puts a pin somewhere on the open guess map. Resolves to false when there is no map to put it on. */
async function pin(page) {
  await page.locator('.map-panel').hover();
  await page.waitForTimeout(600);
  const canvas = page.locator('.map-panel .maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    return false;
  }
  const at = { x: 80 + Math.random() * Math.max(1, box.width - 160), y: 80 + Math.random() * Math.max(1, box.height - 160) };
  await canvas.click({ position: at });
  return true;
}

/** Sends the pin that is on the map. Resolves to false when the round would not take it. */
async function send(page) {
  const button = page.locator('.map-panel .guess');
  if (!(await button.isEnabled())) {
    return false;
  }
  await button.click();
  return true;
}

/** Puts a pin somewhere on the open guess map and sends it. Resolves to false when the round would not take it. */
const guess = async (page) => (await pin(page)) && (await send(page));

/** True while the round on screen is waiting for this player's guess, its view shown or known to be missing. */
const takesGuess = (seen) => seen.phase === 'guessing' && (seen.guess === 'Place your pin' || seen.guess === 'Guess') && (seen.status === '' || seen.status.startsWith('This place cannot be shown'));

/**
 * Leaves a match by the way out given, and waits for the home screen. A match that is still
 * running asks first; one that has ended does not.
 */
async function leave(page, way) {
  const sure = page.getByRole('dialog').getByRole('button', { name: 'Leave match' });
  const home = page.getByRole('button', { name: 'Start game' });
  await way.first().click({ timeout: STEP_MS });
  await sure.or(home).first().waitFor({ timeout: STEP_MS });
  if (await sure.isVisible()) {
    await sure.click();
  }
  await home.waitFor({ timeout: STEP_MS });
}

/**
 * Plays a match from the first round to its final standing, saying what the player sees on the way.
 * `onReveal` is given every reveal and answers with what is wrong with it, or with nothing; what it
 * finds is said, and is its caller's to count.
 */
async function playMatch(page, who, limitMs, onReveal = () => '') {
  const guessed = new Set();
  const revealed = new Set();
  let waitingSaid = '';
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    const seen = await look(page);
    if (seen.lost) {
      say(who, `connection banner: ${seen.lost}`);
    }
    if (seen.final.length > 0) {
      say(who, `final standing: "${seen.outcome}" ${seen.final.join(' ; ')}${seen.health ? ` | health ${seen.health}` : ''}`);
      return true;
    }
    if (seen.notice) {
      say(who, `stopped by a notice: ${seen.notice}`);
      return false;
    }
    if (seen.phase === 'guessing' && !guessed.has(seen.round) && (seen.guess === 'Place your pin' || seen.guess === 'Guess')) {
      const view = seen.status === '' ? 'view shown' : `status "${seen.status}"`;
      if (seen.status === '' || seen.status.startsWith('This place cannot be shown')) {
        const sent = await guess(page);
        guessed.add(seen.round);
        say(who, `round ${seen.round}: ${view} on ${seen.imagery ?? 'no imagery'}, clock ${seen.clock}${seen.health ? `, health ${seen.health}` : ''}; ${sent ? 'guess sent' : 'could not send a guess'}`);
      }
    } else if (seen.phase === 'guessing' && guessed.has(seen.round) && seen.roster && seen.roster !== waitingSaid) {
      waitingSaid = seen.roster;
      say(who, `round ${seen.round}: waiting, ${seen.roster}`);
    } else if (seen.phase === 'guessing' && seen.guess === 'Time is up' && !guessed.has(seen.round)) {
      guessed.add(seen.round);
      say(who, `round ${seen.round}: time ran out before a guess`);
    }
    if (seen.result.length > 0 && !revealed.has(seen.round)) {
      revealed.add(seen.round);
      say(who, `round ${seen.round} reveal: ${seen.country}: ${seen.result.join(' ; ')}${seen.health ? ` | health ${seen.health}` : ''}`);
      const problem = onReveal(seen);
      if (problem) {
        say(who, `round ${seen.round} reveal: ${problem}`);
      }
    }
    await page.waitForTimeout(POLL_MS);
  }
  say(who, `gave up after ${Math.round(limitMs / 1000)} s without a final standing`);
  return false;
}

/** One player's row in a party's lobby. */
const lobbyRow = (page, name) => page.getByRole('main').getByRole('listitem').filter({ hasText: name }).first();

/** The host starts the match once the lobby lets them: Start match is off while the host is alone. */
async function startParty(host) {
  const start = host.getByRole('button', { name: 'Start match' });
  await start.waitFor({ timeout: STEP_MS });
  await host.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Start match' && !button.disabled), null, { timeout: STEP_MS });
  say(users[0], `lobby lists: ${(await host.locator('main .player-list').first().locator('.player-row').allTextContents()).join(', ')}; starting`);
  await start.click();
}

/**
 * A visitor with no account joins the party by its code as a guest. Resolves to the guest's name,
 * and to whether it is a guest's name and the host's lobby shows it as one is shown.
 */
async function joinAsGuest(visitor, host, code) {
  await visitor.goto(`${origin}/?party=${encodeURIComponent(code)}`);
  await visitor.getByRole('button', { name: 'Play as a guest' }).click();
  const line = (await visitor.getByText(/Playing as Guest #\d+/).first().textContent({ timeout: STEP_MS })) ?? '';
  const name = /Guest #\d+/.exec(line)?.[0] ?? '';
  await visitor.getByRole('button', { name: 'Join party', exact: true }).click();
  await visitor.getByRole('heading', { name: 'Party', exact: true }).waitFor({ timeout: STEP_MS });
  await lobbyRow(host, name).waitFor({ timeout: STEP_MS });
  const named = /^Guest #\d{4}$/.test(name);
  // a guest has no profile: the name is plain text, where an account's leads to one
  const plain = (await lobbyRow(host, name).getByRole('link').count()) === 0 && (await lobbyRow(host, users[1]).getByRole('link', { name: users[1], exact: true }).count()) === 1;
  const lists = (await visitor.locator('main .player-list').first().locator('.player-row').allTextContents()).join(', ');
  say(name, `joined by code as a guest; lobby lists: ${lists}${named ? '' : ' (the name is not "Guest #NNNN")'}${plain ? '' : " (the host's lobby does not show the guest in plain text beside an account's link)"}`);
  return { name, ok: named && plain };
}

/**
 * A 3-round party of two accounts and a guest. Resolves to whether it went as it should, whether
 * everyone reached its final standing, its code, and who played it on which page.
 */
async function party(host, member, visitor) {
  await host.goto(`${origin}/#create`);
  await host.getByRole('slider', { name: 'Rounds' }).fill('3');
  await host.getByRole('slider', { name: 'Time per round' }).fill('30');
  await host.getByRole('button', { name: 'Create party', exact: true }).click();
  await host.getByRole('heading', { name: 'Party', exact: true }).waitFor({ timeout: STEP_MS });
  const code = (await host.locator('.lobby-code').textContent())?.trim() ?? '';
  say(users[0], `created a party, code ${code}`);

  await member.goto(`${origin}/?party=${encodeURIComponent(code)}`);
  await member.getByRole('button', { name: 'Join party', exact: true }).click();
  await member.getByRole('heading', { name: 'Party', exact: true }).waitFor({ timeout: STEP_MS });
  say(users[1], `joined by code; lobby lists: ${(await member.locator('main .player-list').first().locator('.player-row').allTextContents()).join(', ')}`);

  const guest = await joinAsGuest(visitor, host, code);
  const players = [
    { page: host, who: users[0] },
    { page: member, who: users[1] },
    { page: visitor, who: guest.name },
  ];
  await startParty(host);

  let guestGuessed = false;
  let revealsWrong = false;
  // every reveal lists the guest, whose name alone leads to no profile; a distance beside it is a round the guest played
  const whatIsWrong = (seen) => {
    const row = seen.players.find(([name]) => name?.includes(guest.name));
    guestGuessed ||= row !== undefined && row[1] !== 'No guess';
    if (!row) {
      return 'the guest is not in the table';
    }
    if (seen.linked.some((name) => name.includes('#'))) {
      return "the guest's name is a link";
    }
    return [users[0], users[1]].every((name) => seen.linked.includes(name)) ? '' : "an account's name is not a link";
  };
  const onReveal = (seen) => {
    const problem = whatIsWrong(seen);
    revealsWrong ||= problem !== '';
    return problem;
  };
  const results = await Promise.all(players.map(({ page, who }) => playMatch(page, who, PARTY_MS, onReveal)));
  if (!guestGuessed) {
    say(guest.name, 'no reveal showed a guess of the guest');
  }
  const finished = results.every(Boolean);
  return { ok: finished && guest.ok && guestGuessed && !revealsWrong, finished, code, players };
}

/**
 * The host takes the finished party back to its lobby: everyone who played is in it again under
 * the same code, and a second match starts from it. They leave once its first round is running.
 */
async function partyAgain({ code, players }) {
  const host = players[0].page;
  await host.getByRole('region', { name: 'Final standing' }).getByRole('button', { name: 'Back to lobby' }).click();
  const codes = await Promise.all(
    players.map(async ({ page, who }) => {
      await page.getByRole('heading', { name: 'Party', exact: true }).waitFor({ timeout: STEP_MS });
      const shown = (await page.locator('.lobby-code').textContent())?.trim() ?? '';
      await lobbyRow(host, who).waitFor({ timeout: STEP_MS });
      say(who, `back in the lobby, code ${shown}${shown === code ? '' : ` (it was ${code})`}`);
      return shown;
    }),
  );
  await startParty(host);

  const begun = await Promise.all(
    players.map(async ({ page, who }) => {
      const seen = await until(async () => {
        const now = await look(page);
        return now.phase === 'guessing' && now.guess === 'Place your pin' ? now : null;
      }, 2 * STEP_MS);
      say(who, seen ? `second match: round ${seen.round} is running, clock ${seen.clock}` : 'second match: no round began');
      return seen !== null;
    }),
  );
  await Promise.all(
    players
      .filter((_, index) => begun[index])
      .map(async ({ page, who }) => {
        await leave(page, page.getByRole('button', { name: 'Exit', exact: true }));
        say(who, 'left the second match');
      }),
  );
  return codes.every((shown) => shown === code) && begun.every(Boolean);
}

async function ranked(pages) {
  await Promise.all(
    pages.map(async (page, index) => {
      await page.goto(`${origin}/#ranked`);
      await page.getByRole('button', { name: 'Find a match' }).click();
      say(users[index], 'looking for a ranked duel');
    }),
  );
  await Promise.all(pages.map((page) => page.locator('.play').waitFor({ timeout: QUEUE_MS })));
  pages.forEach((_, index) => say(users[index], 'matched: the duel is loading'));
  const results = await Promise.all(pages.map((page, index) => playMatch(page, users[index], RANKED_MS)));
  return results.every(Boolean);
}

/** One player's part of the second duel: guess in the first round, read the reveal, leave. */
async function duelRound(page, who) {
  const deadline = Date.now() + 3 * 60_000;
  let guessed = false;
  while (Date.now() < deadline) {
    const seen = await look(page);
    if (seen.notice) {
      say(who, `stopped by a notice: ${seen.notice}`);
      return false;
    }
    if (!guessed && takesGuess(seen)) {
      guessed = await guess(page);
      say(who, `second duel round ${seen.round}: on ${seen.imagery ?? 'no imagery'}; ${guessed ? 'guess sent' : 'could not send a guess'}`);
    }
    if (seen.result.length > 0 || seen.final.length > 0) {
      say(who, `second duel reveal: ${seen.result.join(' ; ')}${seen.health ? ` | health ${seen.health}` : ''}`);
      const ok = seen.result.length === 2;
      // the reveal's own way out; the standing's, when the other player's leaving has already ended the duel
      const reveal = page.getByRole('region', { name: 'Round result' }).getByRole('button', { name: 'Leave match' });
      await leave(page, reveal.or(page.getByRole('region', { name: 'Final standing' }).getByRole('button', { name: 'Home' })));
      say(who, `left the second duel${ok ? '' : ' (the reveal did not show the two players)'}`);
      return ok;
    }
    await page.waitForTimeout(POLL_MS);
  }
  say(who, 'gave up on the second duel without seeing a reveal');
  return false;
}

/** After the duel both press Play again: each is back in the ranked queue, and they meet in a new match. */
async function rematch(pages) {
  const first = pages.map((_, index) => matchOf.get(users[index]));
  await Promise.all(
    pages.map(async (page, index) => {
      await page.getByRole('region', { name: 'Final standing' }).getByRole('button', { name: 'Play again' }).click();
      say(users[index], 'pressed Play again: looking for a ranked duel');
    }),
  );
  // a new match is one the page has not asked the server for before
  const next = await Promise.all(pages.map((_, index) => until(() => (matchOf.get(users[index]) === first[index] ? null : matchOf.get(users[index])), QUEUE_MS)));
  if (next.includes(null)) {
    pages.forEach((_, index) => say(users[index], next[index] ? 'matched again' : `not matched again within ${QUEUE_MS / 1000} s`));
    return false;
  }
  const together = next[0] === next[1];
  pages.forEach((_, index) => say(users[index], `matched again: a new match${together ? ', and the same one as the other player' : ', but not the one the other player is in'}`));
  const results = await Promise.all(pages.map((page, index) => duelRound(page, users[index])));
  return together && results.every(Boolean);
}

const number = (text) => Number((text ?? '').replace(/\D/g, ''));
/** the team a text names: "Team 1 health", "Team 2yours", or the "1" of a player's row */
const teamIn = (text) => /\d+/.exec(text ?? '')?.[0] ?? '';
const both = (byTeam) => TEAMS.map((team) => byTeam[team]).join(' / ');
const sameHealth = (a, b) => TEAMS.every((team) => a[team] === b[team]);
/** Each team's health as the strip on screen has it, by team number. */
const shownHealth = (seen) => Object.fromEntries(seen.meters.map(([name, now]) => [teamIn(name), now]));

/** The 2v2 rule for one round: a team's score is its best member's, and the team with the lower one loses the gap times 1.3, down to 0. */
function teamRule(health, rows) {
  const best = (team) => Math.max(0, ...rows.filter((row) => row.team === team).map((row) => row.score));
  const left = (team, other) => Math.max(0, health[team] - Math.round(Math.max(0, best(other) - best(team)) * TEAM_DAMAGE));
  return { scores: { 1: best('1'), 2: best('2') }, health: { 1: left('1', '2'), 2: left('2', '1') } };
}

/**
 * A 2v2 reveal against the rule: what is wrong with it (its shape, its team scores, the health
 * beside it, the team of the player whose pin was shown), the health the rule leaves, and this
 * player's own team. `health` is what the teams went into the round with.
 */
function checkReveal(seen, who, health, mate) {
  const rows = seen.players.map(([name, team, , points]) => ({ name: users.find((user) => name?.includes(user)) ?? name, team, score: number(points) }));
  const own = rows.find((row) => row.name === who);
  const after = teamRule(health, rows);
  const shown = shownHealth(seen);
  const wrong = [
    seen.result.length === 4 && seen.teams.length === 2 && seen.teams.filter((row) => row.includes('yours')).length === 1 ? '' : "the reveal did not show four players in two teams, one of them this player's",
    seen.teamScores.every(([name, round]) => number(round) === after.scores[teamIn(name)]) ? '' : `the teams' scores are not their best guesses, which are ${both(after.scores)}`,
    TEAMS.some((team) => health[team] === 0) ? 'a round was played after a team had no health left' : '',
    sameHealth(shown, after.health) ? '' : `health shown is ${both(shown)}; the rule gives ${both(after.health)}, from ${both(health)} and best scores of ${both(after.scores)}`,
    !mate || rows.some((row) => row.name === mate && row.team === own?.team) ? '' : `${mate}, whose pin was shown, is not on this player's team`,
  ];
  return { wrong: wrong.filter(Boolean), health: after.health, team: own?.team ?? '' };
}

/** Where a 2v2 ended against the rule: on a team with no health or after 5 rounds, with the health the rounds left, and more health wins. */
function checkFinal(seen, health, rounds, team) {
  const other = team === '1' ? '2' : '1';
  const outcome = health[team] > health[other] ? 'Your team won.' : health[team] < health[other] ? 'The other team won.' : 'A draw.';
  const shown = shownHealth(seen);
  const wrong = [
    rounds === TEAM_ROUNDS || TEAMS.some((side) => health[side] === 0) ? '' : `it ended after ${rounds} rounds with health ${both(health)}: neither ${TEAM_ROUNDS} rounds nor a team with none`,
    sameHealth(shown, health) ? '' : `health shown at the end is ${both(shown)}; the rounds left ${both(health)}`,
    team === '' || seen.outcome === outcome ? '' : `the standing says "${seen.outcome}" where the health says "${outcome}"`,
  ];
  return wrong.filter(Boolean);
}

/**
 * One player's whole 2v2, from the first round to the final standing. In the first round the pin
 * is put down and held until the teammate's pin shows on the map and the teammate has seen this
 * one (`pins`: whose pin each player has seen, shared by the four), or PIN_MS at most. Every
 * reveal and the standing are checked against the 2v2 rule.
 */
async function teamMatch(page, who, pins) {
  const guessed = new Set();
  const revealed = new Set();
  let health = { 1: START_HEALTH, 2: START_HEALTH };
  let team = '';
  let held = '';
  let heldAt = 0;
  let ok = true;
  const report = (wrong) => {
    ok &&= wrong.length === 0;
    wrong.forEach((problem) => say(who, `2v2: ${problem}`));
  };
  const deadline = Date.now() + TEAM_MS;
  while (Date.now() < deadline) {
    const seen = await look(page);
    if (seen.final.length > 0) {
      say(who, `2v2 final standing: "${seen.outcome}" ${seen.final.join(' ; ')} | health ${seen.health}`);
      report(checkFinal(seen, health, revealed.size, team));
      return ok;
    }
    if (seen.notice) {
      say(who, `stopped by a notice: ${seen.notice}`);
      return false;
    }
    // a teammate's pin that can still move: once it is their guess it would be shown whether or not pins are shared
    const mate = seen.mates.find((shown) => !shown.final);
    if (mate && !pins.has(who) && (held === '' || held === seen.round)) {
      pins.set(who, mate.name);
      say(who, `2v2 round ${seen.round}: the pin of ${mate.name} is on the map`);
    }
    const open = takesGuess(seen) && !guessed.has(seen.round);
    if (open && held === '') {
      held = seen.round;
      heldAt = Date.now();
      const placed = await pin(page);
      say(who, `2v2 round ${seen.round}: on ${seen.imagery ?? 'no imagery'}, health ${seen.health}; ${placed ? 'pin placed and held for the teammate to see' : 'could not place a pin'}`);
      report([...(placed ? [] : ['no pin could be placed']), ...(sameHealth(shownHealth(seen), health) ? [] : [`health at the start is ${both(shownHealth(seen))}, not ${both(health)}`])]);
      if (!placed) {
        guessed.add(seen.round);
      }
    } else if (open && held === seen.round && (pins.get(pins.get(who)) === who || Date.now() - heldAt > PIN_MS)) {
      await page.locator('.map-panel').hover();
      const sent = await send(page);
      guessed.add(seen.round);
      say(who, `2v2 round ${seen.round}: ${sent ? 'guess sent' : 'could not send a guess'}`);
      report(pins.has(who) ? [] : [`no teammate's pin was shown within ${PIN_MS / 1000} s of this player's own`]);
    } else if (open && held !== seen.round) {
      const sent = await guess(page);
      guessed.add(seen.round);
      say(who, `2v2 round ${seen.round}: on ${seen.imagery ?? 'no imagery'}, health ${seen.health}; ${sent ? 'guess sent' : 'could not send a guess'}`);
    }
    if (seen.players.length > 0 && !revealed.has(seen.round)) {
      revealed.add(seen.round);
      say(who, `2v2 round ${seen.round} reveal: players ${seen.result.join(' ; ')} | teams ${seen.teams.join(' ; ')} | health ${seen.health}`);
      const checked = checkReveal(seen, who, health, pins.get(who));
      report(checked.wrong);
      health = checked.health;
      team = checked.team || team;
    }
    await page.waitForTimeout(POLL_MS);
  }
  say(who, `gave up on the 2v2 after ${Math.round(TEAM_MS / 1000)} s without a final standing`);
  return false;
}

async function teams(pages) {
  await Promise.all(
    pages.map(async (page, index) => {
      await page.goto(`${origin}/#team`);
      await page.getByRole('button', { name: 'Find a match' }).click();
      say(users[index], 'looking for a 2v2 match');
    }),
  );
  await Promise.all(pages.map((page) => page.locator('.play').waitFor({ timeout: QUEUE_MS })));
  pages.forEach((_, index) => say(users[index], 'matched: the 2v2 is loading'));
  const pins = new Map();
  const results = await Promise.all(pages.map((page, index) => teamMatch(page, users[index], pins)));
  return results.every(Boolean);
}

const browser = await chromium.launch({ channel: 'chromium', headless: !flags.includes('--headed') });
const newContext = () => browser.newContext({ viewport: { width: 1360, height: 840 } });
let ok = false;
try {
  const contexts = await Promise.all(users.map(() => newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  pages.forEach((page, index) => watch(page, users[index]));

  await Promise.all(pages.map((page, index) => signUp(page, users[index])));
  // the guest: one more browser, with no account, so nothing of it is in THROWAWAY_USERS
  const visitor = await (await newContext()).newPage();
  watch(visitor, 'guest');
  console.log('--- party, 3 rounds, with a guest');
  const room = await party(pages[0], pages[1], visitor);
  console.log('--- the same party again, from its lobby');
  const lobbyOk = room.finished && (await partyAgain(room));
  await visitor.context().close();
  const goHome = () => Promise.all(pages.map((page) => page.getByRole('button', { name: 'Home' }).click({ timeout: 5000 }).catch(() => {})));
  await goHome();
  console.log('--- ranked duel');
  const rankedOk = await ranked(pages.slice(0, 2));
  console.log('--- Play again: a second duel');
  const againOk = rankedOk && (await rematch(pages.slice(0, 2)));
  await goHome();
  console.log('--- 2v2, four players, to its end');
  const teamsOk = await teams(pages);
  ok = room.ok && lobbyOk && rankedOk && againOk && teamsOk;
} catch (error) {
  problems.push(`the check itself stopped: ${String(error).split('\n')[0]}`);
} finally {
  await browser.close();
}

console.log('--- problems');
console.log(problems.length === 0 ? 'none' : [...new Set(problems)].join('\n'));
console.log(`--- ${ok ? 'PASSED' : 'FAILED'}: ${lines.length} things seen, ${problems.length} problems`);
console.log(`THROWAWAY_USERS=${created.join(',')}`);
process.exit(ok ? 0 : 1);
