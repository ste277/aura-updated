import { MuhurtaTraditionalCoverageLevel } from '../../../packages/muhurta/src/muhurtaRulePacks';

/**
 * PCE-2A -- Engine Trust Contract & CI Enforcement.
 *
 * Small, static user-facing strings for MuhurthamSearchResult.activity.
 * traditionalCoverage (muhurthamFinder.ts) -- kept out of the component file
 * so the exact wording can be unit-tested (test/muhurtaTraditionalCoverage.
 * test.ts) without importing a .tsx module from a plain ts-node test.
 *
 * Deliberately NOT a badge/warning: no implication that every traditional
 * factor has been checked, no "fully validated" claim, and no wording that
 * casts doubt on the underlying astronomical calculation (that calculation
 * is unaffected either way -- this only describes which traditional RULE
 * DATA was used to evaluate the recommendation).
 */
export function traditionalCoverageExplanation(level: MuhurtaTraditionalCoverageLevel): string {
  switch (level) {
    case 'OCCASION_SPECIFIC':
      return 'Uses occasion-specific traditional Muhurtham rules. Additional traditional factors may not be included.';
    case 'TRADITIONALLY_VALIDATED':
    case 'GENERAL_PANCHANGAM':
    default:
      // TRADITIONALLY_VALIDATED is reserved and never produced by
      // deriveTraditionalCoverageLevel() today (see its own doc comment) --
      // falling through to the GENERAL_PANCHANGAM message here is a safety
      // net, not a real path: an unrecognized or not-yet-earned tier must
      // never be upgraded to an unsupported trust claim by default.
      return 'Uses general Panchangam suitability factors. Occasion-specific traditional rules have not yet been fully validated.';
  }
}
