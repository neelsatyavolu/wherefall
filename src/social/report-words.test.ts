import { afterEach, describe, expect, it } from 'vitest';
import { useLanguage } from '../i18n/index.ts';
import { REPORT_CATEGORIES, REPORT_STATUSES } from './client.ts';
import { reportCategoryChoices, reportCategoryName, reportStatusName, reportStatusTone } from './report-words.ts';

afterEach(() => useLanguage('en'));

describe('reportCategoryName', () => {
  it('names each thing a report can be about', () => {
    expect(REPORT_CATEGORIES.map(reportCategoryName)).toEqual(['Cheating', 'Offensive name', 'Offensive chat', 'Other']);
  });

  it('calls a category it does not know "Other", as the server would file it', () => {
    expect(reportCategoryName('spam')).toBe('Other');
    expect(reportCategoryName('')).toBe('Other');
  });

  it('is written in the language in use', async () => {
    await useLanguage('de');
    expect(reportCategoryName('name')).toBe('Anstößiger Name');
    await useLanguage('ru');
    expect(reportCategoryName('chat')).toBe('Оскорбления в чате');
  });
});

describe('reportCategoryChoices', () => {
  it('offers every category the server takes, in its order, each by its name', () => {
    expect(reportCategoryChoices()).toEqual([
      { value: 'cheating', name: 'Cheating' },
      { value: 'name', name: 'Offensive name' },
      { value: 'chat', name: 'Offensive chat' },
      { value: 'other', name: 'Other' },
    ]);
  });
});

describe('reportStatusName', () => {
  it('says where a report stands', () => {
    expect(REPORT_STATUSES.map(reportStatusName)).toEqual(['Open', 'Action taken', 'Dismissed']);
  });

  it('is written in the language in use', async () => {
    await useLanguage('fr');
    expect(reportStatusName('dismissed')).toBe('Classé sans suite');
    await useLanguage('es');
    expect(reportStatusName('actioned')).toBe('Medida tomada');
  });
});

describe('reportStatusTone', () => {
  it('marks a report still waiting as live, one acted on as done, and a dismissed one as neither', () => {
    expect(REPORT_STATUSES.map(reportStatusTone)).toEqual(['live', 'ok', 'idle']);
  });
});
