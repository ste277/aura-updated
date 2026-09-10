/**
 * Forward Planner V1: pure-logic regression suite for
 * apps/web/lib/forwardPlanner.ts. Plain .ts import only (no .tsx) --
 * runnable via this repo's standard `npx ts-node test/*.test.ts`
 * invocation with no jsx compiler flag, following the exact same
 * precedent test/bestForYouViewModel.test.ts / test/whyAuraViewModel.test.ts
 * already established.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

import {
  resolveForwardPlannerRange,
  selectOneCandidatePerLocalDate,
  isAboveForwardPlannerFloor,
  filterConflictingCandidates,
  rankForwardPlannerCandidates,
  buildTargetEvaluationTime,
  rangeDayCount,
  MAX_FORWARD_PLANNER_RANGE_DAYS,
  MAX_FORWARD_PLANNER_RESULTS,
} from '../apps/web/lib/forwardPlanner';
import type { ForwardPlannerRankInput, ForwardPlannerBlockingInterval } from '../apps/web/lib/forwardPlanner';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

const TZ_KOLKATA = 'Asia/Kolkata';
const TZ_NEW_YORK = 'America/New_York';

// ============================================================
// Fixture builders.
// ============================================================

function buildCandidate(overrides: Partial<TimingCandidate> = {}): TimingCandidate {
  return {
    start: '2026-09-11T04:00:00.000Z',
    end: '2026-09-11T05:00:00.000Z',
    score: 8.5,
    label: 'VERY_GOOD',
    muhurtaScore: 5,
    reasons: [],
    metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'Deep Work', dateLabel: 'Fri, Sep 11' },
    ...overrides,
  };
}

// ============================================================
// RANGE RESOLUTION.
// ============================================================

check(
  'TOMORROW: resolves to the next local calendar date, both ends equal',
  (() => {
    // Friday Sep 11 2026, 10:00 IST.
    const now = new Date('2026-09-11T04:30:00.000Z');
    const result = resolveForwardPlannerRange('TOMORROW', now, TZ_KOLKATA);
    return result.ok && result.range.startLocalDate === '2026-09-12' && result.range.endLocalDate === '2026-09-12';
  })()
);

check(
  'TOMORROW near local midnight: a request at 23:50 IST still resolves to the NEXT calendar date, never +24h from a UTC-anchored instant',
  (() => {
    // 2026-09-11 23:50 IST == 2026-09-11 18:20 UTC.
    const now = new Date('2026-09-11T18:20:00.000Z');
    const result = resolveForwardPlannerRange('TOMORROW', now, TZ_KOLKATA);
    return result.ok && result.range.startLocalDate === '2026-09-12';
  })()
);

check(
  'WEEKEND (Thursday): resolves to the upcoming Saturday+Sunday',
  (() => {
    // Thursday Sep 10 2026.
    const now = new Date('2026-09-10T04:00:00.000Z');
    const result = resolveForwardPlannerRange('WEEKEND', now, TZ_KOLKATA);
    return result.ok && result.range.startLocalDate === '2026-09-12' && result.range.endLocalDate === '2026-09-13';
  })()
);

check(
  'WEEKEND (Friday): resolves to the upcoming Saturday+Sunday',
  (() => {
    const now = new Date('2026-09-11T04:00:00.000Z');
    const result = resolveForwardPlannerRange('WEEKEND', now, TZ_KOLKATA);
    return result.ok && result.range.startLocalDate === '2026-09-12' && result.range.endLocalDate === '2026-09-13';
  })()
);

check(
  'WEEKEND (Saturday, merge-critical): includes the REMAINDER of today -- today + tomorrow (Sunday)',
  (() => {
    // Saturday Sep 12 2026.
    const now = new Date('2026-09-12T04:00:00.000Z');
    const result = resolveForwardPlannerRange('WEEKEND', now, TZ_KOLKATA);
    return result.ok && result.range.startLocalDate === '2026-09-12' && result.range.endLocalDate === '2026-09-13';
  })()
);

check(
  'WEEKEND (Sunday, merge-critical): resolves to Sunday ONLY -- deliberately NOT the shared resolveHorizonDayOffsets behavior (which jumps to next Saturday, a week away)',
  (() => {
    // Sunday Sep 13 2026.
    const now = new Date('2026-09-13T04:00:00.000Z');
    const result = resolveForwardPlannerRange('WEEKEND', now, TZ_KOLKATA);
    return result.ok && result.range.startLocalDate === '2026-09-13' && result.range.endLocalDate === '2026-09-13';
  })()
);

check(
  'WEEKEND (Monday): resolves to the upcoming Saturday (5 days away)+Sunday',
  (() => {
    const now = new Date('2026-09-14T04:00:00.000Z'); // Monday
    const result = resolveForwardPlannerRange('WEEKEND', now, TZ_KOLKATA);
    return result.ok && result.range.startLocalDate === '2026-09-19' && result.range.endLocalDate === '2026-09-20';
  })()
);

check(
  'SEVEN_DAYS: tomorrow through 7 calendar days from today (inclusive), 7 total dates',
  (() => {
    const now = new Date('2026-09-11T04:00:00.000Z');
    const result = resolveForwardPlannerRange('SEVEN_DAYS', now, TZ_KOLKATA);
    return result.ok && result.range.startLocalDate === '2026-09-12' && result.range.endLocalDate === '2026-09-18' && rangeDayCount(result.range) === 7;
  })()
);

check(
  'CUSTOM: valid future single date accepted',
  (() => {
    const now = new Date('2026-09-11T04:00:00.000Z');
    const result = resolveForwardPlannerRange('CUSTOM', now, TZ_KOLKATA, '2026-09-15', '2026-09-15');
    return result.ok && result.range.startLocalDate === '2026-09-15' && result.range.endLocalDate === '2026-09-15';
  })()
);

check(
  'CUSTOM: today rejected (must start tomorrow or later)',
  (() => {
    const now = new Date('2026-09-11T04:00:00.000Z');
    const result = resolveForwardPlannerRange('CUSTOM', now, TZ_KOLKATA, '2026-09-11', '2026-09-11');
    return !result.ok;
  })()
);

check(
  'CUSTOM: past date rejected',
  (() => {
    const now = new Date('2026-09-11T04:00:00.000Z');
    const result = resolveForwardPlannerRange('CUSTOM', now, TZ_KOLKATA, '2026-09-01', '2026-09-01');
    return !result.ok;
  })()
);

check(
  'CUSTOM: start > end rejected',
  (() => {
    const now = new Date('2026-09-11T04:00:00.000Z');
    const result = resolveForwardPlannerRange('CUSTOM', now, TZ_KOLKATA, '2026-09-15', '2026-09-13');
    return !result.ok;
  })()
);

check(
  `CUSTOM: range exceeding ${MAX_FORWARD_PLANNER_RANGE_DAYS} days rejected`,
  (() => {
    const now = new Date('2026-09-11T04:00:00.000Z');
    const result = resolveForwardPlannerRange('CUSTOM', now, TZ_KOLKATA, '2026-09-12', '2026-09-25');
    return !result.ok;
  })()
);

check(
  `CUSTOM: a range of exactly ${MAX_FORWARD_PLANNER_RANGE_DAYS} days is accepted (boundary, not rejected)`,
  (() => {
    const now = new Date('2026-09-11T04:00:00.000Z');
    const result = resolveForwardPlannerRange('CUSTOM', now, TZ_KOLKATA, '2026-09-12', '2026-09-18');
    return result.ok && rangeDayCount(result.range) === MAX_FORWARD_PLANNER_RANGE_DAYS;
  })()
);

check(
  'CUSTOM: malformed date string rejected',
  (() => {
    const now = new Date('2026-09-11T04:00:00.000Z');
    const result = resolveForwardPlannerRange('CUSTOM', now, TZ_KOLKATA, 'not-a-date', '2026-09-15');
    return !result.ok;
  })()
);

check(
  'TIMEZONE: America/New_York (DST) resolves TOMORROW to a different calendar date than a naive UTC read would, correctly',
  (() => {
    // 2026-09-10 23:30 in New York (EDT, UTC-4) == 2026-09-11 03:30 UTC.
    const now = new Date('2026-09-11T03:30:00.000Z');
    const result = resolveForwardPlannerRange('TOMORROW', now, TZ_NEW_YORK);
    // Local date in NY at this instant is still Sep 10 -> tomorrow is Sep 11.
    return result.ok && result.range.startLocalDate === '2026-09-11';
  })()
);

// ============================================================
// TARGET EVALUATION TIME -- merge-critical.
// ============================================================

check(
  'NOON POLICY: buildTargetEvaluationTime resolves to exactly 12:00 local time on the given date, Asia/Kolkata (no DST, fixed +05:30)',
  (() => {
    const instant = buildTargetEvaluationTime('2026-09-12', TZ_KOLKATA);
    // 12:00 IST == 06:30 UTC.
    return instant.toISOString() === '2026-09-12T06:30:00.000Z';
  })()
);

check(
  'NOON POLICY + DST: buildTargetEvaluationTime resolves to a DIFFERENT UTC offset in America/New_York depending on the season (EDT vs EST), never a fixed offset',
  (() => {
    const julyNoon = buildTargetEvaluationTime('2026-07-15', TZ_NEW_YORK); // EDT, UTC-4
    const januaryNoon = buildTargetEvaluationTime('2026-01-15', TZ_NEW_YORK); // EST, UTC-5
    return julyNoon.toISOString() === '2026-07-15T16:00:00.000Z' && januaryNoon.toISOString() === '2026-01-15T17:00:00.000Z';
  })()
);

check(
  'FUTURE-EVALUATION SEPARATION (merge-critical): two different candidate local dates produce two DIFFERENT target evaluation instants -- the future personalization pipeline is never fed the same instant (e.g. requestNow) for every date',
  (() => {
    const day1 = buildTargetEvaluationTime('2026-09-12', TZ_KOLKATA);
    const day2 = buildTargetEvaluationTime('2026-09-13', TZ_KOLKATA);
    return day1.getTime() !== day2.getTime();
  })()
);

check(
  'TARGET TIME NEVER EQUALS AN ARBITRARY REQUEST-NOW: a request made at some specific instant does not leak into the target evaluation time for a date that is not today',
  (() => {
    const requestNow = new Date('2026-09-11T09:47:23.123Z'); // an arbitrary, oddly-specific "now"
    const target = buildTargetEvaluationTime('2026-09-15', TZ_KOLKATA);
    return target.getTime() !== requestNow.getTime();
  })()
);

// ============================================================
// ONE-CANDIDATE-PER-LOCAL-DATE DEDUP.
// ============================================================

check(
  'DEDUP: keeps only the FIRST (best-scoring, since input is already score-sorted) candidate per local date',
  (() => {
    const candidates = [
      buildCandidate({ start: '2026-09-12T04:00:00.000Z', end: '2026-09-12T05:00:00.000Z', score: 9.0 }), // Sep 12, best
      buildCandidate({ start: '2026-09-12T10:00:00.000Z', end: '2026-09-12T11:00:00.000Z', score: 7.0 }), // Sep 12, second-best -- dropped
      buildCandidate({ start: '2026-09-13T04:00:00.000Z', end: '2026-09-13T05:00:00.000Z', score: 8.0 }), // Sep 13
    ];
    const result = selectOneCandidatePerLocalDate(candidates, TZ_KOLKATA);
    return result.length === 2 && result[0].score === 9.0 && result[1].score === 8.0;
  })()
);

check(
  'DEDUP: never mutates the input array',
  (() => {
    const candidates = [buildCandidate()];
    const clone = JSON.parse(JSON.stringify(candidates));
    selectOneCandidatePerLocalDate(candidates, TZ_KOLKATA);
    return JSON.stringify(candidates) === JSON.stringify(clone);
  })()
);

check('DEDUP: empty input -> empty output, never crashes', selectOneCandidatePerLocalDate([], TZ_KOLKATA).length === 0);

// ============================================================
// CAUTION FLOOR.
// ============================================================

check('FLOOR: USABLE passes', isAboveForwardPlannerFloor('USABLE') === true);
check('FLOOR: GOOD passes', isAboveForwardPlannerFloor('GOOD') === true);
check('FLOOR: EXCELLENT passes', isAboveForwardPlannerFloor('EXCELLENT') === true);
check('FLOOR: CAUTION never passes (merge-critical -- runTimingSearch(FIND) does not already exclude this on its own)', isAboveForwardPlannerFloor('CAUTION') === false);

// ============================================================
// PLAN-CONFLICT FILTERING.
// ============================================================

check(
  'CONFLICT: full overlap excludes the candidate',
  (() => {
    const candidate = buildCandidate({ start: '2026-09-12T04:00:00.000Z', end: '2026-09-12T05:00:00.000Z' });
    const blocking: ForwardPlannerBlockingInterval[] = [{ start: new Date('2026-09-12T04:15:00.000Z'), end: new Date('2026-09-12T04:45:00.000Z') }];
    return filterConflictingCandidates([candidate], blocking).length === 0;
  })()
);

check(
  'CONFLICT: partial overlap excludes the candidate',
  (() => {
    const candidate = buildCandidate({ start: '2026-09-12T04:00:00.000Z', end: '2026-09-12T05:00:00.000Z' });
    const blocking: ForwardPlannerBlockingInterval[] = [{ start: new Date('2026-09-12T04:30:00.000Z'), end: new Date('2026-09-12T06:00:00.000Z') }];
    return filterConflictingCandidates([candidate], blocking).length === 0;
  })()
);

check(
  'CONFLICT: adjacent intervals (candidate ends exactly when Plan starts) are NOT a conflict',
  (() => {
    const candidate = buildCandidate({ start: '2026-09-12T04:00:00.000Z', end: '2026-09-12T05:00:00.000Z' });
    const blocking: ForwardPlannerBlockingInterval[] = [{ start: new Date('2026-09-12T05:00:00.000Z'), end: new Date('2026-09-12T06:00:00.000Z') }];
    return filterConflictingCandidates([candidate], blocking).length === 1;
  })()
);

check(
  'CONFLICT: adjacent intervals the other direction (Plan ends exactly when candidate starts) are NOT a conflict',
  (() => {
    const candidate = buildCandidate({ start: '2026-09-12T04:00:00.000Z', end: '2026-09-12T05:00:00.000Z' });
    const blocking: ForwardPlannerBlockingInterval[] = [{ start: new Date('2026-09-12T03:00:00.000Z'), end: new Date('2026-09-12T04:00:00.000Z') }];
    return filterConflictingCandidates([candidate], blocking).length === 1;
  })()
);

check(
  'CONFLICT: non-overlapping, non-adjacent interval is not a conflict',
  (() => {
    const candidate = buildCandidate({ start: '2026-09-12T04:00:00.000Z', end: '2026-09-12T05:00:00.000Z' });
    const blocking: ForwardPlannerBlockingInterval[] = [{ start: new Date('2026-09-12T10:00:00.000Z'), end: new Date('2026-09-12T11:00:00.000Z') }];
    return filterConflictingCandidates([candidate], blocking).length === 1;
  })()
);

check(
  'CONFLICT: no blocking intervals at all -- nothing excluded',
  filterConflictingCandidates([buildCandidate(), buildCandidate({ start: '2026-09-13T04:00:00.000Z', end: '2026-09-13T05:00:00.000Z' })], []).length === 2
);

// ============================================================
// CROSS-DAY RANKING.
// ============================================================

function buildRankInput(overrides: Partial<ForwardPlannerRankInput> = {}): ForwardPlannerRankInput {
  return {
    localDate: '2026-09-12',
    start: '2026-09-12T04:00:00.000Z',
    end: '2026-09-12T05:00:00.000Z',
    personalRelevance: 'RELEVANT',
    relevantThemes: [],
    timingLabel: 'GOOD',
    timingScore: 7.5,
    ...overrides,
  };
}

check(
  'RANK: HIGHLY_RELEVANT beats RELEVANT beats BASELINE, before timing is ever compared',
  (() => {
    const items = [
      buildRankInput({ personalRelevance: 'BASELINE', timingLabel: 'EXCELLENT', timingScore: 9.5 }),
      buildRankInput({ personalRelevance: 'RELEVANT', timingLabel: 'USABLE', timingScore: 5.6 }),
      buildRankInput({ personalRelevance: 'HIGHLY_RELEVANT', timingLabel: 'USABLE', timingScore: 5.6 }),
    ];
    const ranked = rankForwardPlannerCandidates(items);
    return ranked[0].personalRelevance === 'HIGHLY_RELEVANT' && ranked[1].personalRelevance === 'RELEVANT' && ranked[2].personalRelevance === 'BASELINE';
  })()
);

check(
  'RANK: within the same relevance tier, EXCELLENT beats VERY_GOOD beats GOOD beats USABLE',
  (() => {
    const items = [
      buildRankInput({ personalRelevance: 'RELEVANT', timingLabel: 'USABLE' }),
      buildRankInput({ personalRelevance: 'RELEVANT', timingLabel: 'EXCELLENT' }),
      buildRankInput({ personalRelevance: 'RELEVANT', timingLabel: 'GOOD' }),
      buildRankInput({ personalRelevance: 'RELEVANT', timingLabel: 'VERY_GOOD' }),
    ];
    const ranked = rankForwardPlannerCandidates(items);
    return ranked.map((item) => item.timingLabel).join(',') === 'EXCELLENT,VERY_GOOD,GOOD,USABLE';
  })()
);

check(
  'RANK: within same relevance+label tier, higher timing score wins',
  (() => {
    const items = [
      buildRankInput({ timingScore: 7.0, start: '2026-09-12T04:00:00.000Z' }),
      buildRankInput({ timingScore: 7.9, start: '2026-09-13T04:00:00.000Z' }),
    ];
    const ranked = rankForwardPlannerCandidates(items);
    return ranked[0].timingScore === 7.9;
  })()
);

check(
  'RANK: exact tie on relevance+label+score -- earlier start wins',
  (() => {
    const items = [
      buildRankInput({ start: '2026-09-15T04:00:00.000Z' }),
      buildRankInput({ start: '2026-09-12T04:00:00.000Z' }),
    ];
    const ranked = rankForwardPlannerCandidates(items);
    return ranked[0].start === '2026-09-12T04:00:00.000Z';
  })()
);

check(
  'RANK: never mutates the input array',
  (() => {
    const items = [buildRankInput()];
    const clone = JSON.parse(JSON.stringify(items));
    rankForwardPlannerCandidates(items);
    return JSON.stringify(items) === JSON.stringify(clone);
  })()
);

check(
  `TOP-N: more than ${MAX_FORWARD_PLANNER_RESULTS} eligible days -- caller slices to exactly ${MAX_FORWARD_PLANNER_RESULTS}`,
  (() => {
    const items = Array.from({ length: 5 }, (_, i) => buildRankInput({ start: `2026-09-1${2 + i}T04:00:00.000Z`, localDate: `2026-09-1${2 + i}` }));
    const ranked = rankForwardPlannerCandidates(items).slice(0, MAX_FORWARD_PLANNER_RESULTS);
    return ranked.length === MAX_FORWARD_PLANNER_RESULTS;
  })()
);

check(
  'NO PADDING: 2 eligible days ranked -- slicing to top-N never fabricates a third',
  (() => {
    const items = [buildRankInput({ localDate: '2026-09-12' }), buildRankInput({ localDate: '2026-09-13' })];
    const ranked = rankForwardPlannerCandidates(items).slice(0, MAX_FORWARD_PLANNER_RESULTS);
    return ranked.length === 2;
  })()
);

check('ZERO RESULT: ranking an empty input returns empty, never crashes', rankForwardPlannerCandidates([]).length === 0);

// ============================================================
// STATIC GUARDS -- merge-critical.
// ============================================================

function readForwardPlannerSource(stripped = true): string {
  const text = fs.readFileSync('apps/web/lib/forwardPlanner.ts', 'utf8');
  return stripped ? stripComments(text) : text;
}

check(
  'NO NUMERIC COMPOSITE: forwardPlanner.ts never computes a weighted blend of personal relevance and timing score (no "* " multiplication of a rank/score by another score anywhere in the ranking function)',
  !/personalRelevance\s*\*|timingScore\s*\*.*\+|\+.*timingScore\s*\*/.test(readForwardPlannerSource())
);

