import { describe, expect, it } from 'vitest';
import { resolveRounds } from './rounds.ts';

const candidates = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, lng: i, lat: i, country: 'FR' }));
class Gone extends Error {}
const isGone = (error: unknown) => error instanceof Gone;
const loader = (broken: string[], offline: string[] = []) => async ({ id }: { id: string }) => {
  if (broken.includes(id)) {
    throw new Gone(`${id} is gone`);
  }
  if (offline.includes(id)) {
    throw new Error('network down');
  }
  return `pano-${id}`;
};

describe('resolveRounds', () => {
  it('loads the first candidates in order', async () => {
    const rounds = await resolveRounds(candidates, 3, loader([]), isGone);
    expect(rounds.map((r) => r.location.id)).toEqual(['a', 'b', 'c']);
    expect(rounds[0]!.pano).toBe('pano-a');
  });

  it('fills gaps from the spares when a picture has disappeared', async () => {
    const rounds = await resolveRounds(candidates, 3, loader(['b']), isGone);
    expect(rounds.map((r) => r.location.id)).toEqual(['a', 'c', 'd']);
  });

  it('keeps trying spares until one loads', async () => {
    const rounds = await resolveRounds(candidates, 3, loader(['a', 'd']), isGone);
    expect(rounds.map((r) => r.location.id)).toEqual(['b', 'c', 'e']);
  });

  it('fails clearly when there are not enough working places', async () => {
    await expect(resolveRounds(candidates, 3, loader(['a', 'b', 'c']), isGone)).rejects.toThrow(/2 of 3/);
  });

  it('does not swap in a spare for a passing network failure, so both players of a link get the same places', async () => {
    await expect(resolveRounds(candidates, 3, loader([], ['b']), isGone)).rejects.toThrow('network down');
  });
});
