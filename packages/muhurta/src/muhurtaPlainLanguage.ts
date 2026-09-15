/**
 * Plain-language projection of MuhurtaReason[] for default assistant/
 * productivity surfaces (Home, Plan cards, Ask Aura) -- AURA HOME IA V2
 * FOLLOW-UP FIXES, Finding B.
 *
 * Sibling to muhurtaReasonFormat.ts, not a replacement for it:
 * formatMuhurtaReason()/deriveLegacyMuhurtaText()/formatPersonalReasons()
 * (muhurtaReasonFormat.ts) remain byte-for-byte unchanged and are still the
 * right choice for explicit astrology/Panchang exploration surfaces
 * (Muhurtham Finder, Ask Aura's own Muhurtham search). This module is the
 * one the ticket's shared-presentation-boundary rule asks for: a single,
 * narrow, reused-everywhere function that turns the SAME structured
 * MuhurtaReason[] into copy that never names a raw Tithi/Nakshatra/Yoga/
 * Karana/Tara Bala term and never surfaces a numeric score -- only the
 * SUPPORT/CAUTION polarity shape of the evidence.
 *
 * Deliberately conservative: no per-factor branching, no activity-specific
 * wording -- a caller that wants an activity-specific opening clause (e.g.
 * "Good fit for deep work.") composes it separately from already-public,
 * already-clean data (e.g. auraFitEngine.ts's own labelText()) and appends
 * this sentence after it.
 */
import type { MuhurtaReason } from './activityOntology';

export function summarizeReasonsPlainly(reasons: MuhurtaReason[]): string | undefined {
  if (reasons.length === 0) return undefined;
  const supportCount = reasons.filter((reason) => reason.polarity === 'SUPPORT').length;
  const cautionCount = reasons.filter((reason) => reason.polarity === 'CAUTION' || reason.polarity === 'BLOCK').length;
  if (cautionCount === 0) return 'Conditions are supportive for this.';
  if (supportCount === 0) return 'Conditions call for a bit of caution here.';
  if (supportCount > cautionCount) return "Conditions are generally supportive, although this isn't the strongest window available.";
  if (supportCount === cautionCount) return 'Conditions are mixed for this -- workable, but not the strongest option.';
  return "Conditions call for some caution here, though it's still workable.";
}
