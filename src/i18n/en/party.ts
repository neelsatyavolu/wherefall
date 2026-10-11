/** Wave 5, English: party options, host controls, teams and 2v2. Keys as in `../en.ts`. */
export const party = {
  // The party form: what a host chooses besides the map, the mode and the time
  'party.rounds.less': 'Fewer rounds',
  'party.rounds.more': 'More rounds',
  'party.time.note': 'With no limit, a round ends when everyone has guessed or when the host ends it.',
  'party.communication': 'Communication',
  'party.communication.chat': 'Chat',
  'party.communication.reactions': 'Reactions only',
  'party.communication.off': 'Off',
  'party.teams': 'Teams',
  'party.teams.none': 'No teams',
  'party.teams.best': 'Best guess',
  'party.teams.average': 'Average',
  'party.teams.note': 'With teams, the players split into two sides. A team scores its best guess of the round, or the average of all its guesses.',

  // The settings in one line, after the map, rounds, time and mode
  'party.line.chat': 'chat',
  'party.line.reactions': 'reactions only',
  'party.line.off': 'no chat',
  'party.line.best': 'teams by best guess',
  'party.line.average': 'teams by average',

  // The lobby: settings, the lock, teams, queueing for 2v2 as a pair
  'party.settings.change': 'Change settings',
  'party.settings.save': 'Save settings',
  'party.settings.form': 'Party settings',
  'party.lock': 'Lock party',
  'party.unlock': 'Unlock party',
  'party.locked.tag': 'locked',
  'party.locked.note': 'This party is locked. Nobody new can join.',
  'party.team.join': 'Join',
  'party.team.joinLabel': 'Join {team}',
  'party.team.unseated': 'No team yet',
  'party.team.empty': 'Nobody yet',
  'party.team.shuffle': 'Shuffle teams',
  'party.team.hint': 'Pick a team. Anyone without one joins the smaller team when the match starts.',
  'party.pair.button': 'Queue for 2v2 together',
  'party.pair.note': 'With exactly two of you here, you can queue for 2v2 as teammates. This closes the party.',
  'party.pair.queued': 'You and your teammate are in the 2v2 queue together.',

  // What only the host has
  'host.title': 'Host',
  'host.label': 'Host controls',
  'host.kick': 'Kick',
  'host.kickLabel': 'Kick {name}',
  'host.kickConfirm': 'Remove {name} from the party? They cannot come back.',
  'host.kickYes': 'Remove',
  'host.makeHost': 'Make host',
  'host.makeHostLabel': 'Make {name} the host',
  'host.moreLabel': 'Actions for {name}',
  'host.endRound': 'End round',

  // A round with no timer
  'party.noTimer.label': 'No timer',
  'party.noTimer': 'The round ends when everyone has guessed, or when the host ends it.',
  'party.noTimerHost': 'The round ends when everyone has guessed, or when you end it.',

  // Teams in a match
  'team.health': 'Team health',
  'team.healthLeft': '{health} health',

  // Chat in a match with teams
  'chat.scope': 'Send to',
  'chat.scope.all': 'All',
  'chat.scope.team': 'Team',
  'chat.teamTag': 'team',

  // Wave 6
  'party.guests': 'Allow guests',
  'party.guests.on': 'Yes',
  'party.guests.off': 'No',
  'party.guests.note': 'A guest plays without an account. With this off, only players who are signed in can join.',
  'party.guests.stay': 'Guests who are already here stay. You can remove them from the list of players.',
  'party.line.accountsOnly': 'accounts only',
  'party.accountsOnly.label': 'Accounts only',
  'party.accountsOnly': 'This party is for players with an account. Sign up to join it: it is free and takes a username and a password.',
} as const;
