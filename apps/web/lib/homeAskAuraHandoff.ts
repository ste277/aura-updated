/**
 * HOME-INTENT-1 -- pure, dependency-free helpers for Home's "What would
 * you like to do?" entry point handing a free-text request off into the
 * existing Ask Aura tab/pipeline exactly once. No parsing/classification
 * lives here -- that stays entirely inside askAuraIntent.ts/the existing
 * /api/ask-aura pipeline, untouched. These functions only decide WHETHER
 * a request is submittable and WHETHER a given handoff has already been
 * consumed; AskAuraView's own existing handleSend() does all the real
 * work once invoked.
 */

export interface AskAuraHandoffRequest {
  readonly text: string;
  readonly key: number;
}

/** Trims and validates Home's raw input. A whitespace-only or empty
 * string must never produce a submission -- this REPLACES the old
 * decorative button's unconditional Plan navigation, which fired
 * regardless of any text. */
export function resolveHomeAskAuraSubmission(rawInput: string): { readonly shouldSubmit: boolean; readonly text: string } {
  const trimmed = rawInput.trim();
  return trimmed.length > 0 ? { shouldSubmit: true, text: trimmed } : { shouldSubmit: false, text: '' };
}

/** Builds a one-shot handoff payload. `key` is a fresh timestamp on every
 * call (mirrors page.tsx's own existing planPrefill/planFocusKey
 * convention) so two consecutive, even textually identical, requests are
 * still distinct handoffs -- never coalesced or ignored as "the same
 * one". `now` is injectable for deterministic testing. */
export function createAskAuraHandoff(text: string, now: () => number = Date.now): AskAuraHandoffRequest {
  return { text, key: now() };
}

/** The entire one-shot-consumption decision, in one place so it can be
 * unit-tested directly rather than only traced through a React effect.
 * A handoff is consumed exactly once: the first time its `key` differs
 * from the last key this consumer has already handled. Any later check
 * with the SAME key (a rerender, returning to this tab without a new
 * submission, navigating away and back) must return false -- while a
 * genuinely new key (a second, distinct submission) must return true
 * even if its text happens to be identical to the previous one. */
export function shouldConsumeAskAuraHandoff(pending: AskAuraHandoffRequest | null | undefined, lastConsumedKey: number | null): boolean {
  if (!pending) return false;
  return pending.key !== lastConsumedKey;
}
