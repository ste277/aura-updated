/**
 * AURA-SEC-01 (#350) -- log-safe forms of values the sign-in routes report.
 *
 * Raw error objects are not logged: a provider error message can echo the
 * recipient, and a Postgres error's `detail` can contain row values (for
 * example a unique-violation on an email). Only the error's name, its code and
 * its message are kept, each with any email address redacted and truncated.
 *
 * Redaction deliberately over-matches: anything shaped like `x@y` is replaced,
 * including internationalised addresses, `user@localhost`, IP-literal domains
 * (`u@[192.0.2.1]`), quoted or commented local parts (`"a b"@x.com`,
 * `(c)a@x.com`), apostrophes (`o'brien@x.com`), URL-encoded at signs (`%40`,
 * `%2540`) and the fullwidth at sign. Over-redacting a log line is acceptable;
 * leaking an address is not.
 *
 * Input is cut to MAX_INPUT_LENGTH BEFORE matching, so a long message can never
 * make the pattern slow (it is quadratic in the worst case on unbounded input).
 */
const AT = '(?:@|\\uFF20|%40|%2540)';
// Quoted local part first, so its spaces (or newlines) don't split it into a leaked prefix.
const QUOTED_ADDRESS = new RegExp(`"[^"]{0,128}"\\s*${AT}[^\\s<>"';,]+`, 'giu');
const ADDRESS = new RegExp(`[^\\s<>"@\\uFF20]+${AT}[^\\s<>"';,]+`, 'giu');
const MAX_INPUT_LENGTH = 4096;
const MAX_MESSAGE_LENGTH = 300;
const MAX_FIELD_LENGTH = 64;

export function redactEmails(text: string): string {
  return text.slice(0, MAX_INPUT_LENGTH).replace(QUOTED_ADDRESS, '[email]').replace(ADDRESS, '[email]');
}

function safe(value: unknown, max: number): string {
  let text: string;
  try {
    text = String(value);
  } catch {
    return '[unprintable]';
  }
  return redactEmails(text).slice(0, max);
}

export function errorForLog(err: unknown): { name: string; code?: string; message: string } {
  try {
    if (err && typeof err === 'object') {
      const e = err as { name?: unknown; code?: unknown; message?: unknown };
      const code = e.code;
      return {
        name: typeof e.name === 'string' ? safe(e.name, MAX_FIELD_LENGTH) : 'Error',
        ...(typeof code === 'string' || typeof code === 'number' ? { code: safe(code, MAX_FIELD_LENGTH) } : {}),
        message: safe(e.message ?? '', MAX_MESSAGE_LENGTH),
      };
    }
    return { name: 'NonError', message: safe(err, MAX_MESSAGE_LENGTH) };
  } catch {
    // A hostile getter must never turn a logging call into a thrown error.
    return { name: 'Unloggable', message: '[unprintable]' };
  }
}
