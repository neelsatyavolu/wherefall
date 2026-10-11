// The panes of the home screen: what a visitor, a guest and a signed-in player each see, and the
// states a pane can be in.
import { dailyEntries } from '../../e2e/daily-server.ts';
import { historyGames } from '../../e2e/games-server.ts';
import { PARIS, MINE } from '../../e2e/maps-server.ts';
import { matchState, player } from '../../src/multiplayer/testing.ts';
import { NO_FRIENDS, dailyHistory, fillMaps, friendsList } from './data.mjs';
import { SEASONED, bring, button, harness, menuButton, openPane, panes, radio, section } from './setup.mjs';

const PASSWORD = 'correct horse battery';
const FULL = { fullPage: true };
/** a pasted list for the map editor: places that are added, one twice, one with no Street View, one at sea, and a line that is nothing */
const PASTED = ['48.8566, 2.3522', '48.8606 2.3376', '48.8738, 2.2950', '48.8530, 2.3499', '48.8462, 2.3464', '-1.2921, 36.8219', '48.8566, 2.3522', '85.0, 10.0', '30, -40', 'somewhere nice'];


async function visitorScenes(run) {
  await run.scene('visitor: every pane signed out', { who: 'visitor', stored: { 'plonk.intro-seen': null } }, async (s) => {
    await panes(s, [
      ['/', 'pane-singleplayer-signed-out-needs-account'],
      ['/#streak', 'pane-country-streak-signed-out-needs-account'],
      ['/#country', 'pane-country-guesser-signed-out-needs-account'],
      ['/#continent', 'pane-continent-guesser-signed-out-needs-account'],
      ['/#daily', 'pane-daily-signed-out-needs-account'],
      ['/#ranked', 'pane-ranked-duel-signed-out-needs-account'],
      ['/#unranked', 'pane-unranked-signed-out-needs-account'],
      ['/#team', 'pane-2v2-signed-out-needs-account'],
      ['/#create', 'pane-create-party-signed-out-needs-account'],
      ['/?party=ABC123', 'pane-join-party-signed-out-needs-account'],
      ['/#maps', 'pane-maps-signed-out-liked-needs-account'],
      ['/#leaderboards', 'pane-leaderboards-signed-out'],
      ['/#friends', 'pane-friends-signed-out-needs-account'],
      ['/?user=sam', 'pane-profile-signed-out-no-friend-button'],
      ['/#account', 'pane-account-sign-in-form-and-settings-of-this-browser'],
      ['/#account', 'pane-account-create-account-form-with-username-rule', () => radio(s, 'account.register.name').check()],
      ['/#about', 'pane-about'],
    ]);
  });

  await run.scene('guest: the notice a guest session left from before gets on every pane that plays', { who: 'guest' }, async (s) => {
    await panes(s, [
      ['/#unranked', 'pane-unranked-as-guest-needs-account-notice'],
      ['/#ranked', 'pane-ranked-duel-as-guest-needs-account-notice'],
      ['/#create', 'pane-create-party-as-guest-needs-account-notice'],
      ['/#friends', 'pane-friends-as-guest-needs-account-notice'],
      ['/?party=ABC123', 'pane-join-party-as-guest-needs-account-notice'],
      ['/#daily', 'pane-daily-as-guest-needs-account-notice'],
      ['/#account', 'pane-account-as-guest'],
    ]);
  });
}

async function soloPaneScenes(run) {
  await run.scene('singleplayer form: timer control, road names, country list', {}, async (s) => {
    await panes(s, [
      ['/', 'pane-singleplayer-form-with-timer-control-and-road-names'],
      [
        '/',
        'pane-singleplayer-timer-set-and-road-names-shown',
        async () => {
          await s.page.getByRole('slider', { name: s.say('label.timePerRound') }).fill('90');
          await s.page.getByRole('group', { name: s.say('singleplayer.roadNames') }).getByRole('radio', { name: s.say('singleplayer.roadNames.on') }).check();
        },
      ],
      ['/', 'pane-singleplayer-country-list-open', () => radio(s, 'picker.aCountry').check()],
      ['/?map=world&seed=e2e00001&t=250&mode=move&n=3', 'pane-singleplayer-challenge-link-received'],
    ]);
  });

  await run.scene('phone menu', { only: 'phone' }, async (s) => {
    await s.capture('phone-menu-open', async () => {
      await openPane(s, '/');
      await menuButton(s).click();
    });
  });

  await run.scene('solo panes: streak, the two guessers, about', {}, async (s) => {
    await panes(s, [
      ['/#streak', 'pane-country-streak-with-best'],
      ['/#country', 'pane-country-guesser-with-best-score'],
      ['/#continent', 'pane-continent-guesser-with-best-score'],
      ['/#about', 'pane-about'],
    ]);
  });
}

