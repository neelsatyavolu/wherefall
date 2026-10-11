import type { Page, Route } from '@playwright/test';
import type { MapDetail, MapRow } from '../src/social/maps.ts';
import { serveCommunityMaps } from './place-rules.ts';

type Body = Record<string, unknown>;

const envelope = (data: unknown, status = 200) => ({ status, json: { success: true, data } });
const refusal = (error: string, status: number) => ({ status, json: { success: false, error } });

const PER_PAGE = 24;
const MIN_SEARCH = 3;
const LIMITS = { minName: 3, maxName: 30, minDescription: 20, maxDescription: 100, maxDetails: 1000, minPlaces: 5, maxPlaces: 5000, accountPlaces: 25_000 };

/** The server's own words, verbatim. */
const SAYS = {
  signIn: 'Sign in first.',
  guests: 'Guests cannot do that. Make an account first.',
  badMap: 'A map needs a name of 3 to 30 characters, a description of 20 to 100, and 5 to 5000 places.',
  tooManyPlaces: "An account's maps can hold 25,000 places in all. Make this one smaller, or delete another.",
  noSuchMap: 'There is no such map.',
  slowDown: 'Too many requests. Slow down a little.',
} as const;

const rows = (prefix: string, count: number, lng: number, lat: number): MapRow[] =>
  Array.from({ length: count }, (_, i) => [`${prefix}-${String(i).padStart(22 - prefix.length - 1, '0')}`, lng + i * 0.002, lat + i * 0.001, 'FR']);

export const PARIS: MapDetail = {
  slug: 'paris-walk-x7k2',
  name: 'Paris walk',
  maker: 'sam',
  places: 6,
  plays: 41,
  likes: 3,
  liked: false,
  description: 'Left bank and right, all on foot.',
  details: 'Start at the river and work outwards.\nEvery place is within a mile of it.',
  createdAt: '2026-10-09T10:00:00.000Z',
  mine: false,
  locations: rows('paris', 6, 2.34, 48.85),
};

export const MINE: MapDetail = {
  slug: 'my-coast-q1w2',
  name: 'My coast',
  maker: 'neel',
  places: 5,
  plays: 2,
  likes: 0,
  liked: false,
  // saved before a description was required: it keeps what it has until it is next saved
  description: '',
  details: '',
  createdAt: '2026-10-10T10:00:00.000Z',
  mine: true,
  locations: rows('coast', 5, -9.14, 38.7),
};

const summaryOf = ({ slug, name, maker, places, plays, likes, liked, description }: MapDetail) => ({ slug, name, maker, places, plays, likes, liked, description });

const within = (text: unknown, min: number, max: number): text is string => typeof text === 'string' && text.length >= min && text.length <= max;

/** `popular`: by likes, then plays, then newest. Every other list is newest first. */
const byPopularity = (a: MapDetail, b: MapDetail) => b.likes - a.likes || b.plays - a.plays || b.createdAt.localeCompare(a.createdAt);
const byAge = (a: MapDetail, b: MapDetail) => b.createdAt.localeCompare(a.createdAt);

/**
 * A stand-in for `/api/maps`, by the wave-6 contract, seen by the signed-in player "neel": two
 * maps to start with (one theirs), the four lists, search over name, description and maker, and
 * the five actions. It records what was posted. A `GamesServer` on the same page checks a game
 * saved on one of these maps against the map's places as they are here.
 */
export class MapsServer {
  maps: MapDetail[] = [PARIS, MINE];
  /** who is asking: `mine`, `liked` and every action need an account; a guest and a visitor may only read */
  session: 'account' | 'guest' | 'none' = 'account';
  readonly posts: Body[] = [];
  /** every list that was asked for, as its query string */
  readonly asked: string[] = [];
  /** set to make the next posts fail with this error (status `refuseStatus`) */
  refuse: string | null = null;
  refuseStatus = 400;
  /** makers who are banned or deleted: their maps are not served by slug to anyone but themselves */
  gone: string[] = [];
  /** true once `delete` was sent 60 times in the hour */
  slowDown = false;

  static async install(page: Page): Promise<MapsServer> {
    const server = new MapsServer();
    serveCommunityMaps(page, () => server.maps);
    await page.route('**/api/maps**', (route) => server.handle(route));
    return server;
  }

  posted(action: string): Body[] {
    return this.posts.filter((body) => body.action === action);
  }

  /** Adds `count` more maps by other players, each played less than the last. */
  addMany(count: number): void {
    const extra = Array.from({ length: count }, (_, i): MapDetail => ({ ...PARIS, slug: `extra-${i}`, name: `Extra map ${i + 1}`, plays: 30 - i, likes: 0 }));
    this.maps = [...this.maps, ...extra];
  }

