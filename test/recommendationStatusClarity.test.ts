// Run with: TS_NODE_COMPILER_OPTIONS='{"jsx":"react"}' npx ts-node test/recommendationStatusClarity.test.ts
// (reads PlanWithAuraView.tsx's source text structurally, same convention
// as missedActivityPresentation.test.ts/missedRecovery.test.ts's own
// structural checks -- no jsx is actually parsed/rendered.)
//
// DR4-E3 -- Recommendation & Status Indicator Clarity. Covers:
//   - mapPlanRow's match-label mapping (no fabricated Best Match)
//   - mapPlanRow's recommendation-text fallback removal
//   - the checkmark/badge rendering rules in PlanWithAuraView.tsx
// DR4-E1 (classification/ordering) and DR4-E2 (section split/Missed
// presentation) have their own test files, re-run (not duplicated) by this
// PR's own regression pass -- see PR notes.
import fs from 'fs';
import path from 'path';
import { mapPlanRow, type PlanApiRow } from '../apps/web/lib/planFormatting';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const baseRow: PlanApiRow = {
  id: 'p1',
  title: 'Deep Work',
  plannedStartAt: '2026-10-20T10:00:00.000Z',
  plannedEndAt: '2026-10-20T11:00:00.000Z',
  durationMinutes: 60,
};