function fillDaily(daily) {
  daily.country = 'IN';
  daily.entries = dailyEntries(45);
  daily.records = { played: 11, best: 14_200, average: 9860 };
  daily.history = dailyHistory();
}

async function dailyScenes(run) {
  await run.scene('daily: open, started and left, done', {}, async (s) => {
    fillDaily(s.daily);
    s.daily.streak = { current: 4, best: 9, atRisk: true };
    await panes(s, [['/#daily', 'pane-daily-open-streak-at-risk-with-countdown']]);
    s.daily.started = true;
    await panes(s, [['/#daily', 'pane-daily-started-and-left-attempt-used']]);
    s.daily.started = false;
    s.daily.save([4800, 3950, 2500]);
    await panes(s, [['/#daily', 'pane-daily-done-rank-share-beaten-distribution-and-history']]);
    await s.capture('pane-daily-leaderboard-first-page-own-row-below', () => bring(s.page.locator('.daily-board')));
    await s.capture('pane-daily-leaderboard-page-two-with-own-row', async () => {
      await button(s, 'daily.nextPage').click();
      await s.page.locator('.daily-board .pager-page', { hasText: s.say('daily.page', { page: 2 }) }).waitFor();
      await bring(s.page.locator('.daily-board'));
    });
    await s.capture('pane-daily-todays-scores-and-last-14-days', () => bring(section(s, 'daily.distribution')));
  });

  await run.scene('daily: the mark beside its name in the menu', {}, async (s) => {
    const menu = async () => {
      await openPane(s, '/');
      if (s.phone) {
        await menuButton(s).click();
      }
    };
    const shows = (state) => s.page.getByRole('img', { name: s.say(`daily.nav.${state}`) }).waitFor();
    await s.capture('home-daily-mark-not-played-today', async () => {
      await menu();
      await shows('open');
    });
    s.daily.streak = { current: 4, best: 9, atRisk: true };
    await s.capture('home-daily-mark-streak-at-risk', async () => {
      await menu();
      await shows('atRisk');
    });
    s.daily.save([4800, 3950, 2500]);
    await s.capture('home-daily-mark-played-today', async () => {
      await menu();
      await shows('done');
    });
  });
}

async function accountScenes(run) {
  await run.scene('account: overview, duel record, paged history, a match opened', {}, async (s) => {
    s.games.history = historyGames(40);
    const rows = s.page.locator('.history tbody tr');
    await panes(s, [['/#account', 'pane-account-with-duel-record-charts-and-history-of-every-kind']]);
    await s.capture('pane-account-duel-record-and-stats', () => bring(section(s, 'account.duelRecord')));
    await s.capture('pane-account-history-first-page-every-kind', () => bring(rows.nth(3)));
    await s.capture(
      'pane-account-history-second-page-shown',
      async () => {
        await button(s, 'history.more').click();
        await rows.nth(39).waitFor();
      },
      FULL,
    );
    await s.capture(
      'pane-history-of-a-ranked-match-opened',
      async () => {
        await rows.first().getByRole('button').click();
        await s.page.locator('.history-map .pin-actual').first().waitFor();
      },
      FULL,
    );
  });

}

