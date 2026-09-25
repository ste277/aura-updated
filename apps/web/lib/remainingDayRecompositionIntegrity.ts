/**
 * Remaining-Day Recomposition V1 PR F3 -- PROPOSAL INTEGRITY: a server-signed, PROPOSAL-LEVEL token.
 *
 * F2 produces one coherent, ephemeral final schedule. F3 must accept exactly that or nothing, so the token binds the
 * WHOLE proposal (not per-MOVE): the browser can neither alter what the proposal means nor accept an arbitrary subset
 * of its MOVEs. Same trust model as the Day Constructor preview token (F1): the client may choose WHETHER to accept a
 * valid server-generated proposal; it may not change WHAT it is. The acceptance body is therefore just
 * `{ proposalToken }` -- the decoded, verified payload is the only source of plan ids, slots, decision types,
 * timezone and target date; nothing editable is ever resubmitted.
 *
 * SIGNED PROVENANCE != CURRENT SAFETY: the token proves "Aura proposed this for this user"; it says nothing about the
 * world still matching. Acceptance (remainingDayRecompositionAcceptance.ts) independently revalidates everything.
 *
 * Reuses the repository's existing HMAC-SHA256 `sign`/`verify` (auth.ts, AUTH_SECRET, timingSafeEqual): no new secret,
 * no client signing, no new dependency. Purpose `rdr-proposal` v1 is DISTINCT from the F1 preview purpose
 * (`dc-preview-item`), so neither token can be presented as the other; the payload carries no userId/email keys, so it
 * is not a session lookalike. Canonical payload = an explicit fixed-order array of primitives, decisions sorted by plan
 * id -- never object key order.
 *
 * TOKEN AGE (decision): NO TTL. `generatedAt` and `targetDate` are signed, and acceptance rejects a day change, a
 * timezone change, any source/KEEP slot or lifecycle change, an elapsed destination, changed availability and any
 * conflict; a wall-clock TTL would duplicate those checks without a product rationale.
 *
 * Only a CHANGES_PROPOSED proposal is ever signed: NO_CHANGES / NEEDS_ATTENTION / TIMING_FAILED / NO_USABLE_CAPACITY
 * have nothing to commit and are never signable.
 */
import { sign, verify } from './auth';
import { MAX_RECOMPOSITION_CANDIDATES, type RemainingDayRecompositionProposal } from './remainingDayRecomposition';

export const RECOMPOSITION_TOKEN_VERSION = 1;
const RECOMPOSITION_TOKEN_PURPOSE = 'rdr-proposal';
/** Rejects absurd inputs before any decoding work. */
const MAX_TOKEN_LENGTH = 16_384;

export interface SignedSlot {
  start: Date;
  end: Date;
}
export interface SignedDecision {
  planId: string;
  decision: 'KEEP' | 'MOVE' | 'UNRESOLVED';
  /** The persisted slot at proposal time (evidence for stale detection). */
  current: SignedSlot;
  /** Present exactly for MOVE. */
  to: SignedSlot | null;
}
export interface SignedRecompositionProposal {
  userId: string;
  generatedAt: Date;
  targetDate: string;
  timezone: string;
  decisions: SignedDecision[];
}

const iso = (d: Date) => d.toISOString();
const byPlanId = (a: { planId: string }, b: { planId: string }) => (a.planId < b.planId ? -1 : a.planId > b.planId ? 1 : 0);

/** Signs a CHANGES_PROPOSED proposal for `userId`, or returns null for any other proposal state (nothing to accept). */
export function signRecompositionProposal(userId: string, proposal: Pick<RemainingDayRecompositionProposal, 'generatedAt' | 'targetDate' | 'timezone' | 'decisions'> & { summary: { state: string } }): string | null {
  if (proposal.summary.state !== 'CHANGES_PROPOSED') return null;
  const decisions = [...proposal.decisions].sort(byPlanId).map((d) => [d.planId, d.decision, iso(d.current.start), iso(d.current.end), d.decision === 'MOVE' ? iso(d.to.start) : null, d.decision === 'MOVE' ? iso(d.to.end) : null]);
  return sign({ k: RECOMPOSITION_TOKEN_PURPOSE, v: RECOMPOSITION_TOKEN_VERSION, f: [userId, iso(proposal.generatedAt), proposal.targetDate, proposal.timezone, 'CHANGES_PROPOSED', decisions] });
}

export type ProposalTokenFailure = 'INVALID_TOKEN';

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString() === value ? d : null;
};

/**
 * Verifies signature, purpose, version and structure, and that the token was issued to `userId`. Fails closed on
 * anything unexpected (non-string, oversized, bad signature, wrong purpose/version, malformed or non-canonical
 * payload). Never throws.
 */
export function verifyRecompositionProposalToken(userId: string, token: unknown): { ok: true; proposal: SignedRecompositionProposal } | { ok: false; code: ProposalTokenFailure } {
  const invalid = { ok: false as const, code: 'INVALID_TOKEN' as const };
  try {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return invalid;
    const payload = verify<{ k?: unknown; v?: unknown; f?: unknown }>(token);
    if (!payload || typeof payload !== 'object' || payload.k !== RECOMPOSITION_TOKEN_PURPOSE || payload.v !== RECOMPOSITION_TOKEN_VERSION || !Array.isArray(payload.f) || payload.f.length !== 6) return invalid;
    const [tokenUserId, generatedAtRaw, targetDate, timezone, state, rawDecisions] = payload.f as unknown[];
    if (typeof tokenUserId !== 'string' || tokenUserId !== userId) return invalid; // another user's token
    const generatedAt = parseDate(generatedAtRaw);
    if (!generatedAt || typeof targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || typeof timezone !== 'string' || !timezone || state !== 'CHANGES_PROPOSED') return invalid;
    if (!Array.isArray(rawDecisions) || rawDecisions.length === 0 || rawDecisions.length > MAX_RECOMPOSITION_CANDIDATES) return invalid;
    const decisions: SignedDecision[] = [];
    let previousId = '';
    for (const raw of rawDecisions) {
      if (!Array.isArray(raw) || raw.length !== 6) return invalid;
      const [planId, decision, curStart, curEnd, toStart, toEnd] = raw as unknown[];
      if (typeof planId !== 'string' || !planId || planId <= previousId) return invalid; // canonical: strictly ascending ids (also rejects duplicates)
      previousId = planId;
      if (decision !== 'KEEP' && decision !== 'MOVE' && decision !== 'UNRESOLVED') return invalid;
      const cs = parseDate(curStart); const ce = parseDate(curEnd);
      if (!cs || !ce || ce.getTime() <= cs.getTime()) return invalid;
      let to: SignedSlot | null = null;
      if (decision === 'MOVE') {
        const ts = parseDate(toStart); const te = parseDate(toEnd);
        if (!ts || !te || te.getTime() <= ts.getTime()) return invalid;
        to = { start: ts, end: te };
      } else if (toStart !== null || toEnd !== null) return invalid;
      decisions.push({ planId, decision, current: { start: cs, end: ce }, to });
    }
    if (!decisions.some((d) => d.decision === 'MOVE')) return invalid;
    return { ok: true, proposal: { userId: tokenUserId, generatedAt, targetDate, timezone, decisions } };
  } catch {
    return invalid;
  }
}
