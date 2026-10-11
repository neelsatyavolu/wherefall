import { describe, expect, it } from 'vitest';
import { nextZoom, panoramaOptions, turned } from './google-view-options.ts';

describe('panoramaOptions', () => {
  it('draws street names only when the player asked for them', () => {
    expect(panoramaOptions('move', false).showRoadLabels).toBe(false);
    expect(panoramaOptions('move', true).showRoadLabels).toBe(true);
    expect(panoramaOptions('nmpz', true).showRoadLabels).toBe(true);
  });

  it('never shows the address, whatever the setting', () => {
    expect(panoramaOptions('move', true).addressControl).toBe(false);
    expect(panoramaOptions('no-move', false).addressControl).toBe(false);
  });

  it('lets the player walk only in the moving mode, and zoom in every mode but the locked one', () => {
    expect(panoramaOptions('move', false)).toMatchObject({ linksControl: true, clickToGo: true, scrollwheel: true });
    expect(panoramaOptions('no-move', false)).toMatchObject({ linksControl: false, clickToGo: false, scrollwheel: true });
    expect(panoramaOptions('nmpz', false)).toMatchObject({ linksControl: false, clickToGo: false, scrollwheel: false });
  });
});

describe('turned', () => {
  it('turns a heading and keeps it between 0 and 360', () => {
    expect(turned(10, 15)).toBe(25);
    expect(turned(10, -15)).toBe(355);
    expect(turned(350, 15)).toBe(5);
  });
});

describe('nextZoom', () => {
  it('steps the zoom and stops at both ends', () => {
    expect(nextZoom(0, 1)).toBe(1);
    expect(nextZoom(1, -1)).toBe(0);
    expect(nextZoom(0, -1)).toBe(0);
    expect(nextZoom(4, 1)).toBe(4);
  });
});
