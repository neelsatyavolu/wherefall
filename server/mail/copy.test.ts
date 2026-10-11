import { describe, expect, it } from 'vitest';
import { MAIL_FROM, MAIL_LANGUAGES, mailLanguageSchema, resetEmail } from './copy.js';

const URL = 'https://wherefall.example/?reset=token';
const FIELDS = ['subject', 'heading', 'body', 'button', 'linkHint', 'footer'] as const;

describe('resetEmail', () => {
  it('is the approved copy in English, with the account named and the link carried', () => {
    expect(resetEmail('en', 'neel', URL)).toEqual({
      app: 'Wherefall',
      lang: 'en',
      url: URL,
      subject: 'Reset your Wherefall password',
      heading: 'Reset your password',
      body: 'Someone asked to reset the password for your Wherefall account neel. If that was you, choose a new one below.',
      button: 'Reset password',
      linkHint: 'Or paste this link into your browser:',
      footer: "This link works once and expires in 1 hour. If you didn't ask for it, ignore this email and your password stays the same.",
    });
  });

  it('comes in the five languages of the site, each saying which it is', () => {
    expect(MAIL_LANGUAGES).toEqual(['en', 'es', 'fr', 'de', 'ru']);
    for (const lang of MAIL_LANGUAGES) {
      expect(resetEmail(lang, 'neel', URL)).toMatchObject({ app: 'Wherefall', lang, url: URL });
    }
  });

  it.each(MAIL_LANGUAGES.filter((lang) => lang !== 'en'))('says everything in %s, in words of its own', (lang) => {
    const english = resetEmail('en', 'neel_s', URL);
    const copy = resetEmail(lang, 'neel_s', URL);
    for (const field of FIELDS) {
      expect(copy[field].trim()).not.toBe('');
      expect(copy[field]).not.toBe(english[field]);
    }
    expect(copy.subject).toContain('Wherefall');
    expect(copy.body).toContain('Wherefall');
    expect(copy.body).toContain('neel_s');
    expect(copy.body).not.toContain('{username}');
    // the hour the link lasts is said in every language
    expect(copy.footer).toContain('1');
  });
});

describe('mailLanguageSchema', () => {
  it('takes each of the five languages', () => {
    for (const lang of MAIL_LANGUAGES) {
      expect(mailLanguageSchema.parse(lang)).toBe(lang);
    }
  });

  it.each([undefined, null, '', 'EN', 'pt', 'en-GB', 42, {}])('reads %j as English', (lang) => {
    expect(mailLanguageSchema.parse(lang)).toBe('en');
  });
});

describe('MAIL_FROM', () => {
  it('is the sender the domain is verified for', () => {
    expect(MAIL_FROM).toBe('Wherefall <no-reply@n3el.dev>');
  });
});
