import { afterEach, describe, expect, it } from 'vitest';
import { useLanguage } from '../i18n/index.ts';
import { isQueuedAlready, lockSeconds, queueEntryState, readQueueEntry, typicalWait, waitedSeconds } from './queue-view.ts';
import { NOW, at } from './testing.ts';

const now = Date.parse(NOW);

describe('waitedSeconds', () => {
  it('is the whole seconds from joining to the server time now', () => {
    expect(waitedSeconds(at(-12), now)).toBe(12);
    expect(waitedSeconds(at(-12.9), now)).toBe(12);
    expect(waitedSeconds(at(-75), now)).toBe(75);
  });

  it('is zero before the queue is joined, for a time yet to come, and for no time at all', () => {
    expect(waitedSeconds(null, now)).toBe(0);
    expect(waitedSeconds(at(3), now)).toBe(0);
    expect(waitedSeconds('not a time', now)).toBe(0);
  });
});

describe('lockSeconds', () => {
  it('counts a started second as a whole one', () => {
    expect(lockSeconds(at(120), now)).toBe(120);
    expect(lockSeconds(at(0.4), now)).toBe(1);
  });

  it('is zero with no lock and once it has passed', () => {
    expect(lockSeconds(null, now)).toBe(0);
    expect(lockSeconds(at(-1), now)).toBe(0);
  });
});

describe('isQueuedAlready', () => {
  it('is true for a player the server has queued itself: after a dodge, and with a 2v2 partner', () => {
    expect(isQueuedAlready('dodged')).toBe(true);
    expect(isQueuedAlready('pair')).toBe(true);
  });

  it('is false for a player who still has to ask, and for one who only opened the pane', () => {
    expect(isQueuedAlready('again')).toBe(false);
    expect(isQueuedAlready(null)).toBe(false);
  });
});

describe('readQueueEntry', () => {
  it('reads back what was put in the history entry, for the pane of that kind', () => {
    expect(readQueueEntry(queueEntryState({ kind: 'ranked', reason: 'dodged' }), 'ranked')).toBe('dodged');
    expect(readQueueEntry(queueEntryState({ kind: 'unranked', reason: 'again' }), 'unranked')).toBe('again');
    expect(readQueueEntry(queueEntryState({ kind: 'team', reason: 'pair' }), 'team')).toBe('pair');
  });

  it('is nothing for another kind of queue', () => {
    expect(readQueueEntry(queueEntryState({ kind: 'ranked', reason: 'again' }), 'team')).toBeNull();
  });

  it('is nothing for a history entry that holds something else', () => {
    expect(readQueueEntry(null, 'ranked')).toBeNull();
    expect(readQueueEntry({ preset: 'world' }, 'ranked')).toBeNull();
    expect(readQueueEntry({ queue: { kind: 'ranked', reason: 'whatever' } }, 'ranked')).toBeNull();
    expect(readQueueEntry({ queue: 'ranked' }, 'ranked')).toBeNull();
  });
});

describe('typicalWait', () => {
  afterEach(() => useLanguage('en'));

  it('is under a minute up to 59 seconds', () => {
    expect([0, 1, 30, 59].map(typicalWait)).toEqual(Array(4).fill('usually under a minute'));
  });

  it('is about so many minutes from a minute on, to the nearest minute', () => {
    expect(typicalWait(60)).toBe('about 1 minute');
    expect(typicalWait(89)).toBe('about 1 minute');
    expect(typicalWait(90)).toBe('about 2 minutes');
    expect(typicalWait(149)).toBe('about 2 minutes');
    expect(typicalWait(150)).toBe('about 3 minutes');
    expect(typicalWait(180)).toBe('about 3 minutes');
    expect(typicalWait(3600)).toBe('about 60 minutes');
  });

  it('says so when no match was found in the last day', () => {
    expect(typicalWait(null)).toBe('no recent games');
  });

  it('reads a time that is no time as no recent games, and one below zero as under a minute', () => {
    expect(typicalWait(Number.NaN)).toBe('no recent games');
    expect(typicalWait(-5)).toBe('usually under a minute');
  });

  it('is written in each language', async () => {
    const said = async (code: 'es' | 'fr' | 'de') => {
      await useLanguage(code);
      return [typicalWait(null), typicalWait(59), typicalWait(60), typicalWait(180)];
    };
    expect(await said('es')).toEqual(['sin partidas recientes', 'normalmente menos de un minuto', 'alrededor de 1 minuto', 'alrededor de 3 minutos']);
    expect(await said('fr')).toEqual(['aucune partie récente', 'en général moins d’une minute', 'environ 1 minute', 'environ 3 minutes']);
    expect(await said('de')).toEqual(['zuletzt keine Spiele', 'meist unter einer Minute', 'etwa 1 Minute', 'etwa 3 Minuten']);
  });

  it('takes the Russian form the number asks for', async () => {
    await useLanguage('ru');
    expect(typicalWait(null)).toBe('недавних игр не было');
    expect(typicalWait(45)).toBe('обычно меньше минуты');
    expect([60, 120, 240, 300, 660, 1260, 1320, 1500].map(typicalWait)).toEqual([
      'примерно 1 минута',
      'примерно 2 минуты',
      'примерно 4 минуты',
      'примерно 5 минут',
      'примерно 11 минут',
      'примерно 21 минута',
      'примерно 22 минуты',
      'примерно 25 минут',
    ]);
  });
});
