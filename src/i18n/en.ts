import { round } from './en/round.ts';
import { solo } from './en/solo.ts';
import { match } from './en/match.ts';
import { daily } from './en/daily.ts';
import { account } from './en/account.ts';
import { maps } from './en/maps.ts';
import { social } from './en/social.ts';
import { party } from './en/party.ts';

/**
 * English: the catalog every other language is checked against. A key is `area.what`; `{name}`
 * marks a value put in when the string is used. A string that changes with a count has one key per
 * plural form, ending `.one`, `.other` (and, in languages that need them, `.few`, `.many`).
 */
export const en = {
  // the strings added in wave 5 live in a file per area, beside this one
  ...round,
  ...solo,
  ...match,
  ...daily,
  ...account,
  ...maps,
  ...social,
  ...party,

  'language.name': 'Language',

  // Shared buttons and short lines
  'common.tryAgain': 'Try again',
  'common.home': 'Home',
  'common.cancel': 'Cancel',
  'common.remove': 'Remove',
  'common.report': 'Report',
  'common.sendReport': 'Send report',
  'common.reportPlayer': 'Report {name}',
  'common.linkCopied': 'Link copied',
  'common.signIn': 'Sign in or create an account',
  'common.playTutorial': 'Play the tutorial',
  'common.typeToSearch': 'Type to search',
  'common.connectionLost': 'Connection lost. {error}',
  'common.matchOver': 'The match is over.',
  'common.joiningMatch': 'Joining the match',
  'common.loadingFriends': 'Loading your friends',
  'common.makeMap': 'Make a map',
  'common.editMap': 'Edit map',
  'common.leaveMatch': 'Leave match',
  'common.partyCode': 'Party code',
  'common.findingPlaces': 'Finding places',
  'common.loadingView': 'Loading the view',
  /** two names in a list; three are joined as "a and b and c" */
  'common.pair': '{first} and {second}',

  // Shared labels: table headings, figure labels, form legends
  'label.rating': 'Rating',
  'label.points': 'Points',
  'label.rounds': 'Rounds',
  'label.round': 'Round',
  'label.map': 'Map',
  'label.mode': 'Mode',
  'label.league': 'League',
  'label.bestStreak': 'Best streak',
  'label.noGuess': 'No guess',
  'label.distance': 'Distance',
  'label.country': 'Country',
  'label.player': 'Player',
  'label.timePerRound': 'Time per round',
  'label.xp': 'XP',
  'label.rankedDuels': 'Ranked duels',
  'label.games': 'Games',
  'label.recentGames': 'Recent games',
  'label.score': 'Score',
  'label.places': 'Places',
  'label.level': 'Level',
  'label.streak': 'Streak',
  'label.chat': 'Chat',

  // Tags beside a name or a score
  'tag.you': 'you',
  'tag.host': 'host',
  'tag.won': 'won',
  'tag.away': 'away',
  'tag.hint': 'hint',

  // Leagues, lowest first. The server sends the English name; `league.<name>` is how it is shown
  'league.Trekker': 'Trekker',
  'league.Explorer': 'Explorer',
  'league.Voyager': 'Voyager',
  'league.Nomad': 'Nomad',
  'league.Legend': 'Legend',

  // The sidebar
  'nav.group.solo': 'Solo',
  'nav.group.online': 'Online',
  'nav.group.party': 'Party',
  'nav.group.community': 'Community',
  'nav.item.singleplayer': 'Singleplayer',
  'nav.item.streak': 'Country streak',
  'nav.item.daily': 'Daily challenge',
  'nav.item.ranked': 'Ranked duel',
  'nav.item.unranked': 'Unranked match',
  'nav.item.team': '2v2 match',
  'nav.item.create': 'Create party',
  'nav.item.join': 'Join party',
  'nav.item.maps': 'Maps',
  'nav.item.leaderboards': 'Leaderboards',
  'nav.item.friends': 'Friends',
  'nav.item.account': 'Account',
  'nav.item.moderation': 'Moderation',

  // Official maps
  'map.world': 'World',
  'map.europe': 'Europe',
  'map.americas': 'Americas',
  'map.asia-oceania': 'Asia & Oceania',
  'map.africa': 'Africa',
  'map.community': 'Community map',
  'map.tooFewPlaces.one': '{name} has {count} place. Choose fewer rounds.',
  'map.tooFewPlaces.other': '{name} has {count} places. Choose fewer rounds.',

  // Game settings: a mode as a choice, and inside a settings line such as "World · 5 rounds · 1 min · move"
  'mode.move': 'Move',
  'mode.no-move': 'No move',
  'mode.nmpz': 'No move, pan or zoom',
  'settings.mode.move': 'move',
  'settings.mode.no-move': 'no move',
  'settings.mode.nmpz': 'no move, pan or zoom',
  'settings.rounds.one': '{count} round',
  'settings.rounds.other': '{count} rounds',
  'time.0': 'No limit',

  // Loading and failing to load a game
  'load.places': 'Loading places',
  'load.failed': 'The game could not be loaded. Check your connection and try again.',
  'error.unreachable': 'Could not reach the server. Check your connection and try again.',
  'error.unexpected': 'The server sent a reply this page could not read. Try again in a moment.',

  // What the summary says about saving a finished game
  'save.xp': '+{xp} XP.',
  'save.tutorial': 'That was the tutorial. It is not saved and does not count for stats.',
  'save.game.signedOut': 'Sign in from the home screen to keep your stats.',
  'save.game.failed': 'This game could not be saved to your stats.',
  'save.game.saved': "Saved to {name}'s stats.",
  'save.game.recount.one': 'The server counted it as {count} points.',
  'save.game.recount.other': 'The server counted it as {count} points.',
  'save.daily.signedOut': 'You are not signed in, so this result is not on the leaderboard.',
  'save.daily.failed': 'This result could not be put on the leaderboard.',
  'save.daily.saved': "On today's leaderboard as {name}.",
  'save.daily.firstStays': "Your first result today stays on the leaderboard as {name}'s.",
  'save.streak.signedOut': 'Sign in from the home screen to keep your best streak.',
  'save.streak.failed': 'This run could not be saved.',
  'save.streak.best': 'Your best streak is {streak}.',

  // The tutorial's coach
  'tutorial.label': 'Tutorial',
  'tutorial.hide': 'Hide tips',
  'tutorial.tip.look': 'Look around: drag the picture with the mouse or a finger.',
  'tutorial.tip.move': 'Walk down the street: click an arrow on the road, or press the up arrow key.',
  'tutorial.tip.map': 'Now the map. Move the pointer over it in the corner, or press Open map on a phone.',
  'tutorial.tip.pin': 'Click the map where you think you are. Zoom in with + to be exact.',
  'tutorial.tip.guess': 'Happy with the pin? Press Guess. You can move the pin first.',
  'tutorial.tip.result': 'The dashed line is how far off you were: the shorter it is, the more points. Press Next round.',
  'tutorial.tip.solo': 'This one is yours to find. No more tips.',

  // How a match ended
  'outcome.cancelled': 'The match was cancelled before it began.',
  'outcome.draw': 'A draw.',
  'outcome.yourTeam': 'Your team won.',
  'outcome.otherTeam': 'The other team won.',
  'outcome.you': 'You won.',
  'outcome.won.one': '{names} won.',
  'outcome.won.other': '{names} won.',

  // What stops a map draft being saved
  'draft.name': 'Give the map a name of {min} to {max} characters.',
  'draft.description': 'Give the map a short description of {min} to {max} characters.',
  'draft.places': 'A map needs at least {min} places. Add {missing} more.',

  // Who a picture is by, under a round's result
  'credit.google': 'Imagery {copyright}',
  'credit.panoramax': 'Photo by {name}, {licence}, via Panoramax',
  'credit.contributor': 'a Panoramax contributor',
  'credit.openLicence': 'open licence',

  // The round screen: HUD, street view tools, the Guess button
  'round.time': 'Time',
  'round.exit': 'Exit',
  /** the letter on the compass needle */
  'round.north': 'N',
  'round.placePin': 'Place your pin',
  'round.guess': 'Guess',
  'round.openMap': 'Open map',
  'round.closeMap': 'Close map',
  'round.returnToStart': 'Return to start',
  'round.hint': 'Hint (half points)',
  'round.hintShown': 'Hint shown',
  'round.hintTitle': 'Draws a circle on the map that contains the place. Halves the points for this round.',
  /** the imagery credit when the first choice of imagery could not be used */
  'round.creditStandIn': '{credit} (standing in today)',

  // The guess map's tools
  'guessMap.zoom': 'Zoom',
  'guessMap.zoomIn': 'Zoom in',
  'guessMap.zoomOut': 'Zoom out',
  'guessMap.size': 'Map size',
  'guessMap.size.small': 'Small map',
  'guessMap.size.medium': 'Medium map',
  'guessMap.size.large': 'Large map',
  'guessMap.marker': 'Map marker',

  // The street view
  'pano.blocked': 'That way is blocked',
  'pano.loading': 'Loading...',
  'provider.panoramaxCredit': 'Imagery: Panoramax contributors',

  // A local game
  'play.again': 'Play again',
  'play.keepPlaying': 'Keep playing',
  'play.skipPlace': 'Skip this place',
  'play.viewFailed': 'This view would not load. Check your connection and try again.',
  'play.findingAnother': 'Finding another place',
  'play.noSpare': 'There is no other place to switch to in this game.',
  'play.leaveConfirm': 'Leave this game? The rounds you have played will not be saved.',
  'play.leave': 'Leave game',
  'play.tooFewPlaces.one': '{name} has {count} place, too few for {rounds} rounds. Start it again with fewer.',
  'play.tooFewPlaces.other': '{name} has {count} places, too few for {rounds} rounds. Start it again with fewer.',
  'play.communityUnavailable': 'This map is made of Google Street View places, which cannot be shown right now, so it cannot be played. Try it again later.',

  // The panel after a round
  'result.label': 'Round result',
  'result.openInMaps': 'Open in Google Maps',
  'result.timedOut': 'Time ran out before you placed a pin.',
  'result.hinted': 'You used the hint, so this round scored half.',
  'result.next': 'Next round',
  'result.seeSummary': 'See summary',

  // The panel after a game
  'summary.label': 'Game summary',
  'summary.finalScore': 'Final score',
  'summary.share': 'Send the link to a friend and they will get the same places.',
  'summary.copyLink': 'Copy challenge link',
  'summary.linkLabel': 'Challenge link',

  // A country streak run
  'streakPlay.notInCountry': 'That is not in a country',
  'streakPlay.guessCountry': 'Guess {country}',
  'streakPlay.correct': 'Correct',
  'streakPlay.correctCountry': 'Correct: {country}',
  'streakPlay.nextFailed': 'The next place could not be loaded. Check your connection and try again.',
  'streakPlay.endConfirm': 'End this run? Your streak of {streak} is kept.',
  'streakPlay.end': 'End run',
  'streakPlay.overLabel': 'Streak over',
  /** after the streak's number, which is drawn large beside it */
  'streakPlay.countries.one': 'country',
  'streakPlay.countries.other': 'countries',
  'streakPlay.unbeaten': '{streak} in a row, and that is every place in this run.',
  'streakPlay.wrong': 'It was {answer}. You said {guess}.',
  'streakPlay.noPick': 'It was {answer}. You did not pick a country.',

  // A saved game, round by round
  'history.title': 'Game',
  'history.back': 'Back to account',
  'history.loading': 'Loading the game',
  'history.daily': 'daily challenge',
  'history.mapLabel': 'Map of the places and your guesses',
  'history.noMap': 'This game was saved before places were kept, so there is no map of it.',

  // The progress charts
  'chart.label': 'Progress',
  'chart.title': 'Progress',
  'chart.empty': 'Not enough history to draw yet. A point is added for each day XP or rating changes.',
  'chart.summary': '{name} from {first} to {last}: {min} at lowest, {max} at highest, now {now}',

  // Figures, the level bar and the games table of an account or a profile
  'stats.xp': '{xp} XP',
  'stats.toLevel': '{xp} to level {level}',
  'stats.levelProgress': 'Progress to the next level',
  'stats.date': 'Date',
  'stats.mode.move': 'Moving',
  'stats.mode.no-move': 'No move',
  'stats.mode.nmpz': 'NMPZ',
  'stats.openRounds.one': 'Rounds of the game on {day}, {count} points',
  'stats.openRounds.other': 'Rounds of the game on {day}, {count} points',

  // A match: loading it, the round, leaving it
  'match.multiplayer': 'Multiplayer',
  'match.loading': 'Loading the match',
  'match.loadFailed': 'The match could not be loaded. Check your connection and try again.',
  'match.placesFailed': 'The places could not be loaded. Check your connection and try again.',
  'match.loadingPlaces': 'Loading the places',
  'match.waitingForPlaces': 'Waiting for the places',
  'match.roundStartsIn': 'Round starts in {seconds}',
  'match.viewMissing': 'This place cannot be shown on this device. You can still guess.',
  'match.waitForStart': 'Wait for the start',
  'match.guessSent': 'Guess sent',
  'match.timeUp': 'Time is up',
  'match.leaveConfirm': 'Leave this match? You will not be able to come back to it.',
  'match.stay': 'Stay',
  'match.reportConfirm': 'Report {name} to the moderators?',

  // A match: health, who has guessed, the round table, the standing
  'match.health': 'Health',
  'match.healthOf': '{name} health',
  'match.nameYou': '{name} (you)',
  'match.roster.label': 'Guesses this round',
  'match.status.guessed': 'guessed',
  'match.status.guessing': 'guessing',
  'match.status.away': 'away',
  'match.players': 'Players',
  'match.total': 'Total',
  'match.roundResult': 'Round result',
  'match.roundOf': 'Round {round} of {rounds}',
  'match.nextRoundIn': 'Next round in {seconds}',
  'match.finalIn': 'Final standing in {seconds}',
  'match.finalStanding': 'Final standing',
  'match.tag.left': 'left',
  'match.join.label': 'Joining a game under way',
  'match.join.title': 'A game under way',
  'match.join.round': 'You join in round {round}',
  'match.join.story': 'The rounds before that count as nothing for you. This is where the others stand.',

  // Teams in a 2v2 match
  'team.heading': 'Team',
  'team.tableLabel': 'Teams',
  'team.name': 'Team {number}',
  'team.nameYours': 'Team {number} (yours)',
  'team.yours': 'yours',

  // A party's lobby
  'lobby.title': 'Party',
  'lobby.copyLink': 'Copy join link',
  'lobby.joinLink': 'Join link',
  'lobby.playerCount': '{count} of {max}',
  'lobby.settings': 'Settings',
  'lobby.start': 'Start match',
  'lobby.leave': 'Leave party',
  'lobby.hint.ready': 'Everyone here plays. Start when you are ready.',
  'lobby.hint.needPlayers': 'A match needs at least two players. Share the code or the link.',
  'lobby.hint.waiting': 'Waiting for the host to start the match.',
  'lobby.invite.title': 'Invite friends',
  'lobby.invite.none': 'Friends you add on the Friends pane can be invited from here.',
  'lobby.invite.allHere': 'All your friends are here.',
  'lobby.invite.failed': 'Your friends could not be loaded.',
  'lobby.invite.button': 'Invite',
  'lobby.invite.label': 'Invite {name}',
  'lobby.invite.sent': 'Invited',

  // Chat in a lobby and over a match
  'chat.messages': 'Messages',
  'chat.empty': 'Nothing said yet.',
  'chat.message': 'Message',
  'chat.placeholder': 'Say something',
  'chat.send': 'Send',
  'chat.reactions': 'Reactions',
  'chat.close': 'Close chat',
  'chat.unread.one': '{count} new',
  'chat.unread.other': '{count} new',

  // The matchmaking panes: what each kind is, and the wait
  'queue.ranked.lede':
    'One opponent, and health instead of a total. You both start with 5,000; each round the lower scorer loses the difference. It ends when one of you runs out, or after five rounds.',
  'queue.ranked.facts': '1 v 1 · World · moving · up to 5 rounds · 1 min a round · rated',
  'queue.unranked.lede':
    'A public game for whoever is looking. Once a second player turns up a ten second countdown starts, and anyone who joins before it ends is in, up to ten. If a game is already under way with room and rounds to spare, you are dropped into it and play from its next round. The highest total after five rounds wins.',
  'queue.unranked.facts': '2 to 10 players · World · moving · 5 rounds · 45 sec a round · not rated',
  'queue.team.lede':
    'Four players in two teams, each with 5,000 health to share. Each round a team scores what its best member scores, and the lower team loses the difference and three tenths more. It ends when a team runs out, or after five rounds.',
  'queue.team.facts': '2 v 2 · World · moving · up to 5 rounds · 1 min a round · not rated',
  'queue.yourRating': 'Your rating: {rating}',
  'queue.find': 'Find a match',
  'queue.joining': 'Joining the queue',
  'queue.looking': 'Looking for players',
  'queue.startingIn': 'Starting in {seconds}',
  'queue.waiting.one': '{count} player waiting',
  'queue.waiting.other': '{count} players waiting',
  'queue.ranOut': 'The search ran out before a match was found. Start it again.',

  // Creating and joining a party
  'party.create.lede': 'A private match for two to forty players. You choose the settings, share the code, and start it when everyone is in.',
  'party.create.facts': '2 to 40 players · any map · your rules · not rated',
  'party.create.submit': 'Create party',
  'party.join.lede': 'Enter the six-character code from the host. A join link fills it in for you.',
  'party.join.facts': "A friend's private match · their rules · not rated",
  'party.join.submit': 'Join party',
  'party.join.empty': 'Enter the code the host gave you.',

  // The Friends pane
  'friends.lede': 'Add players by username, see who is online or in a party, and take up invites.',
  'friends.what': 'A friends list',
  'friends.add.label': 'Add a friend by username',
  'friends.add.submit': 'Send request',
  'friends.empty': 'No friends yet. Send a request by username; it shows up here for them to accept.',
  'friends.invites': 'Party invites',
  'friends.invitedYou': 'invited you',
  'friends.joinPartyOf': "Join {name}'s party",
  'friends.requests': 'Requests',
  'friends.accept': 'Accept',
  'friends.acceptName': 'Accept {name}',
  'friends.decline': 'Decline',
  'friends.declineName': 'Decline {name}',
  'friends.list': 'Friends',
  'friends.level': 'level {level}',
  'friends.removeName': 'Remove {name}',
  'friends.sent': 'Sent, waiting for an answer',
  'friends.cancelRequest': 'Cancel the request to {name}',

  // The Leaderboards pane
  'leaderboards.lede': 'The top hundred players by rating, by XP and by longest country streak: over all time, or by what they gained today.',
  'leaderboards.board': 'Board',
  'leaderboards.tab.rating': 'Rating',
  'leaderboards.tab.xp': 'XP',
  'leaderboards.tab.streak': 'Best streak',
  'leaderboards.column.rating': 'Rating',
  'leaderboards.column.xp': 'XP',
  'leaderboards.column.streak': 'Streak',
  'leaderboards.loading': 'Loading the board',
  'leaderboards.empty': 'No one is on this board yet.',
  'leaderboards.yourPlace': 'You are number {rank} with {value}.',

  // A player's profile
  'profile.loading': 'Loading the profile',
  'profile.since': 'Playing since {date}',
  'profile.stats': "{name}'s stats",
  'profile.noGames': 'No games yet.',
  'profile.report.open': 'Report player',
  'profile.report.placeholder': 'What they did (optional)',
  'profile.report.sent': 'Reported. A moderator will look at it.',

  // The Moderation pane
  'moderation.lede': 'Maps and players that others have reported. Removing a map deletes it; a ban stops online play, not playing alone.',
  'moderation.loading': 'Loading the reports',
  'moderation.maps.title': 'Reported maps',
  'moderation.maps.empty': 'No map is waiting for a decision.',
  'moderation.players.title': 'Reported players',
  'moderation.players.empty': 'No player is waiting for a decision.',
  'moderation.by': 'by {maker}',
  'moderation.reports.one': '{count} report',
  'moderation.reports.other': '{count} reports',
  'moderation.banned': 'banned',
  'moderation.removeMap': 'Remove map',
  'moderation.removeMapLabel': 'Remove the map {name}',
  'moderation.dismiss': 'Dismiss',
  'moderation.dismissLabel': 'Dismiss the reports on {name}',
  'moderation.ban': 'Ban',
  'moderation.banLabel': 'Ban {name} from online play',
  'moderation.unban': 'Lift ban',
  'moderation.unbanLabel': 'Lift the ban on {name}',

  // The home screen's shell: the sidebar and the unfinished-match banner
  'home.nav': 'Main',
  'home.menu': 'Menu',
  'home.install': 'Install Wherefall',
  'home.profile': 'Profile',
  'home.waiting.one': '{count} waiting',
  'home.waiting.other': '{count} waiting',
  'home.resume.label': 'Unfinished match',
  'home.resume.text': 'You are in a match that has not finished.',
  'home.resume.rejoin': 'Rejoin match',
  'home.resume.leave': 'Leave it',

  // What every pane shares: the way back, the account check and its notices
  'pane.back': 'Back',
  'pane.checkingAccount': 'Checking your account',
  'pane.needsAccount':
    '{what} needs an account, so other players can see who they are up against and your results have somewhere to go. It is free and takes a username and a password.',
  'play.what': 'Playing',
  'pane.banned': 'This account is banned from online play: matches, parties, chat, friends and map making. Playing alone still works.',
  'pane.playSingleplayer': 'Play singleplayer',

  // The first-visit introduction
  'intro.title': 'How to play',
  'intro.step.1': 'You are dropped somewhere on Earth, at street level.',
  'intro.step.2': 'Look around, walk the street if the mode allows it, and put a pin on the map where you think you are.',
  'intro.step.3': 'The closer the pin, the more of the 5,000 points a round you get.',
  'intro.dismiss': 'Got it',

  // Singleplayer
  'singleplayer.lede': 'Five places, a pin for each, up to 5,000 points a round. Pick a map and how hard to make it.',
  'singleplayer.challenge': 'Challenge',
  'singleplayer.challengeSent': 'You were sent a challenge',
  'singleplayer.playChallenge': 'Play challenge',
  'singleplayer.start': 'Start game',
  /** `{panoramax}` and `{openfreemap}` are links, each showing its own name */
  'singleplayer.credits':
    'Free to play. Playing takes a free account, which keeps your stats. Street imagery from Google Street View where available, otherwise from {panoramax} contributors under open licences. Map from {openfreemap} and OpenStreetMap.',

  // Country streak
  'streak.lede': 'One place after another, anywhere in the world. Click the country each one is in. The first wrong country ends the run.',
  'streak.best': 'Your best streak: {streak}',
  'streak.start': 'Start streak',
  'streak.fine': 'Signed in, your best streak is kept and each right country earns 20 XP.',

  // Daily challenge
  'daily.lede': 'Three places, the same for everyone, new every day at midnight UTC.',
  'daily.loading': "Loading today's challenge",
  'daily.today': 'Today',
  'daily.yourResult': 'Your result today',
  'daily.notPlayed': 'You have not played today. You get one attempt.',
  'daily.firstCounts': 'You get one attempt a day.',
  'daily.play': "Play today's challenge",
  'daily.againNote': 'One attempt a day. The next challenge opens at midnight UTC.',
  'daily.leaderboard': 'Leaderboard',
  'daily.todaysLeaderboard': "Today's leaderboard",
  'daily.empty': 'No results yet today. The first one in leads.',

  // Account: the sign-in form
  'account.lede': 'Your level, your stats and your games, on every device you sign in on. Playing takes one, and it is free.',
  'account.loading': 'Loading account',
  'account.login.name': 'Sign in',
  'account.login.busy': 'Signing in',
  'account.register.name': 'Create account',
  'account.register.busy': 'Creating account',
  'account.username': 'Username',
  'account.password': 'Password',
  'account.usernameHint': '3 to 20 letters, numbers or single underscores, not starting or ending with one.',
  'account.passwordHint': 'At least 8 characters. You are given a recovery code once the account is made: the only way back in if you forget the password.',
  'account.missing': 'Enter a username and a password.',

  // Account: a signed-in player
  'account.signedInAs': 'Signed in as',
  'account.signOut': 'Sign out',
  'account.stats': 'Your stats',
  'account.averageRound': 'Average round',
  'account.bestRound': 'Best round',
  'account.perfectRounds': 'Perfect rounds',
  'account.bestGame': 'Best game',
  'account.ofMax': 'of {max}',
  'account.noGames': 'No games yet. Finish a game while signed in and it is saved here.',
  'account.tutorialNote': 'Two guided rounds on famous places. It never counts for your stats.',
  'account.newUsername': 'New username',
  'account.rename': 'Change username',
  'account.renameHint': '3 to 20 letters, numbers or single underscores, not starting or ending with one. It can be changed once every 30 days.',
  'account.renameEmpty': 'Enter the username you want.',

  // Settings kept in this browser
  'prefs.units': 'Distances in',
  'prefs.units.km': 'Kilometres',
  'prefs.units.mi': 'Miles',
  'prefs.sound': 'Sound',
  'prefs.sound.on': 'On',
  'prefs.sound.off': 'Off',

  // Maps
  'maps.lede': 'Play an official map, or one another player made from places they chose. Make your own from anywhere with Street View.',
  'maps.search': 'Search maps',
  'maps.places.one': '{count} place',
  'maps.places.other': '{count} places',
  'maps.plays.one': '{count} play',
  'maps.plays.other': '{count} plays',
  'maps.likes.one': '{count} like',
  'maps.likes.other': '{count} likes',
  'maps.official': 'Official maps',
  'maps.loadingOfficial': 'Loading the official maps',
  'maps.officialFailed': 'The official maps could not be loaded.',
  'maps.noOfficial': 'No official map by that name.',
  'maps.allCountries.one': 'All {count} countries',
  'maps.allCountries.other': 'All {count} countries',
  'maps.choose': 'Choose',
  'maps.chooseMap': 'Choose {name}',
  /** `{maker}` is a link to the maker's profile */
  'maps.by': 'by {maker}',
  'maps.edit': 'Edit',
  'maps.loading': 'Loading maps',
  'maps.showMore': 'Show more',
  'maps.showMoreOf': 'Show more of {list}',
  'maps.popular': 'Popular community maps',
  'maps.popularEmpty': 'No one has made a map yet. Yours could be the first.',
  'maps.newest': 'Newest community maps',
  'maps.newestEmpty': 'Nothing new yet.',
  'maps.mine': 'My maps',
  'maps.mineEmpty': 'You have not made a map yet.',
  'maps.matching': 'Community maps matching "{query}"',
  'maps.noCommunity': 'No community map matches that.',

  // A community map's page
  'mapPage.loading': 'Loading the map',
  /** `{maker}` is a link to the maker's profile */
  'mapPage.byline': 'Community map by {maker} · made {date}',
  'mapPage.inNumbers': '{name} in numbers',
  'mapPage.plays': 'Plays',
  'mapPage.likes': 'Likes',
  'mapPage.noGoogle': 'A community map is made of Google Street View places. This site has no Google imagery set up right now, so the map cannot be played or previewed here.',
  'mapPage.play': 'Play this map',
  'mapPage.party': 'Start a party on it',
  'mapPage.like': 'Like',
  'mapPage.unlike': 'Unlike',
  'mapPage.preview': 'Where the places of {name} are',
  'mapPage.reportThis': 'Report this map',
  'mapPage.reportReason': 'What is wrong with it (optional)',
  'mapPage.reported': 'Reported. Someone will look at it.',
  'mapPage.yours': 'Your map',
  'mapPage.delete': 'Delete map',
  'mapPage.deleteConfirm': 'Delete it for good?',
  'mapPage.deleteYes': 'Yes, delete it',
  'mapPage.deleteNo': 'Keep it',

  // The map editor
  'editor.lede': 'Click anywhere on the world map to add the place nearest it that has Street View, or paste a list of places. Five places make a map; five thousand is the most.',
  /** what the sign-in notice says needs an account: "{what} needs an account, …" */
  'editor.what': 'Making a map',
  'editor.loading': 'Loading the editor',
  'editor.loadFailed': 'The editor could not be loaded. Check your connection and try again.',
  'editor.needsGoogle':
    'Map making needs Google Street View imagery: each place you click is matched to the nearest Street View panorama, and that is what gets played. This site has no Google imagery set up right now, so maps cannot be made or changed here.',
  'editor.backToMaps': 'Back to maps',
  'editor.loadingMap': 'Loading your map',
  'editor.notYours': 'This map was made by someone else, so it cannot be changed from your account.',
  'editor.name': 'Name',
  'editor.description': 'Short description',
  'editor.mapLabel': 'World map: click to add a place',
  'editor.clickToAdd': 'Click the map to add a place.',
  /** how many places the map has, after the word "Places": "Places · 12 of 500" */
  'editor.placesOf': '{placed} of {max}',
  'editor.removePlace': 'Remove place {number}, {country}',
  'editor.looking': 'Looking for Street View there',
  'editor.none': 'No Street View within 500 m of that spot.',
  'editor.noCountry': 'That Street View is not in any country, so it cannot be added.',
  'editor.full': 'The map is full.',
  'editor.duplicate': 'That place is already in the map.',
  'editor.added': 'Added a place in {country}.',
  'editor.unreachable': 'Street View could not be reached. Try that spot again in a moment.',
  'editor.publish': 'Publish map',
  'editor.save': 'Save changes',

  // The map choice in a game's settings
  'picker.loading': 'Loading the other maps',
  'picker.failed': 'The other maps could not be loaded. The world map still works.',
  'picker.aCountry': 'A country',
  'picker.countries': 'Countries',
  'picker.noCountry': 'No country by that name has enough places yet.',
  'picker.places.one': '{count} place',
  'picker.places.other': '{count} places',
} as const;
