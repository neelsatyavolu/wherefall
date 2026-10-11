// The panes of wave 6: getting back into an account by its recovery code, signing out everywhere,
// the 2v2 record, reports with a category and where each stands, the boards with the players not
// seen lately, the moderation pane's questions, and what a pane says once the session has ended.
import { historyGames } from '../../e2e/games-server.ts';
import { friendsList } from './data.mjs';
import { SEASONED, bring, button, endSessionElsewhere, harness, openPane, panes, radio, refusal, section } from './setup.mjs';
import { showInactive } from './world.mjs';

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'another horse staple';
const FULL = { fullPage: true };
/** a name nobody of the review's world has: the account a visitor makes */
const NEWCOMER = 'tess_w';

const codeBox = (s) => s.page.locator('.recovery-code');
const forgotForm = (s) => s.page.getByRole('form', { name: s.say('recovery.forgot') });
const yes = (s, key) => s.page.getByRole('group', { name: s.say(key) }).getByRole('radio', { name: s.say('account.switch.yes') });

/** Fills in the forgot-password form, which is open, and sends it. */
async function recover(s, code, password) {
  await forgotForm(s).getByLabel(s.say('account.username')).fill('neel');
  await forgotForm(s).getByLabel(s.say('recovery.title')).fill(code);
  await forgotForm(s).getByLabel(s.say('account.newPassword')).fill(password);
  await button(s, 'recovery.submit').click();
}

async function recoveryScenes(run) {
  await run.scene('sign-up: the recovery code shown once', { who: 'visitor' }, async (s) => {
    await s.capture(
      'pane-account-sign-up-recovery-code-to-acknowledge',
      async () => {
        await openPane(s, '/#account');
        await radio(s, 'account.register.name').check();
        await s.page.getByLabel(s.say('account.username')).fill(NEWCOMER);
        await s.page.getByLabel(s.say('account.password')).fill(PASSWORD);
        await button(s, 'account.register.name').click();
        await codeBox(s).locator('.recovery-code-value').waitFor();
      },
      FULL,
    );
    await s.capture('pane-account-sign-up-recovery-code-copied', async () => {
      await codeBox(s).getByRole('button', { name: s.say('recovery.copy'), exact: true }).click();
      await codeBox(s).getByRole('button', { name: s.say('recovery.copied') }).or(codeBox(s).getByRole('textbox')).first().waitFor();
    });
  });

  await run.scene('forgot password: the form, a wrong code, back in with a new code', {}, async (s) => {
    // "neel" has an account and is signed out of this browser
    s.account.signOut();
    const code = s.account.recoveryCode;
    await openPane(s, '/#account');
    await s.capture('pane-account-sign-in-form-with-forgot-password', undefined, FULL);
    await s.capture('pane-account-forgot-password-form', async () => {
      await button(s, 'recovery.forgot').click();
      await forgotForm(s).waitFor();
    });
    await s.capture('pane-account-forgot-password-wrong-code-refused', async () => {
      await recover(s, 'ABCD-EFGH-JKMN', NEW_PASSWORD);
      await refusal(forgotForm(s)).waitFor();
    });
    await s.capture('pane-account-forgot-password-success-signed-in-new-code-shown', async () => {
      await recover(s, code.toLowerCase(), NEW_PASSWORD);
      await codeBox(s).locator('.recovery-code-value').waitFor();
    });
  });
}

