/**
 * Day Constructor V1 -- PR F2 preview client helper.
 *
 * The ONLY client-side function that requests a `ConstructDayPreview` from
 * PR F1's `POST /api/day-constructor/preview`. Mirrors E3's own
 * `acceptConstructedDay.ts` pattern exactly: a pure, directly-testable
 * response parser (`parsePreviewResponseBody`) separate from the one real
 * network call (`previewConstructedDay`), plus one explicit, pure date-
 * revival adapter (`reviveConstructDayPreviewDates`) -- F1 returns JSON, so
 * every `Date` field in a `ConstructDayPreview` arrives as an ISO string;
 * `DayPlanPreviewController`/`DayPlanPreview` (PR D/E3, unmodified) require
 * real `Date` instances (e.g. `item.end.getTime() - item.start.getTime()`,
 * `window.start.toISOString()` inside `computePreviewIdentityKey`). This
 * file never relies on a TypeScript cast to bridge that gap -- every
 * required field is parsed and validated explicitly, and the whole preview
 * is rejected (`UNKNOWN_RESPONSE`) rather than partially revived if any of
 * them fails to parse.
 *
 * Never sends `userId`/`timezone`/`now`/`originalOrder`/`importance`/
 * `deadline`/`activityId`/`constructionWindowSource` -- F2's V1 request is
 * exactly `{ targetDate, intents: [{id, title, durationMinutes?,
 * flexibility, fixedStart? }] }` (planning-date hardening, this ticket's
 * own section 7: `targetDate` is always the same server-established
 * planning date FIXED-time assembly used, never omitted once established).
 */

import type { ConstructDayPreview } from './dayConstructorOrchestrator';

// ============================================================
// Request body (F1's own accepted shape, dayConstructorPreviewRequest.ts)
// ============================================================

export interface PreviewRequestIntentBody {
  id: string;
  title: string;
  durationMinutes?: number;
  flexibility: 'FIXED' | 'FLEXIBLE';
  /** Only meaningful when `flexibility === 'FIXED'`. A real `Date` here --
   * `JSON.stringify` (inside `previewConstructedDay` below) serializes it
   * to an ISO string the same way `acceptConstructedDay.ts`'s own request
   * body does, never a hand-formatted string. */
  fixedStart?: Date;
}

// ============================================================
// Client result contract -- F1's own six domain statuses, plus
// `HTTP_ERROR` for a non-200 protocol-level response (401/400/404/500,
// none of which carry an F1 domain `status` at all -- see
// dayConstructorPreviewRequest.ts's own route wiring), and the same two
// purely client-side outcomes `acceptConstructedDay.ts` already
// establishes (`NETWORK_ERROR`, `UNKNOWN_RESPONSE`).
// ============================================================

export type ConstructDayPreviewClientResult =
  | { status: 'READY'; preview: ConstructDayPreview }
  | { status: 'NO_USABLE_CAPACITY' }
  | { status: 'INVALID_CONSTRUCTION_WINDOW' }
  | { status: 'TIMEZONE_MISSING' }
  | { status: 'INVALID_REQUEST' }
  | { status: 'TIMING_SEARCH_FAILED' }
  | { status: 'HTTP_ERROR'; httpStatus: number }
  | { status: 'NETWORK_ERROR' }
  | { status: 'UNKNOWN_RESPONSE' };

function reviveDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The ONLY Date-revival boundary for a preview response (this ticket's own
 * section 25/26). Exhaustively enumerated against the real
 * `ConstructDayPreview`/`ConstructedDay`/`ProposedItem` shapes
 * (dayConstructorOrchestrator.ts/dayConstructor.ts) -- `deferredItems`,
 * `conflicts`, `requestedCapacity`/`proposedCapacity`, and `resolvedIntents`
 * carry no Date fields at all (confirmed by direct audit, not assumed), so
 * only FOUR fields ever need revival: `constructionWindow.start`/`.end`
 * and each proposed item's own `start`/`end`. Returns `null` -- never a
 * partially-revived object -- if any required field is missing or
 * unparseable.
 */
