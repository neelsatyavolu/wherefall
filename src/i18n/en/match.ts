/** Wave 5, English: guests, parties, 2v2, chat and the queues. Keys as in `../en.ts`. */
export const match = {
  // Guests: playing without an account, and what an account adds
  'guest.signUp': 'Sign up',
  'guest.label': 'Guest session',
  'guest.needsAccount':
    'This needs an account. You are here as {name}, a guest, and a guest can no longer play. An account keeps your results and opens every mode, friends, chat and map making. It is free and takes a username and a password.',
  'guest.chatNote': 'Guests can send reactions. Writing messages needs an account.',
  'session.ended': 'You are no longer signed in.',

  // A match: a session that ran out, and what the final screen offers
  'match.sessionEnded': 'You are no longer signed in, so you are out of this match.',
  'match.guestEnded': 'Your guest session has ended, so you are out of this match. A guest session lasts 24 hours.',
  'match.backToLobby': 'Back to lobby',
  'match.hostLobby': 'Back to lobby takes everyone who is still here with you.',
  'match.stayForLobby': 'Stay on this screen to remain in the party. The host can take everyone back to the lobby.',
  'match.xpEarned': 'You earned {xp} XP.',
  'match.xpEarnedRanked': 'You earned {xp} XP. Ranked duels pay double.',
  'match.roster.count': '{guessed} / {players} guessed',
  'match.reportSent': '{name} was reported. A moderator will look at it.',

  // The screen before a ranked duel's first round
  'versus.word': 'versus',
  'versus.label': 'Ranked duel: {first} versus {second}',

  // The queues: the wait, the ranked lock, coming back after the other player left
  'queue.ranked.xp': 'Ranked rounds pay double XP.',
  'queue.waited': 'Waiting for {time}',
  'queue.window': 'Opponents within ±{points} of your rating',
  'queue.locked': 'You left two ranked matches before they began. You can queue again in {time}.',
  'queue.dodged': 'The other player left before the match began. Your rating has not changed, and you are back in the queue.',

  // Chat: muting a player
  'chat.mute.title': 'Mute players',
  'chat.mute.note': 'What a muted player says is hidden from you for the rest of the match.',
  'chat.mute.tag': 'muted',
  'chat.mute.button': 'Mute',
  'chat.mute.undo': 'Unmute',
  'chat.mute.label': 'Mute {name}',
  'chat.mute.undoLabel': 'Unmute {name}',

  // Wave 6
  'match.placesRefused': 'The places drawn for this match were not accepted: {error}',
  'match.drawAgain': 'Draw new places',
  'match.removed.label': 'Removed',
  'queue.typical': 'Typical wait: {wait}',
  'queue.typical.underMinute': 'usually under a minute',
  'queue.typical.minutes.one': 'about {count} minute',
  'queue.typical.minutes.other': 'about {count} minutes',
  'queue.typical.none': 'no recent games',
} as const;