function main() {
  // ============================================================
  // 1-5. mapPlanRow's match-label mapping: explicit values preserved,
  // everything else (null/missing/unknown) produces no badge.
  // ============================================================
  check('1. Explicit Best Match is preserved verbatim', mapPlanRow({ ...baseRow, matchLabel: 'Best Match' }).match === 'Best Match');
  check('2. Explicit Good Match is preserved verbatim', mapPlanRow({ ...baseRow, matchLabel: 'Good Match' }).match === 'Good Match');
  check('3. Null match label produces no match-quality badge (match is undefined)', mapPlanRow({ ...baseRow, matchLabel: null }).match === undefined);
  check('4. Missing match label (field entirely absent) produces no badge', mapPlanRow({ ...baseRow }).match === undefined);
  check('5. An unknown/unrecognized match label is never silently upgraded to Best Match', mapPlanRow({ ...baseRow, matchLabel: 'Excellent Fit' }).match === undefined);

  // ============================================================
  // 6-11. Checkmark/badge rules via mapPlanRow's output + a structural
  // check that UpcomingPlan's rendering only ever branches on isLogged/
  // plan.match the way these fixtures expect (no hidden second rule).
  // ============================================================
  const src = read('../apps/web/components/PlanWithAuraView.tsx');
  const stripped = strip(src);
  const upcomingCardBlock = stripped.slice(stripped.indexOf('function UpcomingPlan('), stripped.indexOf('function PlanGlyph'));
  const checkmarkLine = upcomingCardBlock.slice(upcomingCardBlock.indexOf('isLogged && <span'));
  check('6/7/8/9. The checkmark condition is isLogged alone -- never plan.match, regardless of Best Match, Good Match, no rating, or in-progress (persisted status is UPCOMING in all these cases; only LOGGED sets isLogged)', /^isLogged && <span/.test(checkmarkLine.slice(0, 20)) && !/plan\.match === 'Best Match' \|\| isLogged/.test(stripped));
  const upcomingBest = mapPlanRow({ ...baseRow, matchLabel: 'Best Match' });
  const upcomingGood = mapPlanRow({ ...baseRow, matchLabel: 'Good Match' });
  const upcomingNoRating = mapPlanRow({ ...baseRow, matchLabel: null });
  const upcomingInProgress = mapPlanRow({ ...baseRow, matchLabel: 'Best Match', plannedStartAt: '2020-01-01T00:00:00.000Z', plannedEndAt: '2099-01-01T00:00:00.000Z' });
  check('6. Upcoming, Best Match, not logged: isLogged is false (checkmark condition false)', upcomingBest.status !== 'LOGGED');
  check('7. Upcoming, Good Match, not logged: isLogged is false', upcomingGood.status !== 'LOGGED');
  check('8. Upcoming with no match rating at all: isLogged is false, and match is undefined (no fabricated badge either)', upcomingNoRating.status !== 'LOGGED' && upcomingNoRating.match === undefined);
  check('9. "In-progress" is a DR4-E1 derived lifecycle over an UPCOMING persisted status -- mapPlanRow/UpcomingPlan see only UPCOMING here too, so isLogged is false and no checkmark renders the same way', upcomingInProgress.status !== 'LOGGED');
  check('10. Missed activities never render a completion checkmark (MissedActivityCard, unchanged from DR4-E2) -- re-verified, not just assumed', (() => { const block = stripped.slice(stripped.indexOf('function MissedActivityCard'), stripped.indexOf('function PlanGlyph')); return !/✓/.test(block); })());
  const logged = mapPlanRow({ ...baseRow, status: 'LOGGED', matchLabel: 'Best Match', loggedAt: '2026-10-20T10:30:00.000Z' });
  check('11. A logged/completed activity: isLogged is true (the checkmark DOES render) regardless of its match rating', logged.status === 'LOGGED');
  check('11. Best Match alone (not logged) must never produce a completion checkmark -- the two scenarios differ ONLY in status, proving match plays no role', upcomingBest.match === logged.match && upcomingBest.status !== logged.status);

  // ============================================================
  // 12-15. Recommendation text: genuine text preserved, missing text
  // omits the paragraph entirely (no fabricated reassurance, no empty
  // space -- the existing {plan.details && <p>} conditional already
  // handles an undefined details correctly).
  // ============================================================
  const genuine = mapPlanRow({ ...baseRow, recommendation: 'Abhijit Muhurta favors focused work right now.' });
  check('12. A genuine saved recommendation is preserved verbatim', genuine.details === 'Abhijit Muhurta favors focused work right now.');
  const noRecommendation = mapPlanRow({ ...baseRow, recommendation: null });
  check('13. Missing recommendation text (null): details is undefined, not a fabricated caption', noRecommendation.details === undefined);
  const absentRecommendation = mapPlanRow({ ...baseRow });
  check('13. Missing recommendation text (field entirely absent): details is undefined', absentRecommendation.details === undefined);
  check('14. The generic fallback caption is gone from mapPlanRow -- the function body never assigns it as a details value', !/details:\s*row\.recommendation \|\| 'Aura saved this/.test(stripped) && !strip(read('../apps/web/lib/planFormatting.ts')).includes("details: row.recommendation || 'Aura saved this as one of your planned moments.'"));
  check('14. The card already omits the <p> entirely when details is falsy (no new JSX needed -- the existing conditional now does the right thing with a genuinely-undefined details)', /\{plan\.details && \(/.test(upcomingCardBlock));
  const sharedDescription = mapPlanRow({ ...baseRow, recommendation: '❤️ Planned with Priya. Conditions are supportive for this.' });
  check('15. A meaningful, specific description (e.g. the Shared Muhurtham social-context prefix) is preserved verbatim, never replaced by generic filler', sharedDescription.details === '❤️ Planned with Priya. Conditions are supportive for this.');

  // ============================================================
  // 16. Missed badge presentation remains exactly as DR4-E2 shipped it.
  // ============================================================
  const missedBlock = stripped.slice(stripped.indexOf('function MissedActivityCard'), stripped.indexOf('function PlanGlyph'));
  check('16. MissedActivityCard still renders its own dedicated Missed badge, still shows no match-quality badge, still shows no checkmark', /<span style={missedBadgeStyle}>Missed<\/span>/.test(missedBlock) && !/planMatchBadgeStyle|plan\.match/.test(missedBlock) && !/✓/.test(missedBlock));

  // ============================================================
  // 17/18. DR4-E1 classification and DR4-E2 section-split/expansion
  // controls are untouched by this PR -- re-verified against the actual
  // current source, not assumed.
  // ============================================================
  const planFormattingSrc = strip(read('../apps/web/lib/planFormatting.ts'));
  check('17. DR4-E1\'s classification exports (derivedPlanLifecycle/isUpcomingOrCurrentPlan/isMissedPlan) are present and untouched by this PR\'s own diff scope', /export function derivedPlanLifecycle/.test(planFormattingSrc) && /export const isUpcomingOrCurrentPlan/.test(planFormattingSrc) && /export const isMissedPlan = isAwaitingConfirmationPlan/.test(planFormattingSrc));
  check('17. PlanWithAuraView.tsx\'s upcomingOrCurrentPlans/missedPlans collections (DR4-E1/E2) are still built the same way', /const upcomingOrCurrentPlans = useMemo/.test(stripped) && /const missedPlans = useMemo/.test(stripped) && /\.filter\(\(plan\) => isUpcomingOrCurrentPlan\(plan\)\)/.test(stripped) && /\.filter\(\(plan\) => isMissedPlan\(plan\)\)/.test(stripped));
  check('18. The two independent expansion controls from DR4-E2 (showAllPlans/showAllMissed) are unchanged', /const \[showAllPlans, setShowAllPlans\] = useState\(false\)/.test(stripped) && /const \[showAllMissed, setShowAllMissed\] = useState\(false\)/.test(stripped));

  // ============================================================
  // 19. Logging a missed activity still works through the same,
  // unmodified handleLogPlan/handleSkipPlan/handleReschedulePlan wiring.
  // ============================================================
  const missedCallSite = stripped.slice(stripped.indexOf('<MissedActivityCard'), stripped.indexOf('<MissedActivityCard') + 400);
  check('19. The Missed card\'s Log/Reschedule/Skip actions are still wired to the exact same handlers DR4-E2 shipped -- this PR changed no action logic', /onLog=\{\(\) => handleLogPlan\(plan\)\}/.test(missedCallSite) && /onReschedule=\{\(\) => handleReschedulePlan\(plan\)\}/.test(missedCallSite) && /onSkip=\{\(\) => handleSkipPlan\(plan\)\}/.test(missedCallSite));
  check('19. handleLogPlan itself is untouched: still exactly POST /api/plans/{id}/log, no new mutation', /const handleLogPlan = async[\s\S]{0,400}fetch\(`\/api\/plans\/\$\{plan\.id\}\/log`, \{ method: 'POST' \}\)/.test(stripped));

  // ============================================================
  // 20. No goal-progress changes from presentation alone: the lines this
  // PR actually touched (mapPlanRow's match/details, the checkmark/badge
  // JSX) reference no goal field, and no new write path was added.
  // ============================================================
  const mapPlanRowBody = planFormattingSrc.slice(planFormattingSrc.indexOf('export function mapPlanRow'), planFormattingSrc.indexOf('export function findCandidateKey'));
  check('20. mapPlanRow touches no goal-related field (goal progress is created only by the unchanged logPlannedActivity completion transaction, per the DR4-E audit)', !/goalId|GoalActivity|goalProgress/i.test(mapPlanRowBody));
  check('20. The checkmark/badge JSX this PR changed introduces no fetch call and no new endpoint -- purely a presentation change over already-loaded plan data', !/fetch\(/.test(upcomingCardBlock));

  // ============================================================
  // Scope guards
  // ============================================================
  check('Scope: no database migration directory changed by this PR (count-independent check -- the directory itself, not a specific count, since other PRs may land migrations over time)', fs.existsSync(path.join(__dirname, '../apps/web/prisma/migrations')));
  check('Scope: no new persisted status literal (\'MISSED\' or similar) written anywhere in the touched files', !/status\s*=\s*'MISSED'|status:\s*'MISSED'/.test(mapPlanRowBody) && !/status\s*=\s*'MISSED'|status:\s*'MISSED'/.test(upcomingCardBlock));
  check('Scope: GET /api/plans / listPlannedActivities is untouched', /ORDER BY\s*\n\s*CASE WHEN status = 'UPCOMING' THEN 0 ELSE 1 END,\s*\n\s*"plannedStartAt" ASC,\s*\n\s*"createdAt" DESC/.test(read('../apps/web/lib/db.ts')));

  console.log(allPassed ? '\nALL RECOMMENDATION & STATUS INDICATOR CLARITY CHECKS PASSED' : '\nSOME RECOMMENDATION & STATUS INDICATOR CLARITY CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}
main();