export function reviveConstructDayPreviewDates(raw: unknown): ConstructDayPreview | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const window = record.constructionWindow;
  if (!window || typeof window !== 'object') return null;
  const windowRecord = window as Record<string, unknown>;
  const windowStart = reviveDate(windowRecord.start);
  const windowEnd = reviveDate(windowRecord.end);
  if (!windowStart || !windowEnd) return null;

  const constructedDay = record.constructedDay;
  if (!constructedDay || typeof constructedDay !== 'object') return null;
  const constructedDayRecord = constructedDay as Record<string, unknown>;
  const proposedItemsRaw = constructedDayRecord.proposedItems;
  if (!Array.isArray(proposedItemsRaw)) return null;

  const proposedItems: Record<string, unknown>[] = [];
  for (const item of proposedItemsRaw) {
    if (!item || typeof item !== 'object') return null;
    const itemRecord = item as Record<string, unknown>;
    const start = reviveDate(itemRecord.start);
    const end = reviveDate(itemRecord.end);
    if (!start || !end) return null;
    proposedItems.push({ ...itemRecord, start, end });
  }

  return {
    ...record,
    constructionWindow: { ...windowRecord, start: windowStart, end: windowEnd },
    constructedDay: { ...constructedDayRecord, proposedItems },
  } as unknown as ConstructDayPreview;
}

/** Pure -- never throws, never touches the network. Exported directly so
 * response-shape handling is testable without mocking `fetch`. */
export function parsePreviewResponseBody(body: unknown, httpStatus: number): ConstructDayPreviewClientResult {
  if (!body || typeof body !== 'object') return { status: 'UNKNOWN_RESPONSE' };
  const record = body as Record<string, unknown>;

  // A non-200 response is ALWAYS a protocol-level failure in F1's own
  // contract (dayConstructorPreviewRequest.ts: every domain outcome is
  // HTTP 200) -- never reinterpreted as a domain status even if the body
  // happens to carry a `status`-shaped field.
  if (httpStatus !== 200) return { status: 'HTTP_ERROR', httpStatus };

  switch (record.status) {
    case 'READY': {
      const preview = reviveConstructDayPreviewDates(record.preview);
      return preview ? { status: 'READY', preview } : { status: 'UNKNOWN_RESPONSE' };
    }
    case 'NO_USABLE_CAPACITY':
      return { status: 'NO_USABLE_CAPACITY' };
    case 'INVALID_CONSTRUCTION_WINDOW':
      return { status: 'INVALID_CONSTRUCTION_WINDOW' };
    case 'TIMEZONE_MISSING':
      return { status: 'TIMEZONE_MISSING' };
    case 'INVALID_REQUEST':
      return { status: 'INVALID_REQUEST' };
    case 'TIMING_SEARCH_FAILED':
      return { status: 'TIMING_SEARCH_FAILED' };
    default:
      return { status: 'UNKNOWN_RESPONSE' };
  }
}

/**
 * The one network call. Never retries internally -- a thrown/failed
 * `fetch` itself is reported as `NETWORK_ERROR`, distinct from every
 * server-returned status, so a caller (PlanDayClient.tsx) decides whether
 * and how to retry.
 */
export interface ConstructDayPreviewRequestBody {
  targetDate: string;
  intents: PreviewRequestIntentBody[];
}

/**
 * Pure. Planning-date hardening (this ticket's own section 7): once F2
 * has established a server-authoritative `planningDate`
 * (planDayBootstrap.ts), it is ALWAYS sent as `targetDate` -- never
 * omitted -- so F1 never has to independently re-derive "today" from its
 * own fresh `now` and risk disagreeing with the exact civil date this
 * request's own FIXED `fixedStart` values were assembled against. Still
 * never sends `userId`/`timezone`/`now`/`originalOrder`/`importance`/
 * `deadline`/`constructionWindowSource` (this ticket's own section 7/22).
 */
export function buildPreviewRequestBody(intents: PreviewRequestIntentBody[], targetDate: string): ConstructDayPreviewRequestBody {
  return { targetDate, intents };
}

export async function previewConstructedDay(intents: PreviewRequestIntentBody[], targetDate: string): Promise<ConstructDayPreviewClientResult> {
  let response: Response;
  try {
    response = await fetch('/api/day-constructor/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPreviewRequestBody(intents, targetDate)),
    });
  } catch {
    return { status: 'NETWORK_ERROR' };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { status: 'UNKNOWN_RESPONSE' };
  }
  return parsePreviewResponseBody(json, response.status);
}
