// Builds public/cities.json: the names of the world's cities, for the pin map to draw while it is
// zoomed out further than its tiles carry more than a handful of them (`src/ui/basemap-cities.ts`).
//
//   pnpm cities
//
// The cities are Natural Earth's populated places, which are in the public domain. Each comes with
// the zoom Natural Earth finds it worth naming from, so the biggest are named first.
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';

const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places_simple.geojson';
const OUTPUT = new URL('../public/cities.json', import.meta.url);
/** research stations and ruins are in the list too */
const NOT_A_CITY = /station|historic/i;
/** about a hundred metres, far finer than a name is placed */
const COORDINATE_DIGITS = 3;

const placesSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({ name: z.string().min(1), featurecla: z.string(), adm0cap: z.number(), min_zoom: z.number(), pop_max: z.number() }),
    }),
  ),
});

const rounded = (degrees: number) => Number(degrees.toFixed(COORDINATE_DIGITS));
/** A name as it is drawn: a few in the list carry an invisible mark or a doubled space. */
const tidy = (name: string) => name.replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();

const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`Natural Earth answered ${response.status}`);
}
const { features } = placesSchema.parse(await response.json());
const cities = features
  .filter(({ properties }) => !NOT_A_CITY.test(properties.featurecla))
  // the order names are placed in where they would overlap: by zoom, then the bigger city first
  .sort((a, b) => a.properties.min_zoom - b.properties.min_zoom || b.properties.pop_max - a.properties.pop_max)
  .map(({ geometry, properties }) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: geometry.coordinates.map(rounded) },
    properties: { name: tidy(properties.name), zoom: properties.min_zoom, ...(properties.adm0cap === 1 ? { capital: true } : {}) },
  }));

await writeFile(OUTPUT, JSON.stringify({ type: 'FeatureCollection', features: cities }));
process.stdout.write(`${cities.length} cities written to public/cities.json\n`);
