/** Epoch milliseconds to a timestamptz parameter. */
export const toTs = (ms: number): string => new Date(ms).toISOString();

/** A timestamptz column back to epoch milliseconds. */
export const fromTs = (value: unknown): number => new Date(value as string | Date).getTime();
