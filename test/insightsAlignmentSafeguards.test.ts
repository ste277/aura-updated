/**
 * AURA-INS-01 (PV-F04) -- alignment insight safeguards.
 *   A. computeAlignmentComparison (lib/insightsAlignment.ts), imported
 *      directly: eligibility boundaries, edge cases, rounding, wording.
 *   B. Source checks: the route uses the module; Home no longer shows the
 *      comparison; Insights shows sample sizes/method/caveat and no
 *      headline number; scoring and "followed" definition unchanged.
 */
import fs from 'fs';
import path from 'path';
import {
  ALIGNMENT_CAVEAT_TEXT,
  ALIGNMENT_INSUFFICIENT_TEXT,
  ALIGNMENT_MIN_DAYS_PER_GROUP,
  ALIGNMENT_MIN_TOTAL_DAYS,
  computeAlignmentComparison,
  roundAlignmentDifference,
  type AlignmentReflectionInput,
} from '../apps/web/lib/insightsAlignment';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** n days starting at 2026-01-01 (+offset), all with the same mood/followed. */
function days(n: number, outputLevel: string, followedGuidance: boolean, offset = 0): AlignmentReflectionInput[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + offset + i));
    return { dateKey: d.toISOString().slice(0, 10), outputLevel, followedGuidance };
  });
}
const NO_LOGS = new Map<string, { aligned: number; friction: number }>();
const run = (r: AlignmentReflectionInput[], logs = NO_LOGS) => computeAlignmentComparison(r, logs, 60);

// ---------------------------------------------------------------
// A1. Eligibility boundaries
// ---------------------------------------------------------------
check('T0. thresholds are 30 overall and 10 per group', ALIGNMENT_MIN_TOTAL_DAYS === 30 && ALIGNMENT_MIN_DAYS_PER_GROUP === 10);
const none = run([]);
check('E1. no observations -> INSUFFICIENT, neutral text, no number', none.status === 'INSUFFICIENT' && none.differencePoints === null && none.direction === null && none.summaryText === ALIGNMENT_INSUFFICIENT_TEXT && none.qualifyingDays === 0);
const total29 = run([...days(15, 'PEAK_FLOW', true), ...days(14, 'LOW', false, 100)]);
check('E2. 29 days (15/14) -> INSUFFICIENT', total29.status === 'INSUFFICIENT' && total29.qualifyingDays === 29);
const total30 = run([...days(15, 'PEAK_FLOW', true), ...days(15, 'LOW', false, 100)]);
check('E3. 30 days (15/15) -> AVAILABLE', total30.status === 'AVAILABLE' && total30.qualifyingDays === 30);
const group9 = run([...days(9, 'PEAK_FLOW', true), ...days(40, 'LOW', false, 100)]);
check('E4. 49 days but only 9 followed -> INSUFFICIENT (per-group minimum)', group9.status === 'INSUFFICIENT' && group9.followedDays === 9);
const group9other = run([...days(40, 'PEAK_FLOW', true), ...days(9, 'LOW', false, 100)]);
check('E5. 49 days but only 9 other -> INSUFFICIENT', group9other.status === 'INSUFFICIENT' && group9other.otherDays === 9);
const group10 = run([...days(10, 'PEAK_FLOW', true), ...days(20, 'LOW', false, 100)]);
check('E6. exactly 10 / 20 -> AVAILABLE', group10.status === 'AVAILABLE');
const oneSided = run(days(45, 'PEAK_FLOW', true));
check('E7. empty comparison group (45/0) -> INSUFFICIENT, never a one-sided number', oneSided.status === 'INSUFFICIENT' && oneSided.otherDays === 0 && oneSided.differencePoints === null);
// Same rule regardless of direction: mirror datasets just below threshold.
const posBelow = run([...days(9, 'PEAK_FLOW', true), ...days(30, 'LOW', false, 100)]);
const negBelow = run([...days(9, 'LOW', true), ...days(30, 'PEAK_FLOW', false, 100)]);
check('E8. a would-be positive and a would-be negative result are held back by the same rule', posBelow.status === 'INSUFFICIENT' && negBelow.status === 'INSUFFICIENT');

