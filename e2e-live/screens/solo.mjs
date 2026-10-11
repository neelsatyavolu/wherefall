// Games played alone: a singleplayer game from its first round to its summary, the round screen's
// timer and pin map in each of their states, the country streak, the two guessers and the daily.
import { PLACES_FIXTURE, RUSSIA_ONLY } from '../../e2e/fixtures.ts';
import { button, guess, leaveMap, openMap, openPane, placePin, playRound, roundReady, settle, startChallenge, visit } from './setup.mjs';

/** forty-five places within a few streets of Notre-Dame: a country map that opens at street level */
const PARIS_STREETS = { version: 1, regions: { FR: 'europe' }, locations: Array.from({ length: 45 }, (_, i) => [`fr-${i}`, 2.3445 + (i % 9) * 0.0008, 48.8525 + Math.floor(i / 9) * 0.0006, 'FR']) };
const GUESSER_ROUNDS = 10;
/** the continent each country of the stand-in places is on, as the catalog keys name it */
const CONTINENT_OF = { RU: 'europe', KE: 'africa', JP: 'asia' };
/** how many presses of Zoom in take the pin map from the whole world to streets */
const ZOOMS_TO_STREETS = 10;
/** how far into its flight the confetti is photographed */
const CONFETTI_MID_FLIGHT_MS = 450;
/** where on the pin map to try for a country, as fractions of its width and height: the likeliest first */
const GRID = [0.22, 0.28, 0.34, 0.16, 0.4, 0.5, 0.6, 0.7, 0.1].flatMap((down) => [0.7, 0.78, 0.62, 0.55, 0.86, 0.45, 0.35, 0.25].map((across) => [across, down]));
/** how long a spot of the pin map is given to take a click before it is taken to be under one of the map's buttons */
const SPOT_MS = 1500;

const result = (s) => s.page.getByRole('region', { name: s.say('result.label') });
const summary = (s) => s.page.getByRole('region', { name: s.say('summary.label') });
const countryIn = (s, code) => new Intl.DisplayNames([s.language], { type: 'region' }).of(code);
/** the country of the place a round is showing, from the id of its picture */
const countryShown = (s) => s.shown.at(-1).split('-')[0].toUpperCase();

/** Zooms far in on the middle of the pin map, pins it and guesses. */
async function guessTheMiddle(s) {
  await openMap(s);
  for (let step = 0; step < ZOOMS_TO_STREETS; step += 1) {
    await button(s, 'guessMap.zoomIn').click();
    await settle(s.page, s.loading);
  }
  await placePin(s, 0.5, 0.5);
  await button(s, 'round.guess').click();
  await s.page.locator('.play[data-phase="result"]').waitFor();
}

/** Plays the two rounds after the first with any guess, through to the summary. */
async function finishGame(s) {
  for (const next of ['result.next', 'result.next']) {
    await button(s, next).click();
    await playRound(s);
  }
  await button(s, 'result.seeSummary').click();
  await summary(s).waitFor();
}

/**
 * Where the middle of the zoomed-in pin map is, as longitude and latitude. It depends on the
 * screen and on how the map is laid out, so it is found by playing: a game whose first guess is
 * the middle of the map is saved with where that guess was.
 */
async function middleOfTheMap(s) {
  await startChallenge(s, 't=0&mode=move');
  await guessTheMiddle(s);
  await finishGame(s);
  await s.page.waitForFunction(() => (document.querySelector('.save-note')?.textContent ?? '') !== '');
  const [first] = s.games.saved.at(-1).rounds;
  return [first.guessLng, first.guessLat];
}

/** Moves the pin about the map until the guess button reads as `wanted` says it should. */
async function pinWhere(s, wanted) {
  await openMap(s);
  const canvas = s.page.locator('.map-panel .maplibregl-canvas');
  const label = s.page.locator('.map-panel .guess');
  const box = await canvas.boundingBox();
  for (const [across, down] of GRID) {
    // a spot under one of the map's own buttons cannot be clicked: the next is tried
    const clicked = await canvas.click({ position: { x: box.width * across, y: box.height * down }, timeout: SPOT_MS }).then(
      () => true,
      () => false,
    );
    if (clicked && wanted((await label.textContent()) ?? '')) {
      return;
    }
  }
  throw new Error('No spot on the pin map gave the guess button the country wanted');
}

