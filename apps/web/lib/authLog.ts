/**
 * AURA-SEC-01 (#350) -- log-safe forms of values the sign-in routes report.
 *
 * Raw error objects are not logged: a provider error message can echo the
 * recipient, and a Postgres error's `detail` can contain row values (for
 * example a unique-violation on an email). Only the error's name, its code and
 * its message (with any email address redacted, and truncated) are kept.
 */
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAX_MESSAGE_LENGTH = 300;

export function redactEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, '[email]');
}

export function errorForLog(err: unknown): { name: string; code?: string; message: string } {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown; message?: unknown };
    return {
      name: typeof e.name === 'string' ? e.name : 'Error',
      ...(typeof e.code === 'string' || typeof e.code === 'number' ? { code: String(e.code) } : {}),
      message: redactEmails(String(e.message ?? '')).slice(0, MAX_MESSAGE_LENGTH),
    };
  }
  return { name: 'NonError', message: redactEmails(String(err)).slice(0, MAX_MESSAGE_LENGTH) };
}
