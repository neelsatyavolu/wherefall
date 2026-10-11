import type { ImageryProvider, Place } from './provider.ts';

/**
 * The same source, telling `shown` the id of every place it gets ready to show. A game's places
 * are made ready as it is drawn, so this is how the browser comes to know what it has shown,
 * whatever kind of game it was. It changes nothing about which places a game gets.
 */
export function notingShown<P extends Place>(provider: ImageryProvider<P>, shown: (id: string) => void): ImageryProvider<P> {
  return {
    name: provider.name,
    // read when it is used, as the source's own is: it can depend on the language in use
    get attribution() {
      return provider.attribution;
    },
    places: () => provider.places(),
    resolve: async (location) => {
      const place = await provider.resolve(location);
      shown(location.id);
      return place;
    },
    isGone: (error) => provider.isGone(error),
    createView: (container, mode, handlers) => provider.createView(container, mode, handlers),
  };
}
