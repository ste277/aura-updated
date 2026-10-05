/**
 * Constructor Decision Intelligence -- O5 P2c: Decision Pressure AUTHORITY (architecture guard, pure).
 *
 * THE INTENDED AUTHORITY CHAIN (documented here, enforced below -- not by TypeScript structural typing):
 *
 *   provider facts            goalDecisionFactsProvider.ts, opportunityDecisionFacts.ts, opportunityProjection.ts
 *     -> DecisionFacts        decisionFacts.ts          MUTABLE TRANSPORT (what a provider hands the orchestrator)
 *     -> prepare              decisionFactPreparation.ts  prepareDecisionFacts* / prepareDecisionEvidence (the one preparation stage)
 *     -> DecisionEvidence     decisionEvidence.ts       IMMUTABLE, by-value, deep-frozen: the ONLY fact authority for policy
 *     -> deriveDecisionPressure   decisionPressure.ts   the ONE semantic derivation (pure, evidence-only, source-neutral)
 *     -> DecisionPressure     'NONE' | 'LAST_KNOWN_OPPORTUNITY'
 *
 * A future policy consumes `DecisionEvidence` / the derived `DecisionPressure`, never the mutable `DecisionFacts`, and never
 * re-reads the raw recurrence / opportunity fields to decide anything of its own: there is exactly ONE place that knows what
 * "last known opportunity" means.
 *
 * KNOWN TYPE-SYSTEM LIMIT (not relied on): `DecisionFacts` is STRUCTURALLY assignable to `DecisionEvidence` (a mutable object
 * satisfies a readonly type), so the compiler cannot stop a caller passing facts where evidence is expected. This slice does not
 * add branding or wrapper types to hide that; the repository's architecture enforcement (this file) is the boundary:
 *
 *   - which production modules may import / name DecisionFacts, DecisionEvidence and pressure at all (exact allowlists)
 *   - which production modules may read each raw recurrence / opportunity field (exact allowlists), and that ONLY the deriver
 *     COMPARES them
 *   - that a pressure consumer (a module that mentions pressure) may not touch DecisionFacts, a raw fact field, a source
 *     concept or an importance / deadline signal
 *   - that nothing in the Constructor, comparator, placement, capacity, replenishment, acceptance, persistence, preview,
 *     signing or presentation code mentions pressure
 *
 * DECISION PRESSURE vs VALUE: importance and deadline are user / value / explicit-precedence signals. DecisionPressure is the
 * temporal cost of deferral. They are different authorities and are deliberately NOT combined by any module.
 *
 * Every rule below is a PURE FUNCTION over a set of source files. The suite runs it on the real tree (zero violations
 * expected) AND on the real tree with a synthetic violation injected, proving each rule fires (the mutation classes: the
 * deriver reading DecisionFacts, a second module reimplementing pressure from raw fields, a source-specific branch, a
 * pressure read in the comparator, pressure added to preview / signing / persistence, a pressure consumer reading raw
 * facts). Behavior-level mutations (fallback or an unknown day qualifying) are pinned by anchors at the end and, in full, by
 * decisionPressure.test.ts.
 *
 * This is a P3-SHADOW readiness guard. It does not approve active policy (P4): the underlying recurrence and opportunity
 * reads are still not one coherent REPEATABLE READ snapshot (P2d).
 */
import fs from 'fs';
import path from 'path';
import { deriveDecisionPressure } from '../apps/web/lib/decisionPressure';
import { buildDecisionEvidence, type DecisionEvidence } from '../apps/web/lib/decisionEvidence';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

// ---- documented compile-time fact: the structural-typing limit this guard exists because of ----
type FactsAssignableToEvidence = DecisionFacts extends DecisionEvidence ? true : false;
const KNOWN_TYPE_LIMIT: FactsAssignableToEvidence = true; // if this stops compiling the limit was removed: update the header above

// ============================================================
// Production source set (comment-stripped): apps/web lib + app + components and every package's src.
// ============================================================
interface SrcFile { f: string; src: string }
function productionFiles(): SrcFile[] {
  const out: SrcFile[] = [];
  const walk = (dir: string) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(rel); } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push({ f: rel, src: stripComments(read(rel)) });
  });
  ['apps/web/lib', 'apps/web/app', 'apps/web/components'].forEach(walk);
  fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true }).forEach((p) => { if (p.isDirectory() && fs.existsSync(path.join(root, 'packages', p.name, 'src'))) walk(path.join('packages', p.name, 'src')); });
  return out.sort((a, b) => (a.f < b.f ? -1 : 1));
}

// ============================================================
// The pinned authority model.
// ============================================================
const DERIVER = 'apps/web/lib/decisionPressure.ts';

