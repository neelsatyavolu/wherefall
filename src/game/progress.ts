/** XP per level step: level = floor(sqrt(xp / 250)) + 1, so each level takes more than the last. */
const LEVEL_XP = 250;

export const levelForXp = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / LEVEL_XP)) + 1;

/** The XP at which a level starts. */
export const xpForLevel = (level: number) => LEVEL_XP * (level - 1) ** 2;

export interface LevelProgress {
  level: number;
  /** XP earned since this level started */
  into: number;
  /** XP this level takes from start to finish */
  span: number;
  toNext: number;
  /** 0 to 1 through the level */
  fraction: number;
}

export function levelProgress(xp: number): LevelProgress {
  const earned = xp > 0 ? xp : 0;
  const level = levelForXp(earned);
  const into = earned - xpForLevel(level);
  const span = xpForLevel(level + 1) - xpForLevel(level);
  return { level, into, span, toNext: span - into, fraction: into / span };
}
