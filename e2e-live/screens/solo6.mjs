// Playing alone in wave 6: the welcome a new visitor gets and the tutorial behind it, the country
// streak that ordinary games keep, the hybrid map, a guesser with the longest names there are, the
// daily's result against the day's average, and what a summary says when a save went another way.
import { dailyEntries } from '../../e2e/daily-server.ts';
import { PLACES_FIXTURE, RUSSIA_ONLY, mockPlaces } from '../../e2e/fixtures.ts';
import { servePlaces } from '../../e2e/place-rules.ts';
import { dailyHistoryUnder, keptDaily, recordsOf } from './data.mjs';
import { bring, button, openMap, openPane, panes, playRound, roundReady, section, startChallenge, visit } from './setup.mjs';

const FULL = { fullPage: true };
/** a streak of four that earlier world games left in this browser */
const FOUR_IN_A_ROW = JSON.stringify({ rounds: ['ru-00', 'ru-01', 'ru-02', 'ru-03'].map((id) => ({ id, answer: 'RU' })), begun: null });
/** where on the pin map Russia is, and where it is not, as fractions of the map's width and height */
const IN_RUSSIA = [0.7, 0.22];
const NOT_IN_RUSSIA = [0.3, 0.62];
/** spots of the pin map in other countries, the likeliest first: Brazil, the Sahara, the United States, Australia */
const ELSEWHERE = [[0.3, 0.6], [0.5, 0.48], [0.22, 0.4], [0.85, 0.68], [0.52, 0.55], [0.33, 0.66]];
/**
 * Six countries of one continent, so every round of the Country Guesser offers these six: the ones
 * with the longest names there are (the British Indian Ocean Territory, the Central African
 * Republic, the Democratic Republic of the Congo) and short ones beside them.
 */
const LONG_NAMED = ['IO', 'CF', 'CD', 'GQ', 'ST', 'ZA'];
const LONG_NAMES = {
  version: 1,
  regions: Object.fromEntries(LONG_NAMED.map((code) => [code, 'africa'])),
  locations: LONG_NAMED.flatMap((country, c) => Array.from({ length: 6 }, (_, i) => [`${country.toLowerCase()}-${i}`, 20 + c + i * 0.1, -5 + i * 0.1, country])),
};
/** The same places under other ids: what the server holds after an update of the site replaced its list. */
const renamed = (list) => ({ ...list, locations: list.locations.map(([id, ...rest]) => [`new-${id}`, ...rest]) });

const welcome = (s) => s.page.getByRole('main', { name: s.say('welcome.label') });
const result = (s) => s.page.getByRole('region', { name: s.say('result.label') });
const summary = (s) => s.page.getByRole('region', { name: s.say('summary.label') });
const saveNote = (s) => summary(s).locator('.save-note').filter({ hasText: /\S/ });

/** Plays the rounds of the game on screen, each with the same guess, through to its summary. */
async function playToSummary(s, rounds = 3) {
  for (let round = 1; round <= rounds; round += 1) {
    await playRound(s, 0.45, 0.4);
    await button(s, round === rounds ? 'result.seeSummary' : 'result.next').click();
  }
  await summary(s).waitFor();
}

/** where the two guesses that measure the pin map are put, as fractions of its width and height */
const PROBES = [[0.3, 0.35], [0.7, 0.62]];
/** how far a pin may be from the edge of the pin map, where its buttons are */
const MAP_MARGIN = 0.12;
const mercator = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/**
 * How the closed-in world of the pin map lies on this screen: what fraction of its width a
 * longitude is at, and of its height a latitude. It depends on the size of the screen, so it is
 * measured by playing: a game whose first two guesses are at known spots is saved with where on
 * Earth those spots were, and two points give the line (latitude along the map's own projection).
 */