async function accountScenes(run) {
  await run.scene('account: the recovery code section, a new code, sign out everywhere', {}, async (s) => {
    await openPane(s, '/#account');
    const recovery = section(s, 'recovery.title');
    const issue = recovery.getByRole('button', { name: s.say('recovery.issue') });
    await s.capture('pane-account-recovery-code-section-and-sign-out-everywhere', () => bring(recovery));
    await s.capture('pane-account-new-recovery-code-asks-for-the-password', async () => {
      await issue.click();
      await recovery.getByLabel(s.say('account.currentPassword')).fill('not it at all');
      await issue.click();
      await refusal(recovery).waitFor();
      await bring(recovery);
    });
    await s.capture('pane-account-new-recovery-code-shown-once', async () => {
      await recovery.getByLabel(s.say('account.currentPassword')).fill(PASSWORD);
      await issue.click();
      await codeBox(s).locator('.recovery-code-value').waitFor();
      await bring(codeBox(s));
    });
    await s.capture('pane-account-sign-out-everywhere-section', async () => {
      await button(s, 'recovery.saved').click();
      await bring(section(s, 'sessions.everywhere'));
    });
    await s.capture('pane-account-after-sign-out-everywhere-a-visitor-again', async () => {
      await section(s, 'sessions.everywhere').getByRole('button', { name: s.say('sessions.everywhere') }).click();
      await button(s, 'recovery.forgot').waitFor();
    }, FULL);
  });

  await run.scene('account: made before recovery codes, it has none', {}, async (s) => {
    s.account.recoveryCode = null;
    await openPane(s, '/#account');
    await s.capture('pane-account-recovery-code-section-no-code-yet', () => bring(section(s, 'recovery.title')));
  });

  await run.scene('account: the 2v2 record, hide my last seen, my reports', {}, async (s) => {
    s.games.history = historyGames(40);
    await openPane(s, '/#account');
    const mine = section(s, 'reports.mine');
    await s.capture('pane-account-2v2-record-under-the-duel-record', () => bring(section(s, 'account.teamRecord')));
    await s.capture('pane-account-hide-my-last-seen-switched-on', async () => {
      await yes(s, 'account.hideLastSeen').check();
      await bring(s.page.getByRole('group', { name: s.say('account.hideLastSeen') }));
    });
    await s.capture('pane-account-my-reports-closed', () => bring(mine));
    await s.capture('pane-account-my-reports-open-action-taken-and-dismissed', async () => {
      await mine.getByRole('button', { name: s.say('reports.mine.show') }).click();
      await mine.locator('.report-row').nth(2).waitFor();
      await bring(mine);
    });
    await s.capture('pane-account-my-reports-empty', async () => {
      s.social.reports = [];
      await mine.getByRole('button', { name: s.say('reports.mine.hide') }).click();
      await mine.getByRole('button', { name: s.say('reports.mine.show') }).click();
      await mine.getByText(s.say('reports.mine.empty')).waitFor();
      await bring(mine);
    });
  });
}

async function socialScenes(run) {
  await run.scene('profile: the 2v2 record, a report with its category', {}, async (s) => {
    await openPane(s, '/?user=sam');
    const form = s.page.locator('.report-form');
    const about = form.getByRole('group', { name: s.say('report.category.legend') });
    await s.capture('pane-profile-2v2-record-under-the-duel-record', () => bring(section(s, 'profile.teams', { name: 'sam' })));
    await s.capture('pane-profile-report-form-with-its-four-categories', async () => {
      await button(s, 'profile.report.open').click();
      await about.getByRole('radio').nth(3).waitFor();
      await bring(form);
    });
    await s.capture('pane-profile-report-refused-nothing-chosen', async () => {
      await button(s, 'common.sendReport').click();
      await refusal(form).waitFor();
      await bring(form);
    });
    await s.capture('pane-profile-report-category-chosen-and-note-written', async () => {
      await about.getByRole('radio', { name: s.say('report.category.offensiveChat'), exact: true }).check();
      await form.getByRole('textbox').fill('insults in the lobby chat, three games running');
      await bring(form);
    });
    await s.capture('pane-profile-report-sent', async () => {
      await button(s, 'common.sendReport').click();
      await s.page.getByText(s.say('profile.report.sent')).waitFor();
      await bring(s.page.getByText(s.say('profile.report.sent')));
    });
  });

  await run.scene('friends: removing a friend is asked in the row', {}, async (s) => {
    s.social.friends = friendsList();
    await openPane(s, '/#friends');
    const row = s.page.locator('.player-row').filter({ hasText: 'raj' });
    await s.capture('pane-friends-remove-a-friend-asked-in-the-row', async () => {
      await row.getByRole('button', { name: s.say('friends.removeName', { name: 'raj' }) }).click();
      await refusal(row).waitFor();
      await bring(row);
    });
  });
}

