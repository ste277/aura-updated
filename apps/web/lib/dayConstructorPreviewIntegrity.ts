/**
 * Remaining-Day Recomposition V1 PR F1 (trust-boundary correction) -- Day Constructor PREVIEW INTEGRITY.
 *
 * The Day Constructor preview is stateless: the server hands the browser a proposal, and the browser later
 * resubmits the items it wants accepted. Until now the browser was authoritative for what each proposed item
 * MEANT -- notably `placementSource` (FIXED_CONSTRAINT vs SELECTED_CANDIDATE), which decides the persisted
 * scheduling mode and whether acceptance runs the timing check. A caller could flip it.
 *
 * This module closes that with a SERVER-SIGNED, PER-ITEM token, and nothing else:
 *   - the preview response gets one `acceptanceToken` per proposed item;
 *   - acceptance verifies each item against its token BEFORE anything is trusted or written.
 * The token proves "Aura produced exactly this item, for this user, in this construction window, with this
 * placementSource". It is NOT authentication, authorization, an idempotency key, or proposal persistence -- the
 * session, ownership checks, staleness, fresh-blocker and timing revalidation all still apply. Signature validity
 * never implies the proposal can still be committed.
 *
 * DESIGN CHOICES (documented, not accidental):
 *  - Secret / primitive: the repository's existing `sign`/`verify` (auth.ts): HMAC-SHA256 over the base64url body
 *    keyed by AUTH_SECRET, compared with `timingSafeEqual`. No new secret, no new crypto, no client exposure
 *    (this module is server-only; the client only passes the opaque string back).
 *  - Per-ITEM tokens (not one per preview): today's UX always accepts the full preview, but per-item binding keeps
 *    ordering irrelevant (no order to canonicalize), needs no whole-preview hash, and preserves any future subset
 *    acceptance; the item set is still fully checked because every submitted item must carry a valid token.
 *  - Canonical payload: an EXPLICIT fixed-order array of primitives (`f`), never object key order.
 *  - Version: `v: 1`; any other version fails closed.
 *  - Purpose: `k: 'dc-preview-item'`, so a session / magic-link token can never be presented as a preview token.
 *  - No expiry: acceptance already rejects an elapsed window, an elapsed start and any fresh conflict, and the
 *    window end is itself signed. A second clock rule would only duplicate STALE_PREVIEW.
 *  - Not bound (audited): Capture / GoalActivity link ids. The preview request never carries source ids, so the
 *    server cannot sign them; ownership is enforced inside the acceptance transaction and a caller can only link
 *    their OWN source. That is pre-existing and out of scope here.
 */
import { sign, verify } from './auth';
import type { ConstructionWindow } from './dayIntent';
import type { AcceptanceDiagnostic, AcceptedProposedItem } from './dayConstructorAcceptance';

export const PREVIEW_TOKEN_VERSION = 1;
const PREVIEW_TOKEN_PURPOSE = 'dc-preview-item';

/** Client-safe machine codes carried in `AcceptanceDiagnostic.detail` (reason INVALID_REQUEST). No crypto detail is ever returned. */
export type PreviewTokenFailureCode = 'PREVIEW_TOKEN_MISSING' | 'PREVIEW_TOKEN_INVALID' | 'PREVIEW_TOKEN_MISMATCH';

export interface PreviewItemFacts {
  userId: string;
  window: Pick<ConstructionWindow, 'date' | 'timezone' | 'source' | 'start' | 'end'>;
  item: Pick<AcceptedProposedItem, 'intentId' | 'activityId' | 'title' | 'start' | 'end' | 'placementSource'>;
}

/**
 * The authoritative facts, in a fixed order. Duration is implied by start/end (acceptance derives it from them and
 * rejects sub-minute precision). `title` is bound because it becomes the persisted plan's title; `activityId`
 * because it becomes the plan's activity identity. Presentation-only fields (timingFit, candidateOrder,
 * requiresConfirmation) are deliberately not part of it.
 */
export function canonicalPreviewItemFields(facts: PreviewItemFacts): Array<string | null> {
  const { userId, window, item } = facts;
  return [
    userId,
    window.date,
    window.timezone,
    window.source,
    window.start.toISOString(),
    window.end.toISOString(),
    item.intentId,
    item.activityId ?? null,
    item.title,
    item.start.toISOString(),
    item.end.toISOString(),
    item.placementSource,
  ];
}

export function signPreviewItem(facts: PreviewItemFacts): string {
  return sign({ k: PREVIEW_TOKEN_PURPOSE, v: PREVIEW_TOKEN_VERSION, f: canonicalPreviewItemFields(facts) });
}

/**
 * Verifies one submitted item against its token. Fails closed on anything unexpected: missing / non-string token,
 * bad signature, wrong purpose, unknown version, malformed body, or any bound fact (including the user) differing
 * from the submitted item.
 */
export function verifyPreviewItem(facts: PreviewItemFacts, token: unknown): { ok: true } | { ok: false; code: PreviewTokenFailureCode } {
  if (typeof token !== 'string' || token.length === 0) return { ok: false, code: 'PREVIEW_TOKEN_MISSING' };
  const payload = verify<{ k?: unknown; v?: unknown; f?: unknown }>(token);
  if (!payload || typeof payload !== 'object' || payload.k !== PREVIEW_TOKEN_PURPOSE || payload.v !== PREVIEW_TOKEN_VERSION || !Array.isArray(payload.f)) {
    return { ok: false, code: 'PREVIEW_TOKEN_INVALID' };
  }
  const signedFields: unknown[] = payload.f;
  const expected = canonicalPreviewItemFields(facts);
  if (signedFields.length !== expected.length || expected.some((value, index) => signedFields[index] !== value)) {
    return { ok: false, code: 'PREVIEW_TOKEN_MISMATCH' };
  }
  return { ok: true };
}

/** Adds `acceptanceToken` to every proposed item of a READY preview body. Any other body is returned untouched. */
export function signPreviewResultBody(userId: string, body: Record<string, unknown>): Record<string, unknown> {
  if (body.status !== 'READY') return body;
  const preview = body.preview as { constructionWindow?: ConstructionWindow; constructedDay?: { proposedItems?: Array<Record<string, unknown>> } } | undefined;
  const window = preview?.constructionWindow;
  const items = preview?.constructedDay?.proposedItems;
  if (!window || !Array.isArray(items)) return body;
  const signed = items.map((item) => ({ ...item, acceptanceToken: signPreviewItem({ userId, window, item: item as unknown as PreviewItemFacts['item'] }) }));
  return { ...body, preview: { ...preview, constructedDay: { ...preview!.constructedDay, proposedItems: signed } } };
}

/**
 * The acceptance-side gate: EVERY submitted item must carry a valid token bound to this user, this window and
 * exactly its own submitted facts. Returns per-item diagnostics (no partial acceptance -- one bad item rejects the
 * whole request, exactly like every other INVALID_REQUEST). Runs BEFORE the replay/idempotency classification and
 * before any write, so a replay with altered facts cannot use idempotency to slip past verification.
 */
export function verifyAcceptanceItems(userId: string, window: ConstructionWindow, items: readonly AcceptedProposedItem[], tokens: ReadonlyMap<string, unknown>): AcceptanceDiagnostic[] {
  const diagnostics: AcceptanceDiagnostic[] = [];
  for (const item of items) {
    const result = verifyPreviewItem({ userId, window, item }, tokens.get(item.intentId));
    if (!result.ok) diagnostics.push({ intentId: item.intentId, reason: 'INVALID_REQUEST', detail: result.code });
  }
  return diagnostics;
}
