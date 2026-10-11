import type { Page, Route } from '@playwright/test';
import type { ChatScope, MatchOutcome, MatchState, QueueKind, QueueState } from '../src/multiplayer/client.ts';
import { PLACES, guest, matchState, outcome, player, queueState } from '../src/multiplayer/testing.ts';
import * as rules from './match-rules.ts';
import { SAYS, isRefusal, refusal, type Refusal } from './match-rules.ts';
import { communityRows, listsFor } from './place-rules.ts';

export { accountReply, signIn } from './account-server.ts';

/** Five posted places, for the matchmade kinds, which always play five rounds. */
export const FIVE_PLACES = [
  ...PLACES,
  { id: 'place-four', lng: 18.0686, lat: 59.3293, country: 'SE' },
  { id: 'place-five', lng: 151.2093, lat: -33.8688, country: 'AU' },
];

/** What a guest left from before playing took an account may send: the way out, and nothing else. */
const GUEST_ACTIONS = ['leave', 'leaveQueue'];
const HOST_ACTIONS = ['configure', 'start', 'shuffle', 'kick', 'host', 'lock', 'endRound', 'lobby'];
const RANKED_WINDOW = { start: 50, perSecond: 10 };

type Body = Record<string, unknown>;
type Answer = { status?: number; json: unknown };
/** What an action answers with: a body to send as it is, or a refusal. */
type Outcome = MatchState | QueueState | { left: true } | { queued: false } | { username: string } | Refusal;

const envelope = (data: unknown, status = 200): Answer => ({ status, json: { success: true, data } });
const refused = ({ status, error }: Refusal): Answer => ({ status, json: { success: false, error } });

/**
 * A stand-in for `/api/match`, seen by one player: the signed-in "neel" unless a test says
 * otherwise. It answers the page's requests from one match state by the rules of the wave-5 and
 * wave-6 contracts (statuses and texts included) and records what was posted. The test plays everyone
 * else and moves the match on (`opponentGuesses`, `reveal`, `startRound`, `finish` and the rest),
 * as the real server would by itself.
 */
export class MatchServer {
  state: MatchState = matchState({ players: [player('neel')] });
  /** as last set; `serverNow`, and a ranked `window` and `lockedUntil`, are filled in when it is sent */
  queue: QueueState = queueState();
  /** every body posted to /api/match, in order */
  readonly posts: Body[] = [];
  /** how many times the match was asked for; a finished party is polled on, which is what `lobby` goes by */
  polls = 0;
  /** set to make the next posts fail with this error (status `refuseStatus`) */
  refuse: string | null = null;
  refuseStatus = 400;
  /** true cuts the connection: every request fails on the way */
  down = false;
  /** how long the server takes to answer */
  delayMs = 0;
  /** who is asking: an account, a guest, or a visitor with no session at all */
  session: 'account' | 'guest' | 'none' = 'account';
  /** true once the host has removed the page's player: every request on the match is then refused */
  removed = false;
  /** how long before a round starts. Short, so tests do not wait the real five seconds; set 5000 to see them */
  leadMs = 400;
  /** the typical wait the queue the player is in reports, in seconds; null for no match found in the last 24 hours */
  typicalWait: number | null = null;
  /** true moves the match on by itself when a reveal's time is up, as the server does: the next round's get-ready begins on the first request after it */
  advanceAfterReveal = false;
  /** how many `places` posts are still to be refused with `placesRefusal`, whatever they hold */
  placesRefusedTimes = 0;
  placesRefusal: string = SAYS.notOnMap;
  /** what `endRound` gives the page's player and everyone else */
  endRoundScores = { own: 2500, other: 2500 };
  /** where teammates' pins are, by username, as their own `pin` actions would have put them */
  private matePins: Record<string, { lng: number; lat: number }> = {};
  /** the pins the page itself has sent */
  readonly pins: Array<{ round: number; lng: number; lat: number }> = [];
  private readonly skewMs: number;
  private readonly page: Page | null;
  private ownGuess: { lng: number; lat: number } | null = null;
  private lockedUntilMs: number | null = null;

  /** `skewMs` puts the server's clock that far ahead of the browser's. `page` is whose lists of places the server knows. */
  constructor(skewMs = 0, page: Page | null = null) {
    this.skewMs = skewMs;
    this.page = page;
  }

