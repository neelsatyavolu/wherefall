// Writes a review set: a PNG of every screen and state, at desktop and phone size, dark and light.
// Not part of the test suite. The API is stood in for by the same mock servers the browser tests
// use, so it runs against a plain dev server; map tiles, fonts and one street picture are the real ones.
//
//   node e2e-live/screens.mjs http://localhost:5184 /path/to/output/dir [folder]
//
// One folder per size and scheme (desktop-dark, desktop-light, phone-dark, phone-light), and a file
// per screen whose name says what it is. A fifth folder, languages, has the main screens of each
// other language on a phone. Naming a folder as a third argument writes only that one.
//
// A picture's name starts with the number of its scene and a letter, the same in every folder and
// on every run. A scene or a picture that fails does not stop the run: it is listed at the end.
// To shoot only some scenes, set SCREENS_ONLY to a pattern their titles are matched against
// (titles are the first argument of each `scene(...)` in e2e-live/screens/).
import { chromium } from '@playwright/test';
import { friendsList } from './screens/data.mjs';
import { languageScenes } from './screens/languages.mjs';
import { onlineScenes } from './screens/online.mjs';
import { onlineScenes6 } from './screens/online6.mjs';
import { paneScenes } from './screens/panes.mjs';
import { paneScenes6 } from './screens/panes6.mjs';
import { OTHER_LANGUAGES, SCHEMES, SIZES, fetchStreetPicture, makeRun } from './screens/setup.mjs';
import { soloScenes } from './screens/solo.mjs';
import { soloScenes6 } from './screens/solo6.mjs';
import { worldProblems } from './screens/world.mjs';

const [base, out, only] = process.argv.slice(2);
if (!base || !out || !/^https?:\/\//.test(base)) {
  console.error('Usage: node e2e-live/screens.mjs <base URL> <output directory> [folder]');
  process.exit(2);
}
const origin = base.replace(/\/+$/, '');
// numbers that disagree on one screen (a stat cell and its chart, a board and a profile) make the pictures worthless to a reviewer
const unsound = worldProblems(friendsList().friends);
if (unsound.length > 0) {
  console.error(`The review set's data contradicts itself:\n${unsound.join('\n')}`);
  process.exit(2);
}
const filter = process.env.SCREENS_ONLY ? new RegExp(process.env.SCREENS_ONLY, 'i') : null;
const PHONE = SIZES.find((size) => size.name === 'phone');
/** how many folders are shot at once, each in a browser of its own */
const TOGETHER = 4;

const started = Date.now();
const failures = [];
const street = await fetchStreetPicture();
const shared = { origin, out, street, filter, failures };

/** Runs one job in its own browser, so that the jobs do not wait on each other's drawing. */
async function inBrowser(job) {
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    return await job(browser);
  } finally {
    await browser.close();
  }
}

/** Every screen of one size and scheme. */
async function shootFolder(browser, size, scheme) {
  const folder = `${size.name}-${scheme}`;
  const run = makeRun({ ...shared, browser, folder, size, scheme });
  await paneScenes(run);
  await soloScenes(run);
  await onlineScenes(run);
  // the screens of wave 6 come after the rest, so that a scene keeps the number earlier reviews knew it by
  await paneScenes6(run);
  await soloScenes6(run);
  await onlineScenes6(run);
  console.log(`${folder}: ${run.written} pictures`);
  return run.written;
}

/** The main screens of one other language, on a phone, where its longer words have the least room. */
async function shootLanguage(browser, code) {
  const run = makeRun({ ...shared, browser, folder: 'languages', size: PHONE, scheme: 'dark', language: code, prefix: `${code}-` });
  await languageScenes(run);
  console.log(`languages ${code}: ${run.written} pictures`);
  return run.written;
}

const jobs = [
  ...SIZES.flatMap((size) => SCHEMES.filter((scheme) => !only || only === `${size.name}-${scheme}`).map((scheme) => (browser) => shootFolder(browser, size, scheme))),
  ...(!only || only === 'languages' ? OTHER_LANGUAGES.map((code) => (browser) => shootLanguage(browser, code)) : []),
];

/** Runs the jobs a few at a time, each worker taking the next one that is waiting. Resolves to how many pictures were written. */
async function runAll(waiting) {
  const worker = async () => {
    let written = 0;
    for (let job = waiting.shift(); job; job = waiting.shift()) {
      written += await inBrowser(job);
    }
    return written;
  };
  const counts = await Promise.all(Array.from({ length: TOGETHER }, worker));
  return counts.reduce((total, count) => total + count, 0);
}

const written = await runAll([...jobs]);
console.log(`${written} pictures in ${out}, in ${Math.round((Date.now() - started) / 1000)} seconds`);
if (failures.length > 0) {
  console.log(`not captured:\n${failures.join('\n')}`);
}
process.exit(failures.length === 0 ? 0 : 1);
