/** Sends one email through Resend's HTTP API. No SDK: it is a single POST. */

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailConfig {
  /** Resend API key. */
  apiKey: string;
  /** Sender, as `Wherefall <no-reply@n3el.dev>`. The domain must be verified in Resend. */
  from: string;
}

/** What a route sends an email with: the real thing in production, a stand-in in tests. */
export type Mailer = (mail: Mail) => Promise<void>;

const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

/** Resend answered, and refused. It carries the status and nothing of the request, so it is safe to log. */
export class MailError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Resend refused the email (HTTP ${status})`);
    this.name = 'MailError';
    this.status = status;
  }
}

/** Sends the email, or throws: a `MailError` when Resend refuses it, whatever `fetch` threw when Resend was not reached. */
export async function sendEmail(mail: Mail, config: MailConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new MailError(response.status);
  }
}
