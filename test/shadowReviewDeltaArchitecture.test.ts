/**
 * O5 SHADOW ROLLOUT R3 -- `shadowReviewDelta.ts` architecture guard (pure source inspection, real tree + in-memory mutations).
 *
 * Pins that the review-payload builder:
 *   - reads ONLY the authority's own pre-computed `promoted` / `relocated` / `displacedOwnerIds` for the changed placements
 *     (no diffing, ranking, inference or second scheduling interpretation)
 *   - exposes a closed, five-field item shape (intentId, title, kind, baseline, alternative) and nothing else
 *   - never reads/returns any ConstructionBasis, BaselinePlacements, SchedulingAttempts, fingerprint, DecisionFacts, contention or
 *     pressure vocabulary
 *   - is pure (no database, clock, randomness, logging, environment) and never throws (every inconsistency -> undefined)
 *   - is imported only by the SHADOW execution boundary
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

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

const DELTA = 'apps/web/lib/shadowReviewDelta.ts';
const EXEC = 'apps/web/lib/shadowPolicyExecution.ts';
/** Allowed TYPE-only (never value) importer: the Preview response boundary, to type the captured hand-off. */
const PREVIEW_REQUEST = 'apps/web/lib/dayConstructorPreviewRequest.ts';
/** Allowed TYPE-only (never value) importer: the client-side response parser, to type the optional field it reads defensively. */
const PREVIEW_CLIENT = 'apps/web/lib/dayConstructorPreviewClient.ts';

