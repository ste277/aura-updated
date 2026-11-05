/**
 * HGR3-A -- Read-only weekly Goal-Rhythm proposal generation.
 *
 * Answers: "for one eligible, user-owned, N_PER_WEEK GoalActivity, what are
 * up to MAX_WEEKLY_RHYTHM_PROPOSALS suitable day+time sessions, across the
 * REST of the user's current local calendar week, that would cover its
 * remaining unmet weekly demand?" Never writes anything, never persists a
 * proposal, never reserves weekly capacity -- this module only reads.
 *
 * REUSE, NOT DUPLICATION (per the preceding HGR3 architecture audit):
 *  - Weekly demand/eligibility: loadEligibleGoalDemand (goalDemandCandidates.ts),
 *    called verbatim -- the exact same read model Home (HGR1/HGR2) and Plan
 *    My Day already call, so this endpoint can never disagree with either
 *    about whether a GoalActivity has remaining demand.
 *  - Multi-day timing search: runTimingSearchWithDailyRhythm
 *    (timingSearchDailyRhythm.ts), called with an explicit `dateRange` --
 *    the SAME engine Find a Time / Plan My Day / Ask Aura already call.
 *    No new search/scoring logic exists anywhere in this file.
 *  - Duration: durationMinutesFor (dayBuilderOrchestrator.ts), the same
 *    personalization chain Day Builder already uses for a catalog activity.
 *  - Week boundaries: localCalendarWeekBounds (goalActivityRhythm.ts), the
 *    SAME Monday-start civil-date bounds computeGoalActivityRhythmEligibility
 *    itself buckets completed/committed occurrences with.
 *
 * ACCEPTANCE COMPATIBILITY (the one open question this ticket had to
 * resolve, not assume): the Day Constructor's signed-preview-item module
 * produces per-ITEM tokens, but the existing accept route
 * (app/api/day-constructor/accept/route.ts) parses exactly ONE
 * `constructionWindow` for an entire submitted batch and verifies every
 * item in one acceptance request against that SAME shared window. A
 * genuine multi-day batch (3 items on 3 different calendar dates) cannot
 * be submitted to that endpoint today without either (a) weakening that
 * single-window binding, which this ticket's own instructions forbid, or
 * (b) inventing a new token/acceptance shape, which this ticket also
 * forbids. So this module never re-signs a proposed item and never
 * returns anything resembling an acceptance token -- every result is
 * explicitly `committable: false`, with the exact adapter work HGR3-B
 * needs recorded in `NON_COMMITTABLE_REASON` below, not silently implied
 * to be acceptable.
 */

import type { DailyAssistantContext } from '../../../packages/recommendation/src/dailyAssistant';
import type { TimingCandidate, TimingSearchRequest } from '../../../packages/recommendation/src/timingSearch';
import type { MuhurtaReason } from '../../../packages/muhurta/src/activityOntology';
import { localCalendarWeekBounds } from './goalActivityRhythm';
import { getDatePartsInTimezone } from './timezone';
import { durationMinutesFor, GENERIC_DURATION_FALLBACK_MINUTES } from './dayBuilderOrchestrator';
import { loadEligibleGoalDemand, type GoalDemandCandidatesDeps, type GoalDemandCandidate } from './goalDemandCandidates';
import type { DailyRhythmPreferencesInput } from './dailyRhythmScheduling';
import type { TimingSearchResponseWithDailyRhythm } from './timingSearchDailyRhythm';

/** HGR2 established GOAL_RHYTHM_VISIBLE_CAP = 3 for Home's own card; this
 * reuses the exact same number as the proposal count cap, rather than
 * inventing a second "how many is reasonable" constant. */
export const MAX_WEEKLY_RHYTHM_PROPOSALS = 3;

/** FIND's own HTTP validation layer (timingSearchRequest.ts) caps `limit`
 * at 10. This module calls the engine directly (never through that HTTP
 * layer), but self-imposes the identical bound: request a wide-enough raw
 * candidate pool for this module's OWN distinct-day selection to have real
 * material to choose from, never an unbounded search. */
const SEARCH_CANDIDATE_POOL_LIMIT = 10;

export const NON_COMMITTABLE_REASON =
  'Weekly proposals cannot be accepted directly yet. The existing acceptance endpoint (POST /api/day-constructor/accept) verifies every submitted item against one shared construction window, which is incompatible with proposals spanning multiple calendar dates. HGR3-B must add either a per-item-window acceptance path or orchestrate one single-day Day Constructor preview+accept cycle per proposed session -- this module intentionally does not sign or imply acceptability for any proposal.';

