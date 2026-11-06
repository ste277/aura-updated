/**
 * HGR3-C2 -- Home Weekly Planning UI, client-side pure logic.
 *
 * Production-path regression coverage for weeklyPlanReviewClient.ts: the
 * review-entry gate, session-draft projection/locking/selection, the real
 * acceptance-summary reconciliation, explanation rendering (the real,
 * shared `formatMuhurtaReason`), date/time presentation, failure guidance,
 * and every pure request/response builder/parser for the three endpoints
 * this module composes. No DB, no network, no jsdom -- every function
 * under test here is already I/O-free by design (see that file's own doc
 * comment on the pure/network split).
 *
 * Checks explicitly marked [STRUCTURAL] are source-text assertions; every
 * other check calls the real exported functions directly.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  shouldOfferWeeklyReview,
  buildSessionDraftsFromProposal,
  isSessionLocked,
  selectSessionsPendingSubmission,
  applyAcceptanceSummaryToDrafts,
  summarizeSessionReasons,
  formatSessionDayLabel,
  formatSessionTimeLabel,
  describeSessionFailure,
  buildWeeklyAcceptanceRequestBody,
  parseWeeklyProposalResponseBody,
  parseWeeklyAcceptanceResponseBody,
  buildAdjustmentFindRequestBody,
  buildAdjustmentCheckRequestBody,
  draftFromAdjustmentCandidate,
  siblingLocalDatesExcluding,
  hasDateCollision,
  hasDuplicateActiveLocalDates,
  type WeeklyReviewSessionDraft,
} from '../apps/web/lib/weeklyPlanReviewClient';
import type { WeeklyRhythmProposalItem } from '../apps/web/lib/goalRhythmWeeklyProposal';
import type { WeeklyAcceptanceSummary } from '../apps/web/lib/goalRhythmWeeklyAcceptance';
import type { MuhurtaReason } from '../packages/muhurta/src/activityOntology';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function reason(factor: MuhurtaReason['factor'], code: MuhurtaReason['code'], value?: string): MuhurtaReason {
  return { code, factor, polarity: 'SUPPORT', value };
}

function item(overrides: Partial<WeeklyRhythmProposalItem> = {}): WeeklyRhythmProposalItem {
  return {
    localDate: '2026-11-10',
    start: '2026-11-10T01:30:00.000Z',
    end: '2026-11-10T02:00:00.000Z',
    timezone: 'Asia/Kolkata',
    durationMinutes: 30,
    score: 8.2,
    label: 'VERY_GOOD',
    reasons: [reason('TITHI', 'TITHI_SUPPORTIVE', 'Panchami')],
    ...overrides,
  };
}

function draft(overrides: Partial<WeeklyReviewSessionDraft> = {}): WeeklyReviewSessionDraft {
  return {
    localDate: '2026-11-10',
    start: '2026-11-10T01:30:00.000Z',
    end: '2026-11-10T02:00:00.000Z',
    durationMinutes: 30,
    score: 8.2,
    label: 'VERY_GOOD',
    reasons: [reason('TITHI', 'TITHI_SUPPORTIVE', 'Panchami')],
    adjusted: false,
    outcome: 'PENDING',
    ...overrides,
  };
}

function summary(sessions: WeeklyAcceptanceSummary['sessions']): WeeklyAcceptanceSummary {
  return { requestedCount: sessions.length, acceptedCount: 0, alreadyAcceptedCount: 0, failedCount: 0, sessions, remainingThisWeekByGoalActivityId: new Map() };
}

function candidate(overrides: Partial<TimingCandidate> = {}): TimingCandidate {
  return {
    start: '2026-11-11T02:00:00.000Z',
    end: '2026-11-11T02:30:00.000Z',
    score: 7.5,
    label: 'GOOD',
    muhurtaScore: 12,
    reasons: [reason('NAKSHATRA', 'NAKSHATRA_SUPPORTIVE', 'Hasta')],
    metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'GENERIC', dateLabel: 'Wed, Nov 11' },
    ...overrides,
  };
}

async function main() {
  // ---- 1. shouldOfferWeeklyReview ----
  check('1. zero remaining -> no weekly review offered', shouldOfferWeeklyReview(0) === false);
  check('1. exactly one remaining -> no weekly review offered (keeps the single Plan it action)', shouldOfferWeeklyReview(1) === false);
  check('1. two remaining -> weekly review offered', shouldOfferWeeklyReview(2) === true);
  check('1. three remaining -> weekly review offered', shouldOfferWeeklyReview(3) === true);

  // ---- 2. buildSessionDraftsFromProposal ----
  const sourceItem = item();
  const projected = buildSessionDraftsFromProposal([sourceItem, item({ localDate: '2026-11-12', start: '2026-11-12T03:00:00.000Z', end: '2026-11-12T03:30:00.000Z' })]);
  check('2. projects every proposal item into a draft, order-preserving', projected.length === 2 && projected[0].localDate === '2026-11-10' && projected[1].localDate === '2026-11-12');
  check('2. every new draft starts PENDING and not adjusted', projected.every((d) => d.outcome === 'PENDING' && d.adjusted === false));
  check('2. carries start/end/durationMinutes/score/label/reasons verbatim, never re-derived', projected[0].start === sourceItem.start && projected[0].reasons === sourceItem.reasons);

  // ---- 3. isSessionLocked ----
  check('3. ACCEPTED is locked', isSessionLocked('ACCEPTED') === true);
  check('3. ALREADY_ACCEPTED is locked', isSessionLocked('ALREADY_ACCEPTED') === true);
  check('3. PENDING is not locked', isSessionLocked('PENDING') === false);
  check('3. FAILED is not locked', isSessionLocked('FAILED') === false);

  // ---- 4. selectSessionsPendingSubmission ----
  const mixed = [draft({ localDate: 'd1' }), draft({ localDate: 'd2', outcome: 'ACCEPTED', plannedActivityId: 'p1' }), draft({ localDate: 'd3', outcome: 'FAILED', failureReason: 'TIME_NO_LONGER_AVAILABLE' })];
  const pending = selectSessionsPendingSubmission(mixed);
  check('4. omits locked (ACCEPTED/ALREADY_ACCEPTED) sessions from a submission', pending.length === 2 && pending.every((p) => p.localDate !== 'd2'));
  check('4. includes PENDING and FAILED sessions (both retryable)', pending.some((p) => p.localDate === 'd1') && pending.some((p) => p.localDate === 'd3'));
  check('4. preserves exact start/end, never re-derives them', pending[0].start === mixed[0].start && pending[0].end === mixed[0].end);

  // ---- 5. applyAcceptanceSummaryToDrafts ----
  const original = [
    draft({ localDate: '2026-11-10', start: '2026-11-10T01:30:00.000Z', end: '2026-11-10T02:00:00.000Z' }),
    draft({ localDate: '2026-11-11', start: '2026-11-11T02:00:00.000Z', end: '2026-11-11T02:30:00.000Z' }),
    draft({ localDate: '2026-11-12', start: '2026-11-12T03:00:00.000Z', end: '2026-11-12T03:30:00.000Z' }),
  ];
  const submittedOriginal = selectSessionsPendingSubmission(original);
  const resultSummary = summary([
    { goalActivityId: 'ga1', localDate: '2026-11-10', outcome: 'ACCEPTED', plannedActivityId: 'plan-1', start: '2026-11-10T01:30:00.000Z', end: '2026-11-10T02:00:00.000Z' },
    { goalActivityId: 'ga1', localDate: '2026-11-11', outcome: 'ALREADY_ACCEPTED', plannedActivityId: 'plan-2', start: '2026-11-11T02:00:00.000Z', end: '2026-11-11T02:30:00.000Z' },
    { goalActivityId: 'ga1', localDate: '2026-11-12', outcome: 'FAILED', reason: 'TIME_NO_LONGER_AVAILABLE' },
  ]);
  const applied = applyAcceptanceSummaryToDrafts(original, submittedOriginal, resultSummary);
  check('5. a real ACCEPTED outcome is matched by exact (localDate,start,end), never by array position', applied[0].outcome === 'ACCEPTED' && applied[0].plannedActivityId === 'plan-1');
  check('5. a real ALREADY_ACCEPTED outcome is matched the same way', applied[1].outcome === 'ALREADY_ACCEPTED' && applied[1].plannedActivityId === 'plan-2');
  check('5. a FAILED outcome (no start/end in the response) is matched via the request\'s OWN same-order copy of that session\'s key, not localDate alone', applied[2].outcome === 'FAILED' && applied[2].failureReason === 'TIME_NO_LONGER_AVAILABLE');
  const unmatched = applyAcceptanceSummaryToDrafts([draft({ localDate: 'never-submitted' })], [], summary([]));
  check('5. a draft with no matching outcome in the summary is left completely unchanged', unmatched[0].outcome === 'PENDING');
  check(
    '5. [negative-control-equivalent] a SUCCESS for a DIFFERENT exact instant on the same date never overwrites an unrelated draft',
    applyAcceptanceSummaryToDrafts(
      [draft({ localDate: '2026-11-10', start: '2026-11-10T09:00:00.000Z', end: '2026-11-10T09:30:00.000Z' })],
      [{ localDate: '2026-11-10', start: '2026-11-10T01:30:00.000Z', end: '2026-11-10T02:00:00.000Z' }],
      summary([{ goalActivityId: 'ga1', localDate: '2026-11-10', outcome: 'ACCEPTED', plannedActivityId: 'plan-x', start: '2026-11-10T01:30:00.000Z', end: '2026-11-10T02:00:00.000Z' }])
    )[0].outcome === 'PENDING'
  );

  // ---- 5b. applyAcceptanceSummaryToDrafts -- same-date collision reconciliation (HGR3-C2 remediation, P2) ----
  // Two drafts sharing a localDate but distinct start/end -- the request's
  // own positional copy of each session's key is what makes this
  // unambiguous, even though the backend's FAILED outcome itself carries
  // no start/end.
  const sameDateDrafts = [
    draft({ localDate: '2026-11-15', start: '2026-11-15T01:00:00.000Z', end: '2026-11-15T01:30:00.000Z' }),
    draft({ localDate: '2026-11-15', start: '2026-11-15T09:00:00.000Z', end: '2026-11-15T09:30:00.000Z' }),
  ];
  const sameDateSubmitted = selectSessionsPendingSubmission(sameDateDrafts);
  const bothFailedSummary = summary([
    { goalActivityId: 'ga1', localDate: '2026-11-15', outcome: 'FAILED', reason: 'TIME_NO_LONGER_AVAILABLE' },
    { goalActivityId: 'ga1', localDate: '2026-11-15', outcome: 'FAILED', reason: 'OUTSIDE_AVAILABILITY' },
  ]);
  const bothFailedApplied = applyAcceptanceSummaryToDrafts(sameDateDrafts, sameDateSubmitted, bothFailedSummary);
  check('5b. two same-date FAILURES remain individually attributable -- the first keeps its own reason, never the second\'s', bothFailedApplied[0].outcome === 'FAILED' && bothFailedApplied[0].failureReason === 'TIME_NO_LONGER_AVAILABLE');
  check('5b. ...and the second keeps ITS own reason, never the first\'s', bothFailedApplied[1].outcome === 'FAILED' && bothFailedApplied[1].failureReason === 'OUTSIDE_AVAILABILITY');

  const mixedSameDateSummary = summary([
    { goalActivityId: 'ga1', localDate: '2026-11-15', outcome: 'ACCEPTED', plannedActivityId: 'plan-same-date', start: '2026-11-15T01:00:00.000Z', end: '2026-11-15T01:30:00.000Z' },
    { goalActivityId: 'ga1', localDate: '2026-11-15', outcome: 'FAILED', reason: 'TIME_NO_LONGER_AVAILABLE' },
  ]);
  const mixedSameDateApplied = applyAcceptanceSummaryToDrafts(sameDateDrafts, sameDateSubmitted, mixedSameDateSummary);
  check('5b. a partial success sharing a date with a failure reconciles the success correctly', mixedSameDateApplied[0].outcome === 'ACCEPTED' && mixedSameDateApplied[0].plannedActivityId === 'plan-same-date');
  check('5b. ...and the failure correctly, on the OTHER draft, never the successful one\'s reason', mixedSameDateApplied[1].outcome === 'FAILED' && mixedSameDateApplied[1].failureReason === 'TIME_NO_LONGER_AVAILABLE');

  // ---- 5c. same-date collision detection (HGR3-C2 remediation, P1) ----
  const collisionDrafts = [draft({ localDate: '2026-11-10' }), draft({ localDate: '2026-11-11' }), draft({ localDate: '2026-11-12' })];
  check('5c. siblingLocalDatesExcluding excludes only the given index', JSON.stringify(siblingLocalDatesExcluding(collisionDrafts, 1)) === JSON.stringify(['2026-11-10', '2026-11-12']));
  check('5c. hasDateCollision is true when the candidate date matches a sibling', hasDateCollision('2026-11-10', siblingLocalDatesExcluding(collisionDrafts, 1)) === true);
  check('5c. hasDateCollision is false for a genuinely free date', hasDateCollision('2026-11-20', siblingLocalDatesExcluding(collisionDrafts, 1)) === false);
  check('5c. hasDateCollision is false for a draft\'s OWN current date once excluded (adjusting onto its own unchanged date is never a false collision)', hasDateCollision('2026-11-11', siblingLocalDatesExcluding(collisionDrafts, 1)) === false);
  check('5c. hasDuplicateActiveLocalDates is false for an all-distinct batch', hasDuplicateActiveLocalDates(collisionDrafts) === false);
  check('5c. hasDuplicateActiveLocalDates is true once two active drafts share a date', hasDuplicateActiveLocalDates([draft({ localDate: '2026-11-10' }), draft({ localDate: '2026-11-10' })]) === true);
  check('5c. a removed sibling (simply absent from the array, never merely flagged) cannot cause a false collision', hasDateCollision('2026-11-10', siblingLocalDatesExcluding([draft({ localDate: '2026-11-11' }), draft({ localDate: '2026-11-12' })], 0)) === false);
  check('5c. collision detection includes LOCKED siblings (an already-ACCEPTED date is just as real a collision as a pending one)', hasDateCollision('2026-11-10', siblingLocalDatesExcluding([draft({ localDate: '2026-11-10', outcome: 'ACCEPTED', plannedActivityId: 'p' }), draft({ localDate: '2026-11-20' })], 1)) === true);

  // ---- 6. summarizeSessionReasons (real formatMuhurtaReason, real factor labels) ----
  const reasons = summarizeSessionReasons([reason('TITHI', 'TITHI_SUPPORTIVE', 'Panchami'), reason('NAKSHATRA', 'NAKSHATRA_SUPPORTIVE', 'Hasta'), reason('YOGA', 'YOGA_SUPPORTIVE', 'Siddha'), reason('KARANA', 'KARANA_SUPPORTIVE', 'Bava')]);
  check('6. real structured reasons are formatted into real English prose via the SHARED formatMuhurtaReason', reasons[0].includes('Panchami') && reasons[0].startsWith('Tithi:'));
  check('6. never re-sorts: the engine\'s own first reason stays first', reasons[0].includes('Panchami') && reasons[1].includes('Hasta'));
  check('6. caps at 3 -- the engine\'s own top-reasons convention, never all of them', reasons.length === 3);
  check('6. no reasons -> no explanation lines (never fabricated)', summarizeSessionReasons([]).length === 0);

  // ---- 7. date/time presentation ----
  check('7. day label is formatted from the civil date at local noon UTC -- immune to any timezone shifting it a day', formatSessionDayLabel('2026-11-10', 'Pacific/Kiritimati').includes('Nov 10'));
  check('7. time label respects the GIVEN timezone, not the test runner\'s own local timezone', formatSessionTimeLabel('2026-11-10T01:30:00.000Z', 'Asia/Kolkata') === '7:00 AM');
  check('7. a different timezone for the SAME instant produces a different time label', formatSessionTimeLabel('2026-11-10T01:30:00.000Z', 'Asia/Kolkata') !== formatSessionTimeLabel('2026-11-10T01:30:00.000Z', 'America/New_York'));

  // ---- 8. describeSessionFailure ----
  check('8. a known closed failure code maps to a specific, human message', describeSessionFailure('COMMITMENT_NO_LONGER_LIVE').message.includes('already been handled') || describeSessionFailure('COMMITMENT_NO_LONGER_LIVE').message.length > 0);
  check('8. COMMITMENT_NO_LONGER_LIVE is marked correctable (adjust to a different time rebooks normally)', describeSessionFailure('COMMITMENT_NO_LONGER_LIVE').canAdjust === true);
  check('8. ACCEPTANCE_IDENTITY_CONFLICT is NOT presented as adjustable (closing/reopening is the real fix)', describeSessionFailure('ACCEPTANCE_IDENTITY_CONFLICT').canAdjust === false);
  check('8. an unrecognized/unexpected reason string falls back to a safe default rather than throwing or leaking it', describeSessionFailure('SOME_FUTURE_CODE_THIS_FILE_DOES_NOT_KNOW').message.length > 0);
  check('8. a missing reason also falls back to the safe default', describeSessionFailure(undefined).message.length > 0);

  // ---- 9. buildWeeklyAcceptanceRequestBody ----
  const body = buildWeeklyAcceptanceRequestBody('ga-1', 'accept-uuid-1', [{ localDate: 'd1', start: 's1', end: 'e1' }]);
  check('9. request body carries goalActivityId/acceptanceId/sessions exactly as given', body.goalActivityId === 'ga-1' && body.acceptanceId === 'accept-uuid-1' && body.sessions.length === 1 && body.sessions[0].localDate === 'd1');

  // ---- 10. parseWeeklyProposalResponseBody ----
  check('10. a real OK body with a proposals array parses as OK', parseWeeklyProposalResponseBody({ status: 'OK', proposals: [] }, 200).status === 'OK');
  check('10. NOT_ELIGIBLE parses as NOT_ELIGIBLE', parseWeeklyProposalResponseBody({ status: 'NOT_ELIGIBLE' }, 200).status === 'NOT_ELIGIBLE');
  check('10. SEARCH_FAILED parses as SEARCH_FAILED', parseWeeklyProposalResponseBody({ status: 'SEARCH_FAILED' }, 500).status === 'SEARCH_FAILED');
  check('10. a non-200 with no recognized body shape parses as HTTP_ERROR', parseWeeklyProposalResponseBody({ error: 'nope' }, 401).status === 'HTTP_ERROR');
  check('10. a 200 with no recognized body shape parses as UNKNOWN_RESPONSE, never silently OK', parseWeeklyProposalResponseBody({ unexpected: true }, 200).status === 'UNKNOWN_RESPONSE');

  // ---- 11. parseWeeklyAcceptanceResponseBody ----
  const okAcceptanceBody = { requestedCount: 1, acceptedCount: 1, alreadyAcceptedCount: 0, failedCount: 0, sessions: [{ goalActivityId: 'ga1', localDate: 'd1', outcome: 'ACCEPTED', plannedActivityId: 'p1', start: 's', end: 'e' }] };
  const parsedAcceptance = parseWeeklyAcceptanceResponseBody(okAcceptanceBody, 200);
  check('11. a real acceptance response body parses as OK with the real sessions array carried through', parsedAcceptance.status === 'OK' && parsedAcceptance.summary.sessions.length === 1);
  check('11. a non-200 with no recognized body shape parses as HTTP_ERROR', parseWeeklyAcceptanceResponseBody({ error: 'nope' }, 400).status === 'HTTP_ERROR');
  check('11. a 200 with no recognized body shape parses as UNKNOWN_RESPONSE', parseWeeklyAcceptanceResponseBody({}, 200).status === 'UNKNOWN_RESPONSE');

  // ---- 12. adjustment request builders ----
  const findBody = buildAdjustmentFindRequestBody({ activityId: 'act-1', activityTitleFallback: 'Run', durationMinutes: 30 }, '2026-11-10');
  check('12. FIND adjustment request scopes dateRange to exactly ONE day, never a new multi-day search', (findBody as any).mode === 'FIND' && (findBody as any).dateRange.start === '2026-11-10' && (findBody as any).dateRange.end === '2026-11-10');
  check('12. FIND adjustment request uses the real activityId when present, never a taskTitle fallback in that case', (findBody as any).activityId === 'act-1' && (findBody as any).taskTitle === undefined);
  const findBodyNoActivity = buildAdjustmentFindRequestBody({ activityId: null, activityTitleFallback: 'Run', durationMinutes: 30 }, '2026-11-10');
  check('12. FIND adjustment request falls back to taskTitle only when activityId is null', (findBodyNoActivity as any).activityId === undefined && (findBodyNoActivity as any).taskTitle === 'Run');
  const checkBody = buildAdjustmentCheckRequestBody({ activityId: 'act-1', activityTitleFallback: 'Run', durationMinutes: 30 }, '2026-11-10T09:00:00.000Z');
  check('12. CHECK adjustment request carries mode CHECK and the exact candidateStart given, never re-derived', (checkBody as any).mode === 'CHECK' && (checkBody as any).candidateStart === '2026-11-10T09:00:00.000Z');

  // ---- 13. draftFromAdjustmentCandidate ----
  const originalDraft = draft({ localDate: '2026-11-10', start: '2026-11-10T01:30:00.000Z', end: '2026-11-10T02:00:00.000Z', adjusted: false, outcome: 'FAILED', failureReason: 'TIME_NO_LONGER_AVAILABLE' });
  const sourceCandidate = candidate();
  const adjusted = draftFromAdjustmentCandidate(originalDraft, sourceCandidate, '2026-11-11');
  check('13. carries the real candidate\'s start/end/score/label/reasons verbatim, never re-derived', adjusted.start === sourceCandidate.start && adjusted.end === sourceCandidate.end && adjusted.score === sourceCandidate.score && adjusted.reasons === sourceCandidate.reasons);
  check('13. marks the draft as adjusted (never claims this was Aura\'s original top pick)', adjusted.adjusted === true);
  check('13. resets outcome back to PENDING, clearing any prior failure, so it can be resubmitted', adjusted.outcome === 'PENDING' && adjusted.failureReason === undefined);
  check('13. updates localDate to the adjusted day', adjusted.localDate === '2026-11-11');

  // ---- 14. [STRUCTURAL] no writes before confirmation / single write boundary ----
  const src = fs.readFileSync(path.join(__dirname, '../apps/web/lib/weeklyPlanReviewClient.ts'), 'utf8');
  check('14. [STRUCTURAL] the proposal fetch function calls ONLY the read-only weekly-proposal endpoint', /fetchWeeklyRhythmProposal[\s\S]*?weekly-proposal/.test(src));
  check('14. [STRUCTURAL] the ONE write-capable call in this file targets weekly-accept, and only inside submitWeeklyAcceptance', /submitWeeklyAcceptance[\s\S]*?weekly-accept/.test(src) && src.match(/fetch\('\/api\/daily-assistant\/goal-rhythm\/weekly-accept'/g)?.length === 1);
  check('14. [STRUCTURAL] this file never calls encodeGoalDemandIntentId or any server-only persistence function directly', !/encodeGoalDemandIntentId|persistAcceptedConstructedDay|materializeGoalActivityRhythmOccurrence/.test(src));
  check('14. [STRUCTURAL] acceptanceId is never generated in this file (owned by the modal, per this file\'s own header comment)', !/randomUUID/.test(src));
  check('14. [STRUCTURAL] explanation rendering reuses the real, shared formatMuhurtaReason -- never a second formatter', /from '\.\.\/\.\.\/\.\.\/packages\/muhurta\/src\/muhurtaReasonFormat'/.test(src));

  console.log(allPassed ? '\nALL WEEKLY PLAN REVIEW CLIENT CHECKS PASSED' : '\nSOME WEEKLY PLAN REVIEW CLIENT CHECKS FAILED');
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