async function accountSettingScenes(run) {
  await run.scene('account: country, the two switches, password, delete confirmation', {}, async (s) => {
    await openPane(s, '/#account');
    // the list of countries and the password form are closed until asked for
    const find = s.page.getByLabel(s.say('account.country.find'));
    const password = s.page.locator('.account-section').filter({ has: s.page.getByRole('heading', { name: s.say('account.changePassword') }) });
    const changePassword = password.getByRole('button', { name: s.say('account.changePassword') });
    await s.capture('pane-account-country-list-open', async () => {
      await button(s, 'account.country.change').click();
      await bring(find);
    });
    await s.capture('pane-account-country-list-narrowed-by-search', async () => {
      await find.fill('fran');
      await bring(find);
    });
    await s.capture('pane-account-switches-friend-requests-and-hide-chat', async () => {
      await s.page.locator('.country-picker').getByRole('button', { name: s.say('common.cancel') }).click();
      await s.page.getByRole('group', { name: s.say('account.hideChat') }).getByRole('radio', { name: s.say('account.switch.yes') }).check();
      await bring(s.page.getByRole('group', { name: s.say('account.allowRequests') }));
    });
    const current = password.getByLabel(s.say('account.currentPassword'));
    await s.capture('pane-account-change-password-form', async () => {
      await changePassword.click();
      await bring(current);
    });
    await s.capture('pane-account-change-password-wrong-current-password', async () => {
      await current.fill('not it at all');
      await password.getByLabel(s.say('account.newPassword'), { exact: true }).fill('a new password');
      await changePassword.click();
      await password.getByRole('alert').filter({ hasText: /\S/ }).first().waitFor();
      await bring(current);
    });
    await s.capture('pane-account-delete-confirmation', async () => {
      await password.getByRole('button', { name: s.say('common.cancel') }).click();
      await button(s, 'account.delete').click();
      await bring(button(s, 'account.delete.confirm'));
    });
    await s.capture('pane-account-settings-of-this-browser', () => bring(s.page.getByRole('slider', { name: s.say('prefs.volume') })));
  });

  await run.scene('account: deleted, sign-in refused, restore offered', {}, async (s) => {
    await openPane(s, '/#account');
    await s.capture('pane-account-deleted-notice-with-restore-date', async () => {
      await button(s, 'account.delete').click();
      await s.page.getByLabel(s.say('account.password'), { exact: true }).fill(PASSWORD);
      await button(s, 'account.delete.confirm').click();
      await button(s, 'account.deleted.signIn').waitFor();
    });
    await s.capture('pane-account-sign-in-refused-restore-offer', async () => {
      await button(s, 'account.deleted.signIn').click();
      await s.page.getByLabel(s.say('account.username')).fill('neel');
      await s.page.getByLabel(s.say('account.password')).fill(PASSWORD);
      await button(s, 'account.login.name').click();
      await button(s, 'account.restore').waitFor();
    });
  });
}

async function socialScenes(run) {
  await run.scene('profile: four charts, ranges, numbers, friend button states', {}, async (s) => {
    const friendship = (state) => {
      s.social.profiles = { ...s.social.profiles, sam: { ...s.social.profiles.sam, friend: state } };
    };
    const progress = section(s, 'chart.label');
    await panes(s, [['/?user=sam', 'pane-profile-four-charts-online-send-friend-request']]);
    await s.capture('pane-profile-charts-over-7-days', async () => {
      await progress.getByRole('radio', { name: s.say('chart.days.other', { count: 7 }) }).check();
      await bring(progress);
    });
    await s.capture('pane-profile-charts-over-all-time-with-the-numbers', async () => {
      await progress.getByRole('radio', { name: s.say('social.allTime') }).check();
      await progress.getByText(s.say('chart.table.show')).click();
      await bring(progress.locator('.chart-table'));
    });
    for (const [state, name, key] of [
      ['outgoing', 'pane-profile-friend-request-sent', 'profile.friend.outgoing'],
      ['incoming', 'pane-profile-friend-request-to-accept', 'profile.friend.accept'],
      ['friends', 'pane-profile-you-are-friends', 'profile.friend.friends'],
    ]) {
      await s.capture(name, async () => {
        friendship(state);
        await openPane(s, '/?user=sam');
        await s.page.locator('.friend-offer').getByText(s.say(key)).waitFor();
      });
    }
    await panes(s, [
      ['/?user=kit', 'pane-profile-last-seen-no-history-yet'],
      ['/?user=neel', 'pane-profile-own'],
    ]);
  });

}

