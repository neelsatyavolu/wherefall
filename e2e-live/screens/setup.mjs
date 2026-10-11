// What every group of screens is built from: a browser page with every outside service stood in
// for, the scene and capture that number and name the pictures, and the wait that lets a screen
// come to rest before it is photographed.
import { mkdirSync } from 'node:fs';
import { AccountServer } from '../../e2e/account-server.ts';
import { DailyServer } from '../../e2e/daily-server.ts';
import { PLACES_FIXTURE, mockPlaces, mockServices } from '../../e2e/fixtures.ts';
import { GamesServer } from '../../e2e/games-server.ts';
import { MapsServer } from '../../e2e/maps-server.ts';
import { FIVE_PLACES, MatchServer } from '../../e2e/match-server.ts';
import { SocialServer } from '../../e2e/social-server.ts';
import { de } from '../../src/i18n/de.ts';
import { en } from '../../src/i18n/en.ts';
import { es } from '../../src/i18n/es.ts';
import { fr } from '../../src/i18n/fr.ts';
import { ru } from '../../src/i18n/ru.ts';
import { RATING, SEASONED, countryOf, fillWorld, seasonedStats } from './world.mjs';

export const SIZES = [
  { name: 'desktop', width: 1360, height: 840 },
  { name: 'phone', width: 390, height: 800 },
];
export const SCHEMES = ['dark', 'light'];
export const CATALOGS = { en, es, fr, de, ru };
export const OTHER_LANGUAGES = ['es', 'fr', 'de', 'ru'];

/** how long one click, fill or wait may take: a step that cannot be done fails soon and the run goes on */
const ACTION_MS = 12_000;
/** the longest a screen is given to come to rest before its picture is taken anyway */
const SETTLE_CAP_MS = 8000;
/** how long nothing must be loading, and nothing changing, for a screen to count as at rest */
const NETWORK_QUIET_MS = 350;
const DOM_QUIET_MS = 250;
/** a map tile fades in over this long once it has loaded */
const TILE_FADE_MS = 320;
const POLL_MS = 50;
/** a page that grows when the screen does is measured again, this many times at most, and never made taller than this */
const GROW_PASSES = 3;
const MAX_PAGE_HEIGHT = 12_000;
/** tiles, pictures and fonts: what a screen is still drawing while any of them is on its way */
const DRAWN_FROM = /openfreemap\.org|eox\.at|opentopomap\.org|img\.plonk\.test|fonts\.(googleapis|gstatic)\.com/;

/** The tutorial's two landmarks (src/ui/tutorial.ts): the picture each round shows, and where it stands. */
const LANDMARKS = {
  '1d54c183-312a-42e4-bc9d-5c8d13354494': [2.2936527, 48.8594839],
  '20aae997-0c7b-4877-87cb-a42e155f2fb8': [12.491903, 41.890942],
};
/** One real street picture, shown for every place, so the views are not the tests' single grey pixel: the tutorial's first. */
const [STREET_ID] = Object.keys(LANDMARKS);
const pictureUrl = (id) => `https://api.panoramax.xyz/api/pictures/${id}/sd.jpg`;

const fetchPicture = (id) =>
  fetch(pictureUrl(id))
    .then(async (reply) => (reply.ok ? Buffer.from(await reply.arrayBuffer()) : null))
    .catch(() => null);

/**
 * The real pictures the review shows: the one every place gets, and the tutorial's landmarks each
 * with their own, so a result that tells a fact about the Colosseum is not under a view of Paris.
 */
export async function fetchStreetPicture() {
  const fetched = await Promise.all(Object.keys(LANDMARKS).map(async (id) => [id, await fetchPicture(id)]));
  const landmarks = Object.fromEntries(fetched.filter(([, picture]) => picture !== null));
  const picture = landmarks[STREET_ID] ?? null;
  if (!picture) {
    console.log('The street picture could not be fetched: the views will be blank.');
  }
  return picture && { picture, landmarks };
}

/** The words of a language by key, with values put in their `{places}`. A key the catalog lacks is a mistake in this script. */
export function sayIn(code) {
  const catalog = CATALOGS[code];
  return (key, params = {}) => {
    const template = catalog[key];
    if (template === undefined) {
      throw new Error(`No such catalog key: ${key}`);
    }
    return template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
  };
}

// the account the review is signed in to, and its rating, are the world's: every screen gets the same numbers
export { RATING, SEASONED };
export const GUEST_NAME = 'Guest #4821';