async function measurePinMap(s) {
  await startChallenge(s, 't=0&mode=move');
  for (const [index, [across, down]] of [...PROBES, PROBES[0]].entries()) {
    await playRound(s, across, down);
    await button(s, index === 2 ? 'result.seeSummary' : 'result.next').click();
  }
  await saveNote(s).waitFor();
  const [first, second] = s.games.saved.filter((body) => body.kind === undefined).at(-1).rounds;
  const line = (from, to, a, b) => ({ slope: (b - a) / (to - from), start: a - ((b - a) / (to - from)) * from });
  const across = line(first.guessLng, second.guessLng, PROBES[0][0], PROBES[1][0]);
  const down = line(mercator(first.guessLat), mercator(second.guessLat), PROBES[0][1], PROBES[1][1]);
  const inside = (fraction) => Math.min(1 - MAP_MARGIN, Math.max(MAP_MARGIN, fraction));
  return ({ lng, lat }) => [inside(across.start + across.slope * lng), inside(down.start + down.slope * mercator(lat))];
}

/** The place the round on screen is showing, from the id of its picture. */
function placeShown(s, places) {
  const [id, lng, lat] = places.locations.find(([each]) => each === s.shown.at(-1).split('~')[0]);
  return { id, lng, lat };
}

/**
 * Plays the game on screen as someone who knows the places would: each pin near its place, a
 * little further off each round, so the scores are good and not all alike.
 */
async function playWell(s, whereOnMap, places, rounds = 3) {
  for (let round = 0; round < rounds; round += 1) {
    await roundReady(s.page);
    const place = placeShown(s, places);
    await playRound(s, ...whereOnMap({ lng: place.lng + 1.5 * round, lat: place.lat - round }));
    await button(s, round === rounds - 1 ? 'result.seeSummary' : 'result.next').click();
  }
  await summary(s).waitFor();
}

/** Waits until something this script keeps count of has happened. */
async function expectSoon(happened, page, withinMs = 10_000) {
  const deadline = Date.now() + withinMs;
  while (!happened()) {
    if (Date.now() > deadline) {
      throw new Error('Waited in vain for the next place to be shown');
    }
    await page.waitForTimeout(50);
  }
}

async function welcomeScenes(run) {
  await run.scene('welcome: a new visitor, the tutorial with its facts, the tutorial\'s end', { who: 'visitor', welcome: true, stored: { 'plonk.intro-seen': null } }, async (s) => {
    await s.capture('welcome-screen-show-me-how-or-skip', async () => {
      await visit(s, '/');
      await welcome(s).getByRole('button', { name: s.say('welcome.tutorial') }).waitFor();
    });
    await s.capture('tutorial-first-round-with-its-tip', async () => {
      await welcome(s).getByRole('button', { name: s.say('welcome.tutorial') }).click();
      await roundReady(s.page);
    });
    await s.capture('tutorial-result-with-its-fact-line-eiffel-tower', async () => {
      await playRound(s, 0.47, 0.3);
      await result(s).locator('.place-fact').waitFor();
    });
    await s.capture('tutorial-second-result-with-its-fact-line-colosseum', async () => {
      await button(s, 'result.next').click();
      await playRound(s, 0.5, 0.33);
      await result(s).locator('.place-fact').waitFor();
    });
    await s.capture('tutorial-end-singleplayer-daily-challenge-sign-up', async () => {
      await button(s, 'result.seeSummary').click();
      await summary(s).getByRole('button', { name: s.say('nav.item.daily') }).waitFor();
    });
  });

  await run.scene('welcome: skipped, the home screen with its how-to box', { who: 'visitor', welcome: true, stored: { 'plonk.intro-seen': null } }, async (s) => {
    await s.capture(
      'pane-singleplayer-after-skip-how-to-box-still-there',
      async () => {
        await visit(s, '/');
        await welcome(s).getByRole('button', { name: s.say('welcome.skip') }).click();
        await s.page.locator('.pane-title').waitFor();
      },
      FULL,
    );
  });

  await run.scene('tutorial replayed by a signed-in player: its end', {}, async (s) => {
    await s.capture('tutorial-end-signed-in-singleplayer-and-daily-challenge', async () => {
      await openPane(s, '/#account');
      await button(s, 'common.playTutorial').click();
      await playToSummary(s, 2);
    });
  });
}