async function gameScenes(run) {
  await run.scene('singleplayer game: round, hint, pin, leave dialog, result, summary', {}, async (s) => {
    await startChallenge(s);
    await s.capture('round-map-closed-two-hints-left');
    await s.capture('round-map-open-hint-shown-pin-placed', async () => {
      await button(s, 'round.hintLeft.other', { count: 2 }).click();
      await placePin(s);
    });
    await s.capture('confirm-dialog-leave-game', async () => {
      await button(s, 'round.exit').click();
      await s.page.getByRole('dialog').waitFor();
    });
    await s.capture('round-result-with-hint-flag-and-google-maps-link', async () => {
      await button(s, 'play.keepPlaying').click();
      await button(s, 'round.guess').click();
      await result(s).waitFor();
    });
    await s.capture('round-two-one-hint-left', async () => {
      await button(s, 'result.next').click();
      await roundReady(s.page);
    });
    await s.capture('game-summary-with-stars-time-and-xp', async () => {
      await playRound(s, 0.6, 0.4);
      await button(s, 'result.next').click();
      await playRound(s, 0.3, 0.6);
      await button(s, 'result.seeSummary').click();
      await summary(s).waitFor();
    });
    await s.capture('game-summary-after-share-result', async () => {
      await summary(s).getByRole('button', { name: s.say('summary.shareResult') }).click();
      await summary(s).getByRole('button', { name: s.say('summary.resultCopied') }).or(summary(s).getByRole('textbox', { name: s.say('summary.resultLabel') })).first().waitFor();
    });
  });

  await run.scene('round timer: warn, urgent, time ran out', {}, async (s) => {
    const clock = (state) => s.page.locator(`.hud-cell.${state}`).waitFor();
    await startChallenge(s, 't=10&mode=move');
    // the clock is running: each picture is taken as soon as its state is reached
    await s.capture('round-timer-warn-under-ten-seconds', () => clock('warn'), { still: false });
    await s.capture('round-timer-urgent-under-five-seconds', () => clock('urgent'), { still: false });
    await s.capture('round-result-time-ran-out-no-pin', () => result(s).waitFor());
  });

}

async function pinMapScenes(run) {
  await run.scene('pin map: three sizes, kept open, full screen', { only: 'desktop' }, async (s) => {
    const full = button(s, 'guessMap.fullScreen');
    const pressed = (control) => control.and(s.page.locator('[aria-pressed="true"]')).waitFor();
    await startChallenge(s, 't=0&mode=no-move');
    for (const size of ['small', 'medium', 'large']) {
      await s.capture(`round-pin-map-${size}`, async () => {
        await openMap(s);
        await button(s, `guessMap.size.${size}`).click();
        await placePin(s);
      });
    }
    await s.capture('round-pin-map-kept-open-pointer-away', async () => {
      await button(s, 'guessMap.size.medium').click();
      await button(s, 'guessMap.keepOpen').click();
      await pressed(button(s, 'guessMap.keepOpen'));
      await leaveMap(s);
    });
    await s.capture('round-pin-map-full-screen', async () => {
      await openMap(s);
      await full.click();
      await pressed(full);
    });
    await s.capture('round-pin-map-closed-pointer-away', async () => {
      await full.click();
      await button(s, 'guessMap.keepOpen').click();
      await leaveMap(s);
    });
  });

  await run.scene('pin map: streets, satellite, terrain', {}, async (s) => {
    const type = (name) => s.page.getByRole('group', { name: s.say('guessMap.type') }).getByRole('button', { name: s.say(`guessMap.type.${name}`) });
    await startChallenge(s, 't=0&mode=move');
    await s.capture('round-pin-map-streets', () => placePin(s));
    for (const name of ['satellite', 'terrain']) {
      await s.capture(`round-pin-map-${name}-with-its-credit`, async () => {
        await openMap(s);
        await type(name).click();
        await s.page.locator('.map-credit').waitFor();
      });
    }
    await s.capture('round-result-on-the-terrain-map', async () => {
      await button(s, 'round.guess').click();
      await result(s).waitFor();
    });
  });

}