  static async install(page: Page, skewMs = 0): Promise<MatchServer> {
    const server = new MatchServer(skewMs, page);
    await page.route('**/api/match**', (route) => server.handle(route));
    return server;
  }

  posted(action: string): Body[] {
    return this.posts.filter((body) => body.action === action);
  }

  private now(): number {
    return Date.now() + this.skewMs;
  }

  private at(ms: number): string {
    return new Date(this.now() + ms).toISOString();
  }

  /** The moment `ms` from now on the server's clock, as the server writes times. */
  time(ms: number): string {
    return this.at(ms);
  }

  private set(change: Partial<MatchState>): void {
    this.state = { ...this.state, ...change };
  }

  private current(): MatchState {
    const mates = this.state.players
      .filter((p) => p.username !== this.state.you.username && p.team !== null && p.team === this.state.you.team)
      .flatMap((p) => (this.matePins[p.username] ? [{ username: p.username, ...this.matePins[p.username]!, guessed: p.guessed }] : []));
    return rules.seenBy({ ...this.state, mates, serverNow: this.at(0) });
  }

  private currentQueue(): QueueState {
    const { queued, kind, since } = this.queue;
    const waited = since === null ? 0 : Math.max(0, Math.floor((this.now() - Date.parse(since)) / 1000));
    const lock = this.lockedUntilMs !== null && this.lockedUntilMs > this.now() ? new Date(this.lockedUntilMs).toISOString() : null;
    return {
      ...this.queue,
      serverNow: this.at(0),
      window: queued && kind === 'ranked' ? Math.min(rules.MAX_RANKED_WINDOW, RANKED_WINDOW.start + RANKED_WINDOW.perSecond * waited) : null,
      typicalWaitSeconds: kind === null ? null : this.typicalWait,
      lockedUntil: this.queue.lockedUntil ?? lock,
    };
  }

  // --- what the test does, in the place of the other players and of time passing ------------------

  addPlayer(username: string, change: Partial<MatchState['players'][number]> = {}): void {
    this.set({ players: [...this.state.players, player(username, change)] });
  }

  addGuest(number: number): void {
    this.set({ players: [...this.state.players, guest(number)] });
  }

  /** Puts the match in `playing` for a round, as the server does once the places are in. `lastsMs` cuts the round short. */
  startRound(round: number, lastsMs = this.state.settings.timeLimit * 1000): void {
    this.ownGuess = null;
    this.matePins = {};
    this.set({
      phase: 'playing',
      round,
      roundStartsAt: this.at(this.leadMs),
      // a party with no timer has rounds with no end
      roundEndsAt: lastsMs === 0 ? null : this.at(this.leadMs + lastsMs),
      revealEndsAt: null,
      players: this.state.players.map((p) => ({ ...p, guessed: false })),
    });
  }

  /** Another player's guess goes in. When that leaves one player still to guess, the round's end comes forward. */
  opponentGuesses(username = 'sam'): void {
    this.set({ players: this.state.players.map((p) => (p.username === username ? { ...p, guessed: true } : p)) });
    this.state = rules.cutTimer(this.state, this.now());
  }

  /** Moves the end of the round being played to `ms` from now, as the server does when it cuts a round short. */
  endRoundIn(ms: number): void {
    this.set({ roundEndsAt: this.at(ms) });
  }

  /** Where a teammate's pin is now. It is sent to the page in `mates` while the round is played. */
  matePin(username: string, lng: number, lat: number): void {
    this.matePins = { ...this.matePins, [username]: { lng, lat } };
  }

  /** Ends the round: the page's own guess scores `ownScore`, everyone else `otherScore`. */
  reveal(ownScore: number, otherScore: number): void {
    const scores = Object.fromEntries(this.state.players.filter((p) => p.username !== this.state.you.username).map((p) => [p.username, otherScore]));
    this.revealScores(this.ownGuess ? { ...scores, [this.state.you.username]: ownScore } : scores);
  }

  /** Ends the round with each player's own score. A player left out made no guess. */
  revealScores(scores: Readonly<Record<string, number>>): void {
    this.state = rules.reveal(this.state, scores, this.ownGuess, this.now());
  }

