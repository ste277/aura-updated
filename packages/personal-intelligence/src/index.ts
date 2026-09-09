/**
 * Personal Intelligence Contract V1 -- public API.
 *
 * See ../README.md for what this package is (a shared contract layer for
 * future Aura personalization engines), what it deliberately does not do
 * (no calculation, no scoring, no recommendation, no UI), and the
 * partial-context/evidence-first principles every consumer should follow.
 */
export { CONTRACT_VERSION } from './provenance';

export type { NormalizedScore, ActivityIdentifier, PersonalTheme, PersonalThemeSignal, PersonalReasonCode, PersonalReason } from './types';
export { PERSONAL_REASON_CODES } from './types';

export { PERSONAL_THEMES } from './themes';

export type { PersonalEvidenceSource, PersonalEvidenceRef, PersonalEvidenceDataValue, PersonalEvidence } from './evidence';
export { toPersonalEvidenceRef } from './evidence';

export type {
  LifePeriodSegment,
  LifePeriodContext,
  TransitActivation,
  TransitActivationContext,
  PersonalSupportContext,
  PersonalPanchangContext,
  PersonalMuhurtaWindow,
  PersonalMuhurtaTimingContext,
  PersonalNatalContext,
  PersonalThemeContext,
  PersonalGuidanceContext,
} from './context';

export type { PersonalActivityFit, PersonalRecommendation, DailyPersonalGuidance } from './guidance';

export { isNormalizedScore, assertNormalizedScore, isPersonalTheme, isPersonalGuidanceContext } from './validation';