async function streakScenes(run) {
  await run.scene('singleplayer: the country streak of ordinary play, kept and lost', { places: RUSSIA_ONLY, stored: { 'plonk.world-streak': FOUR_IN_A_ROW } }, async (s) => {
    await startChallenge(s, 't=0&mode=move');
    await s.capture('round-result-country-streak-of-five', async () => {
      await playRound(s, ...IN_RUSSIA);
      await result(s).locator('.streak-line', { hasText: s.say('result.streak', { count: 5 }) }).waitFor();
    });
    await s.capture('round-result-country-streak-ended-at-five', async () => {
      await button(s, 'result.next').click();
      await playRound(s, ...NOT_IN_RUSSIA);
      await result(s).locator('.streak-line', { hasText: s.say('result.streakEnded', { count: 5 }) }).waitFor();
    });
  });
}

async function hybridScenes(run) {
  await run.scene('pin map: hybrid, pictures with the street map\'s names and borders', {}, async (s) => {
    const type = (name) => s.page.getByRole('group', { name: s.say('guessMap.type') }).getByRole('button', { name: s.say(`guessMap.type.${name}`), exact: true });
    await startChallenge(s, 't=0&mode=move');
    await s.capture('round-pin-map-four-types-streets-chosen', () => openMap(s));
    await s.capture('round-pin-map-hybrid-with-its-two-credits', async () => {
      await type('hybrid').click();
      await s.page.locator('.map-panel[data-type="hybrid"] .map-credit').waitFor();
    });
    await s.capture('round-pin-map-hybrid-zoomed-in-names-over-the-pictures', async () => {
      for (let step = 0; step < 4; step += 1) {
        await button(s, 'guessMap.zoomIn').click();
      }
    });
    await s.capture('round-result-on-the-hybrid-map', async () => {
      await s.page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 150 } });
      await button(s, 'round.guess').click();
      await result(s).waitFor();
    });
  });
}

async function guesserScenes(run) {
  await run.scene('Country Guesser: six of the longest country names', { places: LONG_NAMES }, async (s) => {
    const panel = s.page.getByRole('region', { name: s.say('guesser.country.ask') });
    await openPane(s, '/#country');
    await button(s, 'singleplayer.start').click();
    await s.capture('country-guesser-round-long-country-names', async () => {
      await roundReady(s.page);
      await s.page.waitForFunction(() => document.querySelectorAll('.guesser-option:enabled').length === 6);
    });
    await s.capture('country-guesser-long-country-names-answered', async () => {
      await panel.locator('.guesser-option').nth(1).click();
      await s.page.locator('.play[data-phase="result"]').waitFor();
      await panel.getByRole('button', { name: s.say('result.next') }).waitFor();
    });
  });
}

/** A day on which enough others have finished for averages, and an account whose earlier dailies were all lower than `total`. */
function busyDay(daily, total) {
  const history = dailyHistoryUnder(total);
  daily.country = 'IN';
  daily.entries = dailyEntries(45);
  daily.history = history;
  daily.records = recordsOf(history);
  daily.streak = { current: 4, best: 9, atRisk: false };
}

async function dailyResultScenes(run) {
  await run.scene('daily result: each round against the day\'s average, a personal best', {}, async (s) => {
    const scores = [4800, 3950, 2500];
    busyDay(s.daily, scores.reduce((total, score) => total + score, 0));
    s.daily.save(scores);
    await panes(s, [['/#daily', 'pane-daily-done-personal-best-and-rounds-against-the-average']]);
    await s.capture('pane-daily-rounds-against-todays-average', () => bring(section(s, 'daily.average.title')));
  });

  await run.scene('daily game: the summary with a personal best and the averages', {}, async (s) => {
    busyDay(s.daily, 0);
    // whatever the game scores, the account's earlier dailies were a little lower
    await s.page.route('**/api/daily**', (route) => {
      if (s.daily.rounds !== null && s.daily.history.every((day) => (day.score ?? 0) === 0)) {
        s.daily.history = dailyHistoryUnder(s.daily.rounds.reduce((total, score) => total + score, 0));
      }
      return route.fallback();
    });
    const whereOnMap = await measurePinMap(s);
    await s.capture('daily-summary-personal-best-and-rounds-against-the-average', async () => {
      await openPane(s, '/#daily');
      await button(s, 'daily.play').click();
      await playWell(s, whereOnMap, PLACES_FIXTURE);
      await summary(s).locator('.daily-extras .daily-average-row').nth(2).waitFor();
    });
  });

  await run.scene('daily game: the site was updated under it, the result not saved, Reload', {}, async (s) => {
    busyDay(s.daily, 12_400);
    await openPane(s, '/#daily');
    await button(s, 'daily.play').click();
    await roundReady(s.page);
    // the server now holds another list of places, and today's three are others
    servePlaces(s.page, renamed(PLACES_FIXTURE));
    await s.capture('daily-summary-not-saved-site-updated-with-reload', async () => {
      await playToSummary(s);
      await summary(s).locator('.daily-stale').getByRole('button', { name: s.say('daily.stale.reload') }).waitFor();
    });
    await s.capture(
      'pane-daily-after-the-reload-attempt-used-result-lost',
      async () => {
        await Promise.all([s.page.waitForEvent('load'), summary(s).locator('.daily-stale').getByRole('button', { name: s.say('daily.stale.reload') }).click()]);
        await s.page.locator('.pane-title').waitFor();
        await s.page.getByText(s.say('daily.stale.spent')).waitFor();
      },
      FULL,
    );
  });

  await run.scene('visitor: a daily result kept before results could move to an account', { who: 'visitor' }, async (s) => {
    await s.page.addInitScript((value) => localStorage.setItem('plonk.daily', value), keptDaily(s.daily.date, [4800, 3950, 2500]));
    await panes(s, [['/#daily', 'pane-daily-signed-out-kept-result-that-cannot-be-claimed']]);
  });
}