check('NO RAW ASTROLOGY TERM IN SOURCE: forwardPlanner.ts never mentions Dasha/Nakshatra/Rahu/Ketu/Abhijit/Gulika outside doc comments', !/Mahadasha|Antardasha|Nakshatra|\bRahu\b|\bKetu\b|Abhijit|Gulika/.test(readForwardPlannerSource()));

check(
  'NO ENGINE IMPORT: forwardPlanner.ts imports only types and the timezone helper module -- no runtime import of any ranking/scoring/timing engine, and never CALLS one (checked against comment-stripped source, so a doc comment mentioning a function name by way of explanation does not trip this guard)',
  (() => {
    const codeWithComments = readForwardPlannerSource(false);
    const importLines = codeWithComments.match(/^import[^;]*;/gm) ?? [];
    const importsOk = importLines.every((line) => /^import type /.test(line) || /from '\.\/timezone'/.test(line));
    const strippedCode = readForwardPlannerSource(true);
    const noEngineCalls = !/runTimingSearch\(|evaluateActivityFit\(|deriveWindowRanking\(|deriveDailyGuidance\(|deriveDailyPersonalFit\(|deriveLifeWeather\(/.test(strippedCode);
    return importsOk && noEngineCalls;
  })()
);

if (!allPassed) {
  console.error('\nSome Forward Planner (pure logic) checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL FORWARD PLANNER (PURE LOGIC) CHECKS PASSED');
}
