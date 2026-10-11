// The players of the review set, and every number the stand-in servers give out about them.
// Only what cannot be worked out is written down: a player's XP, their rating, and what they gained
// today. Level, league, places on the boards and the history a chart is drawn from all follow from
// those, so a stat cell, a chart's headline and a row of a leaderboard cannot say different things.
import { leagueOf } from '../../e2e/account-server.ts';
import { historyGames } from '../../e2e/games-server.ts';
import { SocialServer, profile } from '../../e2e/social-server.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
export const ago = (ms) => new Date(Date.now() - ms).toISOString();
export const day = (daysAgo) => ago(daysAgo * DAY_MS).slice(0, 10);

/** The server's rule (server/account/progress.ts): level 2 at 250 XP, 3 at 1,000, 4 at 2,250. */
export const levelFor = (xp) => Math.floor(Math.sqrt(xp / 250)) + 1;

/** who the review is signed in as */
export const YOU = 'neel';
const NOTHING_TODAY = { xp: 0, rating: 0 };
const NO_GAMES = { wins: 0, losses: 0, ties: 0 };

/** A record of duels or of 2v2 games as the server sends it: the share won is rounded down, and nothing while none was played. */
export function record({ wins, losses, ties }) {
  const played = wins + losses + ties;
  return { wins, losses, ties, winRate: played === 0 ? 0 : Math.floor((wins * 100) / played) };
}

/**
 * The players met by name. `today` is what the day added, and is already in `xp` and `rating`: the
 * signed-in player's is what the newest day of the stand-in history of games adds up to (1,219 XP
 * over its five games, +18 from the ranked win). A rating gain comes with XP, since a ranked game
 * pays both. `rated: false` is a player with no ranked duel yet, who is on no rating board.
 * `duels` and `teams` are the ranked duels and the 2v2 games a player has won, lost and tied;
 * `inactive` is a player not seen for 14 days, whom the all-time boards leave out unless asked.
 */
const CAST = {
  neel: { country: 'IN', xp: 35_600, rating: 1016, today: { xp: 1219, rating: 18 }, duels: { wins: 2, losses: 1, ties: 0 }, teams: { wins: 7, losses: 4, ties: 1 } },
  sam: { country: 'GB', xp: 36_000, rating: 1004, today: { xp: 640, rating: 0 }, duels: { wins: 24, losses: 14, ties: 2 }, teams: { wins: 31, losses: 12, ties: 3 } },
  ana: { country: 'BR', xp: 640, rating: 990, today: { xp: 310, rating: 31 } },
  raj: { country: 'IN', xp: 9500, rating: 1120 },
  // joined today: everything kit has was earned today, and none of it in a ranked duel
  kit: { country: 'DE', xp: 1200, rating: 500, rated: false, today: { xp: 1200, rating: 0 } },
  lee: { country: 'JP', xp: 4200, rating: 870 },
  mia: { country: 'FR', xp: 61_000, rating: 1312 },
};

const FIRST = ['ka', 'ri', 'mo', 'ta', 'le', 'nu', 'sa', 'vi', 'do', 'en'];
const SECOND = ['lix', 'mar', 'ton', 'vek', 'ria', 'sol', 'dan', 'pio', 'kes', 'umi', 'bra'];
const FLAGS = ['DE', null, 'US', 'JP', null, 'FR', 'BR', 'KE', null, 'AU', 'GB', 'IN'];
/** one in this many of the other players has played today */
const PLAYED_TODAY = 17;
/** and one in this many has not been seen for 14 days */
const GONE_QUIET = 9;

/**
 * A hundred more players, so that the boards are as long as a busy site's: XP falling from 412,000
 * to just above the cast's, ratings spread over every league. The two name lists have 10 and 11
 * parts, so no two of the hundred share a name.
 */
const OTHERS = Array.from({ length: 100 }, (_, index) => {
  const i = index + 1;
  const played = i % PLAYED_TODAY === 0;
  return {
    username: `${FIRST[i % FIRST.length]}${SECOND[(i * 7) % SECOND.length]}${i % 4 === 0 ? 10 + ((i * 13) % 89) : ''}`,
    country: FLAGS[i % FLAGS.length],
    xp: Math.round((412_000 * 0.976 ** index) / 10) * 10,
    rating: 700 + ((i * 53) % 97) * 12,
    today: played ? { xp: 2400 - i * 20, rating: 40 - Math.floor(i / PLAYED_TODAY) * 7 } : NOTHING_TODAY,
    inactive: !played && i % GONE_QUIET === 4,
  };
});

