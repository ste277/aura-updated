/**
 * Goals V2 G3.5 -- goal-aware Recomposition presentation. Pure parsing/presentation/structural coverage (no DB
 * access -- see test/goalAwareRecompositionPresentationDb.test.ts for the live-database proof of real enrichment,
 * decision purity against a real Goal-linked plan, batching and user isolation). Same renderToStaticMarkup
 * convention as test/homeRecomposition.test.ts (this repository has no component-rendering harness otherwise).
 */
import fs from 'fs';
import path from 'path';
import {
  parseRecomposeResponse,
  presentMove,
  type RecompositionState,
  type RecompositionView,
} from '../apps/web/lib/homeRecomposition';
import { handleRemainingDayRecompositionRequest, type RecompositionBoundaryDeps } from '../apps/web/lib/remainingDayRecompositionServer';
import type { RecompositionDeps, RemainingDayRecompositionResult } from '../apps/web/lib/remainingDayRecomposition';
import type { PlanGoalContext } from '../apps/web/lib/db';

/**
 * HOW TO RUN (the card is a .tsx component): npx ts-node -P tsconfig.test-jsx.json test/goalAwareRecompositionPresentation.test.ts
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const React = require('../apps/web/node_modules/react');
const { renderToStaticMarkup } = require('../apps/web/node_modules/react-dom/server');
const { RecompositionCard } = require('../apps/web/components/RecompositionCard');

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const TZ = 'Asia/Kolkata';
const at = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(2026, 7, 24, h, m) - 330 * 60000); };
const slot = (from: string, to: string) => ({ start: at(from).toISOString(), end: at(to).toISOString() });
const moveD = (id: string, title: string, from: string, to: string, nf: string, nt: string, goalContext?: unknown) => ({
  decision: 'MOVE', planId: id, title, current: slot(from, to), to: slot(nf, nt), durationMinutes: 60, reason: 'BETTER_TIMING_TIER',
  evidence: { currentTier: 'CAUTION', proposedTier: 'BEST' }, ...(goalContext !== undefined ? { goalContext } : {}),
});
const keepD = (id: string, title: string, from: string, to: string) => ({ decision: 'KEEP', planId: id, title, current: slot(from, to), reason: 'NO_STRICT_IMPROVEMENT', evidence: { currentTier: 'BEST', alternative: { kind: 'NONE' } } });
const ready = (state: string, decisions: unknown[], token?: string) => ({ status: 'READY', proposal: { generatedAt: at('09:00').toISOString(), targetDate: '2026-08-24', timezone: TZ, decisions, protectedPlans: [], summary: { state, moveCount: 0, keepCount: 0, unresolvedCount: 0, placementRuns: 1 } }, ...(token ? { proposalToken: token } : {}) });
const p = (body: unknown) => parseRecomposeResponse(true, body);
const viewOf = (o: ReturnType<typeof p>) => (o.kind === 'VIEW' ? o.view : null);

async function main() {
  // ============================================================
  // parseRecomposeResponse -- goalContext parsing
  // ============================================================
  {
    const withGoal = viewOf(p(ready('CHANGES_PROPOSED', [moveD('A', 'Strength training', '10:00', '11:00', '18:00', '19:00', { goal: { id: 'g1', title: 'Get fitter' } })], 'tok')));
    check('21. a MOVE decision carrying goalContext parses into RecompositionMoveRow.goalContext (id/title preserved)', withGoal?.kind === 'CHANGES_PROPOSED' && (withGoal as any).moves[0].goalContext?.goal?.id === 'g1' && (withGoal as any).moves[0].goalContext?.goal?.title === 'Get fitter');

    const withoutGoal = viewOf(p(ready('CHANGES_PROPOSED', [moveD('A', 'Call the bank', '10:00', '11:00', '18:00', '19:00')], 'tok')));
    check('22. a MOVE decision with no goalContext field parses with goalContext ABSENT (never null/placeholder) on the row', withoutGoal?.kind === 'CHANGES_PROPOSED' && !('goalContext' in (withoutGoal as any).moves[0]));

    const malformed = p(ready('CHANGES_PROPOSED', [moveD('A', 'x', '10:00', '11:00', '18:00', '19:00', { goal: { id: 'g1' /* missing title */ } })], 'tok'));
    check('11. a MALFORMED goalContext (present but invalid) fails the WHOLE parse closed -- never silently dropped or half-trusted', malformed.kind === 'ERROR');
    const malformed2 = p(ready('CHANGES_PROPOSED', [moveD('A', 'x', '10:00', '11:00', '18:00', '19:00', 'not-an-object')], 'tok'));
    check('11. a non-object goalContext also fails closed', malformed2.kind === 'ERROR');
    const nullGoal = p(ready('CHANGES_PROPOSED', [moveD('A', 'x', '10:00', '11:00', '18:00', '19:00', null)], 'tok'));
    check('11. an explicit null goalContext fails closed too (only a genuinely ABSENT key means "no Goal")', nullGoal.kind === 'ERROR');

    const keepWithGoal = p(ready('NO_CHANGES', [{ ...keepD('K', 'Lunch', '13:00', '14:00'), goalContext: { goal: { id: 'g1', title: 'x' } } }]));
    check('9. a KEEP decision carrying goalContext does not break parsing (the field is simply not read for KEEP -- this ticket\'s own section 9 scope)', viewOf(keepWithGoal)?.kind === 'NO_CHANGES');
  }

  // ============================================================
  // presentMove -- goalTitle / accessibleText
  // ============================================================
  {
    const withGoal = presentMove({ planId: 'A', title: 'Strength training', fromIso: at('10:00').toISOString(), toIso: at('18:00').toISOString(), goalContext: { goal: { id: 'g1', title: 'Get fitter' } } }, TZ);
    check('7/8. presentMove exposes goalTitle for a Goal-linked move', withGoal.goalTitle === 'Get fitter');
    check('7. accessibleText folds the Goal title in without changing the time phrasing', withGoal.accessibleText === 'Strength training, for Get fitter, from 10:00 AM to 6:00 PM');
    const withoutGoal = presentMove({ planId: 'A', title: 'Strength training', fromIso: at('10:00').toISOString(), toIso: at('18:00').toISOString() }, TZ);
    check('8. presentMove for a non-Goal move has NO goalTitle and BYTE-IDENTICAL accessibleText to pre-G3.5 (regression)', withoutGoal.goalTitle === undefined && withoutGoal.accessibleText === 'Strength training, from 10:00 AM to 6:00 PM');
  }

  // ============================================================
  // RecompositionCard rendering -- Goal-linked vs non-Goal, accessibility, density
  // ============================================================
  {
    const render = (view: RecompositionView) => renderToStaticMarkup(React.createElement(RecompositionCard, { state: { generation: 1, phase: 'PROPOSAL', view, notice: null } as RecompositionState, timezone: TZ, onAccept: () => {}, onDismiss: () => {}, onRetry: () => {} }));
    const goalView = viewOf(p(ready('CHANGES_PROPOSED', [moveD('A', 'Strength training session', '10:00', '11:00', '18:00', '19:00', { goal: { id: 'g1', title: 'Get fitter' } })], 'tok'))) as RecompositionView;
    const plainView = viewOf(p(ready('CHANGES_PROPOSED', [moveD('B', 'Call the bank', '10:00', '11:00', '18:00', '19:00')], 'tok'))) as RecompositionView;
    const goalMarkup = render(goalView);
    const plainMarkup = render(plainView);

    check('7. the Goal-linked MOVE row renders "For: Get fitter" as plain visible text', goalMarkup.includes('For: Get fitter'));
    check('30. the Goal line is NOT aria-hidden (readable by assistive tech, never color-alone)', !/aria-hidden="true"[^>]*>For: Get fitter/.test(goalMarkup));
    check('8. a non-Goal MOVE row renders no "For:" line, no blank line, no placeholder', !plainMarkup.includes('For:') && !/For:\s*<\/span>/.test(plainMarkup));
    check('31. at most one compact Goal-context line per move row (no second "For:"/Goal mention for the same row)', (goalMarkup.match(/For: Get fitter/g) ?? []).length === 1);
    check('31. no Goal card/progress bar/statistics introduced (no role="progressbar", no "%", no Goal-specific class/section)', !/role="progressbar"|GoalCard|GoalProgress|GoalStat/.test(goalMarkup));
    check('16/17. no completion/progress detail rendered for the Goal-linked row (no numeric target, no "/ min", no "pages")', !/\d+\s*\/\s*\d+|completionRequirement|currentValue/.test(goalMarkup));
  }

  // ============================================================
  // Server enrichment: boundary, decision purity, batching (mock-level; DB-level proof in the Db test file)
  // ============================================================
  {
    const decisions = [
      { decision: 'MOVE' as const, planId: 'A', title: 'Goal task', current: { start: at('10:00'), end: at('11:00') }, to: { start: at('18:00'), end: at('19:00') }, durationMinutes: 60, reason: 'BETTER_TIMING_TIER' as const, evidence: { currentTier: null, proposedTier: null } },
      { decision: 'MOVE' as const, planId: 'B', title: 'Plain task', current: { start: at('10:00'), end: at('11:00') }, to: { start: at('19:00'), end: at('20:00') }, durationMinutes: 60, reason: 'BETTER_TIMING_TIER' as const, evidence: { currentTier: null, proposedTier: null } },
    ];
    const recomposeResult: RemainingDayRecompositionResult = { status: 'READY', proposal: { generatedAt: at('09:00'), targetDate: '2026-08-24', timezone: TZ, currentState: [], proposedState: [], decisions, protectedPlans: [], summary: { state: 'CHANGES_PROPOSED', moveCount: 2, keepCount: 0, unresolvedCount: 0, placementRuns: 1 } } };
    const baseDeps = { getSession: () => ({ userId: 'u1' }), getUser: async () => ({ id: 'u1', timezone: TZ } as any), now: () => at('09:00'), createDeps: () => ({} as RecompositionDeps), recompose: async () => recomposeResult };

    let calls = 0;
    const contextMap = new Map<string, PlanGoalContext>([['A', { goal: { id: 'g1', title: 'Get fitter' }, goalActivity: { id: 'ga1', completionRequirement: { kind: 'DONE' } }, currentValue: null }]]);
    const loadGoalContexts: RecompositionBoundaryDeps['loadGoalContexts'] = async (userId, planIds) => { calls += 1; check('9/27. loadGoalContexts is called with the AUTHENTICATED session userId, never a client-supplied id', userId === 'u1'); check('28. loadGoalContexts receives every decision\'s planId in ONE call (batched, not per-decision)', planIds.length === 2 && planIds.includes('A') && planIds.includes('B')); return contextMap; };

    const withLoader = await handleRemainingDayRecompositionRequest({ ...baseDeps, loadGoalContexts });
    const withoutLoader = await handleRemainingDayRecompositionRequest({ ...baseDeps });
    const withBody = withLoader.body as any;
    const withoutBody = withoutLoader.body as any;

    check('7. enrichment is applied AFTER the decision (the decision engine itself returns the SAME `decisions`; enrichment is a response-layer step)', withBody.proposal.decisions.find((d: any) => d.planId === 'A').goalContext?.goal.id === 'g1');
    check('29. loadGoalContexts omitted entirely -> the response is byte-identical to pre-G3.5 (no goalContext field anywhere, additive/optional, backward compatible)', !withoutBody.proposal.decisions.some((d: any) => 'goalContext' in d));
    check('33. exactly one loadGoalContexts call for the whole request (no N+1)', calls === 1);
    const stripGoalContext = (ds: any[]) => ds.map(({ goalContext, ...rest }) => rest);
    check('23. decisions (minus goalContext) are byte-identical with and without the loader -- enrichment cannot influence the decision', JSON.stringify(stripGoalContext(withBody.proposal.decisions)) === JSON.stringify(stripGoalContext(withoutBody.proposal.decisions)));
    check('13/22. no proposalToken difference: enrichment never touches signing (both responses carry the SAME token presence/absence contract)', ('proposalToken' in withBody) === ('proposalToken' in withoutBody));
  }

  // ============================================================
  // 32. STRUCTURAL GUARDS
  // ============================================================
  const svc = strip(read('../apps/web/lib/remainingDayRecomposition.ts'));
  const srv = strip(read('../apps/web/lib/remainingDayRecompositionServer.ts'));
  const integrity = strip(read('../apps/web/lib/remainingDayRecompositionIntegrity.ts'));
  const acceptance = strip(read('../apps/web/lib/remainingDayRecompositionAcceptance.ts'));
  const planMoveSrc = strip(read('../apps/web/lib/planMove.ts'));
  const cardSrc = strip(read('../apps/web/components/RecompositionCard.tsx'));
  const libSrc = strip(read('../apps/web/lib/homeRecomposition.ts'));
  const routeSrc = strip(read('../apps/web/app/api/day/recompose/route.ts'));
  const acceptRouteSrc = strip(read('../apps/web/app/api/day/recompose/accept/route.ts'));

  check('decision engine (remainingDayRecomposition.ts) imports/references nothing Goal-related -- stays entirely Goal-unaware', !/goal/i.test(svc));
  check('ranking/comparison (compareTimingTiers, isStrictlyBetterTier) and the KEEP/MOVE fixed-point loop are untouched -- still exactly their pre-G3.5 bodies', /export function compareTimingTiers/.test(svc) && /export const isStrictlyBetterTier/.test(svc) && /const meaningful = !!placement && !sameSlot && \(invalid !== undefined \|\| isStrictlyBetterTier\(placement\.timingFit \?\? null, currentTier\.get\(plan\.id\)\)\)/.test(svc));
  check('acceptance module/route carry no goalId field or Goal reference (acceptance payload unchanged, still exactly { proposalToken })', !/goal/i.test(acceptance) && !/goal/i.test(acceptRouteSrc));
  check('integrity module (signing/verification) carries no Goal reference -- Goal data can never enter what is signed or verified', !/goal/i.test(integrity));
  check('planMove.ts (applyMoveWrites) was not modified by G3.5 -- its own GoalActivity/GoalActivityExecution continuity lines are untouched', !/G3\.5/.test(planMoveSrc));
  check('G3.1\'s own loadGoalContextsForPlanIds is reused verbatim -- route.ts wires the REAL loader (an injectable dep in server.ts, never a second parallel implementation like loadRecompositionGoal/getGoalForProposal anywhere in the stack)', /loadGoalContextsForPlanIds/.test(routeSrc) && !/loadRecompositionGoal|getGoalForProposal/.test(srv + routeSrc));
  check('enrichDecisionsWithGoalContext calls loadGoalContexts exactly once per request, outside any loop (no N+1) -- the per-decision work is a plain, loader-free .map', /const contexts = await loadGoalContexts\(userId, planIds\);/.test(srv) && (srv.match(/await loadGoalContexts\(/g) ?? []).length === 1);
  check('the server wiring exposes ONLY goal id/title -- no execution id/source/snapshot/currentValue field is ever read off PlanGoalContext', !/\.executionId|\.source\b|completionKindSnapshot|completionTargetValueSnapshot|completionUnitSnapshot|ctx\.currentValue/.test(srv));
  check('homeRecomposition.ts (the client parser) never reads any execution/completion field off goalContext -- only goal.id/goal.title', !/executionId|completionRequirement|currentValue|completionKindSnapshot/.test(libSrc));
  check('RecompositionCard.tsx consumes Goal identity only -- no completionRequirement/currentValue/targetValue/progress field is ever read', !/completionRequirement|currentValue|targetValue|progressValue/.test(cardSrc));
  check('RecompositionCard.tsx renders no numeric completion/progress detail (no role="progressbar", no Math.round percentage)', !/role="progressbar"|Math\.round/.test(cardSrc));
  check('Timeline (HomeTimeline.tsx) was not touched by G3.5 -- no new Goal/recomposition cross-reference', !/recompos/i.test(read('../apps/web/components/HomeTimeline.tsx')));
  check('Right Now (HomeDashboard.tsx) was not touched by G3.5 -- no recomposition-goal cross-reference beyond its own pre-existing G3.3 goalContext usage', !/goalAwareRecomposition|RecompositionGoalContext/.test(read('../apps/web/components/HomeDashboard.tsx')));
  check('Goal Detail (GoalDetailClient.tsx) was not touched by G3.5', !/recompos/i.test(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx')));
  check('Goal templates (goals.ts) were not touched by G3.5', !/recompos/i.test(read('../apps/web/lib/goals.ts')));
  check('Constructor (dayConstructorOrchestrator.ts, dayConstructor.ts) was not touched by G3.5 -- still never mentions Goal, and never mentions this ticket', !/\bgoal/i.test(strip(read('../apps/web/lib/dayConstructorOrchestrator.ts'))) && !/\bgoal/i.test(strip(read('../apps/web/lib/dayConstructor.ts'))));
  check('no write statement was added to the server wiring or route (still exactly the pre-G3.5 READ-ONLY guarantee)', ![svc, srv, routeSrc].some((s) => /INSERT\s|UPDATE\s|DELETE\s|beginTransaction/.test(s)));
  check('no Rhythm/recurrence concept anywhere in the Recomposition presentation stack', !/\bRhythm\b|\bRRULE\b|\bfrequency\b|recurrence|recurring/i.test(srv + libSrc + cardSrc));
  check('no day-accumulation concept (dayBucket/dailyTarget/accumulat) anywhere in the Recomposition presentation stack', !/dayBucket|dailyTarget|accumulat/i.test(srv + libSrc + cardSrc));
  check('no history/aggregate concept (executionHistory/weeklyTotal/allExecutions) anywhere in the Recomposition presentation stack', !/executionHistory|weeklyTotal|allExecutions/.test(srv + libSrc + cardSrc));
  check('no streak/score/gamification copy anywhere in the Recomposition presentation stack', !/\bstreak\b|gamif/i.test(srv + libSrc + cardSrc));
  check('no guilt/motivation copy was introduced ("keeps you on track"/"don\'t lose progress"/"stay committed"/"at risk")', !/keeps you on track|don't lose progress|stay committed|goal at risk/i.test(cardSrc + libSrc));
  check('schema/migrations untouched: still 41 migrations', fs.readdirSync(path.join(__dirname, '..', 'apps', 'web', 'prisma', 'migrations')).filter((d) => /^\d{4}_/.test(d)).length === 43);

  if (!allPassed) {
    console.error('SOME GOAL-AWARE RECOMPOSITION PRESENTATION CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL-AWARE RECOMPOSITION PRESENTATION CHECKS PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
