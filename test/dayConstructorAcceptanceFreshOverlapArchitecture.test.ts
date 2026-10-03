/**
 * Schedule write consistency -- S1: acceptance's authoritative overlap read
 * (architecture guard, pure).
 *
 * Pins that Constructor acceptance's fresh-blocker read uses the canonical
 * half-open OVERLAP loader, on the acceptance TRANSACTION client, after the
 * existing per-user lock and before any accepted-plan write -- and that this
 * slice stayed narrow: no new overlap SQL, no lock/helper/timeout change, no
 * change to the plan-creation route, no schema, no policy vocabulary.
 *
 * It deliberately does NOT assert that acceptance is race-free: an unlocked
 * writer is outside this slice (see the DB test's recorded non-guarantee).
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
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const braceStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

const persistenceSrc = read('apps/web/lib/dayConstructorAcceptancePersistence.ts');
const persistence = stripComments(persistenceSrc);
const acceptance = stripComments(read('apps/web/lib/dayConstructorAcceptance.ts'));
const db = stripComments(read('apps/web/lib/db.ts'));
const lib = path.join(root, 'apps/web/lib');
const allLib = fs.readdirSync(lib).filter((f) => f.endsWith('.ts')).map((f) => ({ f, src: stripComments(fs.readFileSync(path.join(lib, f), 'utf8')) }));

const realDeps = functionBody(persistence, 'createRealAcceptanceDeps');
const loader = realDeps.slice(realDeps.indexOf('loadFreshBlockers:'), realDeps.indexOf('validateActivity:'));
const persist = functionBody(persistence, 'persistAcceptedConstructedDay');

// ---- the loader ----
check('acceptance freshness uses the canonical overlap loader with the acceptance TRANSACTION client: listPlannedActivitiesOverlappingRange(userId, bounds.from, bounds.to, client)', /listPlannedActivitiesOverlappingRange\(userId, bounds\.from, bounds\.to, client\)/.test(loader));
check('it does NOT use the start-scoped listPlannedActivitiesForDay anywhere in the acceptance persistence code', !/listPlannedActivitiesForDay/.test(persistence));
check('the loader runs on the transaction client: createRealAcceptanceDeps takes the client and nothing in the loader reads from the global pool', /function createRealAcceptanceDeps\(userId: string, client: PoolClient/.test(realDeps) && !/\bpool\b/.test(loader));
check('the deps are built from the SAME transaction client the writes use', /createRealAcceptanceDeps\(userId, client, timingContext\)/.test(persist) && /createPlannedActivityWithClient\(client,/.test(persist));
check('one fresh-blocker query per acceptance: the loader makes a single call, with no loop and no per-item query', count(/listPlannedActivitiesOverlappingRange\(/g, loader) === 1 && !/for \(|\.map\(async|Promise\.all/.test(loader));
check('the loader asks for exactly the SIGNED window: the validation passes request.constructionWindow.start/end verbatim and never a civil day', /deps\.loadFreshBlockers\(\{ from: request\.constructionWindow\.start, to: request\.constructionWindow\.end \}\)/.test(acceptance) && !/localDayBoundsUTC|getDatePartsInTimezone|addDaysToDateStr/.test(acceptance) && !/localDayBoundsUTC|getDatePartsInTimezone|addDaysToDateStr/.test(persistence));
const requestType = /export interface AcceptConstructedDayRequest \{([\s\S]*?)\n\}/.exec(acceptance)?.[1] ?? '';
check('the blocker list is server-derived only: the acceptance request carries exactly clientRequestId, constructionWindow and proposedItems -- no blocker list, no freshness flag', JSON.stringify(Array.from(requestType.matchAll(/^\s*(\w+)\??:/gm)).map((m) => m[1])) === JSON.stringify(['clientRequestId', 'constructionWindow', 'proposedItems']));

// ---- ordering: lock, then the fresh read (inside validation), then writes ----
const lockAt = persist.indexOf('pg_advisory_xact_lock');
const evalAt = persist.indexOf('evaluateAcceptance(');
const firstWriteAt = persist.indexOf('createPlannedActivityWithClient(');
const claimAt = persist.indexOf('claimPlanCreation(');
check('ORDER: the existing advisory lock is acquired first, then replay classification/claims, then evaluateAcceptance (which performs the fresh read), then the accepted-plan writes', lockAt > 0 && lockAt < claimAt && claimAt < evalAt && evalAt < firstWriteAt);
const evaluate = functionBody(acceptance, 'evaluateAcceptance');
check('the fresh read happens inside evaluateAcceptance (validateAgainstFreshBlockers), before any write intent is produced', /await validateAgainstFreshBlockers\(request, deps, now\)/.test(evaluate) && evaluate.indexOf('validateAgainstFreshBlockers(request, deps, now)') < evaluate.indexOf("status: 'ACCEPTABLE'"));
check('a rejected decision ROLLS BACK before any write (rejection returns before the write loop)', /decision\.status === 'REJECTED'\) \{\s*await client\.query\('ROLLBACK'\);/.test(persist) && persist.indexOf("decision.status === 'REJECTED'") < firstWriteAt);
check('the transaction and lock are unchanged: one beginTransaction, one lock site in this file, the unchanged key', count(/beginTransaction\(\)/g, persist) === 1 && count(/pg_advisory_xact_lock/g, persistence) === 1 && /`day-constructor-accept:\$\{userId\}`/.test(persist));

// ---- rejection stays item-vs-blocker, lifecycle unchanged ----
check('rejection still depends on item-vs-blocker overlap (a blocker loaded for the WINDOW never rejects by itself)', /activeBlockers\.find\(\(blocker\) => intervalsOverlap\(item\.start, item\.end, blocker\.start, blocker\.end\)\)/.test(acceptance));
check('the lifecycle filter is unchanged and still applied after the load', /blockers\.filter\(\(blocker\) => isActivePlanBlocker\(blocker, now\)\)/.test(acceptance));
check('the in-memory overlap formula is unchanged (strict, half-open; the known zero-length debt is NOT altered here)', /return aStart\.getTime\(\) < bEnd\.getTime\(\) && bStart\.getTime\(\) < aEnd\.getTime\(\);/.test(acceptance));

// ---- single overlap definition ----
check('db.ts still contains exactly ONE half-open overlap predicate over plannedStartAt/plannedEndAt for the loaders (no new overlap SQL)', count(/"plannedStartAt" < \$3 AND "plannedEndAt" > \$2/g, db) === 1);
check('acceptance persistence contains no PlannedActivity SQL of its own', !/"plannedStartAt"|"plannedEndAt"|FROM "PlannedActivity"/.test(persistence));
check('the canonical overlap loader is shared by the range loader, the Constructor and acceptance', ['opportunityRangeRealDeps.ts', 'dayConstructorOrchestrator.ts', 'dayConstructorAcceptancePersistence.ts'].every((f) => /listPlannedActivitiesOverlappingRange\(/.test(allLib.find((x) => x.f === f)!.src)));

// ---- no later-slice work ----
const plansRoute = stripComments(read('apps/web/app/api/plans/route.ts'));
check('updated deliberately by schedule-write S2 (this check previously pinned POST /api/plans as unlocked): the S1 acceptance read is unchanged, and createPlannedActivity itself still takes no lock -- the manual writer\'s serialization lives in the route\'s own transaction', !/pg_advisory/.test(functionBody(db, 'createPlannedActivity')) && /pg_advisory_xact_lock/.test(stripComments(read('apps/web/app/api/plans/route.ts'))));
check('NO S2: createPlannedActivity (db.ts) takes no lock', !/pg_advisory/.test(functionBody(db, 'createPlannedActivity')));
check('the lock sites are exactly the three existing ones (acceptance, Move, Recomposition acceptance) with the unchanged key; no helper was extracted', allLib.filter((x) => /pg_advisory_xact_lock/.test(x.src)).map((x) => x.f).sort().join() === 'dayConstructorAcceptancePersistence.ts,planMove.ts,remainingDayRecompositionAcceptance.ts' && !allLib.some((x) => /withUserScheduleLock|scheduleWriteLock|acquireScheduleLock/.test(x.src)));
check('no lock timeout was introduced anywhere in production code', !allLib.some((x) => /lock_timeout/i.test(x.src)));
check('Move and Recomposition acceptance are untouched in kind: they still use their own overlap-correct findBlockingPlanForRange', /findBlockingPlanForRange/.test(allLib.find((x) => x.f === 'planMove.ts')!.src) && /findBlockingPlanForRange/.test(allLib.find((x) => x.f === 'remainingDayRecompositionAcceptance.ts')!.src));
check('no database exclusion constraint or schema change for plans: the schema has no exclusion/overlap construct', !/EXCLUDE USING|tstzrange|btree_gist/i.test(read('apps/web/prisma/schema.prisma')) && !fs.readdirSync(path.join(root, 'apps/web/prisma/migrations')).some((d) => d !== 'migration_lock.toml' && fs.existsSync(path.join(root, 'apps/web/prisma/migrations', d, 'migration.sql')) && /EXCLUDE USING|btree_gist/i.test(fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', d, 'migration.sql'), 'utf8'))));
check('signing, integrity and Goal authorization modules are untouched by this slice: acceptance persistence imports no new module', JSON.stringify(Array.from(persistenceSrc.matchAll(/from '(\.[^']+)'/g)).map((m) => m[1])) === JSON.stringify(['./db', './timezone', './natalContext', '../../../packages/recommendation/src/personalizedTasks', '../../../packages/recommendation/src/timingSearch', './dayConstructorAcceptance', './plannedActivitySchedulingMode']));
check('no policy vocabulary in the acceptance persistence or the acceptance validation (pressure, scarcity, promotion, shadow, DecisionEvidence)', !/DecisionPressure|DecisionEvidence|scarcity|promotion|shadowEval|LAST_KNOWN_OPPORTUNITY|lastOpportunity/i.test(persistence) && !/DecisionPressure|DecisionEvidence|scarcity|promotion|shadowEval|LAST_KNOWN_OPPORTUNITY|lastOpportunity/i.test(acceptance));

// ---- no false claims in the tests of this slice ----
const dbTest = read('test/dayConstructorAcceptanceFreshOverlapDb.test.ts');
const FALSE_CLAIM = /race[- ]free|globally consistent|universal non-overlap|can never overlap|no overlapping plans can ever|global schedule consistency/i;
check('the DB test makes no race-free / global-consistency / universal-non-overlap claim in any assertion label', !(dbTest.match(/check\(`?'?[^\n]*/g) ?? []).some((l) => FALSE_CLAIM.test(l)));
check('the DB test records the known limit (a writer that BYPASSES the lock) explicitly', /KNOWN LIMIT/.test(dbTest) && /createPlannedActivity\(\{ userId: K\.id, title: 's1-unlocked-manual'/.test(dbTest));
check('the DB test covers the required cases: same-day in-progress, overnight, same-window control, left/right adjacent, ±1 ms, full-span, disjoint blocker, cross-user, multiple blockers/items, atomicity, claim rollback/retry/replay, Goal side effects, cross-midnight, DST, row volume, query count, lock order', ['A. SAME-DAY IN-PROGRESS', 'B. OVERNIGHT', 'C. control', 'ENDING EXACTLY', 'ONE ms after', 'EXACTLY at the window end', 'ONE ms before', 'FULL-SPAN', 'does NOT touch the accepted item', 'another USER', 'MULTIPLE blockers', 'MULTIPLE items', 'rolls back its idempotency claim', 'REPLAY', 'Goal-linked', 'CROSSING midnight', 'SPRING FORWARD', 'FALL BACK', '160 historical', 'ONE fresh-blocker query', 'AFTER the advisory lock'].every((m) => dbTest.includes(m) || dbTest.toLowerCase().includes(m.toLowerCase())));

if (!allPassed) {
  console.error('SOME ACCEPTANCE FRESH-OVERLAP ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL ACCEPTANCE FRESH-OVERLAP ARCHITECTURE CHECKS PASSED');