// ---------------------------------------------------------------
// A2. Results and wording
// ---------------------------------------------------------------
const positive = run([...days(15, 'PEAK_FLOW', true), ...days(15, 'MODERATE', false, 100)]);
check('R1. positive: 1.0 vs 0.5 -> about 50 points higher', positive.direction === 'HIGHER' && positive.differencePoints === 50 && /about 50 points higher than other days/.test(positive.summaryText));
const negative = run([...days(12, 'LOW', true), ...days(20, 'MODERATE', false, 100)]);
check('R2. negative: 0 vs 0.5 -> about 50 points lower (never clamped)', negative.direction === 'LOWER' && negative.differencePoints === -50 && /about 50 points lower than other days/.test(negative.summaryText));
const neutral = run([...days(15, 'MODERATE', true), ...days(15, 'MODERATE', false, 100)]);
check('R3. neutral: equal averages -> "about the same", difference 0', neutral.direction === 'SIMILAR' && neutral.differencePoints === 0 && /about the same/.test(neutral.summaryText));
// Small raw difference rounds to SIMILAR: 10 followed with one Balanced among Lows vs 20 Low.
const tiny = run([...days(1, 'MODERATE', true), ...days(9, 'LOW', true, 1), ...days(20, 'LOW', false, 100)]);
check('R4. a 5-point raw difference rounds to 5; a smaller one would read "about the same"', tiny.differencePoints === 5 && roundAlignmentDifference(2.4) === 0 && roundAlignmentDifference(-2.4) === 0 && roundAlignmentDifference(-2.6) === -5);
check('R5. no "-0" from rounding', Object.is(roundAlignmentDifference(-1), 0));
const unequal = run([...days(10, 'PEAK_FLOW', true), ...days(40, 'LOW', false, 100)]);
check('R6. unequal groups (10 vs 40) use per-group means: 100 points higher', unequal.differencePoints === 100 && unequal.followedDays === 10 && unequal.otherDays === 40);
check('R7. sample sizes are stated for each group', positive.sampleText === 'Based on 15 days following favorable windows and 15 other days.');
check('R8. method explains scoring, grouping, window and thresholds', /Strong as 100, Balanced as 50 and Low as 0/.test(positive.methodText) && /last 60 check-ins/.test(positive.methodText) && /at least 30 check-in days, including at least 10 of each kind/.test(positive.methodText));
check('R9. every result carries the non-causal caveat', [none, positive, negative, neutral].every((r) => r.caveatText === ALIGNMENT_CAVEAT_TEXT) && /not a cause and effect/.test(ALIGNMENT_CAVEAT_TEXT));
const allCopy = [positive, negative, neutral, none].flatMap((r) => [r.summaryText, r.sampleText ?? '', r.methodText, r.caveatText]).join(' ');
check('R10. no causal or evaluative wording (because/caused/leads to/improve/better/worse/Panchang/%)', !/\bbecause\b|\bcaus(e|ed|es)\b(?! and effect)|leads? to|improv|\bbetter\b|\bworse\b|panchang|%/i.test(allCopy));
check('R11. insufficient copy matches the agreed neutral text', ALIGNMENT_INSUFFICIENT_TEXT === "Keep checking in to explore patterns in your daily experience. There aren't enough observations for a meaningful comparison yet.");

// ---------------------------------------------------------------
// A3. Data handling
// ---------------------------------------------------------------
const withInvalid = run([...days(15, 'PEAK_FLOW', true), ...days(15, 'LOW', false, 100), { dateKey: '2026-12-01', outputLevel: 'GREAT', followedGuidance: false }, { dateKey: '2026-12-02', outputLevel: null, followedGuidance: true }]);
check('D1. unrecognised/missing mood values are excluded, not scored as Low', withInvalid.excludedInvalidMood === 2 && withInvalid.qualifyingDays === 30 && withInvalid.differencePoints === 100);
const dup = run([...days(15, 'PEAK_FLOW', true), ...days(15, 'LOW', false, 100), { dateKey: days(1, 'LOW', false, 100)[0].dateKey, outputLevel: 'PEAK_FLOW', followedGuidance: true }]);
check('D2. a duplicate day counts once (first row kept)', dup.excludedDuplicateDays === 1 && dup.qualifyingDays === 30 && dup.otherDays === 15);
const logs = new Map<string, { aligned: number; friction: number }>();
for (const d of days(10, 'PEAK_FLOW', false, 300)) logs.set(d.dateKey, { aligned: 2, friction: 1 });
for (const d of days(5, 'LOW', false, 400)) logs.set(d.dateKey, { aligned: 1, friction: 1 });
const byLogs = run([...days(10, 'PEAK_FLOW', false, 300), ...days(5, 'LOW', false, 400), ...days(20, 'LOW', false, 500)], logs);
check('D3. unchanged "followed" rule: aligned > friction logs counts as followed; a tie does not', byLogs.followedDays === 10 && byLogs.otherDays === 25 && byLogs.status === 'AVAILABLE');
check('D4. pure: same input gives the same output', JSON.stringify(run([...days(15, 'PEAK_FLOW', true), ...days(15, 'LOW', false, 100)])) === JSON.stringify(total30));