  /** Something another player says: a message, or a reaction when `emote` is given. `team` reaches only the sender's team. */
  say(username: string, text: string | null, emote: string | null = null, scope: ChatScope = 'all'): void {
    const id = Math.max(0, ...this.state.chat.map((entry) => entry.id)) + 1;
    this.set({ chat: [...this.state.chat, { id, username, text, emote, at: this.at(0), scope }] });
  }

  finish(result: MatchOutcome): void {
    this.set({ phase: 'finished', outcome: result });
  }

  /** A ranked opponent leaves before anyone has guessed: the match is cancelled and the page's player is back in the queue. */
  dodge(username = 'sam'): void {
    this.finish(outcome([], { dodgedBy: username }));
    this.queue = queueState({ queued: true, kind: 'ranked', waiting: 1, since: this.at(0) });
  }

  /** The host removes the page's player. From then on every request on the match is refused. */
  kickYou(): void {
    this.removed = true;
    this.set({ players: this.state.players.filter((p) => p.username !== this.state.you.username) });
  }

  /** The host hands the party to the page's player. */
  makeYouHost(): void {
    this.set({ you: { ...this.state.you, isHost: true, isResolver: true } });
  }

  /** The host of the page's two-player party queues the pair for 2v2: the lobby closes and both are queued. */
  pairQueued(): void {
    this.finish(outcome([]));
    this.set({ movedToQueue: 'team' });
    this.queue = queueState({ queued: true, kind: 'team', waiting: 2, since: this.at(0) });
  }

  /** Locks the page's player out of the ranked queue for `ms`, as a second dodge within the hour does. */
  lockRanked(ms: number): void {
    this.lockedUntilMs = this.now() + ms;
  }

  /** The queue has found a match: the next queue poll hands over its id. */
  matchFound(id = this.state.id): void {
    this.queue = queueState({ kind: this.queue.kind, matchId: id });
  }

  // --- what the page sends ---------------------------------------------------------------------

  private joinQueue(body: Body): QueueState | Refusal {
    const kind = body.kind as QueueKind;
    if (body.matchId !== undefined) {
      const { kind: matchKind, phase, players, you, id } = this.state;
      const pair = kind === 'team' && body.matchId === id && matchKind === 'party' && phase === 'lobby' && you.isHost && players.length === 2 && players.every((p) => !p.guest);
      if (!pair) {
        return refusal(409, SAYS.pairOnly);
      }
      this.pairQueued();
      return this.currentQueue();
    }
    if (kind === 'ranked' && this.lockedUntilMs !== null && this.lockedUntilMs > this.now()) {
      return refusal(429, SAYS.dodgeLock(Math.ceil((this.lockedUntilMs - this.now()) / 1000)));
    }
    this.queue = queueState({ queued: true, kind, waiting: 1, since: this.at(0) });
    return this.currentQueue();
  }

  private chat(body: Body): MatchState | Refusal {
    const isChat = body.action === 'chat';
    if (isChat ? !rules.chatAllowed(this.state) : !rules.reactionsAllowed(this.state)) {
      return refusal(403, isChat ? SAYS.chatOff : SAYS.reactionsOff);
    }
    const scope: ChatScope = body.scope === 'team' && this.state.teams !== null ? 'team' : 'all';
    this.say(this.state.you.username, isChat ? (body.text as string) : null, isChat ? null : (body.emote as string), scope);
    return this.current();
  }

  /** The resolver's places: taken, the first round's get-ready begins. Refused, nothing changes and another set may come. */
  private places(body: Body): MatchState | Refusal {
    if (this.placesRefusedTimes > 0) {
      this.placesRefusedTimes -= 1;
      return refusal(400, this.placesRefusal);
    }
    const { state } = this;
    const next = rules.postPlaces(state, body.places, listsFor(this.page), communityRows(this.page, state.settings.map));
    if (isRefusal(next)) {
      return next;
    }
    if (next !== state) {
      this.state = next;
      this.startRound(0);
    }
    return this.current();
  }

  private guess(body: Body): MatchState {
    const mine = this.state.players.find((p) => p.username === this.state.you.username);
    // a second guess for a round already guessed changes nothing
    if (this.state.phase === 'playing' && body.round === this.state.round && !mine?.guessed) {
      this.ownGuess = { lng: body.lng as number, lat: body.lat as number };
      this.opponentGuesses(this.state.you.username);
    }
    return this.current();
  }