const EVERYONE = [
  ...Object.entries(CAST).map(([username, each]) => ({ username, rated: true, inactive: false, today: NOTHING_TODAY, duels: NO_GAMES, teams: NO_GAMES, ...each })),
  ...OTHERS.map((each) => ({ rated: true, duels: NO_GAMES, teams: NO_GAMES, ...each })),
];
const SEEN_LATELY = EVERYONE.filter((each) => !each.inactive);
const TOP = 100;

/** Everyone a board is about, best first. A player's place on it is their rank everywhere else too. */
const ranked = (valueOf, among) => [...among].filter((each) => valueOf(each) > 0).sort((a, b) => valueOf(b) - valueOf(a));
const rated = (among) => among.filter((each) => each.rated);
/**
 * The boards. `all` is all time as the boards show it to begin with, without the players not seen
 * lately; `everyone` is all time with "Show inactive players" on; `day` is what today added.
 */
const LADDERS = {
  all: { rating: ranked((each) => each.rating, rated(SEEN_LATELY)), xp: ranked((each) => each.xp, SEEN_LATELY) },
  everyone: { rating: ranked((each) => each.rating, rated(EVERYONE)), xp: ranked((each) => each.xp, EVERYONE) },
  day: { rating: ranked((each) => each.today.rating, EVERYONE), xp: ranked((each) => each.today.xp, EVERYONE) },
};
const TOTALS = { rating: (each) => each.rating, xp: (each) => each.xp };
const VALUE = { all: TOTALS, everyone: TOTALS, day: { rating: (each) => each.today.rating, xp: (each) => each.today.xp } };

/** A player's place on a board, or null when they are not on it. */
function rankOf(username, period, board) {
  const index = LADDERS[period][board].findIndex((each) => each.username === username);
  return index === -1 ? null : index + 1;
}

/** One of the players as every screen describes them. */
export function person(username) {
  const found = EVERYONE.find((each) => each.username === username);
  if (!found) {
    throw new Error(`No such player in the review set: ${username}`);
  }
  return { ...found, level: levelFor(found.xp), league: leagueOf(found.rating), xpRank: rankOf(username, 'all', 'xp'), ratingRank: rankOf(username, 'all', 'rating') };
}

/** `count` of the other players seen lately, every second one down the XP board: the names and flags a full party has. */
export const crowd = (count) =>
  OTHERS.filter((each) => !each.inactive)
    .filter((_, index) => index % 2 === 1)
    .slice(0, count)
    .map(({ username, country }) => ({ username, country }));

/** The flag of a player the review knows, or none. */
export const countryOf = (username) => EVERYONE.find((each) => each.username === username)?.country ?? null;

/** A board as the server sends it: its top hundred, and where the signed-in player stands. */
function board(period, name) {
  const ladder = LADDERS[period][name];
  const valueOf = VALUE[period][name];
  const entries = ladder.slice(0, TOP).map((each, index) => ({ rank: index + 1, username: each.username, country: each.country, value: valueOf(each), level: levelFor(each.xp), league: leagueOf(each.rating) }));
  const rank = rankOf(YOU, period, name);
  return { entries, you: rank === null ? null : { rank, value: valueOf(ladder[rank - 1]) } };
}

const HISTORY_DAYS = 40;
/** when the signed-in player joined: before the first day of that history */
const JOINED_DAYS_AGO = 90;
/** places on the boards were only kept from the twenty-first of those days on */
const RANKS_KEPT_DAYS = 20;

/**
 * Forty days of a player's XP and rating, the last of them today and equal to what the player has
 * now. Yesterday is today less what today added; the days before go back a day's play at a time.
 * The places end on the player's places on the boards.
 */
