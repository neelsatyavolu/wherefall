const FEWEST = 2;
const MOST = 4;

/**
 * How many background workers cut the pin map's tiles into what is drawn. The map library uses one
 * outside Safari, and a tile of this map is up to a megabyte: zoom in and ten of them wait in line
 * for it. Half the cores, so the page and the street pictures keep theirs.
 */
export function workerCountFor(cores: number | undefined): number {
  return Math.max(FEWEST, Math.min(MOST, Math.floor((cores ?? 0) / 2)));
}
