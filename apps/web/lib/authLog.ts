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
 * (`u@[192.0.2.1]`), quoted local parts (`"a b"@x.com`) and URL-encoded at
 * signs (`%40`, `%2540`). Over-redacting a log line is acceptable; leaking an
 * address is not.
 */
const AT = '(?:@|%40|%2540)';
// Quoted local part first, so its spaces don't split it into a leaked prefix.
const QUOTED_ADDRESS = new RegExp(`"[^"\\r\\n]{0,128}"\\s*${AT}[^\\s<>()"',;]+`, 'gi');
const ADDRESS = new RegExp(`[^\\s<>()\\[\\]"',;@]+${AT}[^\\s<>()"',;]+`, 'gi');
const MAX_MESSAGE_LENGTH = 300;
const MAX_FIELD_LENGTH = 64;

export function redactEmails(text: string): string {
  return text.replace(QUOTED_ADDRESS, '[email]').replace(ADDRESS, '[email]');
}

const safe = (value: unknown, max: number) => redactEmails(String(value)).slice(0, max);

export function errorForLog(err: unknown): { name: string; code?: string; message: string } {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown; message?: unknown };
    return {
      name: typeof e.name === 'string' ? safe(e.name, MAX_FIELD_LENGTH) : 'Error',
      ...(typeof e.code === 'string' || typeof e.code === 'number' ? { code: safe(e.code, MAX_FIELD_LENGTH) } : {}),
      message: safe(e.message ?? '', MAX_MESSAGE_LENGTH),
    };
  }
  return { name: 'NonError', message: safe(err, MAX_MESSAGE_LENGTH) };
}