async function boardScenes(run) {
  await run.scene('leaderboards: both periods, medals, a hundred rows, empty', {}, async (s) => {
    // the world's boards, twenty rows to a page: the player's own row is under a page they are not on
    await panes(s, [
      ['/#leaderboards', 'pane-leaderboards-rating-all-time-with-medals-and-flags'],
      ['/#leaderboards', 'pane-leaderboards-rating-today', () => radio(s, 'leaderboards.period.day').check()],
      ['/#leaderboards', 'pane-leaderboards-xp-first-page-of-twenty-own-row-below', () => radio(s, 'leaderboards.tab.xp').check()],
      ['/#leaderboards', 'state-empty-leaderboard-all-time', () => radio(s, 'leaderboards.tab.streak').check()],
      [
        '/#leaderboards',
        'state-empty-leaderboard-today',
        async () => {
          await radio(s, 'leaderboards.tab.streak').check();
          await radio(s, 'leaderboards.period.day').check();
        },
      ],
    ]);
  });

  await run.scene('friends: presence, requests, invites, empty', {}, async (s) => {
    s.social.friends = friendsList();
    await panes(s, [['/#friends', 'pane-friends-with-presence-requests-and-invites']]);
    s.social.friends = NO_FRIENDS;
    await panes(s, [['/#friends', 'state-empty-friends']]);
  });
}

async function mapScenes(run) {
  await run.scene('maps: lists with Liked, search, a map page', {}, async (s) => {
    fillMaps(s.maps);
    const search = s.page.getByLabel(s.say('maps.search'));
    await panes(s, [
      ['/#maps', 'pane-maps-lists-official-liked-mine-popular-newest'],
      ['/#maps', 'pane-maps-search-results', () => search.fill('paris')],
      ['/#maps', 'pane-maps-search-shorter-than-three-characters', () => search.fill('pa')],
      ['/?community=paris-walk-x7k2', 'pane-map-page-both-descriptions-liked'],
      ['/?community=my-coast-q1w2', 'pane-map-page-own-map'],
    ]);
    await s.capture(
      'pane-map-page-street-view-preview-stand-in',
      async () => {
        await openPane(s, '/?community=paris-walk-x7k2');
        await harness(s, `mountMapPage('paris-walk-x7k2')`);
        await section(s, 'mapPage.street').getByRole('button', { name: s.say('mapPage.streetStart') }).click();
        await section(s, 'mapPage.street').getByText(s.say('mapPage.streetPlace', { number: 1, total: 5 })).waitFor();
      },
      FULL,
    );
    s.maps.maps = [PARIS, MINE];
    await panes(s, [['/#maps', 'state-empty-liked-maps']]);
  });

}

async function editorScenes(run) {
  await run.scene('map editor: counts, paste box, paste summary', {}, async (s) => {
    const editor = async (slug) => {
      await openPane(s, `/?edit=${slug ?? 'new'}`);
      await harness(s, `mountEditor(${JSON.stringify(slug)})`);
      await s.page.getByLabel(s.say('editor.name'), { exact: true }).waitFor();
    };
    // the box a list is pasted into has its own summary: a file's is beside its own button
    const pasting = section(s, 'editor.paste');
    await panes(s, [['/?edit=new', 'pane-map-editor-without-google']]);
    await s.capture('pane-map-editor-new-map-with-counts-and-paste-box', () => editor(null), FULL);
    await s.capture(
      'pane-map-editor-fields-filled-and-paste-summary',
      async () => {
        await s.page.getByLabel(s.say('editor.name'), { exact: true }).fill('Paris on foot');
        await s.page.getByLabel(s.say('editor.description')).fill('Five corners of the old town.');
        await s.page.getByLabel(s.say('editor.details')).fill('Start at the river.\nEvery place is within a mile of it.');
        await s.page.getByLabel(s.say('editor.pasteLabel')).fill(PASTED.join('\n'));
        await button(s, 'editor.pasteAdd').click();
        await pasting.locator('.paste-summary li').first().waitFor();
      },
      FULL,
    );
    await s.capture('pane-map-editor-paste-summary', () => bring(pasting.locator('.paste-summary')));
    await s.capture(
      'pane-map-editor-refused-too-few-places',
      async () => {
        await editor(null);
        await s.page.getByLabel(s.say('editor.name'), { exact: true }).fill('Paris on foot');
        await s.page.getByLabel(s.say('editor.description')).fill('Five corners of the old town.');
        await button(s, 'editor.publish').click();
        await s.page.getByRole('alert').filter({ hasText: /\S/ }).first().waitFor();
      },
      FULL,
    );
    await s.capture('pane-map-editor-own-map-from-before-descriptions', () => editor('my-coast-q1w2'), FULL);
  });
}

