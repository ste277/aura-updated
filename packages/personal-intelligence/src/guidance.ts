/**
 * Personal Intelligence Contract V1 -- future composed-output contracts.
 *
 * PersonalActivityFit and DailyPersonalGuidance describe what a FUTURE
 * scoring/composition engine would eventually produce -- this file
 * contains no scoring logic, no composer, no template generation, and no
 * LLM call. See ../README.md's "Explicitly out of scope" list.
 */
import type { ActivityIdentifier, NormalizedScore, PersonalReason, PersonalThemeSignal } from './types';
import type { PersonalEvidenceRef } from './evidence';

/**
 * The future per-activity personal-fit result. `score` is a
 * NormalizedScore ([0, 1] -- see types.ts's own doc comment on why this
 * differs from packages/recommendation's existing 0-100
 * AuraFitEvaluation.score). `activity` reuses the existing
 * ActivityIdentifier convention (a plain string matching
 * ActivityProfile.id) rather than a second activity enum.
 */
export interface PersonalActivityFit {
  activity: ActivityIdentifier;
  score: NormalizedScore;
  reasons: PersonalReason[];
  cautions: PersonalReason[];
  evidence: PersonalEvidenceRef[];
}

/**
 * One scheduled/suggested activity within a future DailyPersonalGuidance.
 * startAt/endAt are optional ISO-8601 instant strings (a recommendation
 * need not always be time-bound) -- matching this package's own
 * established ISO-string convention (see context.ts's own doc comments)
 * rather than a `Date` object or a bare minute-of-day number.
 */
export interface PersonalRecommendation {
  activity: ActivityIdentifier;
  startAt?: string;
  endAt?: string;
  score: NormalizedScore;
  reasons: PersonalReason[];
  cautions: PersonalReason[];
  evidence: PersonalEvidenceRef[];
}

/**
 * The eventual, fully-composed daily output -- not produced by this PR.
 * `headline`/`summary` are plain, already-rendered display strings (this
 * contract does not itself generate them -- no template engine, no LLM,
 * see this file's own module doc comment); `date`/`timezone` follow this
 * package's own ISO-string/IANA-timezone convention (see
 * PersonalPanchangContext's own doc comment in context.ts).
 */
export interface DailyPersonalGuidance {
  version: string;
  date: string;
  timezone: string;
  headline: string;
  summary: string;
  dominantThemes: PersonalThemeSignal[];
  recommendations: PersonalRecommendation[];
  evidence: PersonalEvidenceRef[];
}
