/**
 * English formatting / backward-compatibility layer for MuhurtaReason.
 *
 * evaluateMuhurta() and evaluateActivityFit() treat MuhurtaReason[] as the
 * source of truth (see activityOntology.ts). This module is the ONLY place
 * that turns those structured reasons into prose — the calculation layer
 * (muhurtaEngine.ts's RULES-driven loop, auraFitEngine.ts's score formula)
 * never imports from here and never branches on formatted text; it only
 * calls these helpers once, at the end, to populate the legacy
 * supports/blockers/summary string fields existing consumers still read.
 *
 * Every formatMuhurtaReason() case below reproduces, byte-for-byte, the
 * prose the pre-refactor imperative code used to build inline, so existing
 * tests, UI string-matching (e.g. PlanWithAuraView's `summary.includes('Abhijit')`
 * check), and API consumers see no behavior change.
 */

import type { SolarWindowType } from '../../panchang/src/windows';
import type { MuhurtaReason } from './activityOntology';

const NEUTRAL_SUMMARY = 'Panchanga factors are neutral for this activity.';

function windowLabel(type: string): string {
  if (type === 'RAHU_KALAM') return 'Rahu Kalam';
  if (type === 'YAMA') return 'Yama Gandam';
  if (type === 'ABHIJIT') return 'Abhijit Muhurta';
  if (type === 'BRAHMA') return 'Brahma Muhurta';
  if (type === 'GULIKA') return 'Gulika Kalam';
  return 'Neutral Flow';
}

/**
 * Formats a single MuhurtaReason as English prose. `locale` is accepted now
 * so callers don't need a signature change when other locales land, but only
 * 'en' is implemented in this PR (see completion report).
 */
export function formatMuhurtaReason(reason: MuhurtaReason, locale: 'en' = 'en'): string {
  void locale;
  const value = reason.value ?? '';
  switch (reason.code) {
    case 'NAKSHATRA_SUPPORTIVE':
      return `${value} ${reason.params?.note ?? 'supports this activity'}`;
    case 'NAKSHATRA_UNFAVORABLE':
      return `${value} is less supportive for this activity`;
    case 'TITHI_SUPPORTIVE':
      return `${value} is a helpful tithi`;
    case 'TITHI_UNFAVORABLE':
      return `${value} is better for lower-stakes work`;
    case 'YOGA_SUPPORTIVE':
      return `${value} yoga adds support`;
    case 'YOGA_UNFAVORABLE':
      return `${value} yoga adds friction`;
    case 'KARANA_SUPPORTIVE':
      return `${value} karana is workable`;
    case 'KARANA_UNFAVORABLE':
      return `${value} karana is avoided for important starts`;
    case 'RAHU_CAUTION':
    case 'YAMA_CAUTION':
      return `${windowLabel(value)} is a high-friction period`;
    case 'ABHIJIT_SUPPORT':
      return 'Abhijit Muhurta is broadly favorable';
    case 'BRAHMA_SUPPORT':
      return 'Brahma Muhurta supports quiet mental work';
    case 'GULIKA_SUPPORT':
      return 'Gulika supports steady follow-through';
    case 'NEUTRAL_WINDOW':
      return `${windowLabel(value)} carries no special Panchang signal`;
    case 'ACTIVITY_RULE_SUPPORT':
      return `${windowLabel(value)} is a recommended window for this activity`;
    case 'ACTIVITY_RULE_BLOCK':
      return `${windowLabel(value)} is best avoided for this activity`;
    case 'PERSONAL_TARA_SUPPORT':
      return `${value} Tara is supportive from your Janma Nakshatra`;
    case 'PERSONAL_TARA_CAUTION':
      return `${value} Tara is less supportive from your Janma Nakshatra`;
    case 'OTHER':
      if (reason.params?.kind === 'ELEMENT_AFFINITY') return `${value.toLowerCase()} Moon affinity supports this activity`;
      if (reason.params?.kind === 'HIGH_IMPORTANCE_CAUTION') return 'high-importance starts get a personal caution modifier';
      return value || 'Additional Panchang factor';
    default:
      return value || 'Additional Panchang factor';
  }
}

export interface LegacyMuhurtaText {
  supports: string[];
  blockers: string[];
  summary: string;
}

/**
 * The compatibility adapter for evaluateMuhurta(): derives the legacy
 * `supports`/`blockers`/`summary` fields from `reasons`, preserving both the
 * exact original prose per reason and the original ordering/summary rules
 * (first support + first blocker, or whichever exists, or a neutral
 * fallback) — see the old buildSummary()/imperative-push logic this replaces.
 */
export function deriveLegacyMuhurtaText(reasons: MuhurtaReason[], locale: 'en' = 'en'): LegacyMuhurtaText {
  const supports = reasons.filter((reason) => reason.polarity === 'SUPPORT').map((reason) => formatMuhurtaReason(reason, locale));
  const blockers = reasons.filter((reason) => reason.polarity === 'CAUTION' || reason.polarity === 'BLOCK').map((reason) => formatMuhurtaReason(reason, locale));
  const summary = blockers.length > 0 && supports.length > 0
    ? `${supports[0]}; ${blockers[0]}.`
    : supports.length > 0
    ? `${supports[0]}.`
    : blockers.length > 0
    ? `${blockers[0]}.`
    : NEUTRAL_SUMMARY;
  return { supports, blockers, summary };
}

/** Same idea as deriveLegacyMuhurtaText, but for evaluatePersonalMuhurtaFit()'s
 * `notes.join('; ')` summary shape (no trailing period, no support/blocker
 * split — personal reasons are a flat ordered list). */
export function formatPersonalReasons(reasons: MuhurtaReason[], locale: 'en' = 'en'): string {
  return reasons.map((reason) => formatMuhurtaReason(reason, locale)).join('; ');
}

export function formatWindowType(type: SolarWindowType): string {
  return windowLabel(type);
}