export function historyOf(username) {
  const who = person(username);
  const steps = Array.from({ length: HISTORY_DAYS - 1 }, (_, back) => (back === 0 ? who.today : { xp: 300 + ((back * 37) % 7) * 80, rating: (((back * 29) % 9) - 3) * 6 }));
  // `values[back]` is what the player had that many days ago
  const values = steps.reduce((list, step) => [...list, { xp: Math.max(0, list.at(-1).xp - step.xp), rating: list.at(-1).rating - step.rating }], [{ xp: who.xp, rating: who.rating }]);
  const kept = (back) => back < RANKS_KEPT_DAYS;
  return values
    .map((value, back) => ({
      day: day(back),
      ...value,
      xpRank: kept(back) && who.xpRank !== null ? who.xpRank + back * 2 : null,
      ratingRank: kept(back) && who.ratingRank !== null ? who.ratingRank + Math.floor(back / 2) : null,
    }))
    .reverse();
}

export const RATING = CAST[YOU].rating;
/** how many games the signed-in player has played: more than the longest history a scene lists */
export const GAMES_PLAYED = 118;
const ROUNDS_A_GAME = 5;

/** The account the review is signed in to: one with a country, a streak, duels and both guessers played. */
export const SEASONED = {
  country: CAST[YOU].country,
  loginStreak: 5,
  bestCountry: 9000,
  bestContinent: 10_000,
  xp: CAST[YOU].xp,
  level: levelFor(CAST[YOU].xp),
  duels: { ...record(CAST[YOU].duels), rank: rankOf(YOU, 'all', 'rating') },
  teams: record(CAST[YOU].teams),
};

/** The stats of the signed-in account, with as many games as its XP and its history take. */
export const seasonedStats = (stats) => ({ ...stats, gamesPlayed: GAMES_PLAYED, roundsPlayed: GAMES_PLAYED * ROUNDS_A_GAME });

/** What a profile says of a player that the world decides: the numbers, and the place among the rated. */
const standing = (username) => {
  const who = person(username);
  const duels = record(who.duels);
  const played = duels.wins + duels.losses + duels.ties;
  return { country: who.country, xp: who.xp, level: who.level, rating: who.rating, league: who.league, ratedGames: played, duels: { ...duels, rank: who.ratingRank }, teams: record(who.teams) };
};

/**
 * Fills a stand-in social server with this world: the profiles the review opens ("sam" and the
 * player's own, each with forty days of history, and "kit", who joined today) and the boards.
 * The best-streak boards are left empty: they are the review's picture of a board nobody is on.
 */
export function fillWorld(social) {
  const { sam, neel } = social.profiles;
  social.profiles = {
    ...social.profiles,
    sam: { ...sam, ...standing('sam'), history: historyOf('sam'), lastSeenAt: ago(MINUTE_MS) },
    neel: {
      ...neel,
      ...standing(YOU),
      bestCountry: SEASONED.bestCountry,
      bestContinent: SEASONED.bestContinent,
      gamesPlayed: GAMES_PLAYED,
      // an account older than its forty days of history, looked at by its owner: online, with the games the account lists
      joinedAt: ago(JOINED_DAYS_AGO * DAY_MS),
      online: true,
      lastSeenAt: ago(0),
      views: 14,
      recentGames: historyGames().map(({ id, playedAt, map, mode, rounds, score, maxScore }) => ({ id, playedAt, map, mode, rounds, score, maxScore })),
      history: historyOf(YOU),
    },
    kit: profile('kit', { ...standing('kit'), joinedAt: ago(5 * HOUR_MS), views: 1, friend: 'incoming', lastSeenAt: ago(3 * HOUR_MS) }),
  };
  social.boards = boards('all', social.boards);
  social.reports = myReports();
  social.moderation = { ...social.moderation, players: reportedPlayers() };
}

/** The boards over all time (`all`, or `everyone` with the players not seen lately) and by today's gain. */
const boards = (allTime, was) => ({
  all: { ...was.all, rating: board(allTime, 'rating'), xp: board(allTime, 'xp') },
  day: { ...was.day, rating: board('day', 'rating'), xp: board('day', 'xp') },
});

/**
 * What the boards answer once "Show inactive players" is on: the same players in the same order,
 * with the ones not seen for 14 days back among them, and the player's own place counted among all.
 * (The stand-in itself only takes names off a board and counts the rest again; it leaves the
 * player's own place as it was, which would put two different places for one player on a screen.)
 */
export function showInactive(social) {
  social.boards = boards('everyone', social.boards);
}

