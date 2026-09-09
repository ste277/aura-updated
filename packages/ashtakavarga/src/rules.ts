/**
 * Ashtakavarga Engine V1 -- the locked 56-rule Bhinnashtakavarga
 * contribution table (7 targets x 8 contributors).
 *
 * SOURCE / RECENSION AUDIT (see this PR's own implementation report for
 * the full trace, and README.md's "Rule source" section): before writing
 * this table, two independent references were compared cell-by-cell:
 *
 *  (1) A web article summarizing the standard Parashara (BPHS)
 *      Bhinnashtakavarga contribution table for all 7 targets.
 *  (2) A separate PDF teaching document ("Ashtakavarga System" Lesson 1,
 *      kascorner.com), presenting the same table as literal per-house
 *      dot-grids for all 7 targets, PLUS a fully worked real chart
 *      example (a natal chart for a birth in Nagpur, India, 26 Oct 1961,
 *      9:45am, with a complete resulting Ashtakavarga table for all 7
 *      planets) whose own row/column/grand totals are 48/49/39/54/56/
 *      52/39/337 -- an independent confirmation that these are genuinely
 *      the values a real chart produces under this table, not merely an
 *      abstract listing.
 *
 * Cross-check result (final, after a follow-up audit pass): ALL 56 of
 * 56 rules are independently verified at the exact HOUSE-NUMBER level
 * (not merely row-count) between the two sources, with zero
 * disagreement on any cell. The initial pass verified 32 of 56 rows
 * (Sun, Moon, Mars, Mercury) this way and only row-counts for the
 * remaining 24 (Jupiter, Venus, Saturn); a follow-up audit closed that
 * gap by re-rendering source (2)'s PDF pages at 400dpi with precise
 * per-table crop boxes (eliminating the column-alignment ambiguity of a
 * coarser, full-page text extraction) and reading every remaining row
 * directly against a visible, unambiguous "1 2 3 4 5 6 7 8 9 10 11 12"
 * column header -- every one matched source (1) exactly. See
 * test/ashtakavargaEngine.test.ts's own INDEPENDENT_RULE_REFERENCE
 * table (a separately-typed literal, never importing ASHTAKAVARGA_RULES)
 * for the full 56-row deep-comparison test this enables, and
 * README.md's own "Rule source" section for the complete narrative.
 * Both sources also independently confirm the classical contributor set
 * excludes Rahu/Ketu (source (2), verbatim: "Some also
 * include the Ashtakavarga of the Lagna, Rahu and Ketu, but as per my
 * experience I don't recommend this" -- i.e. the STANDARD table, which
 * this package implements, is the 8-reference table without the nodes).
 *
 * Each rule's `houses` array is the locked, traditional data -- it is
 * NEVER computed and NEVER varies per chart. What varies per chart is
 * only WHERE each of these relative houses lands in the actual zodiac
 * (prastara.ts).
 */
import { ASHTAKAVARGA_RULE_VERSION } from './provenance';
import type { AshtakavargaContributionRule, AshtakavargaTargetPlanet, AshtakavargaContributor } from './types';

function ruleId(target: AshtakavargaTargetPlanet, contributor: AshtakavargaContributor): string {
  return `ASHTAKAVARGA_BAV_${target.toUpperCase()}_FROM_${contributor.toUpperCase()}_V1`;
}

function rule(target: AshtakavargaTargetPlanet, contributor: AshtakavargaContributor, houses: readonly number[]): AshtakavargaContributionRule {
  return { target, contributor, houses, ruleId: ruleId(target, contributor), ruleVersion: ASHTAKAVARGA_RULE_VERSION };
}

/**
 * The complete, locked 56-rule table -- 7 targets x 8 contributors,
 * each contributor's own list of relative houses (1-12, inclusive
 * classical counting -- see relativeHouse.ts) where it gives that
 * target a point. Row order matches ASHTAKAVARGA_TARGETS x
 * ASHTAKAVARGA_CONTRIBUTORS (constants.ts) exactly, though lookup
 * (prastara.ts) is by target+contributor identity, not array position.
 */
