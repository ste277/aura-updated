/**
 * AURA-READY-02-F4 -- tell a FAILED Find a Time search apart from a search
 * that genuinely found no suitable time.
 *
 * PlanWithAuraView's Find a Time used to catch EVERY failure (offline, a 5xx,
 * an unreadable body) and show "Aura could not find a time for this request.
 * Try a shorter duration or a wider date range." -- advice that only fits a
 * real empty result, which already has its own message.
 *
 * Classification uses only what the existing transport already produces, so
 * no API contract changes:
 *   - fetch() rejecting with a network TypeError       -> NETWORK
 *   - a non-2xx response (callers throw)              -> SERVER
 *   - an unparseable body (SyntaxError) or a body
 *     without a `candidates` array                     -> MALFORMED
 *   - no answer within FIND_TIME_TIMEOUT_MS            -> TIMEOUT
 *   - anything else                                    -> SERVER (generic)
 * Internal error details are never shown.
 */

export type FindTimeErrorKind = 'NETWORK' | 'SERVER' | 'TIMEOUT' | 'MALFORMED';

/** A normal search answers in ~1.5-3 s; 20 s is clearly "stuck". */
export const FIND_TIME_TIMEOUT_MS = 20_000;

export const FIND_TIME_ERROR_COPY: Record<FindTimeErrorKind, { title: string; message: string }> = {
  NETWORK: { title: 'Connection problem', message: "We couldn't connect to Aura. Check your connection and try again." },
  SERVER: { title: 'Search unavailable', message: 'Something went wrong while finding a time. Please try again.' },
  TIMEOUT: { title: 'Request timed out', message: 'This search is taking longer than expected. Please try again.' },
  MALFORMED: { title: 'Search unavailable', message: 'Something went wrong while finding a time. Please try again.' },
};

export class FindTimeError extends Error {
  constructor(public readonly kind: FindTimeErrorKind) {
    super(`find-a-time ${kind}`);
    this.name = 'FindTimeError';
  }
}

// Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError when
// attempting to fetch resource." A TypeError from anything else is a bug, not
// a connection problem, so it stays SERVER (generic).
const NETWORK_TYPE_ERROR = /failed to fetch|load failed|networkerror|network request failed/i;

export function classifyFindTimeError(err: unknown): FindTimeErrorKind {
  if (err instanceof FindTimeError) return err.kind;
  if (err instanceof SyntaxError) return 'MALFORMED';
  if (err instanceof TypeError && NETWORK_TYPE_ERROR.test(err.message)) return 'NETWORK';
  return 'SERVER';
}

/** Rejects with FindTimeError('TIMEOUT') if `promise` hasn't settled in `ms`. */
export function withFindTimeTimeout<T>(promise: Promise<T>, ms: number = FIND_TIME_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FindTimeError('TIMEOUT')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A successful search must carry a `candidates` array (possibly empty);
 * anything else is MALFORMED, never an empty result. */
export function assertFindTimeCandidates<T>(data: T): T {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { candidates?: unknown }).candidates)) {
    throw new FindTimeError('MALFORMED');
  }
  return data;
}
