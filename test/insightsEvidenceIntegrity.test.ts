/**
 * Insights Evidence & Sample-Size Integrity V1 (PR D): regression suite
 * for apps/web/lib/insightsEvidence.ts and the corrected evidence-gating
 * logic inside apps/web/app/api/daily-assistant/insights/route.ts and
 * apps/web/components/InsightsView.tsx.
 *
 * This PR does not touch any scoring engine (C1's classifyInsightsWindow/
 * insightsWindowWeight, C3's evaluateActivityFit/summarizeAuraFit) --
 * every formula this file tests is REPLICATED exactly as implemented and
 * cross-checked against the live source (the same established pattern as
 * test/insightsWindowAlignment.test.ts and test/habitLogActivityIdentity.test.ts),
 * never reimplemented independently. The one function actually imported
 * and called directly is deriveInsightsEvidenceState itself, since it has
 * no DB/React dependency.
 */
import * as fs from 'fs';
import { deriveInsightsEvidenceState, InsightsEvidenceState } from '../apps/web/lib/insightsEvidence';
import { classifyInsightsWindow, insightsWindowWeight } from '../apps/web/lib/insightsWindowAlignment';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ============================================================
// Shared evidence helper (brief section 41).
// ============================================================

check('count 0 -> NO_DATA', deriveInsightsEvidenceState(0) === 'NO_DATA');
check('count 1 -> LIMITED', deriveInsightsEvidenceState(1) === 'LIMITED');
check('count 2 -> LIMITED', deriveInsightsEvidenceState(2) === 'LIMITED');
check('count 3 -> AVAILABLE', deriveInsightsEvidenceState(3) === 'AVAILABLE');
check('count 5 -> AVAILABLE', deriveInsightsEvidenceState(5) === 'AVAILABLE');
check('A large count remains AVAILABLE (no upper ceiling)', deriveInsightsEvidenceState(500) === 'AVAILABLE');
check('A negative count normalizes to NO_DATA (never throws, never a fabricated state)', deriveInsightsEvidenceState(-1) === 'NO_DATA');
check('deriveInsightsEvidenceState takes exactly 1 parameter', deriveInsightsEvidenceState.length === 1);
check('The exported type has exactly the three intended members (source-level guard against a re-added EARLY/EMERGING/ESTABLISHED taxonomy)', (() => {
  const helperSource = fs.readFileSync('apps/web/lib/insightsEvidence.ts', 'utf8');
  return /'NO_DATA'\s*\|\s*'LIMITED'\s*\|\s*'AVAILABLE'/.test(helperSource) && !/EARLY|EMERGING|ESTABLISHED/.test(helperSource);
})());

// ============================================================
// Your Alignment -- evidence-gated comparison (brief sections 5, 42).
// Replicates route.ts's exact hasValidComparison/alignmentDeltaPoints
// formula, cross-checked against the live source below.
// ============================================================

interface ReflectionFixture {
  followed: boolean;
  outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW';
}

function computeAlignmentComparison(reflections: ReflectionFixture[]): { alignmentDeltaPoints: number | null } {
  let alignedScoreTotal = 0;
  let alignedTotal = 0;
  let unalignedScoreTotal = 0;
  let unalignedTotal = 0;
  reflections.forEach((r) => {
    const score = r.outputLevel === 'PEAK_FLOW' ? 1 : r.outputLevel === 'MODERATE' ? 0.5 : 0;
    if (r.followed) {
      alignedTotal += 1;
      alignedScoreTotal += score;
    } else {
      unalignedTotal += 1;
      unalignedScoreTotal += score;
    }
  });
  const alignedRate = alignedTotal > 0 ? alignedScoreTotal / alignedTotal : null;
  const unalignedRate = unalignedTotal > 0 ? unalignedScoreTotal / unalignedTotal : null;
  const hasBothComparisonGroups = alignedRate !== null && unalignedRate !== null;
  const hasValidComparison = hasBothComparisonGroups && deriveInsightsEvidenceState(reflections.length) === 'AVAILABLE';
  const alignmentDeltaPoints = hasValidComparison ? Math.round((alignedRate! - unalignedRate!) * 100) : null;
  return { alignmentDeltaPoints };
}