export const ASHTAKAVARGA_RULES: readonly AshtakavargaContributionRule[] = [
  // ---- Sun (total 48) ----
  rule('Sun', 'Sun', [1, 2, 4, 7, 8, 9, 10, 11]),
  rule('Sun', 'Moon', [3, 6, 10, 11]),
  rule('Sun', 'Mars', [1, 2, 4, 7, 8, 9, 10, 11]),
  rule('Sun', 'Mercury', [3, 5, 6, 9, 10, 11, 12]),
  rule('Sun', 'Jupiter', [5, 6, 9, 11]),
  rule('Sun', 'Venus', [6, 7, 12]),
  rule('Sun', 'Saturn', [1, 2, 4, 7, 8, 9, 10, 11]),
  rule('Sun', 'Lagna', [3, 4, 6, 10, 11, 12]),

  // ---- Moon (total 49) ----
  rule('Moon', 'Sun', [3, 6, 7, 8, 10, 11]),
  rule('Moon', 'Moon', [1, 3, 6, 7, 10, 11]),
  rule('Moon', 'Mars', [2, 3, 5, 6, 9, 10, 11]),
  rule('Moon', 'Mercury', [1, 3, 4, 5, 7, 8, 10, 11]),
  rule('Moon', 'Jupiter', [1, 4, 7, 8, 10, 11, 12]),
  rule('Moon', 'Venus', [3, 4, 5, 7, 9, 10, 11]),
  rule('Moon', 'Saturn', [3, 5, 6, 11]),
  rule('Moon', 'Lagna', [3, 6, 10, 11]),

  // ---- Mars (total 39) ----
  rule('Mars', 'Sun', [3, 5, 6, 10, 11]),
  rule('Mars', 'Moon', [3, 6, 11]),
  rule('Mars', 'Mars', [1, 2, 4, 7, 8, 10, 11]),
  rule('Mars', 'Mercury', [3, 5, 6, 11]),
  rule('Mars', 'Jupiter', [6, 10, 11, 12]),
  rule('Mars', 'Venus', [6, 8, 11, 12]),
  rule('Mars', 'Saturn', [1, 4, 7, 8, 9, 10, 11]),
  rule('Mars', 'Lagna', [1, 3, 6, 10, 11]),

  // ---- Mercury (total 54) ----
  rule('Mercury', 'Sun', [5, 6, 9, 11, 12]),
  rule('Mercury', 'Moon', [2, 4, 6, 8, 10, 11]),
  rule('Mercury', 'Mars', [1, 2, 4, 7, 8, 9, 10, 11]),
  rule('Mercury', 'Mercury', [1, 3, 5, 6, 9, 10, 11, 12]),
  rule('Mercury', 'Jupiter', [6, 8, 11, 12]),
  rule('Mercury', 'Venus', [1, 2, 3, 4, 5, 8, 9, 11]),
  rule('Mercury', 'Saturn', [1, 2, 4, 7, 8, 9, 10, 11]),
  rule('Mercury', 'Lagna', [1, 2, 4, 6, 8, 10, 11]),

  // ---- Jupiter (total 56) ----
  rule('Jupiter', 'Sun', [1, 2, 3, 4, 7, 8, 9, 10, 11]),
  rule('Jupiter', 'Moon', [2, 5, 7, 9, 11]),
  rule('Jupiter', 'Mars', [1, 2, 4, 7, 8, 10, 11]),
  rule('Jupiter', 'Mercury', [1, 2, 4, 5, 6, 9, 10, 11]),
  rule('Jupiter', 'Jupiter', [1, 2, 3, 4, 7, 8, 10, 11]),
  rule('Jupiter', 'Venus', [2, 5, 6, 9, 10, 11]),
  rule('Jupiter', 'Saturn', [3, 5, 6, 12]),
  rule('Jupiter', 'Lagna', [1, 2, 4, 5, 6, 7, 9, 10, 11]),

  // ---- Venus (total 52) ----
  rule('Venus', 'Sun', [8, 11, 12]),
  rule('Venus', 'Moon', [1, 2, 3, 4, 5, 8, 9, 11, 12]),
  rule('Venus', 'Mars', [3, 5, 6, 9, 11, 12]),
  rule('Venus', 'Mercury', [3, 5, 6, 9, 11]),
  rule('Venus', 'Jupiter', [5, 8, 9, 10, 11]),
  rule('Venus', 'Venus', [1, 2, 3, 4, 5, 8, 9, 10, 11]),
  rule('Venus', 'Saturn', [3, 4, 5, 8, 9, 10, 11]),
  rule('Venus', 'Lagna', [1, 2, 3, 4, 5, 8, 9, 11]),

  // ---- Saturn (total 39) ----
  rule('Saturn', 'Sun', [1, 2, 4, 7, 8, 10, 11]),
  rule('Saturn', 'Moon', [3, 6, 11]),
  rule('Saturn', 'Mars', [3, 5, 6, 10, 11, 12]),
  rule('Saturn', 'Mercury', [6, 8, 9, 10, 11, 12]),
  rule('Saturn', 'Jupiter', [5, 6, 11, 12]),
  rule('Saturn', 'Venus', [6, 11, 12]),
  rule('Saturn', 'Saturn', [3, 5, 6, 11]),
  rule('Saturn', 'Lagna', [1, 3, 4, 6, 10, 11]),
];

/** Looks up the one rule for a given target/contributor pair -- throws if the table is ever malformed (should be unreachable given the integrity test in test/ashtakavargaEngine.test.ts). */
export function findRule(target: AshtakavargaTargetPlanet, contributor: AshtakavargaContributor): AshtakavargaContributionRule {
  const found = ASHTAKAVARGA_RULES.find((r) => r.target === target && r.contributor === contributor);
  if (!found) {
    throw new Error(`No Ashtakavarga rule found for target=${target} contributor=${contributor} -- the rule table is malformed.`);
  }
  return found;
}
