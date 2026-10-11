const COUNT_MS = 900;

export const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The number a count-up shows part of the way through (0 to 1): quick at first, slowing into the end. */
export function countAt(to: number, progress: number): number {
  const part = Math.max(0, Math.min(1, progress));
  return Math.round(to * (1 - (1 - part) ** 3));
}

/**
 * Counts a number up from nothing in an element, written by `write`. Under reduced motion, and for
 * nothing to count, the number is simply there.
 */
export function countUp(node: HTMLElement, to: number, write: (value: number) => string): void {
  if (to <= 0 || reducedMotion()) {
    node.textContent = write(to);
    return;
  }
  node.textContent = write(0);
  let startedAt: number | null = null;
  const step = (now: number): void => {
    startedAt ??= now;
    const progress = (now - startedAt) / COUNT_MS;
    node.textContent = write(countAt(to, progress));
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}
