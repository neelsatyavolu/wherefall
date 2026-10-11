/** Wave 5, English: accounts, history, profiles, boards, friends and who is online. Keys as in `../en.ts`. */
export const account = {
  // Account: signing in to an account that was deleted
  'account.restore': 'Restore it and sign in',
  'account.restore.busy': 'Restoring',

  // Account: who is signed in, and the figures
  'account.loginStreak': 'Login streak',
  /** after the streak's number, which is drawn large above it */
  'account.daysInARow.one': 'day in a row',
  'account.daysInARow.other': 'days in a row',
  /** under the rating: the place on the rating board */
  'account.rank': 'rank {rank}',
  'account.duelRecord': 'Duel record',
  'account.duels.wins': 'Wins',
  'account.duels.losses': 'Losses',
  'account.duels.ties': 'Ties',
  'account.duels.winRate': 'Win rate',

  // Account: what is saved with the account, apart from what this browser keeps
  'account.group.account': 'Your account',
  'account.group.account.note': 'Saved with your account, so it is the same wherever you sign in.',
  'account.group.browser': 'This browser',
  'account.group.browser.note': 'Kept in this browser only.',
  'account.country.note': 'Shown as a flag beside your name.',
  'account.country.none': 'No country',
  'account.country.find': 'Find a country',
  'account.country.change': 'Change country',
  'account.country.noMatch': 'No country by that name.',
  'account.allowRequests': 'Allow friend requests',
  'account.hideChat': 'Hide chat',
  'account.switch.yes': 'Yes',
  'account.switch.no': 'No',

  // Account: the password
  'account.changePassword': 'Change password',
  'account.currentPassword': 'Current password',
  'account.newPassword': 'New password',
  'account.newPasswordHint': '8 to 200 characters. Every other browser is signed out.',
  'account.passwordMissing': 'Enter your current password and a new one.',
  'account.passwordChanged': 'Password changed.',

  // Account: deleting it
  'account.delete': 'Delete account',
  'account.delete.note': 'Hides the account everywhere at once. It can be restored for 30 days.',
  'account.delete.what':
    "Your account disappears everywhere at once: your profile, your places on the leaderboards, your friends' lists. For 30 days you can restore it by signing in with your username and password. After that it is gone for good.",
  'account.delete.confirm': 'Delete my account',
  'account.delete.missing': 'Enter your password to delete the account.',
  'account.deleted': 'Your account is deleted. Until {date} you can restore it by signing in.',
  'account.deleted.signIn': 'Go to sign in',
  /** the label over the note that stands in place of a deleted account */
  'account.deleted.label': 'Account deleted',

  // The history: every game, a page at a time
  'history.yours': 'Your games',
  'history.loadingList': 'Loading your games',
  'history.more': 'Show more',
  'history.more.busy': 'Loading',
  'history.column.kind': 'Type',
  'history.column.players': 'Players',
  'history.kind.solo': 'Solo',
  'history.kind.daily': 'Daily',
  'history.kind.party': 'Party',
  'history.kind.unranked': 'Unranked',
  'history.kind.ranked': 'Ranked',
  'history.kind.team': '2v2',
  /** a small note beside the kind of game */
  'history.result.win': 'win',
  'history.result.loss': 'loss',
  'history.result.draw': 'draw',
  /** in the line above a match's rounds, after a "+18" or a "-12" */
  'history.rating': 'rating {change}',
  'history.players.one': '{count} player',
  'history.players.other': '{count} players',

  // Wave 6: the 2v2 record beside the duels, and one more switch
  'account.teamRecord': '2v2 record',
  'account.hideLastSeen': 'Hide my last seen',
  'account.hideLastSeen.note': 'Friends then see only whether you are online.',

  // Wave 6: the recovery code, the only way back in without the password
  'recovery.title': 'Recovery code',
  /** over a code that was just made: at sign-up, after getting back in with the old one, and on the account pane */
  'recovery.made.signup': 'Your account is ready. This is its recovery code.',
  'recovery.made.recovered': 'Your password is changed and you are signed in. The code you used no longer works. This is your new one.',
  'recovery.made.issued': 'This is your new recovery code. Any earlier one no longer works.',
  'recovery.warning': 'Save it somewhere safe now. It is the only way back into your account if you forget your password, and it is not shown again.',
  'recovery.copy': 'Copy',
  'recovery.copied': 'Copied',
  'recovery.saved': 'I have saved it',
  'recovery.forgot': 'Forgot password',
  'recovery.forgot.lede': 'Sign in with your recovery code and choose a new password. The code is used up, and you get a new one.',
  'recovery.codeHint': 'Capitals, spaces and dashes do not matter.',
  'recovery.submit': 'Set password and sign in',
  'recovery.back': 'Back to sign in',
  'recovery.missing': 'Enter your username, your recovery code and a new password.',
  'recovery.has': 'Your account has a recovery code. A new one replaces it.',
  'recovery.none': 'Your account has no recovery code. Without one there is no way back in if you forget your password.',
  'recovery.issue': 'New recovery code',
  'recovery.issue.missing': 'Enter your current password to get a new code.',

  // Wave 6: sessions, which can end from another browser at any moment
  'sessions.everywhere': 'Sign out everywhere',
  'sessions.everywhere.note': 'Signs your account out of every browser and device, this one included.',
  /** the label over the notice that the session has ended */
  'session.ended.label': 'Signed out',
  /** in the map editor, where leaving the page would lose the map being made */
  'session.ended.draft': 'You are no longer signed in. Your map is still here: sign in in a new tab, then save again.',
  'session.signInNewTab': 'Sign in in a new tab',

  // Wave 6: the player's own reports of other players
  'reports.mine': 'My reports',
  'reports.mine.note': 'The players you have reported, and where each report stands.',
  'reports.mine.show': 'Show my reports',
  'reports.mine.hide': 'Hide my reports',
  'reports.mine.loading': 'Loading your reports',
  'reports.mine.empty': 'You have not reported anyone.',
} as const;
