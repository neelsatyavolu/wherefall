import { describe, expect, it } from 'vitest';
import { MailError, sendEmail, type Mail } from './send.js';

const API_KEY = 're_test_key_never_sent_anywhere';
const CONFIG = { apiKey: API_KEY, from: 'Wherefall <no-reply@n3el.dev>' };
const MAIL: Mail = { to: 'neel@example.com', subject: 'Reset your Wherefall password', html: '<p>html</p>', text: 'text' };

interface Sent {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that answers every call with one status and remembers what it was asked. */
function fakeFetch(status: number) {
  const calls: Sent[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'made-up' }), { status });
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

describe('sendEmail', () => {
  it('posts the email to Resend as JSON, with the key as a bearer token and a time limit', async () => {
    const { fetchImpl, calls } = fakeFetch(200);
    await sendEmail(MAIL, CONFIG, fetchImpl);

    expect(calls).toHaveLength(1);
    const [{ url, init } = { url: '', init: undefined }] = calls;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: 'Wherefall <no-reply@n3el.dev>',
      to: ['neel@example.com'],
      subject: MAIL.subject,
      html: MAIL.html,
      text: MAIL.text,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([400, 401, 403, 422, 429, 500])('throws when Resend answers %i, saying the status and never the key', async (status) => {
    const { fetchImpl } = fakeFetch(status);
    const failure = await sendEmail(MAIL, CONFIG, fetchImpl).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MailError);
    expect(failure).toMatchObject({ name: 'MailError', status, message: `Resend refused the email (HTTP ${status})` });
    expect(JSON.stringify(failure)).not.toContain(API_KEY);
    expect(String((failure as Error).stack)).not.toContain(API_KEY);
  });

  it('lets a failure to reach Resend through as it is', async () => {
    const unreachable = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    await expect(sendEmail(MAIL, CONFIG, unreachable)).rejects.toThrow('fetch failed');
  });
});
