/**
 * Plan My Day -- single-item time editing, CLIENT side.
 *
 * The ONLY client-side function that calls PR #280's
 * `POST /api/day-constructor/preview-item` (route.ts, completely
 * unmodified by this file). Mirrors this repository's own established
 * convention for a thin network wrapper (`acceptConstructedDay.ts`,
 * `dayConstructorPreviewClient.ts`): a pure request builder, a pure
 * response parser (independently testable with plain JS values, no
 * `fetch` mock), and exactly one function that actually calls `fetch`.
 *
 * TRUST BOUNDARY: this file never re-derives `activityId`/`title`/
 * `placementSource` -- it sends the ORIGINAL item's own already-verified
 * fields back verbatim (the server re-verifies them against the
 * `acceptanceToken` before trusting any of it; see preview-item/route.ts's
 * own doc comment). The only thing this file lets a caller choose is
 * `candidateStart`. Never persists anything -- this is a preview-only
 * re-sign, not acceptance.
 *
 * STATUS-CODE ASYMMETRY (read directly from preview-item/route.ts, not
 * assumed): every REJECTED reason except `TIMING_CHECK_FAILED` is
 * returned with a plain HTTP 200 (matching this codebase's established
 * "every domain outcome is HTTP 200" convention for F1/E2); a thrown or
 * empty timing assessment is the ONE case returned with a real HTTP 500.
 * `dayConstructorPreviewClient.ts`'s own parser treats ANY non-200 as a
 * protocol-level `HTTP_ERROR` -- copying that rule verbatim here would
 * misclassify a genuine `TIMING_CHECK_FAILED` rejection as `HTTP_ERROR`.
 * `parseUpdatePreviewItemTimeResponseBody` below instead checks the body's
 * own `status` field FIRST, regardless of HTTP status, and only falls
 * back to `HTTP_ERROR`/`UNKNOWN_RESPONSE` for a body that carries no
 * recognized domain shape at all (the plain `{error}` 401/404/400
 * envelopes genuinely have no `status` field).
 */

import type { ConstructionWindow } from './dayIntent';
import type { ProposedItem } from './dayConstructor';

// ============================================================
// Request body -- exactly preview-item/route.ts's own accepted shape.
// ============================================================

export interface UpdatePreviewItemTimeRequestBody {
  window: { date: string; start: string; end: string; timezone: string; source: ConstructionWindow['source'] };
  item: { intentId: string; activityId?: string; title: string; start: string; end: string; placementSource: ProposedItem['placementSource'] };
  acceptanceToken: string;
  candidateStart: string;
}

/** The subset of a `ProposedItem` this module ever reads. Never the whole
 * `ProposedItem` type -- `timingFit`/`candidateOrder`/`requiresConfirmation`
 * are presentation/ranking artifacts the server never signed and this
 * endpoint never accepts (preview-item/route.ts's own `parseOriginalItem`). */
export type OriginalPreviewItemFacts = Pick<ProposedItem, 'intentId' | 'activityId' | 'title' | 'start' | 'end' | 'placementSource'>;

export function buildUpdatePreviewItemTimeRequestBody(
  window: ConstructionWindow,
  item: OriginalPreviewItemFacts,
  acceptanceToken: string,
  candidateStart: Date
): UpdatePreviewItemTimeRequestBody {
  return {
    window: { date: window.date, start: window.start.toISOString(), end: window.end.toISOString(), timezone: window.timezone, source: window.source },
    item: { intentId: item.intentId, activityId: item.activityId, title: item.title, start: item.start.toISOString(), end: item.end.toISOString(), placementSource: item.placementSource },
    acceptanceToken,
    candidateStart: candidateStart.toISOString(),
  };
}

// ============================================================
// Response -- preview-item/route.ts's own four statuses, plus the
// purely client-side outcomes this repository's other network wrappers
// already establish.
// ============================================================

/** The item the server returns on `UPDATED`: a real `ProposedItem` (same
 * shape the preview already carries) plus its NEW `acceptanceToken` --
 * the only field a caller is ever meant to read off a proposed item that
 * is not part of `ProposedItem` itself (see `acceptConstructedDay.ts`'s
 * own identical convention for the original token). */
