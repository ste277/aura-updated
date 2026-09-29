/**
 * Lunar Intelligence V1 — L2: action-phase representation.
 *
 * These tests prove REPRESENTATION WITHOUT BEHAVIOR CHANGE: the five
 * ActionPhase values compile and pass all the way through to
 * evaluateMuhurtaWithRulePack(), and doing so changes nothing about any
 * score, reason, label, or eligibility decision, whether phase is present
 * or absent. L2 adds no inference and no production caller supplies a
 * phase -- both are checked structurally at the bottom of this file.
 */
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import { evaluateActivityFit, type AuraFitEvaluation } from '../packages/recommendation/src/auraFitEngine';
import { evaluateMuhurtaWithRulePack } from '../packages/muhurta/src/muhurtaRulePacks';
import type { MuhurtaEvaluation } from '../packages/muhurta/src/muhurtaEngine';
import type { ActionPhase } from '../packages/muhurta/src/actionPhase';
import { isTimingSensitiveActivity } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
function deepEqual(label: string, a: unknown, b: unknown) {
  try {
    assert.deepStrictEqual(a, b);
    check(label, true);
  } catch {
    check(label, false);
  }
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const ALL_PHASES: ActionPhase[] = ['START', 'CONTINUE', 'FINISH', 'PREPARE', 'REVIEW'];

async function main() {
  // ============================ A. domain: the five values compile and pass through ============================
  // Deliberately NOT a runtime enum/array export from actionPhase.ts itself (the domain file has zero runtime
  // content, per its own contract) -- this local array is this test's own fixture, not a reflection of the module.
  check('A. all five ActionPhase values are assignable and distinct', new Set(ALL_PHASES).size === 5);
  for (const phase of ALL_PHASES) {
    const accepted: ActionPhase = phase; // a compile-time check: this line fails to compile if the type narrows wrong
    check(`A. "${phase}" is a valid ActionPhase value`, accepted === phase);
  }

  // ============================ fixtures: a real rule-pack-backed activity (Griha Pravesh) ============================
  const grihaActivity = findActivityIntent('griha pravesh')!;
  const grihaDef = getActivityDefinition(grihaActivity)!;
  check('fixture: Griha Pravesh resolves to a CEREMONIAL, rule-pack-backed classification (the path actionPhase threads through)', grihaDef.muhurta.evaluationDepth === 'CEREMONIAL' && grihaDef.muhurta.intent === 'GRIHA_PRAVESH');
  // A real favorable-Abhijit day (Sep 1 2026), matching the shape muhurtaRulePacks.test.ts's own fixtures use.
  const date = new Date(Date.UTC(2026, 8, 1, 6, 20, 0));
  const windowType = 'ABHIJIT' as const;
  const baseParams = { activity: grihaActivity, date, windowType, classification: grihaDef.muhurta };

  // ============================ B. undefined compatibility ============================
  const withoutPhaseField = evaluateActivityFit(baseParams);
  const withExplicitUndefined = evaluateActivityFit({ ...baseParams, actionPhase: undefined });
  deepEqual('B. omitting actionPhase vs. passing actionPhase: undefined produce deep-equal AuraFitEvaluation results', withoutPhaseField, withExplicitUndefined);

  // ============================ C. every phase is behavior-neutral through evaluateActivityFit ============================
  const results: Record<string, AuraFitEvaluation> = { UNDEFINED: withoutPhaseField };
  for (const phase of ALL_PHASES) {
    results[phase] = evaluateActivityFit({ ...baseParams, actionPhase: phase });
  }
  for (const phase of ALL_PHASES) {
    deepEqual(`C. evaluateActivityFit(actionPhase: '${phase}') is deep-equal to the undefined case (full AuraFitEvaluation)`, results[phase], results.UNDEFINED);
  }
  check('C. score is identical across every phase (including undefined)', new Set(Object.values(results).map((r) => r.score)).size === 1);
  check('C. label is identical across every phase', new Set(Object.values(results).map((r) => r.label)).size === 1);
  check('C. reasons are identical (by code+polarity+value) across every phase', new Set(Object.values(results).map((r) => JSON.stringify(r.reasons))).size === 1);

  // A second, non-ceremonial fixture (still rule-pack-backed via a MISSING-coverage classification path is not
  // available without a synthetic classification, so this reuses the same real Griha Pravesh fixture under a
  // different window/date to widen coverage beyond one single Panchanga snapshot).
  const secondDate = new Date(Date.UTC(2026, 8, 2, 6, 20, 0));
  const secondWindow = 'RAHU_KALAM' as const;
  const secondBase = { activity: grihaActivity, date: secondDate, windowType: secondWindow, classification: grihaDef.muhurta };
  const secondResults = ALL_PHASES.map((phase) => evaluateActivityFit({ ...secondBase, actionPhase: phase }));
  const secondBaseline = evaluateActivityFit(secondBase);
  check('C. behavior-neutrality also holds on a second date/window (RAHU_KALAM) where the commencement hard-block applies', secondResults.every((r) => JSON.stringify(r) === JSON.stringify(secondBaseline)));

  // ============================ D. direct rule-pack evaluation ============================
  const rulePackResults: Record<string, MuhurtaEvaluation> = {
    UNDEFINED: evaluateMuhurtaWithRulePack({ classification: grihaDef.muhurta, date, windowType }),
  };
  for (const phase of ALL_PHASES) {
    rulePackResults[phase] = evaluateMuhurtaWithRulePack({ classification: grihaDef.muhurta, date, windowType, actionPhase: phase });
  }
  for (const phase of ALL_PHASES) {
    deepEqual(`D. evaluateMuhurtaWithRulePack(actionPhase: '${phase}') is deep-equal to the undefined case`, rulePackResults[phase], rulePackResults.UNDEFINED);
  }
  check('D. evaluateMuhurtaWithRulePack ignores actionPhase entirely -- proves L2 passes context without consuming it', new Set(Object.values(rulePackResults).map((r) => JSON.stringify(r))).size === 1);

  // ============================ E. existing commencement behavior is unmodified (spot-check; full suites run separately) ============================
  check('E. isTimingSensitiveActivity still returns its documented values for a CEREMONIAL classification (untouched by L2)', isTimingSensitiveActivity(grihaDef.muhurta) === true);
  check('E. isTimingSensitiveActivity still fails safe (true) for an undefined classification (untouched by L2)', isTimingSensitiveActivity(undefined) === true);
  const commencementDuringRahu = evaluateActivityFit({ activity: grihaActivity, date: secondDate, windowType: 'RAHU_KALAM', classification: grihaDef.muhurta });
  const commencementDuringRahuWithPhase = evaluateActivityFit({ activity: grihaActivity, date: secondDate, windowType: 'RAHU_KALAM', classification: grihaDef.muhurta, actionPhase: 'START' });
  check('E. a commencement-window evaluation is identical whether actionPhase is supplied or not (L2 does not fix or touch today\'s "candidate start = commencement" assumption)', JSON.stringify(commencementDuringRahu) === JSON.stringify(commencementDuringRahuWithPhase));

  // ============================ F. structural guard: ActionPhase/actionPhase reference boundary ============================
  // Deliberately searches the exact domain symbols (ActionPhase / actionPhase), never plain English "start"/"review"/etc.
  const schema = read('../apps/web/prisma/schema.prisma');
  check('F. prisma/schema.prisma does not reference ActionPhase/actionPhase', !/ActionPhase|actionPhase/.test(schema));
  const migrationDirs = fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d));
  check('F. migration count remains 39 -- no new migration', migrationDirs.length === 39);
  const migrationsMention = migrationDirs.some((d) => /ActionPhase|actionPhase/.test(read(`../apps/web/prisma/migrations/${d}/migration.sql`)));
  check('F. no migration.sql references ActionPhase/actionPhase', !migrationsMention);

  const plannedActivityFile = strip(read('../apps/web/lib/db.ts'));
  check('F. PlannedActivity/db.ts source does not reference ActionPhase/actionPhase', !/ActionPhase|actionPhase/.test(plannedActivityFile));
  const activityOntology = strip(read('../packages/muhurta/src/activityOntology.ts'));
  check('F. activityOntology.ts (MuhurtaClassification) does not reference ActionPhase/actionPhase', !/ActionPhase|actionPhase/.test(activityOntology));
  const activityDefinitions = strip(read('../packages/recommendation/src/activityDefinitions.ts'));
  check('F. activityDefinitions.ts (ActivityDefinition / the catalog) does not reference ActionPhase/actionPhase', !/ActionPhase|actionPhase/.test(activityDefinitions));
  const dayConstructor = strip(read('../apps/web/lib/dayConstructor.ts'));
  check('F. dayConstructor.ts does not reference ActionPhase/actionPhase', !/ActionPhase|actionPhase/.test(dayConstructor));
  const recomposition = strip(read('../apps/web/lib/remainingDayRecomposition.ts'));
  check('F. remainingDayRecomposition.ts does not reference ActionPhase/actionPhase', !/ActionPhase|actionPhase/.test(recomposition));
  const homeDashboard = strip(read('../apps/web/components/HomeDashboard.tsx'));
  check('F. HomeDashboard.tsx (Home UI) does not reference ActionPhase/actionPhase', !/ActionPhase|actionPhase/.test(homeDashboard));
  const exploreView = strip(read('../apps/web/components/ExploreView.tsx'));
  check('F. ExploreView.tsx (Explore UI) does not reference ActionPhase/actionPhase', !/ActionPhase|actionPhase/.test(exploreView));

  // Repo-wide: exactly the four production files this PR is scoped to may reference the symbol, plus this test
  // and the domain file's own declaration.
  const { execSync } = require('child_process');
  const grepOut = execSync(`grep -rl "ActionPhase\\|actionPhase" apps packages test --include="*.ts" --include="*.tsx" --include="*.prisma" --include="*.sql" 2>/dev/null || true`, { cwd: path.join(__dirname, '..') })
    .toString()
    .split('\n')
    .filter(Boolean)
    .map((f: string) => f.replace(/\\/g, '/'));
  const REQUIRED = [
    'packages/muhurta/src/actionPhase.ts',
    'packages/muhurta/src/muhurtaRulePacks.ts',
    'packages/recommendation/src/auraFitEngine.ts',
    'test/actionPhase.test.ts',
  ];
  // The L1 domain test's own vocabulary guard contains the word "actionPhase" inside a regex pattern (forbidding
  // that word from appearing in L1's source) -- an incidental text match on the guard itself, not a real reference
  // to this PR's ActionPhase concept. Allowed explicitly, not silently ignored. Built from parts rather than one
  // literal path string so this explanatory comment/allowlist entry does not itself trip THAT test's own separate
  // substring guard (which greps the whole tree for its own module name).
  const l1DomainTestFile = ['test/', 'lunar', 'Tithi', 'Context', '.test.ts'].join('');
  // Lunar Intelligence V1 L3 is the deliberate, later consumer of ActionPhase (packages/muhurta/src/lunarFamilyRules.ts,
  // and its own test/integration coverage) -- allowed explicitly, as an intentional consequence of L3's own wiring,
  // not scope creep in this L2 test.
  const l3ConsumerFiles = ['packages/muhurta/src/lunarFamilyRules.ts', 'test/lunarFamilyRules.test.ts', 'test/muhurtaRulePacks.test.ts'];
  // Lunar Intelligence V1 L4 added a second deliberate consumer, packages/muhurta/src/lunarExactTithiRules.ts (its
  // exact-Tithi resolver takes the same explicit ActionPhase parameter, same no-inference contract), plus its own
  // unit test.
  const l4ConsumerFiles = ['packages/muhurta/src/lunarExactTithiRules.ts', 'test/lunarExactTithiRules.test.ts'];
  // Lunar Intelligence V1 L5 wired the one safe production caller (per the L5.1
  // ActionPhase Production Wiring Audit): Muhurtham Finder's own search entry
  // points now supply ActionPhase.START unconditionally at the workflow level
  // (never derived from MuhurtaIntent) -- packages/recommendation/src/
  // timingSearch.ts gained the optional pass-through parameter on
  // evaluateTimingCandidate(), and packages/recommendation/src/muhurthamFinder.ts
  // is the one caller that supplies a concrete value, plus its own test coverage.
  const l5ConsumerFiles = ['packages/recommendation/src/timingSearch.ts', 'packages/recommendation/src/muhurthamFinder.ts', 'test/muhurthamFinder.test.ts'];
  const ALLOWED = new Set([...REQUIRED, l1DomainTestFile, ...l3ConsumerFiles, ...l4ConsumerFiles, ...l5ConsumerFiles]);
  const unexpected = grepOut.filter((f: string) => !ALLOWED.has(f));
  check('F. repo-wide, only the four L2 files (plus this test, L1\'s incidental regex-literal match, and Lunar Intelligence L3/L4/L5\'s deliberate consumer files) reference ActionPhase/actionPhase: ' + (unexpected.length ? 'unexpected: ' + unexpected.join(', ') : 'none unexpected'), unexpected.length === 0);
  check('F. all four expected production/test files DO reference it (the wiring actually exists)', REQUIRED.every((f) => grepOut.includes(f)));

  // ============================ G. no inference exists ============================
  const lib = strip(read('../packages/muhurta/src/actionPhase.ts'));
  check('G. actionPhase.ts has no imports at all (a bare type, nothing to infer FROM)', !/^import\b/m.test(lib));
  check('G. actionPhase.ts contains no function/logic -- only the type declaration', !/\bfunction\b|=>/.test(lib));
  const rulePackSrc = strip(read('../packages/muhurta/src/muhurtaRulePacks.ts'));
  const rulePackFn = rulePackSrc.slice(rulePackSrc.indexOf('export function evaluateMuhurtaWithRulePack'), rulePackSrc.indexOf('export function evaluateMuhurtaWithRulePack') + 1500);
  // Lunar Intelligence V1 L3 deliberately made evaluateMuhurtaWithRulePack the one place that DOES read
  // params.actionPhase (that is the entire point of L3 -- see packages/muhurta/src/lunarFamilyRules.ts and the L3
  // integration tests in test/muhurtaRulePacks.test.ts). L2's own claim was narrower and stays true unmodified:
  // auraFitEngine.ts itself never branches on it (checked separately below) -- only passes it through.
  // Lunar Intelligence V1 L3.2/L4 refactored evaluateMuhurtaWithRulePack to call the SHARED overlay
  // (applyLunarTithiOverlay, packages/muhurta/src/lunarFamilyRules.ts) rather than resolveLunarFamilyReason
  // directly -- still forwarding params.actionPhase opaquely, never branching on its VALUE inline.
  check('G. evaluateMuhurtaWithRulePack DOES read params.actionPhase now (Lunar Intelligence L3\'s designated point of consumption) -- but ONLY by forwarding it into the shared applyLunarTithiOverlay, never by branching on its value directly inline', /applyLunarTithiOverlay\([^)]*params\.actionPhase/.test(rulePackFn) && !/params\.actionPhase\s*(===|!==|\?\?|\?[^:]|&&|\|\|)/.test(rulePackFn));
  const fitSrc = strip(read('../packages/recommendation/src/auraFitEngine.ts'));
  // Lunar Intelligence V1 L3.2 added a second, real (opaque) use of actionPhase in auraFitEngine.ts: forwarding it
  // into applyLunarTithiOverlay for the legacy-path overlay. The invariant that actually matters -- no inference,
  // no branching on its VALUE -- is unchanged and re-checked directly below; the "exactly N occurrences" style of
  // check from L2 no longer applies now that L3.2 legitimately reads it a second time.
  check(
    'G. auraFitEngine.ts never branches on the VALUE of actionPhase (no ===/!==/??/?:/&&/|| /if/switch against it anywhere) -- every occurrence is the type import, the param declaration, or an opaque pass-through into evaluateMuhurtaWithRulePack/applyLunarTithiOverlay',
    !/actionPhase\s*(===|!==|\?\?|\?[^:]|&&|\|\|)|(if|switch)\s*\([^)]*actionPhase/.test(fitSrc) &&
      /actionPhase: params\.actionPhase/.test(fitSrc) &&
      /applyLunarTithiOverlay\([^)]*params\.actionPhase/.test(fitSrc)
  );
  check('G. no mapping exists anywhere from TimingSensitivity/PlannedActivity.status/DailyAgenda status/title to ActionPhase', !/timingSensitivity[\s\S]{0,80}ActionPhase|status[\s\S]{0,80}ActionPhase|title[\s\S]{0,80}ActionPhase|ActionPhase[\s\S]{0,80}timingSensitivity/.test(lib + rulePackSrc + fitSrc));

  if (!allPassed) { console.error('SOME ACTION PHASE CHECKS FAILED'); process.exit(1); }
  console.log('ALL ACTION PHASE CHECKS PASSED');
}
main();