async function streetLevelScenes(run) {
  await run.scene('pin map at street level, road names hidden then shown', { places: PARIS_STREETS }, async (s) => {
    const start = async () => {
      await visit(s, '/');
      await s.page.getByRole('radio', { name: s.say('picker.aCountry') }).check();
      await button(s, 'singleplayer.start').click();
      await roundReady(s.page);
      if (!s.phone) {
        await openMap(s);
        await button(s, 'guessMap.size.large').click();
      }
      await placePin(s, 0.5, 0.55);
    };
    await s.capture('round-map-open-at-street-level-road-names-hidden', start);
    await s.capture('round-map-open-at-street-level-road-names-shown', async () => {
      await s.page.evaluate(() => localStorage.setItem('plonk.road-names', '1'));
      await start();
    });
  });

}

async function perfectScenes(run) {
  await run.scene('a perfect round', {}, async (s) => {
    s.pictures.at = await middleOfTheMap(s);
    await startChallenge(s, 't=0&mode=move');
    // caught in the air: the burst is over in little more than a second
    await s.capture(
      'round-result-perfect-with-confetti',
      async () => {
        await guessTheMiddle(s);
        await s.page.locator('.confetti .confetti-piece').first().waitFor();
        await s.page.waitForTimeout(CONFETTI_MID_FLIGHT_MS);
      },
      { still: false },
    );
    await s.capture('round-result-perfect', () => result(s).waitFor());
    await s.capture('game-summary-after-a-perfect-round', () => finishGame(s));
  });

}

async function tutorialScenes(run) {
  await run.scene('tutorial', {}, async (s) => {
    await s.capture('tutorial-coach-mark', async () => {
      await openPane(s, '/#account');
      await button(s, 'common.playTutorial').click();
      await roundReady(s.page);
    });
  });
}

async function errorScenes(run) {
  await run.scene('errors: a view that will not load', {}, async (s) => {
    await s.page.route('https://img.plonk.test/**/sd.jpg', (route) => route.abort());
    await s.capture('state-error-view-would-not-load-with-skip', async () => {
      await visit(s, '/?map=world&seed=e2e00001&t=60&mode=move&n=3');
      await button(s, 'singleplayer.playChallenge').click();
      await s.page.getByRole('alert').filter({ hasText: /\S/ }).first().waitFor();
    });
  });

  await run.scene('errors: a game that cannot be loaded', {}, async (s) => {
    await s.page.route('**/locations.json', (route) => route.abort());
    await s.capture('state-error-game-could-not-be-loaded', async () => {
      await visit(s, '/');
      await button(s, 'singleplayer.start').click();
      await s.page.getByText(s.say('load.failed')).waitFor();
    });
  });
}

async function streakScenes(run) {
  await run.scene('country streak: a round, a right country, the end', { places: RUSSIA_ONLY }, async (s) => {
    const russia = countryIn(s, 'RU');
    const names = (country) => s.say('streakPlay.guessCountry', { country });
    await openPane(s, '/#streak');
    await button(s, 'streak.start').click();
    await roundReady(s.page);
    await s.capture('streak-round-country-named-on-the-button', () => pinWhere(s, (label) => label === names(russia)));
    // the next place follows by itself: the right answer is on screen only for a moment
    await s.capture(
      'streak-right-country',
      async () => {
        await s.page.locator('.map-panel .guess').click();
        await s.page.getByText(s.say('streakPlay.correctCountry', { country: russia })).waitFor();
      },
      { still: false },
    );
    await s.capture('streak-end-wrong-country', async () => {
      await roundReady(s.page);
      const guessIt = s.say('streakPlay.guessCountry', { country: '' }).trim();
      await pinWhere(s, (label) => label.includes(guessIt) && label !== names(russia));
      await s.page.locator('.map-panel .guess').click();
      await s.page.getByRole('region', { name: s.say('streakPlay.overLabel') }).waitFor();
    });
  });
}

