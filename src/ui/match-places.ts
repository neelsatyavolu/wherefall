import { communitySlugOf, locationsForMap, type LocationSet } from '../game/locations.ts';
import { loadGamePlaces, loadSpreadPlaces, type GamePlaces } from '../imagery/game-places.ts';
import type { ImageryProvider, Place as Picture } from '../imagery/provider.ts';
import type { MatchState, Place } from '../multiplayer/client.ts';
import { needsSpread } from '../multiplayer/draw.ts';
import { countPlay, getMap, toLocationSet } from '../social/maps.ts';
import { homeBounds, type RoundScreen } from './round-screen.ts';

/** Resolves posted places on one imagery source. A place it cannot show is null; none at all is a failure. */
async function resolvePosted(provider: ImageryProvider, places: readonly Place[]): Promise<Array<Picture | null>> {
  const pictures = await Promise.all(places.map((place) => provider.resolve(place).catch(() => null)));
  if (pictures.every((picture) => picture === null)) {
    throw new Error('This source can show none of the places');
  }
  return pictures;
}

/**
 * The places of one match, on this client's imagery: picked from the match's seed by the client
 * that resolves them, and loaded from what that client posted by everyone else. Either way the
 * street view is opened and the guess map framed on the match's map.
 */
export function matchPlaces(screen: RoundScreen, match: Pick<MatchState, 'kind' | 'settings'>, providers: readonly ImageryProvider[]) {
  const { settings } = match;
  const slug = communitySlugOf(settings.map);
  /** a public game, a ranked duel and a 2v2 are drawn on at least three continents: the server takes no other */
  const spread = needsSpread(match);
  /** a community map's own places: what the resolver draws from, and what everyone's guess map opens on */
  let community: LocationSet | null = null;
  let counted = false;
  /** the imagery source the street view was opened on: it loads the places the server sends later, and draws again when a set is refused */
  let source: ImageryProvider | null = null;

  /** The community map itself, asked for once. It stays null when it cannot be had. */
  async function loadCommunity(): Promise<void> {
    if (slug !== null && !community) {
      const map = await getMap(slug);
      if (map.ok) {
        community = toLocationSet(map.data);
        screen.setMapName(map.data.name);
      }
    }
  }

  /** Opens the street view on the first source that can draw the game, and keeps to that source from then on. */
  async function openAndDraw(draw: (provider: ImageryProvider) => Promise<GamePlaces>): Promise<GamePlaces | null> {
    const opened = await screen.openStreet(providers, async (provider) => ({ provider, places: await draw(provider) }));
    source = opened?.provider ?? null;
    return opened?.places ?? null;
  }

  return {
    /** the community map being played, or null for one of the game's own */
    slug,

    /**
     * The resolver's part: the places as a game alone picks them, from `seed` (the match's own, or
     * another when the server refused the first set). Null when they cannot be had. The street view
     * is opened by the first draw; a later one is made on the same source.
     */
    async pick(seed: string): Promise<GamePlaces | null> {
      await loadCommunity();
      // from this client's own imagery source and its list of places, exactly as a game alone picks them
      const draw = (provider: ImageryProvider) =>
        spread ? loadSpreadPlaces(provider, seed, settings.rounds) : loadGamePlaces(provider, settings.map, seed, settings.rounds, community ?? undefined);
      const places = source ? await draw(source).catch(() => null) : await openAndDraw(draw);
      if (places) {
        screen.map.setHome(homeBounds(settings.map, places.locations));
        if (slug !== null && !counted) {
          // the party's game on a community map counts as one play, made by whoever picked the places
          counted = true;
          void countPlay(slug);
        }
      }
      return places;
    },

    /**
     * Everyone else's part: one picture for each posted place, null for a place this client cannot
     * show. `stillShown` is asked once they are in: the guess map is framed only on a screen that is still there.
     */
    async load(places: readonly Place[], stillShown: () => boolean): Promise<ReadonlyArray<Picture | null>> {
      // a community map is framed on its own list of places, never on the posted ones: those are the answers, and the
      // server may have sent only the first of them, which would open the guess map on the very place to be found
      await loadCommunity();
      const loaded = await screen.openStreet(providers, async (provider) => ({
        provider,
        pictures: await resolvePosted(provider, places),
        // the map opens on the region or country as this source knows it; the world if its list will not load
        locations:
          slug !== null
            ? (community?.locations ?? [])
            : await provider.places().then(
                (set) => locationsForMap(set, settings.map),
                () => [],
              ),
      }));
      source = loaded?.provider ?? null;
      if (stillShown()) {
        screen.map.setHome(homeBounds(settings.map, loaded?.locations ?? []));
      }
      return loaded?.pictures ?? places.map(() => null);
    },

    /**
     * One picture for each place the server has sent since `load`, on the source that was opened
     * then: from wave 6 on a round's place comes only when that round does. Null for a place the
     * source cannot show, and for every one of them when no source was opened.
     */
    async more(places: readonly Place[]): Promise<ReadonlyArray<Picture | null>> {
      const provider = source;
      return provider === null ? places.map(() => null) : Promise.all(places.map((place) => provider.resolve(place).catch(() => null)));
    },
  };
}