async function onlinePaneScenes(run) {
  await run.scene('online panes: ranked, unranked, 2v2, the party form, join', {}, async (s) => {
    await panes(s, [
      ['/#ranked', 'pane-ranked-duel'],
      ['/#unranked', 'pane-unranked'],
      ['/#team', 'pane-2v2'],
      ['/#create', 'pane-create-party-form'],
      [
        '/#create',
        'pane-create-party-form-twenty-rounds-no-timer-reactions-teams',
        async () => {
          await s.page.getByRole('slider', { name: s.say('label.rounds') }).fill('20');
          await s.page.getByRole('slider', { name: s.say('label.timePerRound') }).fill('0');
          await radio(s, 'party.communication.reactions').check();
          await radio(s, 'party.teams.best').check();
        },
      ],
      ['/?party=ABC123', 'pane-join-party-code-filled'],
    ]);
    s.match.lockRanked(120_000);
    await panes(s, [['/#ranked', 'pane-ranked-duel-locked-after-two-dodges', () => s.page.locator('.queue-lock').waitFor()]]);
  });
}

async function stateScenes(run) {
  await run.scene('states: banned account', { account: { ...SEASONED, banned: true } }, async (s) => {
    await panes(s, [['/#ranked', 'state-banned-account-on-an-online-pane']]);
  });

  await run.scene('states: moderator', { account: { ...SEASONED, moderator: true } }, async (s) => {
    await panes(s, [['/#moderation', 'pane-moderation']]);
  });

  await run.scene('states: an unfinished match to rejoin', {}, async (s) => {
    s.match.state = matchState({ you: { ...s.match.state.you, isHost: false, isResolver: false }, players: [player('sam'), player('neel')] });
    s.match.matchFound('m1');
    await panes(s, [['/', 'state-unfinished-match-rejoin-offer']]);
  });

}

async function paneErrorScenes(run) {
  await run.scene('errors: panes that will not load, forms that are refused', {}, async (s) => {
    const fails = (pattern, error) => s.page.route(pattern, (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 503, json: { success: false, error } }) : route.fallback()));
    await fails('**/api/daily**', 'The daily challenge could not be loaded. Try again shortly.');
    await panes(s, [['/#daily', 'state-error-daily-failed-to-load']]);
    await panes(s, [['/?user=nobody', 'state-error-profile-no-such-player']]);
    await s.page.route('**/api/social**', (route) => route.abort());
    await panes(s, [
      ['/#leaderboards', 'state-error-leaderboard-could-not-be-reached'],
      ['/#friends', 'state-error-friends-could-not-be-reached'],
    ]);
    await s.page.route('**/api/games**', (route) => route.abort());
    await panes(s, [['/#account', 'state-error-history-could-not-be-reached-recent-games-instead', () => bring(s.page.locator('.account-error').first())]]);
    await s.page.route('**/api/maps**', (route) => route.abort());
    await panes(s, [['/#maps', 'state-error-community-maps-could-not-be-reached']]);
    s.match.refuse = 'Choose a map, a mode, 1 to 20 rounds, and no timer or 10 to 300 seconds a round.';
    await panes(s, [
      [
        '/#create',
        'state-error-party-settings-refused-in-the-servers-words',
        async () => {
          await button(s, 'party.create.submit').click();
          await s.page.getByRole('alert').filter({ hasText: /\S/ }).first().waitFor();
        },
      ],
    ]);
  });

  await run.scene('errors: signing in refused', { who: 'visitor' }, async (s) => {
    s.account.loginRefusal = 'Wrong username or password.';
    await panes(s, [
      [
        '/#account',
        'state-error-sign-in-refused',
        async () => {
          await s.page.getByLabel(s.say('account.username')).fill('neel');
          await s.page.getByLabel(s.say('account.password')).fill('not my password');
          await button(s, 'account.login.name').click();
          await s.page.getByRole('alert').filter({ hasText: /\S/ }).first().waitFor();
        },
      ],
    ]);
  });
}

export async function paneScenes(run) {
  await visitorScenes(run);
  await soloPaneScenes(run);
  await dailyScenes(run);
  await accountScenes(run);
  await accountSettingScenes(run);
  await socialScenes(run);
  await boardScenes(run);
  await mapScenes(run);
  await editorScenes(run);
  await onlinePaneScenes(run);
  await stateScenes(run);
  await paneErrorScenes(run);
}