/** One run of a guesser: its six buttons, a wrong answer, a right one, and the end. */
async function guesserRun(s, kind, optionFor) {
  const panel = s.page.getByRole('region', { name: s.say(`guesser.${kind}.ask`) });
  const options = panel.locator('.guesser-option');
  const ready = async () => {
    await options.nth(5).waitFor();
    await s.page.waitForFunction(() => (document.querySelector('.status')?.textContent ?? '') === '' && document.querySelectorAll('.guesser-option:enabled').length === 6);
  };
  const names = () => panel.locator('.guesser-name').allTextContents();
  const pick = async (right) => {
    const answer = optionFor(countryShown(s));
    const all = await names();
    const index = right ? all.indexOf(answer) : all.findIndex((name) => name !== answer);
    if (index < 0) {
      throw new Error(`"${answer}" is not among the six answers: ${all.join(', ')}`);
    }
    await options.nth(index).click();
    await panel.getByRole('status').filter({ hasText: /\S/ }).waitFor();
  };
  const next = (last = false) => panel.getByRole('button', { name: s.say(last ? 'result.seeSummary' : 'result.next') }).click();

  await openPane(s, `/#${kind}`);
  await button(s, 'singleplayer.start').click();
  await s.capture(`${kind}-guesser-round-with-its-six-buttons`, ready);
  await s.capture(`${kind}-guesser-round-answered-wrong`, () => pick(false));
  await s.capture(`${kind}-guesser-round-answered-right`, async () => {
    await next();
    await ready();
    await pick(true);
  });
  await s.capture(`${kind}-guesser-end-with-every-round`, async () => {
    for (let round = 3; round <= GUESSER_ROUNDS; round += 1) {
      await next();
      await ready();
      await pick(round % 3 !== 0);
    }
    await next(true);
    await summary(s).waitFor();
  });
}

async function guesserScenes(run) {
  await run.scene('Country Guesser: six buttons, answered, the end', { places: PLACES_FIXTURE }, async (s) => {
    await guesserRun(s, 'country', (code) => countryIn(s, code));
  });
  await run.scene('Continent Guesser: six buttons, answered, the end', { places: PLACES_FIXTURE }, async (s) => {
    await guesserRun(s, 'continent', (code) => s.say(`continent.${CONTINENT_OF[code]}`));
  });
}

async function dailyGameScenes(run) {
  await run.scene('daily game: a round with no hint, the leave warning, the summary', {}, async (s) => {
    await openPane(s, '/#daily');
    await s.capture('daily-round-no-hint', async () => {
      await button(s, 'daily.play').click();
      await roundReady(s.page);
    });
    await s.capture('daily-leave-dialog-the-attempt-is-used', async () => {
      await button(s, 'round.exit').click();
      await s.page.getByRole('dialog').waitFor();
    });
    await s.capture('daily-summary-on-the-leaderboard-with-share', async () => {
      await button(s, 'play.keepPlaying').click();
      for (const next of ['result.next', 'result.next', 'result.seeSummary']) {
        await guess(s, 0.45, 0.4);
        await button(s, next).click();
        if (next === 'result.next') {
          await roundReady(s.page);
        }
      }
      await summary(s).locator('.save-note').filter({ hasText: /\S/ }).waitFor();
    });
    await s.capture('pane-daily-done-after-playing', async () => {
      await summary(s).getByRole('button', { name: s.say('common.home') }).click();
      await openPane(s, '/#daily');
    }, { fullPage: true });
  });
}

export async function soloScenes(run) {
  await gameScenes(run);
  await pinMapScenes(run);
  await streetLevelScenes(run);
  await perfectScenes(run);
  await tutorialScenes(run);
  await errorScenes(run);
  await streakScenes(run);
  await guesserScenes(run);
  await dailyGameScenes(run);
}