export interface WeeklyRhythmProposalItem {
  /** The civil date (user-local timezone) this session is proposed for -- "YYYY-MM-DD". */
  localDate: string;
  /** ISO instant. */
  start: string;
  /** ISO instant. */
  end: string;
  timezone: string;
  durationMinutes: number;
  /** 0-10 presentation score, carried verbatim from the real TimingCandidate -- never re-derived. */
  score: number;
  label: TimingCandidate['label'];
  /** Canonical structured reasons, carried verbatim -- nothing here is generated prose. */
  reasons: readonly MuhurtaReason[];
}

export type WeeklyRhythmProposalResult =
  | {
      status: 'OK';
      goalActivityId: string;
      goalId: string;
      activityTitle: string;
      activityId: string | null;
      weeklyTarget: number;
      completedThisWeek: number;
      committedThisWeek: number;
      remainingThisWeek: number;
      requestedCount: number;
      proposals: readonly WeeklyRhythmProposalItem[];
      /** Always false -- see this module's own doc comment. Never omitted,
       * so a caller can never mistake absence for "yes". */
      committable: false;
      nonCommittableReason: string;
      /** Present only when proposals.length < requestedCount: fewer suitable
       * distinct days existed than remaining demand. Never fabricated by
       * forcing an unsuitable slot to hit the count. */
      shortfallReason?: 'FEWER_SUITABLE_DAYS_THAN_REQUESTED';
    }
  /** Covers: GoalActivity not owned by this user, does not exist, Goal
   * archived, activity DISMISSED, not an N_PER_WEEK rhythm, or its weekly
   * target is already fully met right now. Deliberately a single,
   * non-disclosing outcome for all of these -- the SAME "never distinguish
   * doesn't-exist from not-yours from not-eligible-right-now" convention
   * resolveGoalActivityHandoff (planDayBootstrap.ts) already established
   * for this exact kind of ownership boundary. */
  | { status: 'NOT_ELIGIBLE' }
  /** The underlying demand read or the timing search itself failed --
   * distinct from "searched successfully and found nothing suitable"
   * (which is status: 'OK' with an empty/short proposals array). */
  | { status: 'SEARCH_FAILED' };

export interface WeeklyRhythmProposalDeps extends GoalDemandCandidatesDeps {
  runFind: (request: TimingSearchRequest, timezone: string, dailyRhythmPrefs: DailyRhythmPreferencesInput) => TimingSearchResponseWithDailyRhythm;
}

export interface WeeklyRhythmProposalParams {
  userId: string;
  goalActivityId: string;
  planningLocalDate: string;
  timezone: string;
  context: DailyAssistantContext;
  dailyRhythmPrefs: DailyRhythmPreferencesInput;
}

/** The rest of the user's CURRENT local calendar week: today through that
 * week's own Sunday (localCalendarWeekBounds's own Monday-start, DST-safe
 * civil-date bounds -- never a rolling 7-day window, and never reaching
 * into NEXT week, which would conflate two different weekly targets). */
export function remainingWeekDateRange(planningLocalDate: string): { start: string; end: string } {
  const bounds = localCalendarWeekBounds(planningLocalDate);
  return { start: planningLocalDate, end: bounds.endDate };
}

function localDateOfInstant(timezone: string, isoInstant: string): string {
  return getDatePartsInTimezone(timezone, new Date(isoInstant)).dateStr;
}

/**
 * The smallest deterministic selection layer over FIND's own flat ranked
 * candidate list (rank-first, distinct-day). Walks `rankedCandidates` in
 * the order given (already highest-score-first from the engine) and takes
 * the FIRST candidate for each not-yet-used civil date, skipping same-date
 * repeats entirely -- never re-scores, never invents a new ranking or
 * spacing rule. `seedOccupiedLocalDates` lets a caller pre-exclude dates
 * that already have a live occurrence of this SAME GoalActivity (so this
 * one mechanism serves both "don't propose two of our own batch on one
 * day" and "don't propose a day this activity is already committed on").
 * Deterministic for identical, already-deterministic input: no object key
 * order, no Date.now(), no random tie-break -- purely a stable walk.
 *
 * Chosen over a "spread-first" alternative (prioritizing day-spread even
 * over rank) because spread-first would require inventing a new score/
 * day-spread tradeoff function -- exactly what this ticket forbids ("do
 * not introduce new astronomical scoring or timing rules"). Rank-first
 * distinct-day needs no new scoring at all: it is a pure filter over the
 * engine's own existing order.
 */
