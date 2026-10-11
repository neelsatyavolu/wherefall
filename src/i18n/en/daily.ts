/** Wave 5, English: the daily challenge. Keys as in `../en.ts`. */
export const daily = {
  // The pane: the rules, and the wait for the next one
  'daily.rule': 'No hints. One attempt a day.',
  'daily.next': 'Next challenge in',

  // What a player is told before and after their one attempt
  'daily.visitor.open':
    'You are not signed in. You can play once today. The result is kept in this browser, off the leaderboard, and moves to your account if you create one. {signIn}.',
  'daily.visitor.done': 'This result is kept in this browser, off the leaderboard. Create an account and it moves there. {signIn}.',
  'daily.started': "You began today's challenge and left before the end, so today's attempt is used. A new challenge is waiting tomorrow.",
  'daily.claimFailed': 'The results you played before signing in could not be added to your account.',
  'daily.rank': 'Rank',
  /** `{share}` is a percentage, written for the language: 50% */
  'daily.beat': 'Beat {share} of players',

  // Streak, records and the last two weeks
  'daily.record': 'Your daily record',
  'daily.days.one': '{count} day',
  'daily.days.other': '{count} days',
  /** `{days}` is a count of days, as above */
  'daily.streak.best': 'Best: {days}',
  /** a tag beside the streak */
  'daily.streak.risk': 'at risk',
  'daily.streak.start': 'Play today to start one.',
  'daily.streak.atRisk': 'Play today to keep it.',
  'daily.streak.spent': 'Today will not count. One missed day in seven is forgiven.',
  'daily.streak.kept': 'Safe for today.',
  'daily.played': 'Played',
  'daily.best': 'Best score',
  'daily.average': 'Average',
  'daily.history': 'Last 14 days',
  /** what one day of the strip says when it is pointed at or read out */
  'daily.history.played': '{date}: score {score}',
  'daily.history.missed': '{date}: not played',
  'daily.history.open': 'Today: not played yet',
  'daily.history.todayPlayed': 'Today: score {score}',

  // The day's scores as ten bars
  'daily.distribution': "Today's scores",
  'daily.distribution.bar.one': '{from} to {to}: {count} player',
  'daily.distribution.bar.other': '{from} to {to}: {count} players',

  // The leaderboard's pages
  'daily.page': 'Page {page}',
  'daily.previous': 'Previous',
  'daily.nextPage': 'Next',

  // What the Daily item in the sidebar is marked with
  'daily.nav.open': 'Not played today',
  'daily.nav.atRisk': 'Streak at risk',
  'daily.nav.done': 'Played today',

  // The game itself and its summary
  'daily.leaveConfirm': "Leave today's challenge? You get one attempt a day, and leaving uses it.",
  'daily.summary.share': 'Everyone gets the same three places today. Sharing your result gives none of them away.',
  /** follows "You are not signed in, so this result is not on the leaderboard." */
  'daily.kept': 'It is kept in this browser and moves to your account if you create one.',
  /** the first line of a shared result */
  'daily.share.title': 'Wherefall daily challenge · {date}',

  // Wave 6: the result against the day's average, and a personal best
  /** a mark beside the score */
  'daily.personalBest': 'Personal best',
  'daily.average.title': "Against today's average",
  /** `{points}` is the difference with its sign, as the language writes one: +320, -180 */
  'daily.average.above': '{points} above average',
  'daily.average.below': '{points} below average',
  'daily.average.level': 'Level with the average',
  /** a result kept in this browser before a start gave a token: it can never move to an account */
  'daily.visitor.unclaimable': 'This result is kept in this browser, off the leaderboard. It was played before results could move to an account, so it stays here.',

  // Wave 6: the site was updated while the daily was being played, and the day's places changed with it
  'daily.stale.note': 'Wherefall was updated while you played, so this result could not be saved.',
  'daily.stale.explain':
    "The update changed today's three places, and this game was played on the earlier ones. Reload to get the new version. Today's attempt is used, so the daily cannot be played again today. The next challenge opens at midnight UTC.",
  'daily.stale.reload': 'Reload',
  /** the pane, after that reload */
  'daily.stale.spent': "Today's result could not be saved: Wherefall was updated while you played, and the update changed today's places. Today's attempt is used. A new challenge is waiting tomorrow.",
} as const;