// --- reports ---------------------------------------------------------------------------------------

/**
 * Every report of a player there is, newest first: who sent it, about whom, what about, the note,
 * how long ago, and what a moderator did. The signed-in player's own are "My reports" on the
 * account pane; the open ones are what the moderation pane lists; a report that was acted on left
 * its player banned.
 */
/** the player a report got banned: one of the many, gone quiet since, whom no scene meets in a match */
const BANNED = OTHERS.find((each) => each.inactive).username;

const REPORTS = [
  { by: YOU, on: 'kit', category: 'chat', note: 'rude in chat', hoursAgo: 3.5, status: 'open' },
  { by: 'ana', on: 'kit', category: 'other', note: 'left every game', hoursAgo: 4, status: 'open' },
  { by: 'sam', on: 'kit', category: 'cheating', note: '', hoursAgo: 4.5, status: 'open' },
  { by: 'mia', on: 'ana', category: 'chat', note: 'the same line over and over', hoursAgo: 20, status: 'open' },
  { by: YOU, on: BANNED, category: 'cheating', note: 'every guess on the spot within three seconds', hoursAgo: 15 * 24, status: 'actioned' },
  { by: YOU, on: 'raj', category: 'other', note: 'kept leaving our duels', hoursAgo: 12 * 24, status: 'dismissed' },
];

/** The signed-in player's own reports as `?reports=1` lists them, newest first. */
export const myReports = () =>
  [...REPORTS]
    .filter((each) => each.by === YOU)
    .sort((a, b) => a.hoursAgo - b.hoursAgo)
    .map(({ on, category, note, hoursAgo, status }) => ({ username: on, category, note, at: ago(hoursAgo * HOUR_MS), status }));

/** The players a moderator has to decide on, each with their open reports, and after them the players a report got banned. */
export function reportedPlayers() {
  const open = REPORTS.filter((each) => each.status === 'open');
  const waiting = [...new Set(open.map((each) => each.on))].map((username) => {
    const reasons = open.filter((each) => each.on === username).map(({ category, note }) => ({ category, note }));
    return { username, reports: reasons.length, reasons, banned: false };
  });
  const banned = [...new Set(REPORTS.filter((each) => each.status === 'actioned').map((each) => each.on))].map((username) => ({ username, reports: 0, reasons: [], banned: true }));
  return [...waiting, ...banned];
}

/** What the reports have wrong: a player nobody knows, a report of oneself, two of one player by one sender, a banned player still seen lately. */
function reportProblems() {
  const known = (username) => EVERYONE.some((each) => each.username === username);
  const pairs = REPORTS.map((each) => `${each.by} on ${each.on}`);
  return [
    ...REPORTS.filter((each) => !known(each.by) || !known(each.on)).map((each) => `a report names a player the world does not have: ${each.by} on ${each.on}`),
    ...REPORTS.filter((each) => each.by === each.on).map((each) => `${each.by} reports themselves`),
    ...pairs.filter((pair, index) => pairs.indexOf(pair) !== index).map((pair) => `two reports by ${pair}: a second replaces the first`),
    ...REPORTS.filter((each) => each.status === 'actioned' && known(each.on) && !person(each.on).inactive).map((each) => `${each.on} was banned and is still said to be seen lately`),
    ...REPORTS.filter((each) => each.status === 'actioned' && each.on in CAST).map((each) => `${each.on} was banned, and the scenes have them playing online`),
    ...REPORTS.filter((each) => each.status !== 'open' && REPORTS.some((other) => other.on === each.on && other.status === 'open')).map((each) => `${each.on} has a report that was decided and one still open`),
  ];
}

/** What the boards with the inactive players have wrong against the ones without: an order that differs, or a place that got better by adding players. */
function inactiveProblems(shown, withInactive, name) {
  const names = withInactive.entries.map((each) => each.username);
  const kept = shown.entries.map((each) => each.username).filter((username) => names.includes(username));
  const order = names.filter((username) => kept.includes(username));
  return [
    ...(JSON.stringify(order) === JSON.stringify(kept) ? [] : [`the ${name} board with inactive players puts the others in another order`]),
    ...(names.length > 0 && names.every((username) => !person(username).inactive) ? [`the ${name} board with inactive players shows none`] : []),
    ...(shown.entries.some((each) => person(each.username).inactive) ? [`the ${name} board shows an inactive player without being asked`] : []),
    ...((withInactive.you?.rank ?? 0) < (shown.you?.rank ?? 0) ? [`the player's place on the ${name} board is better with inactive players than without`] : []),
  ];
}

