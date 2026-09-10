/**
 * Why Aura V1 -- explanation view model.
 *
 * The second disclosure layer for Best For You (#106): "What should I do,
 * and when?" is already answered by `bestForYouViewModel.ts`; this file
 * answers "Why is Aura recommending this for me?" -- strictly downstream of
 * an already-selected `DailyGuidanceRecommendation`, never influencing
 * selection, ranking, or timing itself.
 *
 * CLIENT-SIDE ONLY, DETERMINISTIC, PRESENTATION-LAYER ONLY (merge-critical,
 * see this PR's own architecture audit): every fact used here already
 * reaches the browser via `GET /api/daily-assistant/guidance`'s existing
 * `PersonalDailyGuidanceResult` payload -- `personalRelevance`,
 * `relevantThemes` (theme+state pairs), `timing.label`, `selectionReason`,
 * and `selectedActivities[activityFamily].source`. No new fetch, no new
 * endpoint, no engine import, and no read of `recommendation.evidence`
 * (`PersonalEvidenceRef.summary`/`.data` are audit/debug provenance, never
 * product copy -- confirmed across every engine package this feature's own
 * audit read; see that audit's evidence-provenance table).
 *
 * NO RAW ASTROLOGY: this file never names a Dasha lord, a transit pair, a
 * Bhrigu relationship, or a raw Panchang term (Nakshatra/Tithi/Yoga/Karana/
 * Abhijit/Gulika/Rahu Kalam). The client cannot distinguish Dasha-driven
 * from transit-driven theme reinforcement today (`LifeWeatherTheme.
 * reinforcementSources` does not survive into `DailyPersonalFitRelevantTheme`
 * / `DailyGuidanceRecommendation.relevantThemes`, which only carry
 * `{theme, state}`) -- so this file only ever says a theme is "active for
 * you today", never which system reinforced it.
 */
import type { DailyGuidanceRecommendation } from '../../../packages/personal-intelligence/src/context';
import type { ConcreteGuidanceCandidateSource } from './dailyGuidanceTypes';
import type { PersonalTheme } from '../../../packages/personal-intelligence/src/types';

// ============================================================
// Semantic contract -- structured facts before any copy is chosen.
// ============================================================

export type WhyAuraReasonKind = 'PERSONAL_THEME' | 'TIMING_SUPPORT';

/**
 * One semantic fact this explanation is built from. `themes` is present
 * only on a `PERSONAL_THEME` reason (already filtered to ACTIVE/
 * STRONGLY_ACTIVE and truncated -- see `selectDisplayThemes`);
 * `timingLabel` is present only on a `TIMING_SUPPORT` reason, copied
 * verbatim from `recommendation.timing.label`.
 */
export interface WhyAuraReason {
  kind: WhyAuraReasonKind;
  themes?: PersonalTheme[];
  timingLabel?: string;
}

export interface WhyAuraExplanation {
  reasons: WhyAuraReason[];
}

/** Final, ready-to-render output. At most 2 lines: one personal-fit line, one timing-fit line. Empty when nothing honest can be said (see buildWhyAuraExplanation's own doc comment) -- a caller must hide its "Why?" affordance in that case, never fabricate a generic line. */
export interface WhyAuraViewModel {
  lines: string[];
}

// ============================================================
// Personal theme labels -- the first PersonalTheme label map in this repo
// (ActionCards.tsx's CATEGORY_LABEL is a different taxonomy, ActivityCategory,
// not PersonalTheme -- confirmed via this feature's own audit). Mechanical,
// plain-language labels only, never a semantic reinterpretation.
// ============================================================

const THEME_LABEL: Record<PersonalTheme, string> = {
  FOCUS: 'focus',
  LEARNING: 'learning',
  CAREER: 'career',
  FINANCE: 'finance',
  RELATIONSHIPS: 'relationships',
  CREATIVITY: 'creativity',
  SOCIAL: 'social connection',
  WELLBEING: 'wellbeing',
  EXPLORATION: 'exploration',
  SPIRITUALITY: 'spirituality',
};

/**
 * Filters `relevantThemes` to ACTIVE/STRONGLY_ACTIVE only (never QUIET --
 * a QUIET theme carries no "today" signal), sorts STRONGLY_ACTIVE before
 * ACTIVE (stable -- preserves original relative order within the same
 * state, since `relevantThemes`' own array order carries no independent
 * meaning of its own, confirmed via this feature's own audit), and
 * truncates to at most 2 -- explanation-local ordering only, never
 * mutates or reorders `recommendation.relevantThemes` itself.
 */