async function boardScenes(run) {
  await run.scene('leaderboards: the pager, the own row on its page, inactive players shown', {}, async (s) => {
    const page = (number) => s.page.locator('.pager-page', { hasText: s.say('daily.page', { page: number }) }).waitFor();
    const turnTo = async (last) => {
      for (let number = 2; number <= last; number += 1) {
        await button(s, 'daily.nextPage').click();
        await page(number);
      }
    };
    await panes(s, [
      [
        '/#leaderboards',
        'pane-leaderboards-xp-last-page-with-the-own-row-in-it',
        async () => {
          await radio(s, 'leaderboards.tab.xp').check();
          await page(1);
          await turnTo(5);
        },
      ],
    ]);
    // from here on the boards are asked for with the players not seen for 14 days
    showInactive(s.social);
    const inactive = () => yes(s, 'leaderboards.inactive').check();
    await panes(s, [
      ['/#leaderboards', 'pane-leaderboards-rating-show-inactive-players-on', inactive],
      [
        '/#leaderboards',
        'pane-leaderboards-xp-show-inactive-players-on-own-row-below-the-hundred',
        async () => {
          await inactive();
          await radio(s, 'leaderboards.tab.xp').check();
          await page(1);
        },
      ],
    ]);
  });
}

async function moderationScenes(run) {
  await run.scene('moderation: each report with its category, a ban and a removal asked in the row', { account: { ...SEASONED, moderator: true } }, async (s) => {
    await openPane(s, '/#moderation');
    const row = (text) => s.page.locator('.player-row').filter({ hasText: text });
    await s.capture('pane-moderation-reports-with-their-categories', () => row('kit').locator('.reasons li').first().waitFor(), FULL);
    await s.capture('pane-moderation-ban-asked-in-the-row', async () => {
      await button(s, 'moderation.banLabel', { name: 'kit' }).click();
      await refusal(row('kit')).waitFor();
      await bring(row('kit'));
    });
    await s.capture('pane-moderation-player-banned-reports-settled', async () => {
      await row('kit').getByRole('button', { name: s.say('moderation.ban'), exact: true }).click();
      await row('kit').getByText(s.say('moderation.banned')).first().waitFor();
      await bring(row('kit'));
    });
    await s.capture('pane-moderation-remove-map-asked-in-the-row', async () => {
      await button(s, 'moderation.removeMapLabel', { name: 'Paris walk' }).click();
      await refusal(row('Paris walk')).waitFor();
      await bring(row('Paris walk'));
    });
  });
}

/** five corners of Paris, latitude first, as a file of places holds them */
const SPOTS = [[48.8566, 2.3522], [48.8606, 2.3376], [48.8738, 2.295], [48.853, 2.3499], [48.8462, 2.3464]];
/** a file as a player might export one: places that are added, one twice, one with no Street View, and two entries that are no place */
const MIXED_FILE = [{ lat: 48.8566, lng: 2.3522 }, { latitude: 48.8606, longitude: 2.3376 }, { lat: 48.8738, lon: 2.295 }, { lat: 48.853, lng: 2.3499 }, { lat: 85, lng: 10 }, { lat: 48.8566, lng: 2.3522 }, { name: 'nowhere' }, 'words'];
/** a spreadsheet's export whose columns the editor cannot tell apart */
const UNNAMED_COLUMNS = 'name,x,y\nParis,2,48';

const upload = (s, name, content, mimeType = '') => s.page.locator('#map-file').setInputFiles({ name, mimeType, buffer: Buffer.from(content) });

/** Opens the map editor with its stand-in for the Street View lookup. */
async function openEditor(s) {
  await openPane(s, '/?edit=new');
  await harness(s, 'mountEditor(null)');
  await s.page.locator('#map-file').waitFor({ state: 'attached' });
  await s.page.getByLabel(s.say('editor.name'), { exact: true }).waitFor();
}