/** What a list of players has wrong against the world: a level its XP does not give, a league its rating does not. */
const misdescribed = (where, rows) =>
  rows
    .filter((row) => EVERYONE.some((each) => each.username === row.username))
    .filter((row) => row.level !== person(row.username).level || row.league !== person(row.username).league)
    .map((row) => `${where}: ${row.username} is level ${row.level}, ${row.league}; the world has level ${person(row.username).level}, ${person(row.username).league}`);

/** What a profile has wrong against itself: its level and league, and the last day of its history. */
function profileProblems(found) {
  const last = found.history.at(-1);
  const says = (what, got, want) => (got === want ? [] : [`${found.username}'s profile: ${what} is ${got}, and should be ${want}`]);
  return [
    ...says('level', found.level, levelFor(found.xp)),
    ...says('league', found.league, leagueOf(found.rating)),
    ...(last ? [...says('the last XP of the history', last.xp, found.xp), ...says('the last rating of the history', last.rating, found.rating), ...says('the last rating rank of the history', last.ratingRank, found.duels.rank)] : []),
  ];
}

/**
 * Everything in the review's data that would make two parts of one screen disagree, as sentences.
 * Empty when the data is sound. `friends` is the friends list a scene shows.
 */
export function worldProblems(friends = []) {
  const social = new SocialServer();
  fillWorld(social);
  const own = social.profiles[YOU];
  const [yesterday, today] = own.history.slice(-2);
  const same = (what, got, want) => (got === want ? [] : [`${what} is ${got}, and should be ${want}`]);
  const { all, day: gained } = social.boards;
  const everyone = new SocialServer();
  fillWorld(everyone);
  showInactive(everyone);
  return [
    ...Object.values(social.profiles).flatMap(profileProblems),
    ...same('the account\'s level', SEASONED.level, own.level),
    ...same('the account\'s XP', SEASONED.xp, own.xp),
    ...same('the account\'s rating', RATING, own.rating),
    ...same('the account\'s rating rank', SEASONED.duels.rank, own.duels.rank),
    ...same('the own row of the rating board', JSON.stringify(all.rating.you), JSON.stringify({ rank: own.duels.rank, value: own.rating })),
    ...same('the own row of the XP board', JSON.stringify(all.xp.you), JSON.stringify({ rank: today.xpRank, value: own.xp })),
    ...same('the rating gained today on its board', gained.rating.you?.value, today.rating - yesterday.rating),
    ...same('the XP gained today on its board', gained.xp.you?.value, today.xp - yesterday.xp),
    ...[all.rating, all.xp, gained.rating, gained.xp].flatMap((each) => misdescribed('a board', each.entries)),
    ...misdescribed('the friends list', friends),
    ...same('the 2v2 record of the account', JSON.stringify(SEASONED.teams), JSON.stringify(own.teams)),
    ...same('the duel record of the account', JSON.stringify(SEASONED.duels), JSON.stringify(own.duels)),
    ...Object.values(social.profiles).flatMap((each) => same(`the ranked games of ${each.username}`, each.ratedGames, each.duels.wins + each.duels.losses + each.duels.ties)),
    ...EVERYONE.filter((each) => each.inactive && (each.today.xp > 0 || each.today.rating > 0)).map((each) => `${each.username} is inactive and played today`),
    ...friends.filter((each) => EVERYONE.some((known) => known.username === each.username) && person(each.username).inactive && each.online).map((each) => `${each.username} is online and inactive`),
    ...['rating', 'xp'].flatMap((name) => inactiveProblems(all[name], everyone.boards.all[name], name)),
    ...reportProblems(),
    ...same('the reports a moderator has open', social.moderation.players.reduce((total, each) => total + each.reports, 0), REPORTS.filter((each) => each.status === 'open').length),
    ...same('the number of different names', new Set(EVERYONE.map((each) => each.username)).size, EVERYONE.length),
  ];
}
