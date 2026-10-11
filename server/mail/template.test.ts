import { describe, expect, it } from 'vitest';
import { escapeHtml, renderEmail, type EmailCopy } from './template.js';

const COPY: EmailCopy = {
  app: 'Wherefall',
  subject: 'Reset your Wherefall password',
  heading: 'Reset your password',
  body: 'Someone asked to reset the password for your Wherefall account neel. If that was you, choose a new one below.',
  button: 'Reset password',
  url: 'https://wherefall.example/?reset=Zk3v9Qx1LrT8mB2nYc7WdA5sHj0PqUeXoIiGfRtN4wE',
  linkHint: 'Or paste this link into your browser:',
  footer: "This link works once and expires in 1 hour. If you didn't ask for it, ignore this email and your password stays the same.",
};

/** A value that would break out of text, of an attribute and of a tag if it were written as it is. */
const HOSTILE = `"><script>alert('x')</script>&`;
const ESCAPED = '&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;';

describe('escapeHtml', () => {
  it('escapes the five characters that mean something in HTML, and leaves the rest', () => {
    expect(escapeHtml(HOSTILE)).toBe(ESCAPED);
    expect(escapeHtml('Réinitialisez — Сбросить пароль')).toBe('Réinitialisez — Сбросить пароль');
  });
});

describe('renderEmail', () => {
  it('answers with the subject as given, an HTML body and a text one', () => {
    const mail = renderEmail(COPY);
    expect(mail.subject).toBe(COPY.subject);
    expect(mail.html.startsWith('<!doctype html>')).toBe(true);
    expect(mail.html.endsWith('</html>')).toBe(true);
  });

  it('writes the text version as the wordmark, the heading, the body, the button with its link, and the small print', () => {
    expect(renderEmail(COPY).text).toBe(
      ['WHEREFALL', COPY.heading, COPY.body, `Reset password: ${COPY.url}`, COPY.footer].join('\n\n'),
    );
  });

  it('puts every part of the copy into the HTML, and the link on the button and written out', () => {
    const { html } = renderEmail(COPY);
    for (const part of [COPY.heading, COPY.body, COPY.button, COPY.linkHint, escapeHtml(COPY.footer)]) {
      expect(html).toContain(part);
    }
    expect(html.split(`href="${COPY.url}"`)).toHaveLength(3);
    expect(html).toContain(`>${COPY.url}</a>`);
    expect(html).toContain(`<title>${COPY.subject}</title>`);
  });

  it('says which language the copy is in, English unless told', () => {
    expect(renderEmail(COPY).html).toContain('<html lang="en">');
    expect(renderEmail({ ...COPY, lang: 'ru' }).html).toContain('<html lang="ru">');
  });

  it.each(['app', 'subject', 'heading', 'body', 'button', 'url', 'linkHint', 'footer', 'lang'] as const)('escapes a hostile %s wherever it is written', (field) => {
    const { html } = renderEmail({ ...COPY, [field]: HOSTILE });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain(HOSTILE);
    expect(html).toContain(ESCAPED);
  });

  it('is laid out with tables and inline styles only, in the colors of the site', () => {
    const { html } = renderEmail(COPY);
    expect(html).not.toMatch(/<style|<link|<script|<img/);
    for (const color of ['#0E0E0D', '#F2F0EA', '#A9A8A3', '#757470', '#252523', '#4C8DFF']) {
      expect(html).toContain(color);
    }
  });
});