const IMPURE_VOCAB = /Date\.now|new Date\(\)|performance\.|hrtime|Math\.random|crypto|process\.|\benv\b|console\.|logger|telemetry|setTimeout|setInterval|\bawait\b|\basync\b|Promise|fetch\(|require\(/;
const DB_VOCAB = /from '\.\/db'|\bpool\b|\.query\(|prisma|INSERT|UPDATE|DELETE|loadDecisionSchedulingContext|loadBlockingPlans|loadDurationContext|loadAvailabilityConfiguration|prepareDecisionFacts/i;
const SECOND_RUN_VOCAB = /\bpreparePromotionInputs\b|\borchestrateConstructDay\w*|\bconstructDay\w*\(|\bobserveShadowPolicy\b|\bgenerateLocalCounterfactual\b|\bevaluateCounterfactualAcceptance\b|\bmintAcceptedCounterfactual\b|\bselectActiveCounterfactual\b|\bevaluateMaterializability\b|\bmaterializeActiveResult\b|\bcheckMaterializationInvariants\b|\bsearchTiming\b|runTimingSearch/;
const POLICY_VOCAB = /\bDecisionPressure\b|LAST_KNOWN_OPPORTUNITY|\.pressure\b|ContentionTrace|contentionTrace|\bNONE\b/i;
const PRIVATE_VOCAB = /userId|\buser\b|email|birth|latitude|longitude|timezone|\bnotes?\b|goalId|activityId|planId|occurrenceId/i;

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const exportsOf = (s: string) => Array.from(s.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1]);

  by(/\bbuildShadowReviewPayload\b/).filter((f) => f !== DELTA && f !== EXEC).forEach((f) => v.push(`D1:another-caller:${f}`));
  by(/from '\.\/shadowReviewDelta'/).filter((f) => f !== EXEC && f !== PREVIEW_REQUEST && f !== PREVIEW_CLIENT).forEach((f) => v.push(`D1:another-importer:${f}`));
  by(/^import (?!type )[^\n]*from '\.\/shadowReviewDelta'/m).filter((f) => f !== EXEC).forEach((f) => v.push(`D1:a-value-import-outside-the-boundary:${f}`));

  const d = get(DELTA);
  if (d) {
    const s = d.src;
    if (JSON.stringify(exportsOf(s)) !== JSON.stringify(['ShadowReviewReason', 'ShadowReviewSlot', 'ShadowReviewItem', 'ShadowReviewPayload', 'buildShadowReviewPayload'])) v.push(`D2:exports-changed:${DELTA}`);
    if (JSON.stringify(Array.from(s.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify([
      `import type { OrchestrateConstructDayResult } from './dayConstructorOrchestrator';`,
      `import type { AcceptedCounterfactual, AcceptedPlacement } from './acceptedCounterfactual';`,
      `import type { PlacementTimingFit, ProposedItem } from './dayConstructor';`,
    ])) v.push(`D2:imports-are-not-the-reviewed-three-types-only:${DELTA}`);
    if (/^import (?!type )/m.test(s)) v.push(`D2:a-value-import-exists:${DELTA}`); // every import must be TYPE-only: no real call is possible
    // the changed-item data comes ONLY from the authority's own fields -- never a second diff/derivation
    if (!/accepted\.promoted/.test(s) || !/accepted\.relocated/.test(s) || !/accepted\.displacedOwnerIds/.test(s) || !/accepted\.candidateIntentId/.test(s)) v.push(`D3:does-not-read-the-authoritys-own-fields:${DELTA}`);
    if (/\.sort\(|\.filter\(.*start|\.find\(.*start.*start|Math\.min|Math\.max|<\s*\w+\.start|>\s*\w+\.start/.test(s)) v.push(`D3:looks-like-a-second-scheduling-interpretation:${DELTA}`);
    const iface = (s.match(/export interface ShadowReviewItem \{[\s\S]*?\n\}/) ?? [''])[0];
    if (JSON.stringify(Array.from(iface.matchAll(/readonly (\w+):/g)).map((x) => x[1])) !== JSON.stringify(['intentId', 'title', 'kind', 'baseline', 'alternative'])) v.push(`D4:item-schema-changed:${DELTA}`);
    if (POLICY_VOCAB.test(s)) v.push(`D4:policy-vocabulary:${DELTA}`);
    if (SECOND_RUN_VOCAB.test(s)) v.push(`D4:second-run-vocabulary:${DELTA}`);
    if (PRIVATE_VOCAB.test(s)) v.push(`D4:private-vocabulary:${DELTA}`);
    if (DB_VOCAB.test(s) || IMPURE_VOCAB.test(s)) v.push(`D5:impure:${DELTA}`);
    if (count(/\btry \{/g, s) !== 1 || count(/\} catch \{/g, s) !== 1) v.push(`D5:not-wrapped-in-one-fail-closed-try:${DELTA}`);
    if (!/^export function buildShadowReviewPayload\([^)]*\): ShadowReviewPayload \| undefined \{\n  try \{/m.test(s)) v.push(`D5:not-the-reviewed-fail-closed-signature:${DELTA}`);
    if (!/\} catch \{\n    return undefined;\n  \}\n\}/.test(s)) v.push(`D5:a-failure-does-not-yield-undefined:${DELTA}`);
  }

  // confinement at the boundary
  const e = get(EXEC);
  if (e && (count(/\bbuildShadowReviewPayload\(/g, e.src) !== 1)) v.push(`D1:boundary-does-not-call-it-exactly-once:${EXEC}`);
  return v;
}

const real = productionFiles();
const mutateFile = (files: SrcFile[], f: string, fn: (s: string) => string): SrcFile[] => files.map((x) => (x.f === f ? { f, src: fn(x.src) } : x));
const addFile = (files: SrcFile[], f: string, s: string): SrcFile[] => [...files, { f, src: s }];
const flags = (violations: string[], prefix: string, file?: string) => violations.some((x) => x.startsWith(prefix) && (file === undefined || x.endsWith(`:${file}`)));
const auditM = (f: string, fn: (s: string) => string) => audit(mutateFile(real, f, fn));
const rep = (from: string, to: string) => (s: string) => {
  const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '[ \\t]*\n'));
  if (!re.test(s)) throw new Error(`mutation target missing: ${from.slice(0, 80)}`);
  return s.replace(re, () => to);
};

console.log('=== the real tree conforms ===');
const base = audit(real);
check(`THE REAL PRODUCTION TREE HAS ZERO SHADOW-REVIEW-DELTA ARCHITECTURE VIOLATIONS (${real.length} files scanned)${base.length ? ': ' + base.join(', ') : ''}`, base.length === 0);

console.log('=== the rules ===');
check('CONFINEMENT: the builder is imported and CALLED only by the SHADOW execution boundary; the Preview response boundary and the client-side response parser may import the payload TYPE only (to type what they capture/validate), never the function', !flags(base, 'D1:'));
check('TYPE-ONLY IMPORTS: exactly the three reviewed type-only imports, no value import, no real call into the Constructor/selector/gate/materializer/mint/search possible', !flags(base, 'D2:'));
check('NO NEW SCHEDULING INTERPRETATION: the changed items come only from the authority\'s own promoted/relocated/displacedOwnerIds/candidateIntentId fields, never a sort/min/max/comparison over instants', !flags(base, 'D3:'));
check('CLOSED ITEM SCHEMA, NO POLICY / SECOND-RUN / PRIVATE VOCABULARY', !flags(base, 'D4:'));
check('PURE AND FAIL-CLOSED: no database/clock/randomness/logging/environment; the whole function is one try, and any failure yields undefined, never a throw or a partial payload', !flags(base, 'D5:'));

console.log('=== mutations (in-memory; the real tree is untouched) ===');
check('MUTATION: another module calls or imports the builder -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueReview.ts', "import { buildShadowReviewPayload } from './shadowReviewDelta';\nexport const r = buildShadowReviewPayload;")), 'D1:another-importer', 'apps/web/lib/rogueReview.ts'));
check('MUTATION: a value import is added (e.g. the real selector) -> detected', flags(auditM(DELTA, (s) => `${s}\nimport { selectActiveCounterfactual } from './activeSelector';`), 'D2:', DELTA));
check('MUTATION: the payload starts reading a second-derivation field instead of the authority\'s own -> detected', flags(auditM(DELTA, (s) => `${s}\nconst sorted = (items: { start: Date }[]) => items.sort((a, b) => a.start.getTime() - b.start.getTime());`), 'D3:', DELTA));
check('MUTATION: a policy/second-run/private identifier appears -> detected', flags(auditM(DELTA, (s) => `${s}\nexport const p = 'LAST_KNOWN_OPPORTUNITY';`), 'D4:policy', DELTA) && flags(auditM(DELTA, (s) => `${s}\nconst u = (x: { userId: string }) => x.userId;`), 'D4:private', DELTA) && flags(auditM(DELTA, (s) => `${s}\nconst g = () => selectActiveCounterfactual({} as never);`), 'D4:second-run', DELTA));
check('MUTATION: a database/clock/log call, or the function stops being one fail-closed try -> detected', flags(auditM(DELTA, (s) => `${s}\nconst n = () => new Date();`), 'D5:impure', DELTA) && flags(auditM(DELTA, (s) => `${s}\nconst l = () => console.log('x');`), 'D5:impure', DELTA) && flags(auditM(DELTA, rep('  } catch {\n    return undefined;\n  }\n}', '  } catch {\n    throw new Error("x");\n  }\n}')), 'D5:a-failure-does-not-yield-undefined', DELTA));
check('MUTATION: the boundary stops calling it, or calls it twice -> detected', flags(auditM(EXEC, (s) => s.replace('buildShadowReviewPayload(handoff.baselineResult, handoff.materializedResult, handoff.accepted)', 'undefined')), 'D1:boundary-does-not-call-it-exactly-once', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst twice = () => buildShadowReviewPayload({} as never, {} as never, {} as never);`), 'D1:boundary-does-not-call-it-exactly-once', EXEC));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(real).length === 0);

if (!allPassed) { console.error('SOME SHADOW REVIEW DELTA ARCHITECTURE CHECKS FAILED'); process.exit(1); }
console.log('ALL SHADOW REVIEW DELTA ARCHITECTURE CHECKS PASSED');
