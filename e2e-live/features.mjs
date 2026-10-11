// A live check of the features two-players.mjs does not touch, run by hand against a deployed site.
// Not part of the test suite.
//
//   node e2e-live/features.mjs https://plonk.example [--headed]
//
// One browser context signs up a throwaway user and goes through singleplayer (hint, street-level
// pin, result link, Exit), a country map, the country streak, the account pane, and making, liking,
// playing and deleting a community map. A second context signs up another user for the public
// unranked game, friends and a party invite. Leaderboards and a profile come last.
// It also checks that Google's daily allowance is asked about once per game, switches the language
// and back, reports the second user from the first, and, when MOD_USER and MOD_PASS are set in the
// environment, signs in as that moderator, finds the report and dismisses it.
// Then, on the first user: a Country Guesser run and its best score on the account, the daily
// challenge's one attempt and its share text, and the guess map as satellite and as terrain. The two
// users play a one-round party, which must turn up in the first one's history. Last, the second user
// changes their password, and deletes and restores their account: nothing else needs it after that.
// The daily result stays on the day's leaderboard under the throwaway name until the account is removed.
// It prints what it saw, every check that failed, console errors and failed requests, and ends with
// THROWAWAY_USERS=a,b and THROWAWAY_MAPS=slugs (the maps it could not delete itself).
// The parts are in e2e-live/features/: setup.mjs (what they share), then solo, account, community and online.
import { chromium } from '@playwright/test';
import { account, changePassword, deleteAndRestore, languages } from './features/account.mjs';
import { community, communityMap, moderation, report } from './features/community.mjs';
import { friends, partyGame, unranked } from './features/online.mjs';
import { checks, COUNTRY, created, flags, maps, part, problems, signUp, users, watch } from './features/setup.mjs';
import { countryGame, daily, guesser, mapTypes, singleplayer, streak } from './features/solo.mjs';

// --- run -----------------------------------------------------------------------------------------

const browser = await chromium.launch({ channel: 'chromium', headless: !flags.includes('--headed') });
try {
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 1360, height: 840 } })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  pages.forEach((page, index) => watch(page, users[index]));
  const [a] = pages;
  const [alice] = users;

  await part('sign up', () => Promise.all(pages.map((page, index) => signUp(page, users[index]))));
  if (created.length === 2) {
    await part('1. singleplayer: hint, street-level pin, result link, Exit', () => singleplayer(a, contexts[0], alice));
    await part('2. country streak', () => streak(a, alice));
    await part(`3. country map: ${COUNTRY}`, () => countryGame(a, alice));
    await part('4. account', () => account(a, alice));
    await part('5. community map: make, like, play, delete', () => communityMap(a, alice));
    await part('6. public unranked, two players', () => unranked(pages));
    await part('7. friends and a party invite', () => friends(pages));
    await part('8. leaderboards and a profile', () => community(a, alice));
    await part('9. language: to Spanish and back', () => languages(a, alice));
    await part('10. report the second user from the first', () => report(a, alice, users[1]));
    await part('11. moderation (needs MOD_USER and MOD_PASS)', () => moderation(browser, users[1]));
    await part('12. Country Guesser: a run saved, and its best score on the account', () => guesser(a, alice));
    await part('13. daily challenge: one attempt, and the share text', () => daily(a, contexts[0], alice));
    await part('14. map types: satellite and terrain, each credited, tiles answered', () => mapTypes(a, alice));
    await part('15. a one-round party, and the game in the history', () => partyGame(pages));
    // the last two change who can sign in as the second user, so nothing comes after them
    await part('16. password: changed, the old one refused, the new one accepted', () => changePassword(pages[1], users[1]));
    await part('17. account: deleted, sign-in refused, restored', () => deleteAndRestore(pages[1], users[1]));
  }
} catch (error) {
  problems.push(`the check itself stopped: ${String(error).split('\n')[0]}`);
} finally {
  await browser.close();
}

const failed = checks.filter((each) => !each.ok);
console.log('--- failed checks');
console.log(failed.length === 0 ? 'none' : failed.map((each) => each.name).join('\n'));
console.log('--- problems');
console.log(problems.length === 0 ? 'none' : [...new Set(problems)].join('\n'));
const ok = failed.length === 0 && created.length === 2;
console.log(`--- ${ok ? 'PASSED' : 'FAILED'}: ${checks.length - failed.length} of ${checks.length} checks, ${new Set(problems).size} problems`);
console.log(`THROWAWAY_USERS=${created.join(',')}`);
console.log(`THROWAWAY_MAPS=${maps.join(',')}`);
process.exit(ok ? 0 : 1);