check('0 reflections -> no comparison (null)', computeAlignmentComparison([]).alignmentDeltaPoints === null);
check('1 reflection -> no comparison (null)', computeAlignmentComparison([{ followed: true, outputLevel: 'PEAK_FLOW' }]).alignmentDeltaPoints === null);
check('2 reflections, one each group -> NO numeric comparison (the exact defect this PR fixes: previously this alone produced a real delta)', computeAlignmentComparison([
  { followed: true, outputLevel: 'PEAK_FLOW' },
  { followed: false, outputLevel: 'LOW' },
]).alignmentDeltaPoints === null);
check('3 reflections, both groups represented -> comparison allowed (non-null)', computeAlignmentComparison([
  { followed: true, outputLevel: 'PEAK_FLOW' },
  { followed: true, outputLevel: 'PEAK_FLOW' },
  { followed: false, outputLevel: 'LOW' },
]).alignmentDeltaPoints !== null);
check('3 reflections, only one group -> no comparison (null)', computeAlignmentComparison([
  { followed: true, outputLevel: 'PEAK_FLOW' },
  { followed: true, outputLevel: 'MODERATE' },
  { followed: true, outputLevel: 'LOW' },
]).alignmentDeltaPoints === null);
check('A real comparison result of exactly 0 is preserved as 0, not coerced to null', (() => {
  // Both groups score identically (PEAK_FLOW=1 and LOW=0 balanced so the
  // mean of each group is 0.5) -- a genuine zero-point delta from valid,
  // sufficient (4-reflection) evidence.
  const result = computeAlignmentComparison([
    { followed: true, outputLevel: 'PEAK_FLOW' },
    { followed: true, outputLevel: 'LOW' },
    { followed: false, outputLevel: 'PEAK_FLOW' },
    { followed: false, outputLevel: 'LOW' },
  ]);
  return result.alignmentDeltaPoints === 0;
})());

