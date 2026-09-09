/**
 * Window Ranking Engine V1 -- input validation.
 *
 * Validates only structural shape -- never astrology. This file does NOT
 * validate Panchang consistency, does NOT re-verify the Aura Fit formula,
 * and does NOT re-derive Muhurta reasons -- every `TimingCandidate` is
 * trusted as already-correct upstream output; this only rejects a
 * genuinely malformed input shape (a missing field, a non-finite score,
 * a non-canonical activity family) before the pure core runs.
 */
import { CANONICAL_ACTIVITY_FAMILIES } from './constants';
import { WindowRankingValidationError } from './types';
import type { WindowRankingInput } from './types';

export function assertValidWindowRankingInput(input: WindowRankingInput): void {
  if (input == null || typeof input !== 'object') {
    throw new WindowRankingValidationError('WindowRankingInput must be an object with activityFamily and candidates.');
  }

  if (!(CANONICAL_ACTIVITY_FAMILIES as readonly string[]).includes(input.activityFamily)) {
    throw new WindowRankingValidationError(`activityFamily must be one of the 13 canonical MuhurtaActivityFamily values, got: ${String(input.activityFamily)}.`);
  }

  if (!Array.isArray(input.candidates)) {
    throw new WindowRankingValidationError('candidates must be an array (an empty array is valid -- it means no eligible timing candidate was found upstream).');
  }

  input.candidates.forEach((candidate, index) => {
    if (candidate == null || typeof candidate !== 'object') {
      throw new WindowRankingValidationError(`candidates[${index}] must be an object.`);
    }
    if (typeof candidate.start !== 'string' || candidate.start.length === 0) {
      throw new WindowRankingValidationError(`candidates[${index}].start must be a non-empty string, got: ${String(candidate.start)}.`);
    }
    if (typeof candidate.end !== 'string' || candidate.end.length === 0) {
      throw new WindowRankingValidationError(`candidates[${index}].end must be a non-empty string, got: ${String(candidate.end)}.`);
    }
    if (typeof candidate.score !== 'number' || !Number.isFinite(candidate.score)) {
      throw new WindowRankingValidationError(`candidates[${index}].score must be a finite number, got: ${String(candidate.score)}.`);
    }
    if (typeof candidate.label !== 'string' || candidate.label.length === 0) {
      throw new WindowRankingValidationError(`candidates[${index}].label must be a non-empty string, got: ${String(candidate.label)}.`);
    }
  });
}
