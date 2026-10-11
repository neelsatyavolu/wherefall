/** Wave 5, English: singleplayer options, the two guessers, settings and the About pane. Keys as in `../en.ts`. */
export const solo = {
  // Sidebar
  'nav.item.country': 'Country Guesser',
  'nav.item.continent': 'Continent Guesser',
  'nav.item.about': 'About',

  // A round's time, written out: 40 sec, 2 min, 1 min 30 sec
  'time.seconds': '{seconds} sec',
  'time.minutes': '{minutes} min',
  'time.minutesSeconds': '{minutes} min {seconds} sec',
  /** the buttons either side of the time slider */
  'time.less': 'Less time',
  'time.more': 'More time',

  // Singleplayer options
  'singleplayer.roadNames': 'Road names on the map',
  'singleplayer.roadNames.off': 'Hidden',
  'singleplayer.roadNames.on': 'Shown',

  // Settings
  'prefs.volume': 'Volume',

  // The six continents of the Continent Guesser
  'continent.africa': 'Africa',
  'continent.asia': 'Asia',
  'continent.europe': 'Europe',
  'continent.north-america': 'North America',
  'continent.oceania': 'Oceania',
  'continent.south-america': 'South America',

  // The guessers' panes
  'guesser.country.lede': 'Ten places, anywhere in the world. Each comes with six countries: pick the one it is in. A right answer is 1,000 points.',
  'guesser.continent.lede': 'Ten places, anywhere in the world. For each one, pick the continent it is on. A right answer is 1,000 points.',
  'guesser.best': 'Your best score: {score} of {max}',
  'guesser.fine': 'Signed in, your best score is kept and each right answer earns 20 XP.',
  'guesser.continent.note': 'Central America and the Caribbean count as North America, Turkey and the Caucasus as Asia. Russia is Europe west of the Urals and Asia east of them.',

  // A guesser round
  'guesser.country.ask': 'Which country is this?',
  'guesser.continent.ask': 'Which continent is this?',
  'guesser.wrong': 'Wrong',
  /** after a wrong answer; {answer} is a country or a continent */
  'guesser.itWas': 'Wrong. It was {answer}.',
  'guesser.answer': 'Answer',
  'guesser.yours': 'Your answer',
  'guesser.outOfPlaces': 'There are no more places to show, so this game cannot be finished.',
  'guesser.save.signedOut': 'You are not signed in, so this score is not kept.',
  'guesser.save.failed': 'This score could not be saved.',
  'guesser.save.best': 'Your best score is {score}.',

  // Wave 6, what a save says: XP stopped at the day's limit, or the places changed under the game
  /** after "Saved to …": the day's 20,000 XP from playing alone was already reached */
  'save.xpCapped': "Today's XP limit for solo games is reached, so no XP was added.",
  /** after "+120 XP.": this game reached it */
  'save.xpCut': "That reaches today's XP limit for solo games, so only part of the XP was added.",
  /** after the server's own words for places it does not know; the lists are read again for the next game, so no reload is asked for */
  'save.placesChanged': 'Wherefall was updated while this page was open, and its places changed. Your next game is played on the current ones.',

  // About
  'about.lede': 'A free game of working out where in the world a street is.',
  'about.what.title': 'What Wherefall is',
  'about.what.1': 'Wherefall drops you somewhere on Earth at street level. You look around, work out where you are, and put a pin on the map. It is free, there are no adverts, and an account is optional.',
  'about.what.2': 'Play alone, take the daily challenge, or play other people in ranked duels, 2v2, unranked matches and private parties. Players make maps of their own and share them.',
  'about.scoring.title': 'How scoring works',
  'about.scoring.1': 'A round is worth up to 5,000 points. A pin within 30 m of the place is a perfect round.',
  'about.scoring.2': 'Beyond that the score falls off with distance. On the world map the scale is 20,000 km: about 3,000 points for a pin 1,000 km away, about 400 at 5,000 km. A region, a country or a community map is scored on its own size, so the same miss costs more on a smaller map.',
  'about.scoring.3': 'A hint draws a circle on the map with the place inside it, and halves that round. In Country Guesser and Continent Guesser each right answer is 1,000 points.',
  'about.faq.title': 'Questions',
  'about.faq.account.q': 'Do I need an account?',
  'about.faq.account.a': 'No. Everything you play alone works without one, and a guest can join unranked matches and parties. An account keeps your stats and best scores, puts you on the leaderboards, and is needed for ranked duels, 2v2, friends and making maps.',
  'about.faq.link.q': 'Does a friend get the same places from my link?',
  'about.faq.link.a': 'Yes, when you both see the same imagery. A link carries the map, the settings and a seed, and the seed decides the places. Street View and Panoramax each have their own list of places, so a player on the other one gets other places.',
  'about.faq.imagery.q': 'Why do I sometimes get Panoramax pictures?',
  'about.faq.imagery.a': 'Street View has a daily allowance on this site. When it is used up, or Google cannot be reached, the game carries on with open imagery from Panoramax.',
  'about.faq.repeats.q': 'Will I see the same place twice?',
  'about.faq.repeats.a': 'Rarely. This browser remembers the last 5,000 places it has shown you and steers new games away from them. Challenge links, the daily challenge and matches are left alone, so everyone in them gets the same places.',
  'about.faq.phone.q': 'Can I play on a phone?',
  'about.faq.phone.a': 'Yes. Wherefall runs in a phone browser, and where the browser allows it you can install it as an app from the menu.',
  'about.credits.title': 'Credits',
  'about.credits.google': 'Street imagery from Google Street View, © Google.',
  'about.credits.panoramax': 'Open street imagery from {panoramax} contributors, under open licences.',
  'about.credits.maps': 'The map is drawn by {openfreemap} from data © OpenStreetMap contributors.',
  /** a placeholder: the sources of the satellite and terrain tiles are named here once they are chosen */
  'about.credits.tiles': 'Satellite map: EOxCloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0. Terrain map: OpenTopoMap (CC-BY-SA), from OpenStreetMap and SRTM data.',
  'about.changes.title': 'What is new',
  'about.changes.version': 'Update {number}',
  'about.changes.5': 'Scoring on a 20,000 km world scale, a daily challenge of three rounds with streaks, guests in online games, Country Guesser and Continent Guesser, teams and more options for parties, round times from 10 seconds to 5 minutes, a volume setting and this page.',
  'about.changes.4': 'Five languages, sounds, an app you can install, skipping a place that will not load, joining a public game under way, and moderation.',
  'about.changes.3': 'Community maps to play and to make, progress charts on profiles, and public matches for more than two players.',
  'about.changes.2': 'A detailed pin map, the country streak, hints, country maps, miles or kilometres, leagues, XP and levels, leaderboards, profiles, game history, friends and chat.',
  'about.changes.1': 'The sidebar, accounts, ranked duels, unranked and 2v2 matches, parties and the daily challenge.',

  /** the phone's menu row while the list is open: what a tap on it does */
  'home.menuClose': 'Close',

  // Wave 6, a first visit: the welcome before the home screen, and a fact with each of the tutorial's results
  'welcome.label': 'Welcome',
  'welcome.lede': 'Wherefall is a free game of working out where in the world you are. It drops you on a street somewhere on Earth: look around, then put a pin on the map.',
  'welcome.tutorial': 'Show me how',
  'welcome.skip': 'Skip',
  'welcome.note': 'The tutorial is two short rounds with tips along the way. It is not saved.',
  /** one true sentence about each of the tutorial's places, shown with its round's result */
  'tutorial.fact.eiffel': "The Eiffel Tower was built for the 1889 World's Fair and was the tallest structure in the world until 1930.",
  'tutorial.fact.colosseum': 'The Colosseum opened in the year 80 and is the largest amphitheatre the Romans ever built.',
} as const;
