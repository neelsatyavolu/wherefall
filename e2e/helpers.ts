import { expect, type Page } from '@playwright/test';

export const play = (page: Page) => page.locator('.play');

/** A round is on screen, its view has loaded, and (in a match) its start has passed. */
export async function roundReady(page: Page): Promise<void> {
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
  await expect(page.locator('.status')).toBeEmpty();
}

export async function placePin(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.locator('.map-panel').hover();
  await page.locator('.map-panel .maplibregl-canvas').click({ position: at });
}

/** Plays a whole local game, one quick guess a round, through to the summary. */
export async function playLocalGame(page: Page, rounds: number): Promise<void> {
  for (let round = 1; round <= rounds; round++) {
    await roundReady(page);
    await placePin(page, { x: 150, y: 150 });
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
    await expect(play(page)).toHaveAttribute('data-phase', 'result');
    await page.getByRole('button', { name: round === rounds ? 'See summary' : 'Next round' }).click();
  }
}

export const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
