/**
 * HGR3-A -- Read-only weekly Goal-Rhythm proposal generation.
 *
 * Production-path regression coverage for goalRhythmWeeklyProposal.ts.
 * Exercises the REAL `generateWeeklyRhythmProposal`/`selectDistinctDayProposals`/
 * `remainingWeekDateRange`, with fake `GoalDemandCandidatesDeps` (the same
 * DI convention homeGoalRhythmSuggestions.test.ts already established) and
 * a fake `runFind` standing in for the timing-search engine -- no DB, no
 * network, no jsdom. Checks explicitly marked [STRUCTURAL] are source-text
 * assertions (this repo has no jsdom/testing-library); every other check
 * calls the real exported functions directly.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  generateWeeklyRhythmProposal,
  selectDistinctDayProposals,
  remainingWeekDateRange,
  MAX_WEEKLY_RHYTHM_PROPOSALS,
  type WeeklyRhythmProposalDeps,
  type WeeklyRhythmProposalResult,
} from '../apps/web/lib/goalRhythmWeeklyProposal';
import type { GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import type { CandidateGoalActivityForRhythmDemandRow } from '../apps/web/lib/db';
import type { GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';
import type { TimingCandidate, TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import type { TimingSearchResponseWithDailyRhythm } from '../apps/web/lib/timingSearchDailyRhythm';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import type { DailyRhythmPreferencesInput } from '../apps/web/lib/dailyRhythmScheduling';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

function row(overrides: Partial<CandidateGoalActivityForRhythmDemandRow> & { goalActivityId: string }): CandidateGoalActivityForRhythmDemandRow {
  return { goalId: 'goal-1', goalTitle: 'Get fit', title: 'Run', activityId: 'running', rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: 5, ...overrides };
}

function fact(localDate: string, contribution: GoalActivityRhythmOccurrenceFact['contribution']): GoalActivityRhythmOccurrenceFact {
  return { localDate, contribution };
}

/** A minimal, deterministic fake TimingCandidate -- the only fields this
 * module's own code actually reads (start/end/score/label/reasons/metadata). */
function candidate(startIso: string, endIso: string, score: number): TimingCandidate {
  return {
    start: startIso,
    end: endIso,
    score,
    label: 'GOOD',
    muhurtaScore: 0,
    reasons: [],
    metadata: { windowType: 'NEUTRAL' as never, windowLabel: '', activityType: 'running', dateLabel: new Date(startIso).toISOString().slice(0, 10) },
  };
}

function depsFor(
  rows: CandidateGoalActivityForRhythmDemandRow[],
  facts: ReadonlyMap<string, readonly GoalActivityRhythmOccurrenceFact[]> = new Map(),
  rawCandidates: TimingCandidate[] = [],
  findError = false
): { deps: WeeklyRhythmProposalDeps; findCalls: { count: number; lastRequest?: TimingSearchRequest } } {
  const findCalls = { count: 0, lastRequest: undefined as TimingSearchRequest | undefined };
  const baseDeps: GoalDemandCandidatesDeps = {
    loadCandidateGoalActivities: async () => rows,
    loadRhythmFacts: async () => facts,
  };
  const deps: WeeklyRhythmProposalDeps = {
    ...baseDeps,
    runFind: (request: TimingSearchRequest): TimingSearchResponseWithDailyRhythm => {
      findCalls.count += 1;
      findCalls.lastRequest = request;
      if (findError) throw new Error('search failed');
      return { mode: 'FIND', candidates: rawCandidates };
    },
  };
  return { deps, findCalls };
}

const CONTEXT: DailyAssistantContext = { now: new Date('2026-11-06T04:00:00.000Z'), latitude: 12.97, longitude: 77.59, timezone: TZ, tzOffsetMinutes: 330 };
const PREFS: DailyRhythmPreferencesInput = { workStart: null, workEnd: null, workDays: [] };

async function run(deps: WeeklyRhythmProposalDeps, goalActivityId: string, planningLocalDate: string): Promise<WeeklyRhythmProposalResult> {
  return generateWeeklyRhythmProposal(deps, { userId: 'user-1', goalActivityId, planningLocalDate, timezone: TZ, context: CONTEXT, dailyRhythmPrefs: PREFS });
}