// ---------------------------------------------------------------
// B. Source checks
// ---------------------------------------------------------------
const routeSrc = stripComments(read('../apps/web/app/api/daily-assistant/insights/route.ts'));
const moduleSrc = stripComments(read('../apps/web/lib/insightsAlignment.ts'));
const homeSrc = stripComments(read('../apps/web/components/HomeDashboard.tsx'));
const pageSrc = stripComments(read('../apps/web/app/page.tsx'));
const insightsSrc = stripComments(read('../apps/web/components/InsightsView.tsx'));
check('S1. the route computes the comparison only through computeAlignmentComparison (no inline score loop)', /computeAlignmentComparison\(/.test(routeSrc) && !/alignedScoreTotal|unalignedScoreTotal/.test(routeSrc));
check('S2. scoring unchanged: PEAK_FLOW 1, MODERATE 0.5, LOW 0', /PEAK_FLOW: 1, MODERATE: 0\.5, LOW: 0/.test(moduleSrc));
check('S3. "followed" rule unchanged: followedGuidance OR aligned > friction', /reflection\.followedGuidance \|\| Boolean\(dayLogs && dayLogs\.aligned > dayLogs\.friction\)/.test(moduleSrc));
check('S4. the route still classifies logs with the shared classifyInsightsWindow taxonomy', /classifyInsightsWindow\(log\.activeWindow\)/.test(routeSrc));
check('S5. Home no longer renders the comparison text or receives the insight', !/insightText|alignmentDeltaPoints|alignment\.summaryText/.test(homeSrc) && !/assistantInsight/.test(homeSrc));
check('S6. Home is not handed the insight by page.tsx (only Insights is)', (pageSrc.match(/assistantInsight=\{assistantInsight\}/g) ?? []).length === 1);
check('S7. Insights shows sample sizes, caveat and method; no "pts" headline number', /alignment\.sampleText/.test(insightsSrc) && /alignment\.caveatText/.test(insightsSrc) && /alignment\.methodText/.test(insightsSrc) && !/alignmentDeltaPoints\}\s*pts/.test(insightsSrc) && !/fontSize: 32[^}]*\}\}>\s*\{assistantInsight\.alignmentDeltaPoints/.test(insightsSrc));
check('S8. the check-in buttons on Home are unchanged (Low / Balanced / Strong)', /handleReflection\('LOW'\)/.test(homeSrc) && /handleReflection\('MODERATE'\)/.test(homeSrc) && /handleReflection\('PEAK_FLOW'\)/.test(homeSrc));
check('S9. no new migration (re-baselined by AURA-REM-01: only its own additive 0054 heartbeat migration is allowed; re-baselined by AURA-MP-1 for its additive 0056)', !fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).some((d) => !['0054_reminder_dispatch_heartbeat', '0056_my_people_foundation'].includes(d) && /^005[4-9]_|^00[6-9]\d_/.test(d)));
check('S10. module is pure (no db/fetch/Date.now)', !/from '\.\/db'|fetch\(|Date\.now|new Date\(\)/.test(moduleSrc));

console.log(allPassed ? '\nALL INS-01 ALIGNMENT SAFEGUARD CHECKS PASSED' : '\nSOME INS-01 ALIGNMENT SAFEGUARD CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