  private change(slug: string, change: Partial<MapDetail>): MapDetail | null {
    this.maps = this.maps.map((map) => (map.slug === slug ? { ...map, ...change } : map));
    return this.maps.find((map) => map.slug === slug) ?? null;
  }

  private act(body: Body): { status: number; json: unknown } {
    const slug = body.slug as string | undefined;
    const found = this.maps.find((map) => map.slug === slug);
    // the map of a banned or deleted maker is there for its maker alone: nobody else can like it, report it or count a play on it
    const hidden = found !== undefined && !found.mine && this.gone.includes(found.maker);
    if (body.action !== 'save' && (!found || hidden)) {
      return refusal(SAYS.noSuchMap, 404);
    }
    switch (body.action) {
      case 'save': {
        const locations = body.locations as MapRow[];
        const details = body.details ?? '';
        const sized = Array.isArray(locations) && locations.length >= LIMITS.minPlaces && locations.length <= LIMITS.maxPlaces;
        if (!within(body.name, LIMITS.minName, LIMITS.maxName) || !within(body.description, LIMITS.minDescription, LIMITS.maxDescription) || !within(details, 0, LIMITS.maxDetails) || !sized) {
          return refusal(SAYS.badMap, 400);
        }
        // an account's maps hold 25,000 places between them, this one counted as it would be saved
        const others = this.maps.filter((map) => map.mine && map.slug !== slug).reduce((total, map) => total + map.locations.length, 0);
        if (others + locations.length > LIMITS.accountPlaces) {
          return refusal(SAYS.tooManyPlaces, 409);
        }
        const content = { name: body.name, description: body.description, details, locations, places: locations.length };
        if (slug) {
          return found?.mine ? envelope(this.change(slug, content)) : refusal('You have no map by that name.', 404);
        }
        const made: MapDetail = { ...MINE, ...content, slug: `${content.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-new1`, plays: 0, likes: 0, createdAt: new Date().toISOString() };
        this.maps = [...this.maps, made];
        return envelope(made, 201);
      }
      case 'delete':
        if (this.slowDown) {
          return refusal(SAYS.slowDown, 429);
        }
        if (!found?.mine) {
          return refusal('You have no map by that name.', 404);
        }
        this.maps = this.maps.filter((map) => map.slug !== slug);
        return envelope({ deleted: true });
      case 'like': {
        const liked = body.liked as boolean;
        const map = this.change(slug!, { liked, likes: found!.likes + (liked === found!.liked ? 0 : liked ? 1 : -1) })!;
        return envelope(summaryOf(map));
      }
      case 'play':
        return envelope({ plays: this.change(slug!, { plays: found!.plays + 1 })!.plays });
      case 'report':
        return envelope({ reported: true });
      default:
        return refusal('That is not something a map can be asked to do.', 400);
    }
  }

  /** Why this asker cannot have what they asked for, or null when they can. */
  private barred(needsAccount: boolean): { status: number; json: unknown } | null {
    if (!needsAccount || this.session === 'account') {
      return null;
    }
    return this.session === 'guest' ? refusal(SAYS.guests, 403) : refusal(SAYS.signIn, 401);
  }

  private list(params: URLSearchParams): { status: number; json: unknown } {
    const typed = (params.get('q') ?? '').trim().toLowerCase();
    // a search shorter than three characters is ignored
    const query = typed.length >= MIN_SEARCH ? typed : '';
    const which = params.get('list');
    const page = Math.max(1, Number(params.get('page') ?? '1'));
    const matching = this.maps
      .filter((map) => (which === 'mine' ? map.mine : which === 'liked' ? map.liked : true))
      .filter((map) => [map.name, map.description, map.maker].some((text) => text.toLowerCase().includes(query)))
      .sort(which === 'popular' ? byPopularity : byAge);
    const start = (page - 1) * PER_PAGE;
    return envelope({ maps: matching.slice(start, start + PER_PAGE).map(summaryOf), page, more: matching.length > start + PER_PAGE });
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Body;
      this.posts.push(body);
      await route.fulfill(this.refuse === null ? (this.barred(true) ?? this.act(body)) : refusal(this.refuse, this.refuseStatus));
      return;
    }
    const params = new URL(request.url()).searchParams;
    const slug = params.get('slug');
    if (slug !== null) {
      // the map of a banned or deleted maker is there for its maker alone
      const map = this.maps.find((each) => each.slug === slug && (each.mine || !this.gone.includes(each.maker)));
      await route.fulfill(map ? envelope(map) : refusal(SAYS.noSuchMap, 404));
    } else {
      this.asked.push(params.toString());
      const list = params.get('list');
      await route.fulfill(this.barred(list === 'mine' || list === 'liked') ?? this.list(params));
    }
  }
}