async function editorScenes(run) {
  await run.scene('map editor: the map first, a file of places read, a file refused', {}, async (s) => {
    const filing = section(s, 'editor.file');
    await s.capture('pane-map-editor-map-first-on-the-first-screen', () => openEditor(s));
    await s.capture('pane-map-editor-add-places-from-a-file', () => bring(filing));
    await s.capture(
      'pane-map-editor-file-read-places-added',
      async () => {
        await upload(s, 'paris.json', JSON.stringify(MIXED_FILE), 'application/json');
        await filing.locator('.paste-summary li').nth(3).waitFor();
      },
      FULL,
    );
    await s.capture('pane-map-editor-file-read-with-its-summary', () => bring(filing));
    await s.capture('pane-map-editor-file-refused-no-latitude-and-longitude-columns', async () => {
      await upload(s, 'columns.csv', UNNAMED_COLUMNS, 'text/csv');
      await refusal(filing).waitFor();
      await bring(filing);
    });
  });
}

/** A signed-in player on a screen, whose session then ends from somewhere else; `meet` is what they do next. */
async function endedScene(run, title, name, arrive, meet, how) {
  await run.scene(`session ended elsewhere: ${title}`, {}, async (s) => {
    s.social.friends = friendsList();
    await arrive(s);
    await s.capture(
      name,
      async () => {
        endSessionElsewhere(s);
        await meet(s);
      },
      how,
    );
  });
}

async function sessionScenes(run) {
  const says = (s, within = s.page) => within.getByText(s.say('session.ended')).first();
  await endedScene(
    run,
    'the account pane turns into the sign-in form',
    'pane-account-session-ended-notice-over-the-sign-in-form',
    (s) => openPane(s, '/#account'),
    async (s) => {
      await yes(s, 'account.hideChat').click();
      await s.page.locator('.account-body > .status-box').waitFor();
    },
    FULL,
  );
  await endedScene(
    run,
    'a line on a profile with the way to sign in',
    'pane-profile-session-ended-line-with-the-way-to-sign-in',
    async (s) => {
      await openPane(s, '/?user=sam');
      await s.page.locator('.friend-offer').getByRole('button').first().waitFor();
    },
    async (s) => {
      await s.page.locator('.friend-offer').getByRole('button').first().click();
      await says(s, s.page.locator('.friend-offer')).waitFor();
    },
  );
  await endedScene(
    run,
    'the party form closes behind the notice',
    'pane-create-party-session-ended-notice',
    (s) => openPane(s, '/#create'),
    async (s) => {
      await button(s, 'party.create.submit').click();
      await says(s, s.page.locator('.pane-body .notice')).waitFor();
    },
    FULL,
  );
  await endedScene(
    run,
    'the map editor keeps the draft',
    'pane-map-editor-session-ended-draft-kept',
    async (s) => {
      await openEditor(s);
      await s.page.getByLabel(s.say('editor.name'), { exact: true }).fill('Paris on foot');
      await s.page.getByLabel(s.say('editor.description')).fill('Five corners of the old town.');
      await upload(s, 'paris.json', JSON.stringify(SPOTS), 'application/json');
      await section(s, 'label.places').locator('.player-row').nth(4).waitFor();
    },
    async (s) => {
      await button(s, 'editor.publish').click();
      await refusal(s.page.locator('.action-bar')).waitFor();
    },
  );
  // the account is still read as signed in when the pane opens: the lists that need it are refused a moment later
  await run.scene('session ended elsewhere: the maps pane', {}, async (s) => {
    s.maps.session = 'none';
    await s.capture(
      'pane-maps-session-ended-on-the-lists-that-need-an-account',
      async () => {
        await openPane(s, '/#maps');
        await says(s, section(s, 'maps.mine')).waitFor();
      },
      FULL,
    );
  });
}

export async function paneScenes6(run) {
  await recoveryScenes(run);
  await accountScenes(run);
  await socialScenes(run);
  await boardScenes(run);
  await moderationScenes(run);
  await editorScenes(run);
  await sessionScenes(run);
}