async function saveNoteScenes(run) {
  await run.scene('save note: saved, and no XP added at the day\'s limit', {}, async (s) => {
    s.games.xpLeft = 0;
    await startChallenge(s, 't=0&mode=move');
    await s.capture('game-summary-saved-xp-limit-reached-no-xp-added', async () => {
      await playToSummary(s);
      await saveNote(s).filter({ hasText: s.say('save.xpCapped') }).waitFor();
    });
  });

  await run.scene('save note: a save the server refused, in its words', {}, async (s) => {
    await startChallenge(s, 't=0&mode=move');
    // the site is updated while the game is on: its places are no longer the server's
    await mockPlaces(s.page, renamed(PLACES_FIXTURE));
    await s.capture('game-summary-not-saved-refused-places-not-on-its-map', async () => {
      await playToSummary(s);
      await saveNote(s).filter({ hasText: s.say('save.placesChanged') }).waitFor();
    });
  });

  await run.scene('save note: a streak run refused as finished too soon', { places: RUSSIA_ONLY }, async (s) => {
    // far more than the two seconds a round of the real rule: the finish is refused, sent once more, and refused again
    s.games.roundMs = 60_000;
    const russia = s.say('streakPlay.guessCountry', { country: new Intl.DisplayNames([s.language], { type: 'region' }).of('RU') });
    /** Pins the first of the spots that is in a country the round wants, and guesses it. */
    const guessIn = async (spots, wanted) => {
      await roundReady(s.page);
      await openMap(s);
      const canvas = s.page.locator('.map-panel .maplibregl-canvas');
      const guessButton = s.page.locator('.map-panel .guess');
      const box = await canvas.boundingBox();
      for (const [across, down] of spots) {
        await canvas.click({ position: { x: box.width * across, y: box.height * down } });
        if ((await guessButton.isEnabled()) && wanted((await guessButton.textContent()) ?? '')) {
          return guessButton.click();
        }
      }
      throw new Error('No spot tried on the pin map was in a country the round wanted');
    };
    await openPane(s, '/#streak');
    await button(s, 'streak.start').click();
    await s.capture('streak-end-run-not-saved-finished-too-soon', async () => {
      const seen = s.shown.length;
      await guessIn([IN_RUSSIA], (label) => label === russia);
      // the next place follows by itself: its picture is asked for once the right answer has been said
      await expectSoon(() => s.shown.length > seen, s.page);
      await guessIn(ELSEWHERE, (label) => label !== russia);
      const over = s.page.getByRole('region', { name: s.say('streakPlay.overLabel') });
      await over.locator('.status-note[data-state="error"]').waitFor({ timeout: 20_000 });
    });
  });
}

export async function soloScenes6(run) {
  await welcomeScenes(run);
  await streakScenes(run);
  await hybridScenes(run);
  await guesserScenes(run);
  await dailyResultScenes(run);
  await saveNoteScenes(run);
}
