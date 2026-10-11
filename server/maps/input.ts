import { z } from 'zod';
import { slugSchema } from '../account/input.js';
import { onOneLine } from '../match/chat.js';

export const MAP_ACTIONS = ['save', 'delete', 'like', 'play', 'report'] as const;
export type MapAction = (typeof MAP_ACTIONS)[number];

export const MIN_MAP_PLACES = 5;
export const MAX_MAP_PLACES = 5000;
export const MIN_MAP_NAME = 3;
export const MAX_MAP_NAME = 30;
/** The short description, shown wherever the map is listed. */
export const MIN_MAP_DESCRIPTION = 20;
export const MAX_MAP_DESCRIPTION = 100;
/** The long description, shown on the map's own page. */
export const MAX_MAP_DETAILS = 1000;
export const MAX_REPORT_REASON = 200;
const MAX_PLACE_ID = 64;

/** Text on one line, within a length. */
const line = (min: number, max: number) => z.string().transform(onOneLine).pipe(z.string().min(min).max(max));

/** Text that may run over several lines, up to a length. */
const lines = (max: number) =>
  z
    .string()
    .transform((text) => text.trim())
    .pipe(z.string().max(max));

/** One place, in the row shape of the dataset files: id, longitude, latitude, country. */
const locationRow = z.tuple([
  z.string().min(1).max(MAX_PLACE_ID),
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
  z.string().regex(/^[A-Z]{2}$/),
]);

export const mapActionSchemas = {
  save: z.object({
    /** Present when saving over a map the player made; absent for a new one. */
    slug: slugSchema.optional(),
    name: line(MIN_MAP_NAME, MAX_MAP_NAME),
    description: line(MIN_MAP_DESCRIPTION, MAX_MAP_DESCRIPTION),
    details: lines(MAX_MAP_DETAILS).default(''),
    locations: z.array(locationRow).min(MIN_MAP_PLACES).max(MAX_MAP_PLACES),
  }),
  delete: z.object({ slug: slugSchema }),
  like: z.object({ slug: slugSchema, liked: z.boolean() }),
  play: z.object({ slug: slugSchema }),
  report: z.object({ slug: slugSchema, reason: line(0, MAX_REPORT_REASON).default('') }),
};

/** Enough of a body to tell which action was meant. */
export const mapActionNameSchema = z.looseObject({ action: z.enum(MAP_ACTIONS) });