/** A street picture as Panoramax describes one, standing at a point of the map. */
function pictureAt(id, [lng, lat]) {
  const point = (north) => ({ type: 'Point', coordinates: [lng, lat + north] });
  return {
    id,
    collection: `seq-of-${id.split('~')[0]}`,
    geometry: point(0),
    properties: {
      license: 'CC-BY-SA-4.0',
      'view:azimuth': 0,
      'geovisio:producer': 'e2e fixture',
      'pers:interior_orientation': { field_of_view: 360 },
      'tiles:tile_matrix_sets': { geovisio: { tileMatrix: [{ tileWidth: 512, tileHeight: 512, matrixWidth: 4, matrixHeight: 2 }] } },
    },
    assets: { hd: { href: `https://img.plonk.test/${id}/hd.jpg` }, sd: { href: `https://img.plonk.test/${id}/sd.jpg` } },
    asset_templates: { tiles: { href: `https://img.plonk.test/${id}/tiled/{TileCol}_{TileRow}.jpg` } },
    links: [
      { rel: 'license', href: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      { rel: 'next', id: `${id}~n`, geometry: point(0.0001) },
      { rel: 'prev', id: `${id}~p`, geometry: point(-0.0001) },
    ],
  };
}

/**
 * Puts each place's picture where the place is, so a result's map shows the country its panel
 * names (the tests' own stand-in has every picture in Paris). Setting `at` on what it returns puts
 * every picture from then on at that one point.
 */
async function mockPictures(page, places) {
  const spots = new Map([...places.locations.map(([id, lng, lat]) => [id, [lng, lat]]), ...FIVE_PLACES.map(({ id, lng, lat }) => [id, [lng, lat]]), ...Object.entries(LANDMARKS)]);
  const pictures = { at: null };
  await page.route('https://api.panoramax.xyz/api/search**', async (route) => {
    const id = new URL(route.request().url()).searchParams.get('ids');
    const spot = pictures.at ?? spots.get((id ?? '').split('~')[0]);
    // a place this script does not know keeps the stand-in the tests give it
    await (id && spot ? route.fulfill({ json: { features: [pictureAt(id, spot)] } }) : route.fallback());
  });
  return pictures;
}

/** Counts the tiles, pictures and fonts a page is still waiting for. */
function watchLoading(page) {
  const pending = new Set();
  page.on('request', (request) => {
    if (DRAWN_FROM.test(request.url())) {
      pending.add(request);
    }
  });
  const done = (request) => pending.delete(request);
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return () => pending.size;
}

/**
 * Waits for a screen to come to rest: its tiles, pictures and fonts in, its transitions and
 * one-off animations over, and nothing in it changing. A clock that ticks once a second leaves
 * room for that; a screen that never rests is photographed as it is when the cap runs out.
 */
export async function settle(page, loading) {
  const deadline = Date.now() + SETTLE_CAP_MS;
  let quietSince = null;
  while (Date.now() < deadline) {
    quietSince = loading() === 0 ? (quietSince ?? Date.now()) : null;
    if (quietSince !== null && Date.now() - quietSince >= NETWORK_QUIET_MS) {
      break;
    }
    await page.waitForTimeout(POLL_MS);
  }
  await page.evaluate(
    async ({ capMs, quietMs, fadeMs, pollMs }) => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const oneOff = document.getAnimations().filter((animation) => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity));
      await Promise.race([Promise.allSettled([document.fonts.ready, ...oneOff.map((animation) => animation.finished)]), wait(capMs)]);
      // at rest when what is written on the screen, and where the pins are, has stopped changing;
      // a clock is rewritten several times a second with the same words, which is not a change
      const look = () => document.body.innerText + [...document.querySelectorAll('.maplibregl-marker')].map((marker) => marker.style.transform).join();
      const end = performance.now() + capMs;
      let last = look();
      let since = performance.now();
      while (performance.now() - since < quietMs && performance.now() < end) {
        await wait(pollMs);
        const now = look();
        if (now !== last) {
          last = now;
          since = performance.now();
        }
      }
      // a map's tiles fade in after they have loaded
      await wait(document.querySelector('.maplibregl-canvas') ? fadeMs : 0);
    },
    { capMs: Math.max(500, deadline - Date.now()), quietMs: DOM_QUIET_MS, fadeMs: TILE_FADE_MS, pollMs: POLL_MS },
  );
}