const PRESSURE_IDENT = /\b(DecisionPressure|DecisionPressureInput|deriveDecisionPressure|PressureCandidateFlexibility)\b|LAST_KNOWN_OPPORTUNITY|decisionPressure\b/;
const PRESSURE_WORD = /pressure/i;
/** The only production files that may name the pressure types, the deriver or its value. P3a / P3b / P4 / P5 must amend this DELIBERATELY. */
/** O5 P3b -- the two inert SHADOW modules that consume the DERIVED value (never raw facts): the pure evaluator and the diagnostics boundary that derives pressure for it. */
const SHADOW_EVALUATOR = 'apps/web/lib/shadowPressureEvaluation.ts';
const SHADOW_OBSERVATION = 'apps/web/lib/shadowPressureObservation.ts';
/** The stronger-than-pressure comparison helper: the ONLY place the shadow stage touches importance / deadline; it names no pressure, evidence or facts. */
const ABOVE_PRESSURE = 'apps/web/lib/abovePressurePrecedence.ts';
const SHADOW_CONSUMERS = [SHADOW_EVALUATOR, SHADOW_OBSERVATION];
/** O5 P4a -- the two inert PROMOTION-INPUT modules: the pure assembler (reads ALREADY-DERIVED pressure by type) and the internal boundary that derives it over this run's immutable evidence. Zero active consumers; pinned by promotionInputArchitecture.test.ts. */
const PROMOTION_CONSUMERS = ['apps/web/lib/promotionInput.ts', 'apps/web/lib/promotionInputPreparation.ts'];
const PRESSURE_CONSUMERS = [...SHADOW_CONSUMERS, ...PROMOTION_CONSUMERS];
const PRESSURE_IDENT_ALLOW = [DERIVER, ...PRESSURE_CONSUMERS];
/** The only production files containing the word at all: the deriver, and unrelated UI copy ("low-pressure practice"). */
/** O5 P4b3: the pure acceptance predicate names only the shared above-pressure comparator primitive (`compareAbovePressure` / `projectAbovePressureFacts`); it never reads a DecisionPressure value. */
const PRESSURE_WORD_ALLOW = [DERIVER, 'packages/recommendation/src/actionCards.ts', ABOVE_PRESSURE, ...PRESSURE_CONSUMERS, 'apps/web/lib/counterfactualAcceptance.ts'];
/** Importers of the deriver. NONE today: it is unwired. A future consumer is added here on purpose and is then held to the consumer rules. */
const PRESSURE_IMPORTER_ALLOW: string[] = [...PRESSURE_CONSUMERS];

const FACTS_IMPORT = /from '(?:\.\/|(?:\.\.\/)+[^']*\/)?decisionFacts'/;
const FACTS_IDENT = /\b(DecisionFacts|RecurrenceDecisionFacts|OpportunityDecisionFacts|DecisionFactsByIntentId|resolveDecisionFactsForIntent|OpportunityDurationBasis)\b|\.decisionFacts\b|decisionFactsByIntentId|\bdecisionFacts\b/;
/** The mutable transport: who may import / name it (producers, the one preparation stage, the one converter, the orchestrator and preview boundary that carry it, and the DayIntent field that holds it). */
const FACTS_ALLOW = [
  'apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/decisionEvidence.ts',
  'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionFacts.ts', 'apps/web/lib/goalDecisionFactsProvider.ts', 'apps/web/lib/opportunityDecisionFacts.ts',
];
const EVIDENCE_IMPORT = /from '(?:\.\/|(?:\.\.\/)+[^']*\/)?decisionEvidence'/;
const EVIDENCE_IMPORTER_ALLOW = ['apps/web/lib/decisionFactPreparation.ts', DERIVER];
const EVIDENCE_IDENT = /DecisionEvidence|decisionEvidence/;
const EVIDENCE_IDENT_ALLOW = ['apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts', DERIVER];
const PRESSURE_IMPORT = /from '(?:\.\/|(?:\.\.\/)+[^']*\/)?decisionPressure'/;

/** Raw recurrence / opportunity field readers, by exact production allowlist (producer, transport, evidence copy, the deriver). */
const RAW_FIELD_ALLOW: Record<string, string[]> = {
  remainingInPeriod: ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/goalDecisionFactsProvider.ts'],
  completedInPeriod: ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/goalDecisionFactsProvider.ts'],
  committedInPeriod: ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/goalDecisionFactsProvider.ts'],
  targetPerPeriod: ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/goalDecisionFactsProvider.ts'],
  LOCAL_CALENDAR_WEEK: ['apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/goalDecisionFactsProvider.ts'],
  afterStartViableDays: ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/opportunityProjection.ts'],
  afterStartUnknownDays: ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/opportunityProjection.ts'],
  afterStartEvaluatedDays: ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/opportunityProjection.ts'],
  startDateState: ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/opportunityProjection.ts'],
  viableDays: ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/opportunityProjection.ts'],
  unknownDays: ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/opportunityProjection.ts'],
  durationBasis: ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/opportunityDecisionFacts.ts'],
  GENERIC_FALLBACK: ['apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionFacts.ts'],
  KNOWN_FEASIBLE: ['apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/opportunityProjection.ts'],
};
/** `coverage` is an everyday word elsewhere; it is a decision fact only where an opportunity-fact vocabulary appears with it. */
const COVERAGE_COMPANION = /OpportunityDecisionFacts|OpportunityEvidence|horizonStartDate|startDateState|afterStart/;
const COVERAGE_ALLOW = ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', DERIVER, 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/opportunityProjection.ts'];
/** The deriver is the ONLY module that COMPARES a raw scarcity field -- the single semantic derivation authority. */
const RAW_COMPARISON = /\.(afterStartViableDays|afterStartUnknownDays|afterStartEvaluatedDays|durationBasis|startDateState|remainingInPeriod|viableDays|unknownDays|coverage)\s*(!==|===|<=|>=|<|>)|(!==|===|<=|>=)\s*[A-Za-z_.]*\.(afterStartViableDays|afterStartUnknownDays|durationBasis|startDateState|remainingInPeriod)\b/;
/** A file that talks about scarcity facts at all (so an unrelated `.coverage ===` elsewhere is not mistaken for a second authority). */
const SCARCITY_CONTEXT = /afterStart|durationBasis|startDateState|remainingInPeriod/;
const RAW_TOKEN_ANY = new RegExp(`\\b(${Object.keys(RAW_FIELD_ALLOW).join('|')}|coverage)\\b`);
const SOURCE_VOCAB = /goal|manual|automatic|demand|provenance|handoff|hand-off|rhythm|plan-day|intentId|\btitle\b|activityId|startsWith|decodeGoal|encodeGoal|\bUI\b/i;
/** A consumer legitimately names Constructor IDENTITY (an intent id); it must still name no source concept, id-scheme parse, title or activity. */
const SOURCE_VOCAB_CONSUMER = new RegExp(SOURCE_VOCAB.source.replace('intentId|', ''), 'i');
const VALUE_VOCAB = /importance|deadline|originalOrder|targetDate/i;

