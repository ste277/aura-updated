/**
 * Day Constructor V1 -- PR E3 acceptance client helper.
 *
 * The ONLY client-side function that submits a reviewed
 * `ConstructDayPreview` for persistence. Sends the E2 request contract
 * exactly, to E2's own single canonical endpoint below -- no other
 * plan-creation route, no Server Action, no second persistence path. This file
 * never reconstructs the proposal, never re-runs timing search, never
 * mutates the preview -- `buildAcceptRequestBody` is a pure, direct
 * mapping from the reviewed `ConstructDayPreview`'s own
 * `constructionWindow`/`constructedDay.proposedItems` to E2's own
 * request shape (`AcceptConstructedDayRequest`, dayConstructorAcceptance.ts),
 * deliberately excluding `deferredItems`/warnings/capacity/presentation
 * copy/`userId`/`now` (this ticket's own section 5/6).
 */

import type { ConstructDayPreview } from './dayConstructorOrchestrator';
import type { AcceptanceRejectionReason, AcceptanceDiagnostic } from './dayConstructorAcceptance';

// ============================================================
// Request body (this ticket's own section 5/6/24) -- exactly the E2
// contract, built ONLY from the reviewed preview's own already-decided
// facts. Never includes `deferredItems`.
// ============================================================

/**
 * Goals -> Planning Integration V1 PR C, this ticket's own section 20 --
 * a SIBLING envelope entry, never merged into `proposedItems` (E1's own
 * scheduling-domain shape is untouched). `intentId` is the exact id a
 * placed `proposedItems[].intentId` already carries; `goalActivityId` is
 * the originating GoalActivity's id. See `buildGoalActivityLinksForAccept`
 * (planDayEntry.ts) for how this array is actually built -- only rows
 * that both carry Goal provenance AND were actually placed reach here.
 */
export interface GoalActivityLink {
  intentId: string;
  goalActivityId: string;
}

/** Quick Capture V1 PR B -- the sibling of GoalActivityLink: same rules, never merged into proposedItems. */
export interface CaptureLink {
  intentId: string;
  captureId: string;
}

export interface AcceptConstructedDayRequestBody {
  clientRequestId: string;
  constructionWindow: ConstructDayPreview['constructionWindow'];
  proposedItems: Array<{
    intentId: string;
    activityId?: string;
    title: string;
    start: Date;
    end: Date;
    placementSource: 'FIXED_CONSTRAINT' | 'SELECTED_CANDIDATE';
    /** The opaque server-signed token the preview returned for this item; passed back verbatim, never decoded. */
    acceptanceToken?: string;
  }>;
  /** Present only when at least one accepted row actually carries Goal
   * provenance -- omitted entirely otherwise, so an ordinary typed-only
   * acceptance sends byte-identical JSON to before this PR. */
  goalActivityLinks?: GoalActivityLink[];
  /** Present only when at least one accepted row carries Capture provenance. */
  captureLinks?: CaptureLink[];
}

export function buildAcceptRequestBody(preview: ConstructDayPreview, clientRequestId: string, goalActivityLinks?: readonly GoalActivityLink[], captureLinks?: readonly CaptureLink[]): AcceptConstructedDayRequestBody {
  return {
    clientRequestId,
    constructionWindow: preview.constructionWindow,
    proposedItems: preview.constructedDay.proposedItems.map((item) => ({
      intentId: item.intentId,
      activityId: item.activityId,
      title: item.title,
      start: item.start,
      end: item.end,
      placementSource: item.placementSource,
      acceptanceToken: (item as { acceptanceToken?: string }).acceptanceToken,
    })),
    ...(goalActivityLinks && goalActivityLinks.length > 0 ? { goalActivityLinks: [...goalActivityLinks] } : {}),
    ...(captureLinks && captureLinks.length > 0 ? { captureLinks: [...captureLinks] } : {}),
  };
}

// ============================================================
// Client result contract (this ticket's own section 10) -- E2's own five
// statuses, plus two purely client-side outcomes (`NETWORK_ERROR` for a
// failed `fetch` itself, `UNKNOWN_RESPONSE` for anything this file
// cannot safely recognize) so a caller never has to guess "did the
// request even reach the server."
// ============================================================

export interface PersistedPlanSummary {
  id: string;
  title: string;
  plannedStartAt: string;
  plannedEndAt: string;
}

export type AcceptConstructedDayClientResult =
  | { status: 'SAVED'; plans: PersistedPlanSummary[] }
  | { status: 'ALREADY_ACCEPTED'; plans: PersistedPlanSummary[] }
  | { status: 'REJECTED'; reason: AcceptanceRejectionReason; diagnostics: AcceptanceDiagnostic[] }
  | { status: 'IDEMPOTENCY_CONFLICT' }
  | { status: 'SAVE_FAILED' }
  | { status: 'NETWORK_ERROR' }
  | { status: 'UNKNOWN_RESPONSE' };

const KNOWN_REJECTION_REASONS = new Set<AcceptanceRejectionReason>(['INVALID_REQUEST', 'STALE_PREVIEW', 'INVALID_ACTIVITY', 'CONFLICT', 'TIMING_CHECK_FAILED']);

/** Pure -- never throws, never touches the network. Exported directly so
 * response-shape handling is testable without mocking `fetch`. */
export function parseAcceptResponseBody(body: unknown): AcceptConstructedDayClientResult {
  if (!body || typeof body !== 'object') return { status: 'UNKNOWN_RESPONSE' };
  const record = body as Record<string, unknown>;
  switch (record.status) {
    case 'SAVED':
      return { status: 'SAVED', plans: Array.isArray(record.plans) ? (record.plans as PersistedPlanSummary[]) : [] };
    case 'ALREADY_ACCEPTED':
      return { status: 'ALREADY_ACCEPTED', plans: Array.isArray(record.plans) ? (record.plans as PersistedPlanSummary[]) : [] };
    case 'REJECTED':
      if (typeof record.reason !== 'string' || !KNOWN_REJECTION_REASONS.has(record.reason as AcceptanceRejectionReason)) return { status: 'UNKNOWN_RESPONSE' };
      return { status: 'REJECTED', reason: record.reason as AcceptanceRejectionReason, diagnostics: Array.isArray(record.diagnostics) ? (record.diagnostics as AcceptanceDiagnostic[]) : [] };
    case 'IDEMPOTENCY_CONFLICT':
      return { status: 'IDEMPOTENCY_CONFLICT' };
    case 'SAVE_FAILED':
      return { status: 'SAVE_FAILED' };
    default:
      return { status: 'UNKNOWN_RESPONSE' };
  }
}

/**
 * The one network call. Never retries internally (this ticket's own
 * section 17: retry is the CALLER's decision, reusing the SAME
 * `clientRequestId`) -- a thrown/failed `fetch` itself is reported as
 * `NETWORK_ERROR`, distinct from every server-returned status, so a
 * caller can safely retry with the identical request.
 */
export async function acceptConstructedDay(preview: ConstructDayPreview, clientRequestId: string, goalActivityLinks?: readonly GoalActivityLink[], captureLinks?: readonly CaptureLink[]): Promise<AcceptConstructedDayClientResult> {
  let response: Response;
  try {
    response = await fetch('/api/day-constructor/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAcceptRequestBody(preview, clientRequestId, goalActivityLinks, captureLinks)),
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
  return parseAcceptResponseBody(json);
}