function selectDisplayThemes(relevantThemes: DailyGuidanceRecommendation['relevantThemes']): PersonalTheme[] {
  return relevantThemes
    .filter((entry) => entry.state === 'ACTIVE' || entry.state === 'STRONGLY_ACTIVE')
    .slice()
    .sort((a, b) => (a.state === b.state ? 0 : a.state === 'STRONGLY_ACTIVE' ? -1 : 1))
    .slice(0, 2)
    .map((entry) => entry.theme);
}

// ============================================================
// Timing wording -- deterministic lookup, never invented per-call grammar.
// `timing.label` stays a plain `string` at the contract boundary (BY
// CONVENTION, mirroring `TimingCandidateLabel`) -- an unrecognized value
// (should not happen; CAUTION is never eligible, and no other value exists
// today) degrades to omitting the timing line rather than rendering a raw
// label or guessing wording, matching bestForYouViewModel.ts's own
// established fallback-logging convention.
// ============================================================

const PLAN_TIMING_LINE: Partial<Record<string, string>> = {
  EXCELLENT: 'Your planned time is especially supportive for this.',
  VERY_GOOD: 'Your planned time is very supportive for this.',
  GOOD: 'Your planned time is supportive for this.',
  USABLE: 'Your planned time is workable for this.',
};

const DAY_BUILDER_TIMING_LINE: Partial<Record<string, string>> = {
  EXCELLENT: 'Aura found an especially supportive window for this.',
  VERY_GOOD: 'Aura found a very supportive window for this.',
  GOOD: 'Aura found a supportive window for this.',
  USABLE: 'Aura found a workable window for this.',
};

function buildTimingLine(timingLabel: string, source: ConcreteGuidanceCandidateSource): string | null {
  const table = source === 'PLAN' ? PLAN_TIMING_LINE : DAY_BUILDER_TIMING_LINE;
  const line = table[timingLabel];
  if (!line) {
    console.error(`Why Aura: unrecognized timing label "${timingLabel}" -- this should be unreachable, omitting the timing line rather than guessing wording.`);
    return null;
  }
  return line;
}

function buildPersonalLine(themes: PersonalTheme[], strong: boolean): string | null {
  if (themes.length === 0) return null;
  const labels = themes.map((theme) => THEME_LABEL[theme]);
  const themeList = labels.length === 1 ? `your ${labels[0]} theme` : `your ${labels[0]} and ${labels[1]} themes`;
  const verb = labels.length === 1 ? 'is' : 'are';
  const prefix = strong ? 'This strongly fits' : 'This fits';
  return `${prefix} ${themeList}, which ${verb} active for you today.`;
}

// ============================================================
// Public entry point.
// ============================================================

/**
 * Derives the semantic facts only -- no copy, no ordering, no source-
 * specific wording. Canonical order is always `[personal?, timing]`
 * (personal first when present); `orderReasonsBySelectionReason` below is
 * the only place emphasis order changes. Exposed separately so the
 * semantic layer is directly testable independent of final copy (see this
 * file's own module doc comment on the semantic-contract-before-copy
 * design, and item 86 of this feature's own architecture audit on
 * evidence traceability).
 *
 * PERSONAL-RELEVANCE POLICY: `BASELINE` never produces a `PERSONAL_THEME`
 * reason (no theme claim invented). A `RELEVANT`/`HIGHLY_RELEVANT`
 * recommendation with no ACTIVE/STRONGLY_ACTIVE theme surviving
 * `selectDisplayThemes` (should not happen -- `personalRelevance` is
 * itself derived as the max state among `relevantThemes`) also omits the
 * reason defensively, rather than claiming a theme with nothing to name.
 */
export function deriveWhyAuraExplanation(recommendation: DailyGuidanceRecommendation): WhyAuraExplanation {
  const displayThemes = selectDisplayThemes(recommendation.relevantThemes);
  const personalReason: WhyAuraReason | null =
    recommendation.personalRelevance === 'BASELINE' || displayThemes.length === 0 ? null : { kind: 'PERSONAL_THEME', themes: displayThemes };
  const timingReason: WhyAuraReason = { kind: 'TIMING_SUPPORT', timingLabel: recommendation.timing.label };
  return { reasons: personalReason ? [personalReason, timingReason] : [timingReason] };
}