  /** A step of the rules: taken when it is a match, sent back as it is when it is a refusal. */
  private step(next: MatchState | Refusal): MatchState | Refusal {
    if (isRefusal(next)) {
      return next;
    }
    this.state = next;
    return this.current();
  }

  private party(body: Body): MatchState | Refusal {
    const { state } = this;
    switch (body.action) {
      case 'create':
      case 'configure': {
        const settings = rules.readSettings(body.settings);
        if (isRefusal(settings)) {
          return settings;
        }
        // create: the test has already put the party in the state the player should meet; only its settings are the page's
        return body.action === 'configure' && state.phase !== 'lobby' ? this.current() : this.step(rules.withSettings(state, settings));
      }
      case 'join':
        return this.step(rules.join(state, state.you.username, false));
      case 'start':
        return this.step(rules.start(state));
      case 'team':
        return this.step(rules.chooseTeam(state, body.team));
      case 'shuffle':
        return this.step(rules.shuffle(state));
      case 'kick':
        return this.step(rules.kick(state, body.username));
      case 'host':
        return this.step(rules.handOver(state, body.username));
      case 'mute':
        return this.step(rules.mute(state, body.username, body.muted));
      case 'lock':
        return this.step({ ...state, locked: body.locked === true });
      case 'endRound':
        if (state.phase === 'playing' && state.roundStartsAt !== null && Date.parse(state.roundStartsAt) <= this.now()) {
          this.reveal(this.endRoundScores.own, this.endRoundScores.other);
        }
        return this.current();
      case 'lobby':
        return this.step(rules.backToLobby(state));
      default:
        return this.current();
    }
  }

  private act(body: Body): Outcome {
    switch (body.action) {
      case 'places':
        return this.places(body);
      case 'guess':
        return this.guess(body);
      case 'pin':
        this.pins.push({ round: body.round as number, lng: body.lng as number, lat: body.lat as number });
        return this.current();
      case 'chat':
      case 'emote':
        return this.chat(body);
      case 'leave':
        return { left: true };
      case 'queue':
        return this.joinQueue(body);
      case 'leaveQueue':
        this.queue = queueState();
        return { queued: false };
      default:
        return this.party(body);
    }
  }

  /** Why a post is not acted on at all, or null when it is. */
  private barred(body: Body): Refusal | null {
    const action = String(body.action);
    if (this.refuse !== null) {
      return refusal(this.refuseStatus, this.refuse);
    }
    if (this.session === 'none') {
      return refusal(401, SAYS.signIn);
    }
    if (this.session === 'guest' && !GUEST_ACTIONS.includes(action)) {
      return refusal(403, SAYS.guests);
    }
    if (this.removed && action !== 'queue' && action !== 'leaveQueue') {
      return refusal(403, SAYS.removed);
    }
    return HOST_ACTIONS.includes(action) && !this.state.you.isHost ? refusal(403, SAYS.hostOnly) : null;
  }

  private post(body: Body): Answer {
    const bar = this.barred(body);
    if (bar) {
      return refused(bar);
    }
    const result = this.act(body);
    return isRefusal(result) ? refused(result) : envelope(result, body.action === 'create' ? 201 : 200);
  }

  private get(params: URLSearchParams): Answer {
    if (this.session === 'none') {
      return refused(refusal(401, SAYS.signIn));
    }
    if (this.session === 'guest') {
      return refused(refusal(403, SAYS.guests));
    }
    if (params.has('queue')) {
      return envelope(this.currentQueue());
    }
    if (params.get('id') !== this.state.id) {
      return refused(refusal(404, SAYS.noSuchMatch));
    }
    this.polls += 1;
    this.moveOn();
    return this.removed ? refused(refusal(403, SAYS.removed)) : envelope(this.current());
  }

  /** With `advanceAfterReveal`: a reveal whose time is up gives way to the next round, unless it was the last. */
  private moveOn(): void {
    const { phase, round, revealEndsAt, settings } = this.state;
    if (this.advanceAfterReveal && phase === 'reveal' && revealEndsAt !== null && Date.parse(revealEndsAt) <= this.now() && round < settings.rounds - 1) {
      this.startRound(round + 1);
    }
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    if (this.down) {
      await route.abort();
      return;
    }
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Body;
      this.posts.push(body);
      await route.fulfill(this.post(body));
      return;
    }
    await route.fulfill(this.get(new URL(request.url()).searchParams));
  }
}
