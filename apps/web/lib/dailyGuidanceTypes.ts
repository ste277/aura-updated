/**
 * Personal Guidance Orchestration V1 -- shared app-level types.
 *
 * This is app-level glue, not an astrology engine: it joins already-built,
 * already-merged Personal Intelligence packages (packages/bhrigu through
 * packages/daily-guidance) with the user's own concrete, already-committed
 * intent (today's Plans, Day Builder intentions) into one runtime result.
 * It introduces no new astrology, no new Muhurta rules, no new timing
 * math, and no numeric composite scoring of its own.
 *
 * `PersonalDailyGuidanceResult`/`ConcreteGuidanceCandidate`/
 * `SelectedActivityMetadata` deliberately live here (apps/web/lib), never
 * inside packages/personal-intelligence or packages/daily-guidance --
 * #104's own contract stays byte-for-byte unchanged (see
 * dailyGuidanceOrchestrator.ts's own doc comment on why).
 */
import type { DailyGuidanceContext } from '../../../packages/personal-intelligence/src/context';
import type { MuhurtaActivityFamily } from '../../../packages/muhurta/src/muhurtaEngine';
import type { TimingCandidate } from '../../../packages/recommendation/src/timingSearch';
import type { BehavioralAffinityTier } from '../../../packages/daily-guidance/src/types';

/** Which existing product surface a concrete candidate activity came from -- never a fabricated/generic source. */
export type ConcreteGuidanceCandidateSource = 'PLAN' | 'DAY_BUILDER_INTENTION';

/**
 * One concrete, already-user-committed-or-suggested activity, resolved
 * enough to enter the timing/family pipeline. `activityFamily` is derived
 * via the ALLOWED forward direction only (activityId -> ActivityProfile
 * -> familyForActivityProfile) -- never a family -> activity reverse
 * lookup (merge-critical, see dailyGuidanceCandidates.ts's own doc
 * comment). `scheduledStart`/`scheduledEnd` are present only for a PLAN
 * candidate (already scheduled, evaluated via CHECK); absent for a
 * DAY_BUILDER_INTENTION candidate (unscheduled, evaluated via FIND / a
 * reused FIND result).
 */
export interface ConcreteGuidanceCandidate {
  source: ConcreteGuidanceCandidateSource;
  sourceEntityId: string;
  activityId: string;
  title: string;
  activityFamily: MuhurtaActivityFamily;
  durationMinutes: number;
  scheduledStart?: string;
  scheduledEnd?: string;
  /** The candidate's own already-evaluated timing windows -- for a PLAN, always exactly one (the CHECK-evaluated scheduled instant); for a DAY_BUILDER_INTENTION, the FIND result (reused verbatim from Day Builder's own already-computed suggestion, never re-searched) or a freshly-run FIND result. Always already in canonical/ranked order -- this module never re-sorts it. */
  timingCandidates: TimingCandidate[];
}

/**
 * Compact metadata for the ONE concrete activity actually selected to
 * represent a family that made it into `DailyGuidanceContext.recommendations`
 * -- never a full copy of the source Plan/suggestion object.
 *
 * `behavioralAffinity` (Behavioral Integration V1) is OPTIONAL,
 * forward-compat-only metadata for a future Why Aura behavioral-
 * explanation PR -- it is NOT consumed by anything in this PR (no UI, no
 * copy, no new Why Aura reason kind), and optional so every pre-existing
 * construction site (e.g. test fixtures built before this field existed)
 * stays valid with zero changes. Deliberately the SAME minimal
 * `'STRONG' | 'MODERATE' | 'NEUTRAL'` tier #104's own input carries, never
 * `evidenceCount`/raw HabitLog rows/timestamps/`preferredDaypart`/
 * `typicalDurationMinutes` (see apps/web/lib/behavioralAffinity.ts's own
 * privacy-contract doc comment -- the identical minimal-exposure
 * discipline applies here).
 */
export interface SelectedActivityMetadata {
  activityId: string;
  title: string;
  source: ConcreteGuidanceCandidateSource;
  sourceEntityId: string;
  behavioralAffinity?: BehavioralAffinityTier;
}

/**
 * The result of one full orchestration run. `status` mirrors the existing
 * MuhurthamPersonalSearchOutcome/MuhurthamProfileIncomplete convention
 * (packages/recommendation/src/muhurthamFinder.ts) -- an incomplete birth
 * profile or an empty intent set are both VALID, expected, non-error
 * outcomes, never a thrown exception or a 500.
 *
 * READY vs NO_ACTIVITY_INTENT is a deliberate, merge-critical distinction:
 * NO_ACTIVITY_INTENT means no concrete candidate existed AT ALL (nothing
 * was even eligible to search); READY with `guidance.recommendations: []`
 * means concrete candidates existed and were searched, but none survived
 * #104's own eligibility stages. Both are valid, but they mean different
 * things to a future consumer (e.g. #105 Home) -- NO_ACTIVITY_INTENT is
 * "you haven't told Aura what you want to do today", READY-empty is
 * "nothing you're already planning has strong timing today".
 */
export type PersonalDailyGuidanceResult =
  | { status: 'READY'; guidance: DailyGuidanceContext; selectedActivities: Record<string, SelectedActivityMetadata> }
  | { status: 'BIRTH_PROFILE_REQUIRED' }
  | { status: 'NO_ACTIVITY_INTENT' };