/** Every rule is a pure function of the file set. Returns `RULE:detail:file` strings; empty means the tree conforms. */
function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const notIn = (list: string[], allow: string[]) => list.filter((f) => !allow.includes(f));

  // R1/R2 pressure vocabulary readers
  notIn(by(PRESSURE_IDENT), PRESSURE_IDENT_ALLOW).forEach((f) => v.push(`R1:pressure-identifier:${f}`));
  notIn(by(PRESSURE_WORD), PRESSURE_WORD_ALLOW).forEach((f) => v.push(`R2:pressure-word:${f}`));
  // R3 importers of the deriver
  notIn(by(PRESSURE_IMPORT), PRESSURE_IMPORTER_ALLOW).forEach((f) => v.push(`R3:imports-deriver:${f}`));
  // R4 the mutable transport boundary
  notIn(by(FACTS_IMPORT), FACTS_ALLOW).forEach((f) => v.push(`R4:imports-decisionFacts:${f}`));
  notIn(by(FACTS_IDENT), FACTS_ALLOW).forEach((f) => v.push(`R4:names-DecisionFacts:${f}`));
  // R5 evidence boundary
  notIn(by(EVIDENCE_IMPORT), EVIDENCE_IMPORTER_ALLOW).forEach((f) => v.push(`R5:imports-evidence:${f}`));
  notIn(by(EVIDENCE_IDENT), EVIDENCE_IDENT_ALLOW).forEach((f) => v.push(`R5:names-evidence:${f}`));
  // R6 raw field readers (exact allowlists) and the single comparison authority
  for (const [token, allow] of Object.entries(RAW_FIELD_ALLOW)) notIn(by(new RegExp(`\\b${token}\\b`)), allow).forEach((f) => v.push(`R6:raw-field-${token}:${f}`));
  notIn(files.filter((x) => /\bcoverage\b/.test(x.src) && COVERAGE_COMPANION.test(x.src)).map((x) => x.f), COVERAGE_ALLOW).forEach((f) => v.push(`R6:raw-field-coverage:${f}`));
  notIn(files.filter((x) => RAW_COMPARISON.test(x.src) && SCARCITY_CONTEXT.test(x.src)).map((x) => x.f), [DERIVER]).forEach((f) => v.push(`R6:second-comparison-authority:${f}`));
  // R7 pressure CONSUMERS (anything but the deriver that names pressure or imports the deriver)
  const consumers = files.filter((x) => x.f !== DERIVER && (PRESSURE_IDENT.test(x.src) || PRESSURE_IMPORT.test(x.src)));
  for (const c of consumers) {
    if (FACTS_IMPORT.test(c.src) || FACTS_IDENT.test(c.src)) v.push(`R7:consumer-reads-DecisionFacts:${c.f}`);
    if (RAW_TOKEN_ANY.test(c.src)) v.push(`R7:consumer-reads-raw-fact-field:${c.f}`);
    if (SOURCE_VOCAB_CONSUMER.test(c.src)) v.push(`R7:consumer-source-vocabulary:${c.f}`);
    if (VALUE_VOCAB.test(c.src)) v.push(`R7:consumer-combines-value-signal:${c.f}`);
  }
  // R9 the stronger-than-pressure helper reads value signals but names no pressure, evidence or facts (value and pressure stay in separate modules)
  const above = files.find((x) => x.f === ABOVE_PRESSURE);
  if (above && (PRESSURE_IDENT.test(above.src) || EVIDENCE_IDENT.test(above.src) || FACTS_IDENT.test(above.src) || FACTS_IMPORT.test(above.src))) v.push(`R9:above-pressure-helper-names-pressure-chain:${ABOVE_PRESSURE}`);
  // R8 the deriver itself: evidence-only, source-neutral, value-free
  const deriver = files.find((x) => x.f === DERIVER);
  if (deriver) {
    if (FACTS_IMPORT.test(deriver.src) || FACTS_IDENT.test(deriver.src)) v.push(`R8:deriver-reads-DecisionFacts:${DERIVER}`);
    if (SOURCE_VOCAB.test(deriver.src)) v.push(`R8:deriver-source-branch:${DERIVER}`);
    if (VALUE_VOCAB.test(deriver.src)) v.push(`R8:deriver-reads-value-signal:${DERIVER}`);
    if (!EVIDENCE_IMPORT.test(deriver.src)) v.push(`R8:deriver-does-not-take-evidence:${DERIVER}`);
  }
  return v;
}

const real = productionFiles();
const mutateFile = (files: SrcFile[], f: string, fn: (src: string) => string): SrcFile[] => files.map((x) => (x.f === f ? { f, src: fn(x.src) } : x));
const addFile = (files: SrcFile[], f: string, src: string): SrcFile[] => [...files, { f, src }];
const flags = (violations: string[], prefix: string, file?: string) => violations.some((x) => x.startsWith(prefix) && (file === undefined || x.endsWith(`:${file}`)));