/**
 * Reorders (never rewrites) `explanation.reasons` by `selectionReason`
 * (merge-critical): `PRIMARY_FLOOR_MET` and `RELAXED_TIMING_FLOOR` lead
 * with the personal-fit reason (the floor that held); `RELAXED_RELEVANCE_
 * FLOOR` leads with the timing reason (relevance needed relaxing to
 * qualify, so timing is the stronger claim). Never changes a reason's own
 * content -- `timing.label`/`personalRelevance` already reflect genuine
 * strength, so no separate "soften the wording" step is needed.
 */
function orderReasonsBySelectionReason(reasons: WhyAuraReason[], selectionReason: DailyGuidanceRecommendation['selectionReason']): WhyAuraReason[] {
  if (selectionReason !== 'RELAXED_RELEVANCE_FLOOR') return reasons;
  const timing = reasons.filter((reason) => reason.kind === 'TIMING_SUPPORT');
  const personal = reasons.filter((reason) => reason.kind === 'PERSONAL_THEME');
  return [...timing, ...personal];
}

/** Renders ordered semantic reasons into final copy -- the only place `source` is read (it selects the PLAN-vs-DAY_BUILDER_INTENTION timing-wording table, never changes which facts are present). */
function presentReasons(reasons: WhyAuraReason[], source: ConcreteGuidanceCandidateSource, strongPersonalFit: boolean): string[] {
  const lines: string[] = [];
  for (const reason of reasons) {
    if (reason.kind === 'PERSONAL_THEME' && reason.themes) {
      const line = buildPersonalLine(reason.themes, strongPersonalFit);
      if (line) lines.push(line);
    } else if (reason.kind === 'TIMING_SUPPORT' && reason.timingLabel) {
      const line = buildTimingLine(reason.timingLabel, source);
      if (line) lines.push(line);
    }
  }
  return lines;
}

/**
 * Derives, orders, and renders a recommendation's explanation in one pure
 * call. Pure and deterministic: same `recommendation`/`source` -> same
 * `lines`, same order, same wording; never mutates either argument.
 *
 * `lines` is `[]` when nothing survives (should not happen in practice --
 * `timing.label` is always present on a real recommendation -- but this
 * function still never throws): a caller must hide its "Why?" affordance
 * entirely in that case, never render a generic fallback sentence.
 */
export function buildWhyAuraExplanation(recommendation: DailyGuidanceRecommendation, source: ConcreteGuidanceCandidateSource): WhyAuraViewModel {
  const explanation = deriveWhyAuraExplanation(recommendation);
  const ordered = orderReasonsBySelectionReason(explanation.reasons, recommendation.selectionReason);
  const lines = presentReasons(ordered, source, recommendation.personalRelevance === 'HIGHLY_RELEVANT');
  return { lines };
}

// ============================================================
// Expansion-state reconciliation -- a small pure helper for
// BestForYouSection.tsx's own "Why?" expansion state, kept here (rather
// than a fourth new file) since it is presentation-STATE logic, not
// engine/domain logic, and this keeps it testable via this file's own
// plain-.ts test, with no JSX compiler flag needed.
// ============================================================

/**
 * Reconciles a locally-held "which card's explanation is expanded" id
 * against the current guidance items' own `sourceEntityId`s, after a
 * guidance refresh.
 *
 * MERGE-CRITICAL (stale re-open bug): a naive "only render as expanded
 * when the id currently matches" check is NOT sufficient on its own --
 * if a refresh removes the expanded item and a LATER refresh brings back
 * a different recommendation that happens to reuse the same
 * `sourceEntityId` (the same underlying Plan/Day Builder intention
 * re-selected into `recommendations` again), the panel would silently
 * reopen without the user clicking "Why?" again, because the stored id
 * would coincidentally match once more. This function is the fix: the
 * caller re-runs it every time the current item set changes, so a
 * disappeared id is cleared to `null` immediately, rather than sitting in
 * state waiting to spuriously match a future, unrelated reappearance.
 *
 * `null` in -> `null` out (nothing was expanded, nothing to reconcile).
 * A non-null id still present in `currentSourceEntityIds` is returned
 * unchanged (an explanation that is still genuinely showing the same
 * recommendation stays open, and re-renders with that recommendation's
 * own freshly-refreshed content -- see buildWhyAuraExplanation, which is
 * recomputed from the live recommendation on every render regardless).
 * A non-null id no longer present is reset to `null`.
 */
export function resolveExpandedWhyAuraId(expandedId: string | null, currentSourceEntityIds: readonly string[]): string | null {
  if (expandedId === null) return null;
  return currentSourceEntityIds.includes(expandedId) ? expandedId : null;
}