export type UpdatedPreviewItem = ProposedItem & { acceptanceToken: string };

export type PreviewItemRejectionReason = 'INVALID_REQUEST' | 'STALE_PREVIEW' | 'UNAVAILABLE' | 'TIMING_CHECK_FAILED';

export type UpdatePreviewItemTimeClientResult =
  | { status: 'UPDATED'; item: UpdatedPreviewItem }
  | { status: 'REJECTED'; reason: PreviewItemRejectionReason; detail?: string }
  | { status: 'HTTP_ERROR'; httpStatus: number }
  | { status: 'NETWORK_ERROR' }
  | { status: 'UNKNOWN_RESPONSE' };

const REJECTION_REASONS: ReadonlySet<string> = new Set(['INVALID_REQUEST', 'STALE_PREVIEW', 'UNAVAILABLE', 'TIMING_CHECK_FAILED']);

/** Mirrors `dayConstructorPreviewClient.ts`'s own private `reviveDate`
 * exactly -- not a second convention, just not exported there. */
function reviveDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Pure -- never throws, never touches the network. Checks the body's own
 * `status` field BEFORE the HTTP status (see this file's own doc comment
 * on the TIMING_CHECK_FAILED / HTTP 500 asymmetry). */
export function parseUpdatePreviewItemTimeResponseBody(body: unknown, httpStatus: number): UpdatePreviewItemTimeClientResult {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (record.status === 'UPDATED') {
      const itemRaw = record.item;
      if (!itemRaw || typeof itemRaw !== 'object') return { status: 'UNKNOWN_RESPONSE' };
      const itemRecord = itemRaw as Record<string, unknown>;
      const start = reviveDate(itemRecord.start);
      const end = reviveDate(itemRecord.end);
      if (
        !start ||
        !end ||
        typeof itemRecord.acceptanceToken !== 'string' ||
        !itemRecord.acceptanceToken ||
        typeof itemRecord.intentId !== 'string' ||
        typeof itemRecord.title !== 'string' ||
        (itemRecord.placementSource !== 'FIXED_CONSTRAINT' && itemRecord.placementSource !== 'SELECTED_CANDIDATE') ||
        (itemRecord.activityId !== undefined && typeof itemRecord.activityId !== 'string')
      ) {
        return { status: 'UNKNOWN_RESPONSE' };
      }
      const item: UpdatedPreviewItem = {
        intentId: itemRecord.intentId,
        activityId: typeof itemRecord.activityId === 'string' ? itemRecord.activityId : undefined,
        title: itemRecord.title,
        start,
        end,
        placementSource: itemRecord.placementSource,
        requiresConfirmation: true,
        acceptanceToken: itemRecord.acceptanceToken,
      };
      return { status: 'UPDATED', item };
    }
    if (record.status === 'REJECTED') {
      if (typeof record.reason !== 'string' || !REJECTION_REASONS.has(record.reason)) return { status: 'UNKNOWN_RESPONSE' };
      return { status: 'REJECTED', reason: record.reason as PreviewItemRejectionReason, detail: typeof record.detail === 'string' ? record.detail : undefined };
    }
  }
  if (httpStatus !== 200) return { status: 'HTTP_ERROR', httpStatus };
  return { status: 'UNKNOWN_RESPONSE' };
}

/**
 * The one network call. Never retries internally -- a thrown/failed
 * `fetch` is reported as `NETWORK_ERROR`, distinct from every
 * server-returned status, so a caller decides whether and how to retry.
 */
export async function updatePreviewItemTime(
  window: ConstructionWindow,
  item: OriginalPreviewItemFacts,
  acceptanceToken: string,
  candidateStart: Date
): Promise<UpdatePreviewItemTimeClientResult> {
  let response: Response;
  try {
    response = await fetch('/api/day-constructor/preview-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildUpdatePreviewItemTimeRequestBody(window, item, acceptanceToken, candidateStart)),
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
  return parseUpdatePreviewItemTimeResponseBody(json, response.status);
}