export function selectDistinctDayProposals(
  rankedCandidates: readonly TimingCandidate[],
  timezone: string,
  maxCount: number,
  seedOccupiedLocalDates: ReadonlySet<string> = new Set()
): TimingCandidate[] {
  const selected: TimingCandidate[] = [];
  const usedDates = new Set<string>(seedOccupiedLocalDates);
  for (const candidate of rankedCandidates) {
    if (selected.length >= maxCount) break;
    const localDate = localDateOfInstant(timezone, candidate.start);
    if (usedDates.has(localDate)) continue;
    usedDates.add(localDate);
    selected.push(candidate);
  }
  return selected;
}

/** Which civil dates (within `dateRange`) already carry a live occurrence
 * (COMPLETED or COMMITTED) of this GoalActivity -- read from the SAME
 * per-activity rhythm facts loadEligibleGoalDemand itself consults, never
 * a second, independently-maintained notion of "already scheduled". */
function occupiedLocalDates(facts: ReadonlyMap<string, readonly { localDate: string; contribution: 'COMPLETED' | 'COMMITTED' | 'NONE' }[]>, goalActivityId: string): Set<string> {
  const rows = facts.get(goalActivityId) ?? [];
  return new Set(rows.filter((row) => row.contribution !== 'NONE').map((row) => row.localDate));
}

function resolveDurationMinutes(candidate: GoalDemandCandidate): number {
  return candidate.activityId ? durationMinutesFor(candidate.activityId) : GENERIC_DURATION_FALLBACK_MINUTES;
}

/**
 * The orchestration entry point. Never trusts any client-supplied
 * "remaining" count -- `candidate.remainingThisWeek` below is always the
 * value THIS call's own loadEligibleGoalDemand just computed, fresh,
 * server-side.
 */
export async function generateWeeklyRhythmProposal(deps: WeeklyRhythmProposalDeps, params: WeeklyRhythmProposalParams): Promise<WeeklyRhythmProposalResult> {
  const demand = await loadEligibleGoalDemand(deps, params.userId, params.planningLocalDate, params.timezone);
  if (demand.status === 'LOAD_FAILED') return { status: 'SEARCH_FAILED' };

  const candidate = demand.candidates.find((c) => c.goalActivityId === params.goalActivityId);
  if (!candidate) return { status: 'NOT_ELIGIBLE' };

  const requestedCount = Math.min(MAX_WEEKLY_RHYTHM_PROPOSALS, candidate.remainingThisWeek);
  if (requestedCount <= 0) return { status: 'NOT_ELIGIBLE' };

  const dateRange = remainingWeekDateRange(params.planningLocalDate);
  const durationMinutes = resolveDurationMinutes(candidate);

  const request: TimingSearchRequest = {
    mode: 'FIND',
    activityId: candidate.activityId ?? undefined,
    taskTitle: candidate.activityId ? undefined : candidate.title,
    durationMinutes,
    dateRange,
    limit: SEARCH_CANDIDATE_POOL_LIMIT,
    timePreference: 'ANY',
    context: params.context,
  };

  let response: TimingSearchResponseWithDailyRhythm;
  try {
    response = deps.runFind(request, params.timezone, params.dailyRhythmPrefs);
  } catch {
    return { status: 'SEARCH_FAILED' };
  }

  let facts: ReadonlyMap<string, readonly { localDate: string; contribution: 'COMPLETED' | 'COMMITTED' | 'NONE' }[]>;
  try {
    facts = await deps.loadRhythmFacts(params.userId, [params.goalActivityId], params.timezone);
  } catch {
    return { status: 'SEARCH_FAILED' };
  }

  const seedOccupied = occupiedLocalDates(facts, params.goalActivityId);
  const selected = selectDistinctDayProposals(response.candidates, params.timezone, requestedCount, seedOccupied);

  const proposals: WeeklyRhythmProposalItem[] = selected.map((c) => ({
    localDate: localDateOfInstant(params.timezone, c.start),
    start: c.start,
    end: c.end,
    timezone: params.timezone,
    durationMinutes,
    score: c.score,
    label: c.label,
    reasons: c.reasons,
  }));

  return {
    status: 'OK',
    goalActivityId: candidate.goalActivityId,
    goalId: candidate.goalId,
    activityTitle: candidate.title,
    activityId: candidate.activityId,
    weeklyTarget: candidate.rhythm.targetPerWeek,
    completedThisWeek: candidate.rhythm.completedThisWeek,
    committedThisWeek: candidate.rhythm.committedThisWeek,
    remainingThisWeek: candidate.remainingThisWeek,
    requestedCount,
    proposals,
    committable: false,
    nonCommittableReason: NON_COMMITTABLE_REASON,
    ...(proposals.length < requestedCount ? { shortfallReason: 'FEWER_SUITABLE_DAYS_THAN_REQUESTED' as const } : {}),
  };
}