/**
 * Makes the screen as tall as the page, for a picture of a whole pane. A picture taken past the
 * end of a screen of the usual height has whatever is fixed to the bottom of the screen (a phone's
 * Start button) drawn across the middle of the pane; on a screen as tall as the page it is at the
 * end, where a player who scrolls down finds it.
 */
async function showWholePage(page, size) {
  for (let pass = 0; pass < GROW_PASSES; pass += 1) {
    const height = Math.min(MAX_PAGE_HEIGHT, await page.evaluate(() => document.documentElement.scrollHeight));
    if (height <= page.viewportSize().height) {
      return;
    }
    await page.setViewportSize({ width: size.width, height });
  }
}

/**
 * A page with every outside service stood in for, and the stand-in servers behind it.
 * `who` is the session the browser holds: the account "neel", a guest, or nobody.
 */
async function open(run, options) {
  const { size, scheme } = run;
  const { who = 'account', places = PLACES_FIXTURE, stored = {}, welcome = false } = options;
  const context = await run.browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_MS);
  // the dev server tells its pages to reload whenever a source file is saved: these pages do not listen
  await page.routeWebSocket(/.*/, () => undefined);
  // a browser that has been here before, unless the scene is of the welcome a new visitor gets
  await mockServices(page, { welcome: welcome ? 'show' : 'seen' });
  // real fonts and real map tiles: the review is of what players see
  await page.unroute(/fonts\.(googleapis|gstatic)\.com/);
  await page.unroute('https://tiles.openfreemap.org/**');
  const shown = await showStreet(page, run.street);
  await mockPlaces(page, places);
  const pictures = await mockPictures(page, places);
  const servers = await installServers(page, who, options);
  // the first-visit note is its own picture; everywhere else it would only be in the way
  await storeBeforeLoad(page, { 'plonk.intro-seen': '1', ...(run.language === 'en' ? {} : { 'plonk.language': run.language }), ...stored });
  return { context, page, ...servers, shown, pictures, loading: watchLoading(page) };
}

/**
 * Shows the one real street picture for every place. Resolves to the list it keeps of the places
 * whose picture was asked for, in order: the last is the place the round on screen is showing.
 */
