/**
 * O5 SHADOW ROLLOUT R3 -- the Preview-only manual review HARNESS architecture guard (pure source inspection, real tree +
 * in-memory mutations).
 *
 * Pins, across the three touched production files (shadowPolicyExecution.ts, shadowEvidence.ts, dayConstructorPreviewRequest.ts):
 *   - the Preview server guard (VERCEL_ENV, read once, server-only) cannot be bypassed from the request/client
 *   - review eligibility REQUIRES both `reviewEligible` (environment) AND the real evidence reaching
 *     selector=APPLY, gate=MATERIALIZABLE, materializer=READY, invariant=PASS, failure=NONE -- nothing weaker
 *   - the review payload never reaches a return value that could replace the baseline, is never persisted (no database/
 *     ProductEvent/Plan/GoalActivityOccurrence/filesystem/log reference anywhere in the three files) and is attached to
 *     the HTTP body ONLY before signing, as a sibling field the signer passes through untouched
 *   - the materializer the review reuses is the SAME one the evidence derivation already calls (no second policy
 *     evaluation, no rerun)
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
  return out.sort((a, b) => (a.f < b.f ? -1 : 1));
}

const EXEC = 'apps/web/lib/shadowPolicyExecution.ts';
const EVID = 'apps/web/lib/shadowEvidence.ts';
const DELTA = 'apps/web/lib/shadowReviewDelta.ts';
const REQUEST = 'apps/web/lib/dayConstructorPreviewRequest.ts';
const ROUTE = 'apps/web/app/api/day-constructor/preview/route.ts';

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);

  // W1 -- the environment guard itself
  const exec = get(EXEC);
  if (exec) {
    const s = exec.src;
    if (!/export function isPreviewReviewEligibleEnvironment\(raw: unknown\): boolean \{\n  return raw !== 'production';\n\}/.test(s)) v.push(`W1:guard-is-not-the-reviewed-exact-value-check:${EXEC}`);
    if (!/reviewEligible: isPreviewReviewEligibleEnvironment\(process\.env\.VERCEL_ENV\)/.test(s)) v.push(`W1:reviewEligible-is-not-set-from-vercel_env-in-the-settings-constructor:${EXEC}`);
    if (count(/process\.env\.VERCEL_ENV/g, s) !== 1) v.push(`W1:vercel_env-read-more-than-once-or-nowhere:${EXEC}`);
    // the eligibility predicate: BOTH reviewEligible AND onReview required -- never either alone
    if (!/execution\.reviewEligible && execution\.onReview \? \{ \.\.\.execution\.evidenceDeps, onReviewReady: reviewHandoff\(execution\.onReview\) \}/.test(s)) v.push(`W2:eligibility-is-not-the-reviewed-both-conditions:${EXEC}`);
  }
  // no request/client/header/cookie/query path can set reviewEligible or onReview (same discipline as the mode itself)
  for (const f of [REQUEST, ROUTE]) { const x = get(f); if (x && /reviewEligible\s*:\s*(true|req\.|body\.|headers)/i.test(x.src)) v.push(`W3:reviewEligible-set-outside-the-server-settings-constructor:${f}`); }
  by(/isPreviewReviewEligibleEnvironment\(/).filter((f) => f !== EXEC).forEach((f) => v.push(`W3:guard-called-outside-the-settings-constructor:${f}`));
  by(/process\.env\.VERCEL_ENV/).filter((f) => f !== EXEC).forEach((f) => v.push(`W3:a-second-vercel_env-read-exists-outside-the-boundary:${f}`));

  // W4 -- the materialized result backing the review never reaches a return value anywhere in the three files; no storage anywhere
  for (const f of [EXEC, EVID, DELTA, REQUEST]) {
    const x = get(f); if (!x) continue;
    if (/\.create\(\s*\{[^}]*Plan|GoalActivityOccurrence|ProductEvent|prisma\.|\bpool\b|\.query\(|writeFileSync|appendFileSync|localStorage/.test(x.src)) v.push(`W4:storage-reference:${f}`);
  }
  // the log line (console.info) exists ONLY in shadowPolicyExecution.ts and never references the review payload or shadowReviewDelta
  by(/console\./).filter((f) => [EVID, DELTA].includes(f)).forEach((f) => v.push(`W4:logging-outside-the-boundary:${f}`));
  { const x = get(EXEC); if (x && /console\.[a-z]+\([^;]*\breview\b/i.test(x.src)) v.push(`W4:the-log-line-references-the-review-payload:${EXEC}`); }
  { const x = get(REQUEST); if (x && /console\.[a-z]+\([^;]*\breview\b/i.test(x.src)) v.push(`W4:the-log-line-references-the-review-payload:${REQUEST}`); }

  // W5 -- the response attaches the review ONLY before signing, as a sibling field, never inside what gets signed
  const req = get(REQUEST);
  if (req) {
    const s = req.src;
    if (!/const bodyWithReview = review \? \{ \.\.\.result\.body, shadowReview: review \} : result\.body;/.test(s)) v.push(`W5:review-is-not-attached-as-the-reviewed-sibling-field:${REQUEST}`);
    if (!/signPreviewResultBody\(session\.userId, bodyWithReview\)/.test(s)) v.push(`W5:signing-does-not-cover-bodyWithReview:${REQUEST}`);
    if (/shadowReview[^\n]*proposedItems|proposedItems[^\n]*shadowReview/.test(s)) v.push(`W5:review-items-are-mixed-into-proposedItems:${REQUEST}`);
  }

  // W6 -- no second materializer call for the review: the hand-off is wired through the SAME evidenceDeps the evidence derivation already uses
  { const x = get(EXEC); if (x && (!/const deps: ShadowEvidenceDeps = execution\.reviewEligible && execution\.onReview \?/.test(x.src) || count(/\(execution\.deriveEvidence \?\? deriveShadowEvidence\)\(baseline, run, deps\)/g, x.src) !== 1)) v.push(`W6:review-is-not-wired-through-the-single-evidence-call:${EXEC}`); }

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
check(`THE REAL PRODUCTION TREE HAS ZERO SHADOW-ROLLOUT-R3 ARCHITECTURE VIOLATIONS (${real.length} files scanned)${base.length ? ': ' + base.join(', ') : ''}`, base.length === 0);

console.log('=== the rules ===');
check('THE ENVIRONMENT GUARD IS THE REVIEWED EXACT VALUE CHECK, READ ONCE, SERVER-ONLY', !flags(base, 'W1:'));
check('ELIGIBILITY REQUIRES BOTH reviewEligible AND onReview', !flags(base, 'W2:'));
check('NO CLIENT/REQUEST PATH CAN SET REVIEW ELIGIBILITY', !flags(base, 'W3:'));
check('NO STORAGE, NO LOGGING OF THE REVIEW PAYLOAD', !flags(base, 'W4:'));
check('THE REVIEW IS A SIBLING FIELD ATTACHED BEFORE SIGNING, NEVER MIXED INTO proposedItems', !flags(base, 'W5:'));
check('NO SECOND MATERIALIZER CALL FOR THE REVIEW', !flags(base, 'W6:'));

console.log('=== mutations (in-memory; the real tree is untouched) ===');
check('MUTATION: the Preview guard is removed (reviewEligible hardcoded true) -> detected', flags(auditM(EXEC, rep("reviewEligible: isPreviewReviewEligibleEnvironment(process.env.VERCEL_ENV)", "reviewEligible: true")), 'W1:', EXEC));
check('MUTATION: the guard itself is loosened (Production also eligible) -> detected', flags(auditM(EXEC, rep("return raw !== 'production';", "return true;")), 'W1:', EXEC) && flags(auditM(EXEC, rep("return raw !== 'production';", "return raw !== 'PRODUCTION';")), 'W1:', EXEC) === false || flags(auditM(EXEC, rep("return raw !== 'production';", "return raw !== 'PRODUCTION';")), 'W1:', EXEC));
check('MUTATION: a second VERCEL_ENV read appears elsewhere -> detected', flags(auditM(DELTA, (s) => `${s}\nconst e = () => process.env.VERCEL_ENV;`), 'W3:', DELTA));
check('MUTATION: reviewEligible is fed from the request body or a header -> detected', flags(auditM(REQUEST, (s) => `${s}\nexport const leak = (body: { reviewEligible?: boolean }) => ({ reviewEligible: body.reviewEligible ?? true });`), 'W3:', REQUEST));
check('MUTATION: eligibility collapses to reviewEligible alone (onReview no longer required) -> detected', flags(auditM(EXEC, rep("execution.reviewEligible && execution.onReview ? { ...execution.evidenceDeps, onReviewReady: reviewHandoff(execution.onReview) }", "execution.reviewEligible ? { ...execution.evidenceDeps, onReviewReady: reviewHandoff(execution.onReview!) }")), 'W2:', EXEC));
check('MUTATION: a Plan/GoalActivityOccurrence/ProductEvent/DB write is added near the review hand-off -> detected', flags(auditM(EXEC, (s) => `${s}\nconst w = () => prisma.plan.create({ data: {} });`), 'W4:', EXEC) && flags(auditM(DELTA, (s) => `${s}\nconst w = () => pool.query('INSERT INTO "Plan" VALUES (1)');`), 'W4:', DELTA));
check('MUTATION: the review payload is logged -> detected', flags(auditM(EXEC, rep("console.info(JSON.stringify({ event: 'DAY_CONSTRUCTOR_SHADOW_POLICY', ...metrics }));", "console.info(JSON.stringify({ event: 'DAY_CONSTRUCTOR_SHADOW_POLICY', ...metrics }), review);")), 'W4:the-log-line-references-the-review-payload', EXEC) && flags(auditM(DELTA, (s) => `${s}\nconst l = () => console.log('review built');`), 'W4:logging-outside-the-boundary', DELTA));
check('MUTATION: the review is merged into proposedItems instead of a sibling field -> detected', flags(auditM(REQUEST, rep("const bodyWithReview = review ? { ...result.body, shadowReview: review } : result.body;", "const bodyWithReview = review ? { ...result.body, shadowReview: review, proposedItems: review.changedItems } : result.body;")), 'W5:', REQUEST));
check('MUTATION: signing stops covering the field that carries the review (bypasses bodyWithReview) -> detected', flags(auditM(REQUEST, rep("signPreviewResultBody(session.userId, bodyWithReview)", "signPreviewResultBody(session.userId, result.body)")), 'W5:', REQUEST));
check('MUTATION: the review hand-off is rewired to call the materializer a second time independently -> detected', flags(auditM(EXEC, rep("const deps: ShadowEvidenceDeps = execution.reviewEligible && execution.onReview ? { ...execution.evidenceDeps, onReviewReady: reviewHandoff(execution.onReview) } : execution.evidenceDeps ?? {};\n    return (execution.deriveEvidence ?? deriveShadowEvidence)(baseline, run, deps);", "const evidence = (execution.deriveEvidence ?? deriveShadowEvidence)(baseline, run, execution.evidenceDeps ?? {});\n    if (execution.reviewEligible && execution.onReview) { const again = materializeActiveResult({} as never); void again; }\n    return evidence;")), 'W6:', EXEC));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(real).length === 0);

if (!allPassed) { console.error('SOME SHADOW ROLLOUT R3 ARCHITECTURE CHECKS FAILED'); process.exit(1); }
console.log('ALL SHADOW ROLLOUT R3 ARCHITECTURE CHECKS PASSED');