// ============================================================
console.log('=== the real tree conforms to the authority model ===');
const baseline = audit(real);
check(`THE REAL PRODUCTION TREE HAS ZERO AUTHORITY VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);
check('the scanned set is the whole production surface (apps/web lib/app/components and every package src), and the deriver, evidence and facts modules are in it', real.length > 300 && [DERIVER, 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', 'apps/web/lib/decisionFactPreparation.ts'].every((f) => real.some((x) => x.f === f)));

// ============================================================
console.log('=== the authority chain, pinned stage by stage ===');
const src = (f: string) => real.find((x) => x.f === f)!.src;
check('STAGE 1 -- providers produce the MUTABLE DecisionFacts transport: the Goal provider imports and returns DecisionFacts and never touches DecisionEvidence or pressure', /import type \{[^}]*DecisionFacts[^}]*\} from '\.\/decisionFacts'/.test(src('apps/web/lib/goalDecisionFactsProvider.ts')) && !EVIDENCE_IDENT.test(src('apps/web/lib/goalDecisionFactsProvider.ts')) && !PRESSURE_IDENT.test(src('apps/web/lib/goalDecisionFactsProvider.ts')));
check('STAGE 2 -- DecisionFacts is the transport type, defined once in decisionFacts.ts (an exported mutable interface, not readonly)', /export interface DecisionFacts \{/.test(src('apps/web/lib/decisionFacts.ts')) && !/export interface DecisionFacts \{\s*readonly/.test(src('apps/web/lib/decisionFacts.ts')));
check('STAGE 3 -- the ONE converter facts -> evidence is `buildDecisionEvidence(facts)`, defined in decisionEvidence.ts and called from exactly one other production place: the preparation stage', JSON.stringify(real.filter((x) => /buildDecisionEvidence\(/.test(x.src)).map((x) => x.f)) === JSON.stringify(['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts']) && count(/buildDecisionEvidence\(/g, src('apps/web/lib/decisionFactPreparation.ts')) === 1);
check('STAGE 4 -- DecisionEvidence is the immutable, readonly, by-value authority: its module imports only types, freezes, and carries no policy', /export interface DecisionEvidence \{\s*readonly recurrence\?/.test(src('apps/web/lib/decisionEvidence.ts')) && count(/Object\.freeze\(/g, src('apps/web/lib/decisionEvidence.ts')) === 3 && !PRESSURE_IDENT.test(src('apps/web/lib/decisionEvidence.ts')));
check('STAGE 5 -- the deriver accepts ONLY immutable evidence (`readonly evidence: DecisionEvidence | undefined`) and imports it from decisionEvidence', /readonly evidence: DecisionEvidence \| undefined;/.test(src(DERIVER)) && EVIDENCE_IMPORT.test(src(DERIVER)) && !FACTS_IMPORT.test(src(DERIVER)));
check('STAGE 6 -- the pressure type is categorical and defined once, in the deriver: `NONE | LAST_KNOWN_OPPORTUNITY`', /export type DecisionPressure = 'NONE' \| 'LAST_KNOWN_OPPORTUNITY';/.test(src(DERIVER)) && JSON.stringify(real.filter((x) => /export type DecisionPressure =/.test(x.src)).map((x) => x.f)) === JSON.stringify([DERIVER]));
check('the compile-time limit is documented, not relied on: DecisionFacts IS structurally assignable to DecisionEvidence (this line type-checks), so the guard above -- not the compiler -- is what keeps facts out of policy', KNOWN_TYPE_LIMIT === true);
const facts: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 3 }, opportunity: { horizonStartDate: '2026-10-09', horizonEndDate: '2026-10-11', evaluatedDays: 3, viableDays: 1, unknownDays: 0, coverage: 'COMPLETE', durationMinutes: 60, durationBasis: 'RESOLVED', startDateState: 'KNOWN_FEASIBLE', afterStartEvaluatedDays: 2, afterStartViableDays: 0, afterStartUnknownDays: 0 } };
const evidence = buildDecisionEvidence(facts)!;
check('the real chain end to end on pure data: facts -> evidence (a distinct, frozen copy) -> pressure LAST_KNOWN_OPPORTUNITY; the mutable facts object is not the evidence', evidence !== (facts as unknown) && Object.isFrozen(evidence) && deriveDecisionPressure({ evidence, planningDate: '2026-10-09', flexibility: 'FLEXIBLE' }) === 'LAST_KNOWN_OPPORTUNITY');

// ============================================================
console.log('=== exact allowlists (any new reader must be added on purpose) ===');
const names = (re: RegExp) => real.filter((x) => re.test(x.src)).map((x) => x.f);
check('PRESSURE LITERAL AUTHORITY: `LAST_KNOWN_OPPORTUNITY`, `DecisionPressure`, `deriveDecisionPressure` and every pressure identifier appear in exactly five production files -- the P2b deriver, since O5 P3b the two inert shadow modules and, since O5 P4a, the two inert promotion-input modules that consume its derived value (none of them is read by the Constructor)', JSON.stringify(names(PRESSURE_IDENT)) === JSON.stringify([...PRESSURE_IDENT_ALLOW].sort()));
check('the word "pressure" appears only in the deriver, the P3b shadow modules, the P4a promotion-input modules and the stronger-than-pressure helper (whose names mark a position in the precedence order), and in unrelated UI copy ("low-pressure practice" in the action-card catalog)', JSON.stringify(names(PRESSURE_WORD)) === JSON.stringify([...PRESSURE_WORD_ALLOW].sort()) && /low-pressure/.test(read('packages/recommendation/src/actionCards.ts')) && !/pressure/i.test(stripComments(read('packages/recommendation/src/actionCards.ts')).replace(/low-pressure/g, '')));
check('ONLY THE INERT SHADOW AND PROMOTION-INPUT MODULES IMPORT THE DERIVER (P3b / P4a): the evaluator and the assembler import its type, the observation and preparation boundaries call it over immutable evidence; nothing in the Constructor, comparator, placement, capacity, replenishment, preview, signing, acceptance or persistence imports it, and there is no active policy consumer (P4 / P5 add consumers deliberately, by amending PRESSURE_IMPORTER_ALLOW and then satisfying the consumer rules)', JSON.stringify(names(PRESSURE_IMPORT)) === JSON.stringify([...PRESSURE_IMPORTER_ALLOW].sort()));
check('DECISIONFACTS BOUNDARY: exactly eight production files import or name the mutable transport -- orchestrator, preview boundary, DayIntent field, evidence converter, preparation stage, the facts module, the Goal provider and the opportunity enrichment', JSON.stringify(names(FACTS_IDENT)) === JSON.stringify([...FACTS_ALLOW].sort()) && JSON.stringify(names(FACTS_IMPORT)) === JSON.stringify(['apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/goalDecisionFactsProvider.ts', 'apps/web/lib/opportunityDecisionFacts.ts']));
check('DECISIONFACTS CANNOT BECOME POLICY AUTHORITY: no module that names pressure, imports the deriver or imports DecisionEvidence for policy also names DecisionFacts (the deriver and every future consumer are on the evidence side of the boundary)', [...names(PRESSURE_IDENT), ...names(PRESSURE_IMPORT)].every((f) => !FACTS_IDENT.test(src(f)) && !FACTS_IMPORT.test(src(f))));
check('EVIDENCE BOUNDARY: only the preparation stage and the deriver import DecisionEvidence; only they, the evidence module and the orchestrator that invokes the stage name it', JSON.stringify(names(EVIDENCE_IMPORT)) === JSON.stringify([...EVIDENCE_IMPORTER_ALLOW].sort()) && JSON.stringify(names(EVIDENCE_IDENT)) === JSON.stringify([...EVIDENCE_IDENT_ALLOW].sort()));
check('NOTHING READS DECISIONFACTS TO DECIDE: the `.decisionFacts` DayIntent field and the by-intent facts map are read only at the orchestrator / preview boundary that carries them', JSON.stringify(names(/\.decisionFacts\b|decisionFactsByIntentId/)) === JSON.stringify(['apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts']));
for (const token of Object.keys(RAW_FIELD_ALLOW)) {
  check(`RAW FIELD "${token}": read only by its allowlisted producer / transport / evidence / deriver modules`, JSON.stringify(names(new RegExp(`\\b${token}\\b`))) === JSON.stringify([...RAW_FIELD_ALLOW[token]].sort()));
}
check('RAW FIELD "coverage" (an everyday word elsewhere): wherever it appears with the opportunity-fact vocabulary it is in the producer / transport / evidence / deriver modules only', JSON.stringify(real.filter((x) => /\bcoverage\b/.test(x.src) && COVERAGE_COMPANION.test(x.src)).map((x) => x.f)) === JSON.stringify([...COVERAGE_ALLOW].sort()));
check('SINGLE DERIVATION AUTHORITY: of all production code, ONLY the deriver compares a raw scarcity field (`afterStartViableDays`, `afterStartUnknownDays`, `durationBasis`, `startDateState`, `remainingInPeriod`, ...) -- producers assign, the evidence module copies, nobody else decides', JSON.stringify(real.filter((x) => RAW_COMPARISON.test(x.src) && SCARCITY_CONTEXT.test(x.src)).map((x) => x.f)) === JSON.stringify([DERIVER]));

// ============================================================
console.log('=== inertness: nothing that decides, places, persists or presents mentions pressure ===');
const NEVER_PRESSURE = [
  'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts', 'apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts',
  'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts',
  'apps/web/lib/goalDecisionFactsProvider.ts', 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/opportunityProjection.ts', 'apps/web/lib/db.ts',
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts',
];
check('the Constructor, precedence comparator, placement, capacity, replenishment loop, preview boundary, signing, acceptance, persistence, Recomposition, presentation, providers, preparation and evidence modules contain no pressure reference', NEVER_PRESSURE.every((f) => !PRESSURE_WORD.test(src(f)) && !PRESSURE_IDENT.test(src(f))));
const comparator = (() => {
  const s = src('apps/web/lib/dayIntent.ts');
  const start = s.indexOf('export function compareByOverloadPrecedence');
  const open = s.indexOf('{', s.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < s.length; i++) { if (s[i] === '{') depth++; else if (s[i] === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); } }
  return '';
})();
check('COMPARATOR UNREAD: `compareByOverloadPrecedence` (the overload precedence the Constructor sorts by) reads no decision facts, evidence, recurrence, opportunity, pressure or raw fact field', comparator.length > 100 && !FACTS_IDENT.test(comparator) && !EVIDENCE_IDENT.test(comparator) && !PRESSURE_WORD.test(comparator) && !RAW_TOKEN_ANY.test(comparator) && !/recurrence|opportunity/i.test(comparator));
check('the Constructor, its capacity module and the replenishment / placement code never import the evidence, facts or deriver modules (dayConstructor.ts and dayCapacity.ts name none of them)', ['apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayCapacity.ts'].every((f) => !FACTS_IDENT.test(src(f)) && !EVIDENCE_IDENT.test(src(f)) && !PRESSURE_WORD.test(src(f))));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO PERSISTENCE: no Prisma model or field, and none of the 43 migration directories, mentions pressure; no migration was added', !/pressure/i.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/pressure/i.test(s)));
check('NO PREVIEW / SIGNING / DAYINTENT FIELD: the preview request, the signed result integrity module, DayIntent and ProposedItem / DeferredItem carry no pressure', ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayConstructor.ts'].every((f) => !PRESSURE_WORD.test(src(f))));
const DECISION_NAME = /decision|pressure|contention|shadow|opportunity/i;
const decisionModules = fs.readdirSync(path.join(root, 'apps/web/lib')).filter((n) => DECISION_NAME.test(n) && /\.tsx?$/.test(n)).sort();
check('DECISION-MODULE INVENTORY: the decision / pressure / contention / shadow / opportunity modules are exactly the known set -- since P2c: the P3a contention trace, the three P3b shadow-stage modules and the two P2d scheduling-snapshot modules (read-consistency only; neither carries pressure policy) and, since P4b2a, the pure promotion contention authority (a typed projection of P3a events; no pressure read) and, since P4b4, the inert same-run shadow policy composition (composes P4b2 / P4b3 over one run; reads no pressure) and, since P4b5, the server-controlled shadow execution boundary (OFF by default; mode check, failure isolation and minimal metrics only); no active-policy or explanation module exists yet (P4 / P5 own them and must amend this list)', JSON.stringify(decisionModules) === JSON.stringify(['abovePressurePrecedence.ts', 'contentionTrace.ts', 'decisionEvidence.ts', 'decisionFactPreparation.ts', 'decisionFacts.ts', 'decisionPressure.ts', 'decisionSchedulingContext.ts', 'decisionSchedulingContextLoader.ts', 'goalDecisionFactsProvider.ts', 'opportunityDecisionFacts.ts', 'opportunityProjection.ts', 'opportunityRangeAdapter.ts', 'opportunityRangeRealDeps.ts', 'promotionContentionAuthority.ts', 'shadowPolicyExecution.ts', 'shadowPolicyObservation.ts', 'shadowPressureEvaluation.ts', 'shadowPressureObservation.ts']));
check('no production identifier for an ACTIVE pressure policy or a pressure explanation exists (the P3a contention trace and the P3b shadow stage are the sanctioned, inert additions; their own guards, contentionTraceArchitecture.test.ts and shadowPressureArchitecture.test.ts, own their producer and consumer allowlists)', real.every((x) => !/\b(activePressurePolicy|explainPressure|pressureExplanation|PressurePolicy|promotePressure|pressurePromotion)\b/.test(x.src)));
check('the contention trace is orthogonal to pressure: the trace module and every file that names it mention no pressure, evidence or DecisionFacts -- except the two inert P3b shadow modules and the two inert P4a promotion-input modules, which are the sanctioned places the two observations are combined (nothing of the P2c authority chain is read by the trace itself)', real.filter((x) => /\b(ContentionEvent|ContentionTrace|constructDayWithTrace|orchestrateConstructDayWithTrace|contentionTrace)\b/.test(x.src)).every((x) => PRESSURE_CONSUMERS.includes(x.f) || !PRESSURE_IDENT.test(x.src) && !EVIDENCE_IDENT.test(x.src) || EVIDENCE_IDENT_ALLOW.includes(x.f)) && !PRESSURE_WORD.test(src('apps/web/lib/contentionTrace.ts')) && !FACTS_IDENT.test(src('apps/web/lib/contentionTrace.ts')) && !EVIDENCE_IDENT.test(src('apps/web/lib/contentionTrace.ts')));

// ============================================================
console.log('=== consumers, source neutrality and value-vs-pressure (rules on the real deriver; consumer rules are vacuous until a consumer exists) ===');
check('SOURCE NEUTRALITY: the deriver branches on no Goal, goal-demand, manual, automatic, provenance, hand-off, Rhythm, intent id, title, activity id or UI source (and has no id, title or source input)', !SOURCE_VOCAB.test(src(DERIVER)) && /export interface DecisionPressureInput \{\s*readonly evidence: DecisionEvidence \| undefined;\s*readonly planningDate: string;\s*readonly flexibility: PressureCandidateFlexibility;\s*\}/.test(src(DERIVER)));
check('VALUE vs PRESSURE: the deriver reads no importance, deadline, original order or target date -- importance / deadline are user / value / explicit-precedence signals; pressure is the temporal cost of deferral, and no module combines them (P2c does not)', !VALUE_VOCAB.test(src(DERIVER)));
check('the pressure CONSUMER set is exactly the two inert P3b shadow modules and the two inert P4a promotion-input modules, and EVERY consumer rule holds for them on the real tree (no DecisionFacts, no raw fact field, no source concept, no importance / deadline / original order / target date -- the value vocabulary lives only in the separate stronger-than-pressure helper, which names no pressure, evidence or facts)', JSON.stringify(real.filter((x) => x.f !== DERIVER && (PRESSURE_IDENT.test(x.src) || PRESSURE_IMPORT.test(x.src))).map((x) => x.f)) === JSON.stringify([...PRESSURE_CONSUMERS].sort()) && PRESSURE_CONSUMERS.every((f) => !VALUE_VOCAB.test(src(f)) && !SOURCE_VOCAB_CONSUMER.test(src(f)) && !FACTS_IDENT.test(src(f)) && !RAW_TOKEN_ANY.test(src(f))) && !PRESSURE_IDENT.test(src(ABOVE_PRESSURE)) && !EVIDENCE_IDENT.test(src(ABOVE_PRESSURE)) && !FACTS_IDENT.test(src(ABOVE_PRESSURE)));

// ============================================================
console.log('=== MUTATIONS OF THE GUARD: each violation class, injected into the real tree, is detected ===');
check('MUTATION: the deriver reads DecisionFacts instead of DecisionEvidence (imports the mutable transport) -> detected', flags(audit(mutateFile(real, DERIVER, (s) => `import type { DecisionFacts } from './decisionFacts';\n${s}`)), 'R4:imports-decisionFacts', DERIVER) && flags(audit(mutateFile(real, DERIVER, (s) => `import type { DecisionFacts } from './decisionFacts';\n${s}`)), 'R8:deriver-reads-DecisionFacts', DERIVER));
check('MUTATION: the deriver swaps its evidence input for facts (`readonly evidence` replaced by `readonly facts: DecisionFacts`) -> detected', flags(audit(mutateFile(real, DERIVER, (s) => s.replace("import type { DecisionEvidence } from './decisionEvidence';", '').replace('readonly evidence: DecisionEvidence | undefined;', 'readonly facts: DecisionFacts | undefined;'))), 'R8:deriver-does-not-take-evidence', DERIVER));
check('MUTATION: a SECOND module reimplements pressure from the raw recurrence / opportunity fields -> detected (raw-field readers and the single comparison authority)', (() => { const v = audit(addFile(real, 'apps/web/lib/rogueScarcityGate.ts', 'export const rogue = (o: { afterStartViableDays: number; afterStartUnknownDays: number }, r: { remainingInPeriod: number }) => r.remainingInPeriod > 0 && o.afterStartViableDays === 0 && o.afterStartUnknownDays === 0;')); return flags(v, 'R6:raw-field-afterStartViableDays', 'apps/web/lib/rogueScarcityGate.ts') && flags(v, 'R6:raw-field-remainingInPeriod', 'apps/web/lib/rogueScarcityGate.ts') && flags(v, 'R6:second-comparison-authority', 'apps/web/lib/rogueScarcityGate.ts'); })());
check('MUTATION: a second module reads durationBasis / startDateState to decide something of its own -> detected', (() => { const v = audit(addFile(real, 'apps/web/lib/rogueBasisGate.ts', "export const rogue = (o: { durationBasis: string; startDateState: string }) => o.durationBasis === 'RESOLVED' && o.startDateState === 'KNOWN_FEASIBLE';")); return flags(v, 'R6:raw-field-durationBasis', 'apps/web/lib/rogueBasisGate.ts') && flags(v, 'R6:raw-field-startDateState', 'apps/web/lib/rogueBasisGate.ts'); })());
check('MUTATION: a source-specific pressure branch (`intentId.startsWith("goal-demand")`) in the deriver -> detected', flags(audit(mutateFile(real, DERIVER, (s) => s.replace("if (input.flexibility !== 'FLEXIBLE') return false;", "if (input.flexibility !== 'FLEXIBLE') return false;\n  if ((input as unknown as { intentId: string }).intentId.startsWith('goal-demand')) return true;"))), 'R8:deriver-source-branch', DERIVER));
check('MUTATION: the deriver combines pressure with importance / a deadline -> detected', flags(audit(mutateFile(real, DERIVER, (s) => s.replace("if (input.flexibility !== 'FLEXIBLE') return false;", "if (input.flexibility !== 'FLEXIBLE') return false;\n  if ((input as unknown as { importance: string }).importance === 'HIGH') return true;"))), 'R8:deriver-reads-value-signal', DERIVER));
check('MUTATION: a direct pressure read inside the precedence comparator file (dayIntent.ts imports and calls the deriver) -> detected', (() => { const v = audit(mutateFile(real, 'apps/web/lib/dayIntent.ts', (s) => `import { deriveDecisionPressure } from './decisionPressure';\n${s}`)); return flags(v, 'R1:pressure-identifier', 'apps/web/lib/dayIntent.ts') && flags(v, 'R3:imports-deriver', 'apps/web/lib/dayIntent.ts'); })());
check('MUTATION: pressure read inside the Constructor / placement (dayConstructor.ts names LAST_KNOWN_OPPORTUNITY) -> detected', flags(audit(mutateFile(real, 'apps/web/lib/dayConstructor.ts', (s) => `${s}\nconst boost = 'LAST_KNOWN_OPPORTUNITY';`)), 'R1:pressure-identifier', 'apps/web/lib/dayConstructor.ts'));
check('MUTATION: pressure added to the preview, the signed result, acceptance persistence or the schema surface -> detected', ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/db.ts'].every((f) => flags(audit(mutateFile(real, f, (s) => `${s}\nexport const pressure = 'NONE';`)), 'R2:pressure-word', f)));
check('MUTATION: a pressure consumer that also reads DecisionFacts, a raw fact field, a source concept or importance -> detected by every consumer rule', (() => { const v = audit(addFile(real, 'apps/web/lib/rogueConsumer.ts', "import { deriveDecisionPressure } from './decisionPressure';\nimport type { DecisionFacts } from './decisionFacts';\nexport const c = (f: DecisionFacts, goalId: string, importance: string) => deriveDecisionPressure({ evidence: undefined, planningDate: '', flexibility: 'FLEXIBLE' }) && f.opportunity?.afterStartViableDays === 0;")); return ['R3:imports-deriver', 'R4:imports-decisionFacts', 'R7:consumer-reads-DecisionFacts', 'R7:consumer-reads-raw-fact-field', 'R7:consumer-source-vocabulary', 'R7:consumer-combines-value-signal'].every((rule) => flags(v, rule, 'apps/web/lib/rogueConsumer.ts')); })());
check('MUTATION: a new module imports the immutable evidence outside the preparation stage and the deriver -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueEvidenceReader.ts', "import type { DecisionEvidence } from './decisionEvidence';\nexport const e = (x: DecisionEvidence) => x;")), 'R5:imports-evidence', 'apps/web/lib/rogueEvidenceReader.ts'));
check('MUTATION: a new module names DecisionFacts outside the transport allowlist -> detected', flags(audit(addFile(real, 'apps/web/lib/roguePolicy.ts', "import type { DecisionFacts } from './decisionFacts';\nexport type P = DecisionFacts;")), 'R4:imports-decisionFacts', 'apps/web/lib/roguePolicy.ts'));
const cleanAfterMutations = audit(real);
check('MUTATION: the stronger-than-pressure helper names pressure / evidence / facts (value and pressure merged into one module) -> detected', flags(audit(mutateFile(real, ABOVE_PRESSURE, (x) => `import type { DecisionPressure } from './decisionPressure';\n${x}`)), 'R9:above-pressure-helper-names-pressure-chain', ABOVE_PRESSURE));
check('MUTATION: a shadow consumer that reads a value signal or a source concept -> detected by the consumer rules', flags(audit(mutateFile(real, SHADOW_EVALUATOR, (x) => `${x}\nexport const leaked = (i: { importance: string }) => i.importance;`)), 'R7:consumer-combines-value-signal', SHADOW_EVALUATOR) && flags(audit(mutateFile(real, SHADOW_EVALUATOR, (x) => `${x}\nexport const g = (id: string) => id.startsWith('goal-demand');`)), 'R7:consumer-source-vocabulary', SHADOW_EVALUATOR));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', cleanAfterMutations.length === 0);

// ============================================================
console.log('=== behavior anchors (the semantic mutations: fallback or an unknown day must never qualify) ===');
const scarce = (overrides: Partial<NonNullable<DecisionFacts['opportunity']>> = {}) => buildDecisionEvidence({ ...facts, opportunity: { ...facts.opportunity!, ...overrides } })!;
const pressureOf = (e: DecisionEvidence) => deriveDecisionPressure({ evidence: e, planningDate: '2026-10-09', flexibility: 'FLEXIBLE' });
check('ANCHOR: the fully qualifying scarce evidence is LAST_KNOWN_OPPORTUNITY; the same evidence with a GENERIC_FALLBACK duration is NONE (fallback never qualifies)', pressureOf(scarce()) === 'LAST_KNOWN_OPPORTUNITY' && pressureOf(scarce({ durationBasis: 'GENERIC_FALLBACK' })) === 'NONE');
check('ANCHOR: an UNKNOWN later day never qualifies (afterStartUnknownDays 1 with the totals kept consistent)', pressureOf(scarce({ unknownDays: 1, afterStartUnknownDays: 1, evaluatedDays: 3 })) === 'NONE');
check('ANCHOR: PARTIAL / UNKNOWN coverage, an UNKNOWN or infeasible start day, and a later viable day never qualify', pressureOf(scarce({ coverage: 'PARTIAL' })) === 'NONE' && pressureOf(scarce({ coverage: 'UNKNOWN' })) === 'NONE' && pressureOf(scarce({ startDateState: 'KNOWN_INFEASIBLE', viableDays: 0 })) === 'NONE' && pressureOf(scarce({ viableDays: 2, afterStartViableDays: 1 })) === 'NONE');
check('ANCHOR: absent evidence and FIXED flexibility are NONE', deriveDecisionPressure({ evidence: undefined, planningDate: '2026-10-09', flexibility: 'FLEXIBLE' }) === 'NONE' && deriveDecisionPressure({ evidence: scarce(), planningDate: '2026-10-09', flexibility: 'FIXED' }) === 'NONE');

// ============================================================
console.log('=== required CI wiring (a guard that is not run guards nothing) ===');
const workflow = read('.github/workflows/ci.yml').split('\n');
let currentJob = '';
const stepJob = new Map<string, string>();
let inJobs = false;
for (const line of workflow) {
  if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
  const job = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
  if (inJobs && job) currentJob = job[1];
  const run = line.match(/^\s+run: npx ts-node (test\/[A-Za-z0-9_]+\.test\.ts)\s*$/);
  if (run && currentJob) stepJob.set(run[1], currentJob);
}
const jobOf = (suite: string) => stepJob.get(`test/${suite}.test.ts`);
check('the authority guard and the pure catalog-reachability suite run in the required PURE job (math-core-tests = "Ephemeris / panchang tests")', jobOf('decisionPressureAuthority') === 'math-core-tests' && jobOf('decisionPressureCatalogReachability') === 'math-core-tests');
check('the real-producer reachability suite runs in the required DB job (day-constructor-acceptance-db-tests = "Day Constructor acceptance DB tests")', jobOf('decisionPressureReachabilityDb') === 'day-constructor-acceptance-db-tests');
check('the P2b suites and the P2a evidence suites are still required where they were (pure: decisionPressure, decisionPressureArchitecture, decisionEvidence, decisionEvidenceArchitecture; DB: decisionPressureDb, decisionEvidenceDb)', ['decisionPressure', 'decisionPressureArchitecture', 'decisionEvidence', 'decisionEvidenceArchitecture'].every((s) => jobOf(s) === 'math-core-tests') && ['decisionPressureDb', 'decisionEvidenceDb'].every((s) => jobOf(s) === 'day-constructor-acceptance-db-tests'));

// ============================================================
console.log('=== no flaky mechanics (the #201 lesson) and honest claims ===');
/** The two behavioral suites (this guard's own source necessarily spells out the patterns it forbids). */
const NEW_SUITES = ['test/decisionPressureCatalogReachability.test.ts', 'test/decisionPressureReachabilityDb.test.ts'];
const FLAKY = /\bctid\b|VACUUM|ANALYZE|EXPLAIN\b|Math\.random|setTimeout|setInterval|Date\.now\(|new Date\(\)|\bsleep\b|enable_hashjoin|set_config/;
check('the new behavioral suites assert product invariants only: no heap layout (ctid), VACUUM, query-plan, random, timer or wall-clock mechanics', NEW_SUITES.every((f) => !FLAKY.test(stripComments(read(f)))));
const FALSE_CLAIM = /policy (is )?(active|enabled|applied)|changes? (the )?(placement|precedence|winner)|affects? the (constructed|proposed)|snapshot[- ]consistent|coherent snapshot|P4 (is )?ready|ready for P4/i;
check('no assertion label in the new behavioral suites claims pressure is wired or active, changes a Constructor outcome, is snapshot-consistent, or that P4 is ready', NEW_SUITES.every((f) => !(read(f).match(/check\(`?'?[^\n]*/g) ?? []).some((l) => FALSE_CLAIM.test(l))));
check('P2D RETAINED: the evidence and preparation modules still contain no REPEATABLE READ / snapshot machinery -- DecisionEvidence is immutable, but its recurrence and opportunity inputs are not yet read from one coherent scheduling snapshot (P2c may approve P3 shadow; it must not approve P4 activation)', !/REPEATABLE READ|ISOLATION|snapshotAt|schedulingContext|beginTransaction/i.test(src('apps/web/lib/decisionEvidence.ts') + src('apps/web/lib/decisionFactPreparation.ts')));

if (!allPassed) {
  console.error('SOME DECISION PRESSURE AUTHORITY CHECKS FAILED');
  process.exit(1);
}
console.log('ALL DECISION PRESSURE AUTHORITY CHECKS PASSED');