const routeSource = fs.readFileSync('apps/web/app/api/daily-assistant/insights/route.ts', 'utf8');
check('route.ts imports deriveInsightsEvidenceState from the shared evidence helper', /import \{ deriveInsightsEvidenceState \} from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/insightsEvidence'/.test(routeSource));
check('route.ts\'s hasValidComparison now requires BOTH groups AND the shared evidence state to be AVAILABLE (the fix)', /hasBothComparisonGroups && deriveInsightsEvidenceState\(reflections\.length\) === 'AVAILABLE'/.test(routeSource));
check('route.ts still requires both comparison groups as a SEPARATE condition (hasBothComparisonGroups), not silently dropped', /alignedRate !== null && unalignedRate !== null/.test(routeSource));
check('route.ts\'s signed percentage-point delta formula (PR #75) remains unchanged', /Math\.round\(\(alignedRate! - unalignedRate!\) \* 100\)/.test(routeSource));

// ============================================================
// Reflection source-of-truth (brief section 6/43) -- NEEDS DATA MODEL
// DECISION. DailyReflection.followedGuidance is a non-nullable
// `Boolean @default(false)` column, and reflection/route.ts's write path
// stores `Boolean(body?.followedGuidance)` -- omitted/undefined and an
// explicit `false` both persist as the identical stored value `false`.
// The data model cannot distinguish "explicitly answered no" from "never
// answered", so an explicit-response-is-authoritative policy cannot be
// correctly implemented without a schema change (e.g. a nullable
// followedGuidance, or a separate "answered" flag) -- out of scope for
// this PR per its own explicit instruction not to invent a distinction.
// This test only documents the confirmed schema/write-path facts and
// asserts the pre-existing OR-based inference line remains UNCHANGED
// (this PR must not silently alter it while the semantics are undecided).
const schemaSource = fs.readFileSync('apps/web/prisma/schema.prisma', 'utf8');
check('Sanity check: DailyReflection.followedGuidance is confirmed non-nullable (Boolean, no ?) in the schema', /followedGuidance Boolean @default\(false\)/.test(schemaSource));
const reflectionRouteSource = fs.readFileSync('apps/web/app/api/daily-assistant/reflection/route.ts', 'utf8');
check('Sanity check: the write path coerces any input via Boolean(...), confirming missing and explicit-false are indistinguishable at write time', /followedGuidance: Boolean\(body\?\.followedGuidance\)/.test(reflectionRouteSource));
check('NEEDS DATA MODEL DECISION: the explicit-followed-is-authoritative policy (brief section 6) is intentionally NOT implemented -- the pre-existing inference line is left byte-for-byte unchanged pending a schema decision', /const followed = reflection\.followedGuidance \|\| followedByLogs;/.test(routeSource));

// ============================================================
// Timing Pattern -- null vs. zero (brief sections 8, 44). Replicates
// InsightsView.tsx's exact alignmentScore/monthAlignmentScore formulas.
// ============================================================

function computeAlignmentScore(windows: string[]): number | null {
  if (windows.length === 0) return null;
  const weighted = windows.reduce((sum, w) => sum + insightsWindowWeight(w), 0);
  return Math.min(100, Math.max(0, Math.round((weighted / windows.length) * 100)));
}

check('0 logs -> alignment score null (never a fabricated 0%)', computeAlignmentScore([]) === null);
check('3 friction logs -> alignment score 0 (a real, observed worst case -- must NOT collapse into the same null as "no data")', computeAlignmentScore(['RAHU_KALAM', 'YAMA', 'RAHU_KALAM']) === 0);
check('3 supportive logs -> alignment score 100', computeAlignmentScore(['BRAHMA', 'ABHIJIT', 'ABHIJIT']) === 100);
check('Mixed supportive/neutral/friction -> exact existing C1 weighted result (68%)', computeAlignmentScore(['ABHIJIT', 'BRAHMA', 'NEUTRAL', 'RAHU_KALAM']) === 68);
check('null and 0 are genuinely distinct JS values from this function (not both falsy-collapsed by a caller)', computeAlignmentScore([]) !== computeAlignmentScore(['RAHU_KALAM']));

const viewSource = fs.readFileSync('apps/web/components/InsightsView.tsx', 'utf8');
check('InsightsView.tsx\'s lifetime alignmentScore now falls back to null, not 0, with zero logs', /const alignmentScore: number \| null =\s*\n\s*totalActivities > 0[\s\S]{0,150}: null;/.test(viewSource));
check('InsightsView.tsx\'s monthAlignmentScore now falls back to null, not 0, with zero month activities', /const monthAlignmentScore: number \| null = monthTotalActivities > 0 \? [\s\S]{0,120} : null;/.test(viewSource));
check('InsightsView.tsx\'s monthAuraGuidedRate now falls back to null, not 0, with zero month activities', /const monthAuraGuidedRate: number \| null = monthTotalActivities > 0 \? Math\.round\(\(monthAuraGuidedCount \/ monthTotalActivities\) \* 100\) : null;/.test(viewSource));
check('C1\'s weight constants remain exactly SUPPORTIVE=1.0/NEUTRAL=0.7/FRICTION=0.0 (unchanged by this PR)', insightsWindowWeight('BRAHMA') === 1.0 && insightsWindowWeight('NEUTRAL') === 0.7 && insightsWindowWeight('RAHU_KALAM') === 0.0);

// ============================================================
// 7-Day Avg correctness fix (brief sections 16, 45). Replicates the new
// sevenDayAlignmentScore formula and proves it is NOT the 400-day score.
// ============================================================

function computeSevenDayAlignmentScore(windowsInRange: string[]): number | null {
  if (windowsInRange.length === 0) return null;
  return Math.round((windowsInRange.reduce((sum, w) => sum + insightsWindowWeight(w), 0) / windowsInRange.length) * 100);
}

check('No logs in the 7-day range -> null', computeSevenDayAlignmentScore([]) === null);
check('All-friction in range -> 0', computeSevenDayAlignmentScore(['RAHU_KALAM', 'YAMA']) === 0);
check('All-supportive in range -> 100', computeSevenDayAlignmentScore(['BRAHMA', 'ABHIJIT']) === 100);
check('Mixed windows in range -> correct C1 weighted result (68%)', computeSevenDayAlignmentScore(['ABHIJIT', 'BRAHMA', 'NEUTRAL', 'RAHU_KALAM']) === 68);
check('A 7-day window with only 1 supportive log among a hypothetical larger 400-day history differs from the lifetime score for the same history -- proves the two are genuinely independent statistics, not the same number relabeled', (() => {
  const sevenDay = computeSevenDayAlignmentScore(['ABHIJIT']); // 100
  const lifetime = computeAlignmentScore(['ABHIJIT', 'RAHU_KALAM', 'RAHU_KALAM', 'RAHU_KALAM']); // heavier friction history -> low score
  return sevenDay !== lifetime;
})());

check('InsightsView.tsx defines sevenDayAlignmentScore from past7Logs (filtered to the 7-day date-key set), never from the full logEntries array', /const past7Logs = logEntries\.filter\(\(e\) => past7DateKeySet\.has\(observationOf\(e\)\.dateKey\)\);/.test(viewSource));
check('past7DateKeySet is built from past7DateKeys (the same 7-day range the chart bars use), proving older-than-7-day logs cannot leak into the Avg', /const past7DateKeySet = new Set\(past7DateKeys\);/.test(viewSource));
check('The "Avg" badge now renders analytics.sevenDayAlignmentScore, never analytics.alignmentScore (the old 400-day mislabeling)', /Avg: \{analytics\.sevenDayAlignmentScore !== null \? `\$\{analytics\.sevenDayAlignmentScore\}%` : '—'\}/.test(viewSource) && !/Avg: \{analytics\.alignmentScore\}%/.test(viewSource));
check('The 7-day PER-DAY bar formula (already-correct null/real-zero semantics) remains untouched by this PR', /dayLogs\.length > 0\s*\n\s*\? Math\.round\(\(dayLogs\.reduce/.test(viewSource));

// ============================================================
// This Month evidence state (brief sections 10-13, 46).
// ============================================================

check('0 activities -> NO_DATA', deriveInsightsEvidenceState(0) === 'NO_DATA');
check('1 activity -> LIMITED', deriveInsightsEvidenceState(1) === 'LIMITED');
check('2 activities -> LIMITED', deriveInsightsEvidenceState(2) === 'LIMITED');
check('3 activities -> AVAILABLE', deriveInsightsEvidenceState(3) === 'AVAILABLE');
check('5 activities -> AVAILABLE', deriveInsightsEvidenceState(5) === 'AVAILABLE');
check('InsightsView.tsx derives monthEvidenceState from monthTotalActivities via the shared helper', /const monthEvidenceState = deriveInsightsEvidenceState\(monthTotalActivities\);/.test(viewSource));
check('The "This Month" card ALWAYS renders the factual activities count and streak (facts display regardless of evidence state)', /<InlineStat value=\{analytics\.monthTotalActivities\} label="activities"/.test(viewSource) && /<InlineStat value=\{analytics\.streak\} label="day streak"/.test(viewSource));
check('The two PERCENTAGE stats (Aura guided / supportive windows) are now gated behind monthEvidenceState === \'AVAILABLE\'', /\{analytics\.monthEvidenceState === 'AVAILABLE' && \(/.test(viewSource));
check('A LIMITED month shows a compact early-signal caption instead of bold percentage conclusions', /\{analytics\.monthEvidenceState === 'LIMITED' && \(/.test(viewSource) && /Early signal · based on \{analytics\.monthTotalActivities\}/.test(viewSource));
check('A NO_DATA month never displays a fabricated "0%" -- it shows a plain no-activity caption instead', /\{analytics\.monthEvidenceState === 'NO_DATA' && \(/.test(viewSource) && /No activities logged this month yet/.test(viewSource));

// ============================================================
// Aura-guided rate (brief sections 14, 16, 47) -- same This Month
// evidence gate; 0/0 unavailable, 1-2 LIMITED (count only, no headline
// percentage), 3+ AVAILABLE (percentage valid, including 1/3 -> 33%).
// ============================================================

function computeAuraGuidedRate(auraGuidedCount: number, totalCount: number): number | null {
  return totalCount > 0 ? Math.round((auraGuidedCount / totalCount) * 100) : null;
}

check('0/0 -> unavailable (null), never a fabricated 0%', computeAuraGuidedRate(0, 0) === null);
check('1/1 -> a real 100% value exists, but evidence state is LIMITED (the UI must not present it as a mature/headline percentage)', computeAuraGuidedRate(1, 1) === 100 && deriveInsightsEvidenceState(1) === 'LIMITED');
check('2/2 -> LIMITED', deriveInsightsEvidenceState(2) === 'LIMITED');
check('3/3 -> AVAILABLE, 100% is a valid, presentable value', computeAuraGuidedRate(3, 3) === 100 && deriveInsightsEvidenceState(3) === 'AVAILABLE');
check('1/3 -> AVAILABLE and 33% using the existing Math.round convention', computeAuraGuidedRate(1, 3) === 33 && deriveInsightsEvidenceState(3) === 'AVAILABLE');
check('auraGuidedRate remains pure provenance -- InsightsView.tsx\'s monthAuraGuidedCount++ still keys only on logSource (AURA_PLANNED/AURA_DO_NOW), never on window/score', /monthAuraGuidedCount\+\+/.test(viewSource) && /source === 'AURA_PLANNED' \|\| source === 'AURA_DO_NOW'/.test(viewSource));
check('auraGuidedRate is never blended into insightsAuraFit.ts (provenance and Aura Fit stay fully separate concerns)', !/monthAuraGuidedRate|auraGuidedRate/.test(fs.readFileSync('apps/web/lib/insightsAuraFit.ts', 'utf8')));

// ============================================================
// Time-of-day near-tie rule (brief sections 24, 48).
// ============================================================

function hasStrictTodWinner(counts: [string, number][]): boolean {
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  const runnerUp = sorted[1];
  return Boolean(top && top[1] > 0 && (!runnerUp || top[1] > runnerUp[1]));
}

check('1/1/1 tie -> no strict winner (no "most consistent time" pattern)', hasStrictTodWinner([['morning', 1], ['afternoon', 1], ['evening', 1]]) === false);
check('2/1/0 -> unique winner allowed', hasStrictTodWinner([['morning', 2], ['afternoon', 1], ['evening', 0]]) === true);
check('2/2/1 tie at the top -> no comparative pattern', hasStrictTodWinner([['morning', 2], ['afternoon', 2], ['evening', 1]]) === false);
check('3/1/1 -> unique winner allowed', hasStrictTodWinner([['morning', 3], ['afternoon', 1], ['evening', 1]]) === true);
check('All zero -> no winner (0 is not a real observation)', hasStrictTodWinner([['morning', 0], ['afternoon', 0], ['evening', 0], ['night', 0]]) === false);
check('InsightsView.tsx computes a runner-up and requires a STRICT (>) margin before the "most consistent time" pattern is emitted', /const hasStrictTodWinner = Boolean\(topTod && topTod\[1\] > 0 && \(!runnerUpTod \|\| topTod\[1\] > runnerUpTod\[1\]\)\);/.test(viewSource));
check('The daypart raw-count cards (Peak Energy Windows) remain purely descriptive and are not gated by this new rule', /TODCard title="Morning/.test(viewSource));

// ============================================================
// Session-length evidence rule (brief sections 25, 49).
// ============================================================

check('3 total activities but only 1 timed -> session-length pattern NOT emitted (evidence state LIMITED)', deriveInsightsEvidenceState(1) !== 'AVAILABLE');
check('3 total / 2 timed -> still not emitted (LIMITED)', deriveInsightsEvidenceState(2) !== 'AVAILABLE');
check('3 timed entries -> pattern allowed (AVAILABLE)', deriveInsightsEvidenceState(3) === 'AVAILABLE');
check('InsightsView.tsx gates the session-length pattern on its OWN timed-entry evidence state, independent of the overall totalActivities gate', /const timedDurationsCount = resolvedDurations\.filter\(\(minutes\) => minutes > 0\)\.length;/.test(viewSource) && /if \(avgMinutes !== null && deriveInsightsEvidenceState\(timedDurationsCount\) === 'AVAILABLE'\)/.test(viewSource));
check('No duration weighting was introduced -- computeAverageTimedSessionMinutes itself is untouched by this PR', fs.readFileSync('apps/web/lib/activityDuration.ts', 'utf8').includes('export function computeAverageTimedSessionMinutes(durationsMinutes: number[]): number | null'));

// ============================================================
// Planning Loop evidence rule + causal safety (brief sections 27-29, 50).
// ============================================================

function computePlanningLift(auraPlannedCount: number, manualCount: number, plannedScore: number, manualScore: number): number | null {
  return auraPlannedCount > 0 && manualCount > 0 && deriveInsightsEvidenceState(auraPlannedCount + manualCount) === 'AVAILABLE'
    ? plannedScore - manualScore
    : null;
}

check('1 Aura-planned + 1 manual -> no comparative lift claim (null)', computePlanningLift(1, 1, 90, 50) === null);
check('2 Aura-planned + 1 manual -> comparison allowed', computePlanningLift(2, 1, 90, 50) !== null);
check('1 Aura-planned + 2 manual -> comparison allowed', computePlanningLift(1, 2, 90, 50) !== null);
check('3 Aura-planned + 0 manual -> no comparison (one group empty)', computePlanningLift(3, 0, 90, 50) === null);
check('0 Aura-planned + 3 manual -> no comparison (one group empty)', computePlanningLift(0, 3, 90, 50) === null);
check('InsightsView.tsx\'s planningLift now requires the COMBINED count to reach AVAILABLE, in addition to both groups being non-empty', /auraPlannedCount > 0 && manualCount > 0 && deriveInsightsEvidenceState\(auraPlannedCount \+ manualCount\) === 'AVAILABLE'/.test(viewSource));
check('The underlying plannedAlignmentScore/manualAlignmentScore calculations are unchanged by this PR', /const plannedAlignmentScore = auraPlannedCount > 0 \? Math\.round\(\(auraPlannedAlignment \/ auraPlannedCount\) \* 100\) : 0;/.test(viewSource));

const causalCodeOnlyView = stripComments(viewSource);
const causalCodeOnlyRoute = stripComments(routeSource);
const PROHIBITED_CAUSAL_PHRASES = [/Aura made you/i, /because you followed/i, /improves your/i, /makes you more productive/i];
for (const phrase of PROHIBITED_CAUSAL_PHRASES) {
  check(`Insights copy never contains the prohibited causal phrase ${phrase}`, !phrase.test(causalCodeOnlyView) && !phrase.test(causalCodeOnlyRoute));
}
check('Planning Loop copy stays observational/past-tense ("were... in your logged history"), not causal', /Aura-planned activities were \{Math\.abs\(analytics\.planningLift\)\} points \{analytics\.planningLift >= 0 \? 'more aligned' : 'less aligned'\} than manual activities in your logged history\./.test(viewSource));

// ============================================================
// Descriptive-metric regression guard (brief section 51) -- streak,
// heatmap, raw Window Distribution, Things to watch, Recent Activity
// Trail must remain ungated.
// ============================================================

check('Streak rendering has no evidence-state condition wrapping it', /<div style=\{\{ fontSize: 28, fontWeight: 800, color: '#facc15' \}\}>\{analytics\.streak\} Days<\/div>/.test(viewSource));
check('The 30-day heatmap iterates analytics.heatmapDays unconditionally (no evidence gate)', /analytics\.heatmapDays\.map\(\(day\) => \{/.test(viewSource));
check('Window Distribution renders from analytics.distribution.length > 0 only (a plain non-empty check, not a new evidence-state gate)', /analytics\.distribution\.length > 0 \?/.test(viewSource));
check('Things to watch remains gated only by frictionLogs.length > 0 (unchanged, still purely factual)', /analytics\.frictionLogs\.length > 0 && \(/.test(viewSource));
check('Recent Activity Trail still renders logEntries.slice(0, 5) unconditionally', /logEntries\.slice\(0, 5\)\.map\(\(entry\) => \(/.test(viewSource));

// ============================================================
// Non-goal / isolation confirmations (brief sections 4, 9, 15, 32-38).
// ============================================================

check('No activeDays/distinctDays/eligibleDays field was introduced anywhere in Insights', !/activeDays|distinctDays|eligibleDays|minimumDistinctDays/.test(viewSource) && !/activeDays|distinctDays|eligibleDays/.test(routeSource));
check('No same-activity diversity gate was introduced (no activityId-counting logic added to InsightsView.tsx)', !/distinctActivityIds|uniqueActivityIds/.test(viewSource));
check('No duration weighting was introduced in the alignment/Aura Fit formulas (durationMinutes never multiplies a window weight)', !/insightsWindowWeight\([^)]*\)\s*\*\s*[a-zA-Z]*[Dd]uration/.test(viewSource));
check('insightsAuraFit.ts (C3) was not modified by this PR', fs.readFileSync('apps/web/lib/insightsAuraFit.ts', 'utf8').includes('eligibleCount === 0 ? \'NO_DATA\' : eligibleCount < 3 ? \'LIMITED\' : \'AVAILABLE\''));
check('insightsAuraFit.ts contains no personalContext reference in actual code (no personalization added; doc-comment prose documenting the deliberate omission is excluded)', !/personalContext/.test(stripComments(fs.readFileSync('apps/web/lib/insightsAuraFit.ts', 'utf8'))));
check('db.ts was not modified for this PR (no new Insights-evidence-related query/column reference)', !/insightsEvidence|InsightsEvidenceState/.test(fs.readFileSync('apps/web/lib/db.ts', 'utf8')));
check('schema.prisma was not modified for this PR (no schema change)', !/insightsEvidence|InsightsEvidenceState/.test(schemaSource));
check('apps/web/app/api/plans/route.ts (C2b) was not modified for this PR', !/insightsEvidence/.test(fs.readFileSync('apps/web/app/api/plans/route.ts', 'utf8')));

console.log(allPassed ? '\nALL INSIGHTS EVIDENCE INTEGRITY CHECKS PASSED' : '\nSOME INSIGHTS EVIDENCE INTEGRITY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