async function showStreet(page, street) {
  const shown = [];
  await page.route('https://img.plonk.test/**', (route) => {
    const [, id, file] = new URL(route.request().url()).pathname.split('/');
    if (file !== 'sd.jpg') {
      return street ? route.abort() : route.fallback();
    }
    const shownId = decodeURIComponent(id);
    shown.push(shownId);
    // a landmark of the tutorial has its own picture; a step along its street is still that street
    const body = street && (street.landmarks[shownId.split('~')[0]] ?? street.picture);
    return body ? route.fulfill({ body, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' } }) : route.fallback();
  });
  return shown;
}

/** The stand-in servers, all told the same thing about who is asking. */
async function installServers(page, who, { account: change = SEASONED, rating = RATING }) {
  const session = who === 'account' ? 'account' : who === 'guest' ? 'guest' : 'none';
  const account = await AccountServer.install(page, who === 'account' ? 'neel' : null, rating, change);
  const match = await MatchServer.install(page);
  const social = await SocialServer.install(page);
  const maps = await MapsServer.install(page);
  const daily = await DailyServer.install(page, session);
  const games = await GamesServer.install(page, daily);
  for (const server of [match, social, maps, games]) {
    server.session = session;
  }
  // one world for every scene: the profiles, the boards and the account all describe the same players
  fillWorld(social);
  daily.entries = daily.entries.map((entry) => ({ ...entry, country: countryOf(entry.username) ?? entry.country }));
  if (account.state.stats) {
    account.state = { ...account.state, stats: seasonedStats(account.state.stats) };
  }
  if (who === 'guest') {
    account.becomeGuest(GUEST_NAME);
    match.state = { ...match.state, you: { ...match.state.you, username: GUEST_NAME, guest: true, isHost: false, isResolver: false } };
  }
  return { account, match, social, maps, daily, games };
}

/** Puts entries in the browser's storage before the app reads it. One whose value is null is left out; one already stored is kept. */
async function storeBeforeLoad(page, entries) {
  await page.addInitScript((given) => {
    // a blank page has no storage to write to
    if (location.protocol === 'about:') {
      return;
    }
    for (const [key, value] of Object.entries(given)) {
      if (value !== null && localStorage.getItem(key) === null) {
        localStorage.setItem(key, value);
      }
    }
  }, entries);
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
/** What failed, in a line; with SCREENS_DEBUG set, the whole error with what the step was waiting for. */
const firstLine = (error) => (process.env.SCREENS_DEBUG ? String(error) : String(error).split('\n')[0]);

/**
 * Takes one picture of the page as it is once `prepare` has run. `fullPage` shows the whole pane;
 * `still: false` takes it at once, for something caught in motion.
 */
async function takePicture({ page, loading }, size, path, prepare, { fullPage = false, still = true } = {}) {
  try {
    await prepare?.();
    if (fullPage) {
      await showWholePage(page, size);
    }
    if (still) {
      await settle(page, loading);
    }
    await page.screenshot({ path, fullPage });
  } finally {
    if (fullPage) {
      await page.setViewportSize({ width: size.width, height: size.height }).catch(() => undefined);
    }
  }
}

/** Shoots a scene once, and says how many pictures it wrote and what failed. `named` is the folder, and what each file name starts with. */
async function shoot(run, named, title, options, body) {
  const failed = [];
  const fail = (what, error) => failed.push(`${what}: ${firstLine(error)}`);
  let written = 0;
  let taken = 0;
  let opened = null;
  try {
    opened = await open(run, options);
    /** A picture. Its letter is taken before it is prepared, so one that fails leaves the names of the rest as they were. */
    const capture = async (name, prepare, how) => {
      const file = `${named.start}${LETTERS[taken] ?? `z${taken}`}-${name}.png`;
      taken += 1;
      return takePicture(opened, run.size, `${named.dir}/${file}`, prepare, how).then(
        () => {
          written += 1;
          return true;
        },
        (error) => {
          fail(file, error);
          return false;
        },
      );
    };
    await body({ ...opened, capture, say: run.say, phone: run.phone, origin: run.origin, size: run.size, language: run.language });
  } catch (error) {
    fail(`${named.start} ${title}`, error);
  } finally {
    await opened?.context.close();
  }
  return { written, failed };
}

/**
 * One folder of pictures: a size, a scheme and a language. Its scenes are numbered in the order
 * they are written, whether or not they are shot, and the pictures of a scene are lettered, so a
 * picture has the same name in every folder and on every run.
 */
export function makeRun({ browser, origin, out, folder, size, scheme, language = 'en', prefix = '', street, filter, failures }) {
  const dir = `${out}/${folder}`;
  mkdirSync(dir, { recursive: true });
  const run = { browser, origin, size, scheme, language, street, phone: size.name === 'phone', say: sayIn(language), written: 0, scenes: 0 };

  /**
   * A scene: a fresh browser page and fresh servers, then a few pictures. `options.only` keeps it
   * to one size. A scene in which anything fails is shot once more from the start; what fails
   * again is noted, and the run goes on.
   */
  run.scene = async (title, options, body) => {
    run.scenes += 1;
    const named = { dir, start: `${prefix}${String(run.scenes).padStart(2, '0')}` };
    if ((options.only && options.only !== size.name) || (filter && !filter.test(title))) {
      return;
    }
    let shot = await shoot(run, named, title, options, body);
    if (shot.failed.length > 0) {
      console.log(`${folder} ${named.start} ${title}: shot again after ${shot.failed.length} failed`);
      shot = await shoot(run, named, title, options, body);
    }
    run.written += shot.written;
    failures.push(...shot.failed.map((failure) => `${folder} ${failure}`));
  };
  return run;
}

// --- what scenes do again and again ------------------------------------------------------------------

/** Opens an address of the app. A blank page first, so an address that differs only in its hash still loads afresh. */
export async function visit(s, address) {
  await s.page.goto('about:blank');
  await s.page.goto(`${s.origin}${address}`);
}

/** Opens a pane of the home screen and waits for its title. */
export async function openPane(s, address) {
  await visit(s, address);
  await s.page.locator('.pane-title').waitFor();
}

/** A round is on screen, its view has loaded, and (in a match) its start has passed. */
export const roundReady = (page) =>
  page.waitForFunction(() => document.querySelector('.play')?.getAttribute('data-phase') === 'guessing' && (document.querySelector('.status')?.textContent ?? '') === '', null, { timeout: 30_000 });

export const button = (s, key, params) => s.page.getByRole('button', { name: s.say(key, params), exact: true });
export const radio = (s, key, params) => s.page.getByRole('radio', { name: s.say(key, params), exact: true });
export const section = (s, key, params) => s.page.getByRole('region', { name: s.say(key, params), exact: true });
/** The line a control keeps for what was refused, once it says something. */
export const refusal = (within) => within.getByRole('alert').filter({ hasText: /\S/ }).first();
/** Brings a part of a long pane to the middle of the screen. */
export const bring = (locator) => locator.evaluate((node) => node.scrollIntoView({ block: 'center' }));
/** Runs a function of `e2e/maps-harness.ts` in the page: the editor and the map page with stand-ins for Google. */
export const harness = (s, call) => s.page.evaluate(`import('/e2e/maps-harness.ts').then((harness) => harness.${call})`);

/** One picture of each pane in a list, each opened afresh and shown whole. */
export async function panes(s, list) {
  for (const [address, name, before] of list) {
    await s.capture(
      name,
      async () => {
        await openPane(s, address);
        await before?.();
      },
      { fullPage: true },
    );
  }
}

/**
 * The account's session ends from somewhere else (its password was changed in another browser,
 * say): from the next request on, every stand-in answers this browser as it answers a visitor.
 */
export function endSessionElsewhere(s) {
  s.account.endedElsewhere();
  for (const server of [s.social, s.games, s.maps, s.match, s.daily]) {
    server.session = 'none';
  }
}

/** The button that opens the menu on a phone. Its name starts with the pane that is open. */
export const menuButton = (s) => s.page.getByRole('button', { name: s.say('home.menu') });

/** Opens the pin map: a button on a phone, the pointer over it on a wider screen. */
export async function openMap(s) {
  const panel = s.page.locator('.map-panel');
  if (s.phone) {
    if (!(await panel.isVisible())) {
      await button(s, 'round.openMap').click();
    }
  } else {
    await panel.hover();
  }
  await panel.locator('.maplibregl-canvas').waitFor();
  await settle(s.page, s.loading);
}

/** Takes the pointer off the pin map, or closes it on a phone, as a player looking back at the street does. */
export async function leaveMap(s) {
  if (s.phone) {
    const close = button(s, 'round.closeMap');
    if (await close.isVisible()) {
      await close.click();
    }
    return;
  }
  // the map stays open while the pointer is on it or one of its buttons has the focus
  await s.page.locator('.hud').hover();
  await s.page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
}

/** Puts the pin on the map, at a place given as fractions of the map's width and height. */
export async function placePin(s, across = 0.42, down = 0.45) {
  await openMap(s);
  const canvas = s.page.locator('.map-panel .maplibregl-canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * across, y: box.height * down } });
}

export async function guess(s, across, down) {
  await placePin(s, across, down);
  await button(s, 'round.guess').click();
}

/** A challenge link's game: the same three places every time. `query` sets the time and the mode. */
export const challenge = (query = 't=60&mode=move') => `/?map=world&seed=e2e00001&${query}&n=3`;

export async function startChallenge(s, query) {
  await visit(s, challenge(query));
  await button(s, 'singleplayer.playChallenge').click();
  await roundReady(s.page);
}

/** Plays a round of a game alone through to its result. */
export async function playRound(s, across, down) {
  await roundReady(s.page);
  await guess(s, across, down);
  await s.page.locator('.play[data-phase="result"]').waitFor();
}

/** Puts the page's player in a match, lobby or round, by way of the home screen's Rejoin. */
export async function enterMatch(s, state, round = null) {
  s.match.state = state;
  if (round !== null) {
    s.match.startRound(round);
  }
  s.match.matchFound(state.id);
  await visit(s, '/');
  await button(s, 'home.resume.rejoin').click();
}

/** Asks to kick a player from their row: on a narrow row the two actions are behind the row's own button. */
export async function askToKick(s, row, name) {
  const kick = row.getByRole('button', { name: s.say('host.kickLabel', { name }), exact: true });
  if (!(await kick.isVisible())) {
    await row.getByRole('button', { name: s.say('host.moreLabel', { name }), exact: true }).click();
  }
  await kick.click();
}

/** The panels of a match and the title of a party's lobby. */
export const roundResult = (s) => s.page.getByRole('region', { name: s.say('match.roundResult') });
export const finalStanding = (s) => s.page.getByRole('region', { name: s.say('match.finalStanding') });
export const lobbyTitle = (s) => s.page.getByRole('heading', { name: s.say('lobby.title'), exact: true });