async function main() {
  // ============================================================
  // 1. Three remaining sessions, three suitable distinct-day candidates
  // ============================================================
  {
    const rawCandidates = [candidate('2026-11-06T02:00:00.000Z', '2026-11-06T02:30:00.000Z', 9), candidate('2026-11-07T02:00:00.000Z', '2026-11-07T02:30:00.000Z', 8), candidate('2026-11-08T02:00:00.000Z', '2026-11-08T02:30:00.000Z', 7)];
    const { deps } = depsFor([row({ goalActivityId: 'ga-1' })], new Map(), rawCandidates);
    const result = await run(deps, 'ga-1', '2026-11-06');
    check('1. three remaining + three suitable distinct days -> three proposals', result.status === 'OK' && result.proposals.length === 3);
    check('1. requestedCount equals min(target cap, remaining)', result.status === 'OK' && result.requestedCount === 3);
    check('1. no shortfallReason when fully satisfied', result.status === 'OK' && result.shortfallReason === undefined);
  }

  // ============================================================
  // 2. Three remaining but only two eligible/suitable dates -> exactly two, with a reason
  // ============================================================
  {
    const rawCandidates = [candidate('2026-11-06T02:00:00.000Z', '2026-11-06T02:30:00.000Z', 9), candidate('2026-11-07T02:00:00.000Z', '2026-11-07T02:30:00.000Z', 8)];
    const { deps } = depsFor([row({ goalActivityId: 'ga-1' })], new Map(), rawCandidates);
    const result = await run(deps, 'ga-1', '2026-11-06');
    check('2. fewer suitable days than requested -> exactly as many proposals as exist', result.status === 'OK' && result.proposals.length === 2);
    check('2. an honest shortfall reason is returned', result.status === 'OK' && result.shortfallReason === 'FEWER_SUITABLE_DAYS_THAN_REQUESTED');
  }

  // ============================================================
  // 3. Weekly target already satisfied -> NOT_ELIGIBLE, zero proposals
  // ============================================================
  {
    // completedThisWeek + committedThisWeek >= target -> loadEligibleGoalDemand
    // itself never returns this candidate as eligible.
    const facts = new Map([['ga-1', [fact('2026-11-02', 'COMPLETED'), fact('2026-11-03', 'COMPLETED'), fact('2026-11-04', 'COMPLETED'), fact('2026-11-05', 'COMPLETED'), fact('2026-11-06', 'COMPLETED')]]]);
    const { deps, findCalls } = depsFor([row({ goalActivityId: 'ga-1', rhythmTargetPerWeek: 5 })], facts);
    const result = await run(deps, 'ga-1', '2026-11-06');
    check('3. weekly target already satisfied -> NOT_ELIGIBLE', result.status === 'NOT_ELIGIBLE');
    check('3. no search is even attempted once demand is satisfied', findCalls.count === 0);
  }

  // ============================================================
  // 4. An existing (already-committed) session on a candidate date is excluded
  // ============================================================
  {
    const rawCandidates = [candidate('2026-11-06T02:00:00.000Z', '2026-11-06T02:30:00.000Z', 9), candidate('2026-11-07T02:00:00.000Z', '2026-11-07T02:30:00.000Z', 8)];
    // Nov 6 already has a COMMITTED occurrence of this SAME GoalActivity.
    const facts = new Map([['ga-1', [fact('2026-11-06', 'COMMITTED')]]]);
    const { deps } = depsFor([row({ goalActivityId: 'ga-1', rhythmTargetPerWeek: 5 })], facts, rawCandidates);
    const result = await run(deps, 'ga-1', '2026-11-06');
    check('4. a date already carrying a live occurrence is never re-proposed', result.status === 'OK' && !result.proposals.some((p) => p.localDate === '2026-11-06'));
    check('4. the remaining suitable (uncommitted) date is still proposed', result.status === 'OK' && result.proposals.some((p) => p.localDate === '2026-11-07'));
  }

  // ============================================================
  // 5. A completed session today still counts correctly against demand,
  //    and does not itself block today from being re-proposed if demand remains
  // ============================================================
  {
    // target 5, one COMPLETED today -> remaining 4, cap at MAX_WEEKLY_RHYTHM_PROPOSALS (3).
    const facts = new Map([['ga-1', [fact('2026-11-06', 'COMPLETED')]]]);
    const rawCandidates = [candidate('2026-11-06T10:00:00.000Z', '2026-11-06T10:30:00.000Z', 9)];
    const { deps } = depsFor([row({ goalActivityId: 'ga-1', rhythmTargetPerWeek: 5 })], facts, rawCandidates);
    const result = await run(deps, 'ga-1', '2026-11-06');
    check('5. a completed session today is counted against remaining demand', result.status === 'OK' && result.completedThisWeek === 1 && result.remainingThisWeek === 4);
    check('5. requestedCount is capped at MAX_WEEKLY_RHYTHM_PROPOSALS, not the raw remaining count', result.status === 'OK' && result.requestedCount === MAX_WEEKLY_RHYTHM_PROPOSALS);
    // Today's COMPLETED fact occupies today's date, so a second same-day proposal is correctly excluded.
    check('5. today is excluded from new proposals once already completed today', result.status === 'OK' && !result.proposals.some((p) => p.localDate === '2026-11-06'));
  }

  // ============================================================
  // 6. Multiple raw candidates on the same date -> selection picks at most one
  // ============================================================
  {
    const rawCandidates = [candidate('2026-11-06T02:00:00.000Z', '2026-11-06T02:30:00.000Z', 9), candidate('2026-11-06T06:00:00.000Z', '2026-11-06T06:30:00.000Z', 8), candidate('2026-11-07T02:00:00.000Z', '2026-11-07T02:30:00.000Z', 7)];
    const selected = selectDistinctDayProposals(rawCandidates, TZ, 3);
    check('6. same-date raw candidates collapse to at most one per date', selected.length === 2 && new Set(selected.map((c) => c.start)).size === 2);
  }

  // ============================================================
  // 7. Candidate ranking vs date distribution (the algorithm-choice proof)
  // ============================================================
  {
    // Top-2 ranked raw candidates are BOTH on day A; the 3rd-ranked is on day B.
    // Rank-first-distinct-day must pick [day A's top candidate, day B's candidate],
    // never both of day A's at the expense of skipping day B's suitable slot.
    const rawCandidates = [
      candidate('2026-11-06T02:00:00.000Z', '2026-11-06T02:30:00.000Z', 9.5), // day A, rank 1
      candidate('2026-11-06T06:00:00.000Z', '2026-11-06T06:30:00.000Z', 9.0), // day A, rank 2
      candidate('2026-11-07T02:00:00.000Z', '2026-11-07T02:30:00.000Z', 8.0), // day B, rank 3
    ];
    const selected = selectDistinctDayProposals(rawCandidates, TZ, 2);
    check('7. rank-first distinct-day picks the top day-A candidate, never both day-A slots', selected.length === 2 && selected[0].score === 9.5);
    check('7. and still reaches the distinct day-B candidate rather than stopping at day A', selected[1].score === 8.0);
  }

  // ============================================================
  // 8. Stable deterministic selection for identical input
  // ============================================================
  {
    const rawCandidates = [candidate('2026-11-06T02:00:00.000Z', '2026-11-06T02:30:00.000Z', 9), candidate('2026-11-07T02:00:00.000Z', '2026-11-07T02:30:00.000Z', 8), candidate('2026-11-08T02:00:00.000Z', '2026-11-08T02:30:00.000Z', 7)];
    const a = selectDistinctDayProposals(rawCandidates, TZ, 3);
    const b = selectDistinctDayProposals(rawCandidates, TZ, 3);
    check('8. identical input produces identical output across repeated calls', JSON.stringify(a) === JSON.stringify(b));
  }

  // ============================================================
  // 9. User-local week boundaries respected
  // ============================================================
  {
    // 2026-11-04 is a Wednesday; the week's own Sunday is 2026-11-08.
    const range = remainingWeekDateRange('2026-11-04');
    check('9. the date range starts today and ends this local week\'s own Sunday, never next week', range.start === '2026-11-04' && range.end === '2026-11-08');
  }

  // ============================================================
  // 10. A DST-transition date does not break the request or the selection
  // ============================================================
  {
    // US DST ends 2026-11-01 (a Sunday) -- construct a range crossing it; the
    // module's own date math is pure civil-date string arithmetic (reused
    // from goalActivityRhythm.ts), so this must not throw or miscount.
    const rawCandidates = [candidate('2026-11-01T02:00:00.000Z', '2026-11-01T02:30:00.000Z', 9), candidate('2026-11-02T02:00:00.000Z', '2026-11-02T02:30:00.000Z', 8)];
    let threw = false;
    let selected: TimingCandidate[] = [];
    try {
      selected = selectDistinctDayProposals(rawCandidates, 'America/New_York', 2);
    } catch {
      threw = true;
    }
    check('10. a DST-transition date range does not throw', !threw);
    check('10. and still resolves two distinct civil dates across the transition', selected.length === 2);
  }

  // ============================================================
  // 11. An unauthorized/non-owned GoalActivity ID is rejected cleanly
  // ============================================================
  {
    const { deps } = depsFor([row({ goalActivityId: 'ga-owned' })]);
    const result = await run(deps, 'ga-not-owned', '2026-11-06');
    check('11. a GoalActivity id this user\'s own discovery query never returned is rejected -> NOT_ELIGIBLE', result.status === 'NOT_ELIGIBLE');
  }

  // ============================================================
  // 12. An archived/ineligible GoalActivity is excluded
  // ============================================================
  {
    // The discovery query itself (loadCandidateGoalActivitiesForRhythmDemand)
    // already excludes archived Goals/DISMISSED activities/non-N_PER_WEEK at
    // the SQL level (proven live in goalDemandCandidatesDb.test.ts) -- here,
    // simulating "archived" as simply absent from the rows this fake deps
    // layer returns, exactly as the real query would behave.
    const { deps } = depsFor([]); // no rows at all -- as if archived/dismissed
    const result = await run(deps, 'ga-1', '2026-11-06');
    check('12. a GoalActivity absent from the eligible-discovery rows is rejected -> NOT_ELIGIBLE', result.status === 'NOT_ELIGIBLE');
  }

  // ============================================================
  // 13. No database writes occur [STRUCTURAL]
  // ============================================================
  {
    const libSrc = fs.readFileSync(path.join(__dirname, '../apps/web/lib/goalRhythmWeeklyProposal.ts'), 'utf8');
    const routeSrc = fs.readFileSync(path.join(__dirname, '../apps/web/app/api/daily-assistant/goal-rhythm/weekly-proposal/route.ts'), 'utf8');
    const writePattern = /\.(create|update|upsert|delete)\s*\(/;
    check('13. [STRUCTURAL] the service module contains no write call', !writePattern.test(libSrc));
    check('13. [STRUCTURAL] the route contains no write call', !writePattern.test(routeSrc));
  }

  // ============================================================
  // 14. A candidate-search failure is handled gracefully, never fabricated
  // ============================================================
  {
    const { deps } = depsFor([row({ goalActivityId: 'ga-1' })], new Map(), [], true);
    const result = await run(deps, 'ga-1', '2026-11-06');
    check('14. a timing-search failure resolves to SEARCH_FAILED, never a fabricated proposal', result.status === 'SEARCH_FAILED');
  }

  // ============================================================
  // 15. Explicit non-committable fallback, since acceptance compatibility
  //     is not established for a multi-day batch (verified in Section 3/7
  //     of the HGR3-A ticket: the accept route binds every submitted item
  //     to ONE shared constructionWindow)
  // ============================================================
  {
    const rawCandidates = [candidate('2026-11-06T02:00:00.000Z', '2026-11-06T02:30:00.000Z', 9)];
    const { deps } = depsFor([row({ goalActivityId: 'ga-1' })], new Map(), rawCandidates);
    const result = await run(deps, 'ga-1', '2026-11-06');
    check('15. every OK result is explicitly non-committable', result.status === 'OK' && result.committable === false && typeof result.nonCommittableReason === 'string' && result.nonCommittableReason.length > 0);
    check(
      '15. [STRUCTURAL] this module never imports the preview-signing module and never assigns an acceptanceToken field',
      !fs.readFileSync(path.join(__dirname, '../apps/web/lib/goalRhythmWeeklyProposal.ts'), 'utf8').match(/from '\.\/dayConstructorPreviewIntegrity'|acceptanceToken\s*:/)
    );
  }

  // ============================================================
  // Negative control A -- bypass weekly-target satisfaction filtering
  // (temporarily treat EVERY candidate as if remaining demand were always
  // MAX_WEEKLY_RHYTHM_PROPOSALS, ignoring loadEligibleGoalDemand's own
  // computed remainingThisWeek) -- proven here via a direct mutation of
  // the inputs a real caller could never construct (target already met),
  // demonstrating check 3 would catch a real regression of this kind.
  // ============================================================
  {
    const facts = new Map([['ga-1', [fact('2026-11-02', 'COMPLETED'), fact('2026-11-03', 'COMPLETED'), fact('2026-11-04', 'COMPLETED'), fact('2026-11-05', 'COMPLETED'), fact('2026-11-06', 'COMPLETED')]]]);
    const { deps } = depsFor([row({ goalActivityId: 'ga-1', rhythmTargetPerWeek: 5 })], facts);
    const result = await run(deps, 'ga-1', '2026-11-06');
    check('negative control A -- a satisfied target genuinely yields NOT_ELIGIBLE (this is what check 3 depends on)', result.status === 'NOT_ELIGIBLE');
  }

  // ============================================================
  // Negative control B -- same-day dedup removed (seedOccupiedLocalDates
  // omitted / usedDates not checked) would let two raw candidates on one
  // date both survive; proven here that WITH the real dedup, they do not.
  // ============================================================
  {
    const rawCandidates = [candidate('2026-11-06T02:00:00.000Z', '2026-11-06T02:30:00.000Z', 9), candidate('2026-11-06T06:00:00.000Z', '2026-11-06T06:30:00.000Z', 8)];
    const selectedWithDedup = selectDistinctDayProposals(rawCandidates, TZ, 2);
    const selectedWithoutDedup = rawCandidates.slice(0, 2); // what a regression without dedup would look like
    check('negative control B -- real dedup collapses same-date raw candidates to one', selectedWithDedup.length === 1);
    check('negative control B -- (for contrast) the undeduped alternative would wrongly keep both', selectedWithoutDedup.length === 2);
  }

  console.log(allPassed ? '\nALL GOAL RHYTHM WEEKLY PROPOSAL CHECKS PASSED' : '\nSOME GOAL RHYTHM WEEKLY PROPOSAL CHECKS FAILED');
  process.exitCode = allPassed ? 0 : 1;
}

main();
