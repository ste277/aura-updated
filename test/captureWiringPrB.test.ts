/**
 * Quick Capture V1 PR B -- structural/UI suite (source-reading, same
 * convention as goalPlanningHandoffWiring/Ui): proves the preview boundary
 * holds, provenance stays outside the planning domain, the envelope is a
 * sibling, the UI exposes only the intended actions, and no out-of-scope
 * feature (Home composer, history, conversion, task fields, migration) leaked.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const cap = (rel: string) => strip(read(rel));

// ---- preview / domain boundary ----
for (const f of ['dayIntent.ts', 'dayConstructor.ts', 'dayConstructorOrchestrator.ts', 'dayConstructorAcceptance.ts', 'dayConstructorPreviewRequest.ts', 'dayConstructorPreviewClient.ts', 'timingSearch.ts']) {
  const rel = f === 'timingSearch.ts' ? '../packages/recommendation/src/timingSearch.ts' : `../apps/web/lib/${f}`;
  check(`${f} has no Capture reference (Constructor/DayIntent/preview/E1/Timing Search stay source-unaware)`, !/capture(Id|Links)?\b/i.test(cap(rel)));
}
const entry = cap('../apps/web/lib/planDayEntry.ts');
const reqBuilder = entry.slice(entry.indexOf('export function buildRequestedIntentsForSubmission'), entry.indexOf('export function buildGoalActivityLinksForAccept'));
check('buildRequestedIntentsForSubmission never reads captureId', !/captureId/.test(reqBuilder));
check('createIntentRowFromCapture is title-only: no activityId inference', /createIntentRowFromCapture\(capture: \{ id: string; title: string \}\)/.test(entry) && !/createIntentRowFromCapture[\s\S]{0,300}activityId/.test(entry.slice(entry.indexOf('export function createIntentRowFromCapture'), entry.indexOf('export function createIntentRowFromGoalActivity'))));
check('Capture row ids are the namespaced deterministic form', /plan-day-capture-\$\{capture\.id\}/.test(entry));
check('captureId sits BESIDE goalActivityId (no sourceType/sourceId polymorphism)', /captureId\?: string/.test(entry) && /goalActivityId\?: string/.test(entry) && !/sourceType|sourceId/.test(entry));
check('link builders enforce goalActivityId XOR captureId', /row\.captureId && !row\.goalActivityId && proposedIntentIds/.test(entry) && /row\.goalActivityId && !row\.captureId && proposedIntentIds/.test(entry));

// ---- accept envelope ----
const accept = cap('../apps/web/lib/acceptConstructedDay.ts');
const acceptBody = accept.slice(accept.indexOf('export function buildAcceptRequestBody'), accept.indexOf('export function buildAcceptRequestBody') + 900);
check('proposedItems mapping never includes captureId (provenance is a sibling field)', !/proposedItems: preview[\s\S]*?captureId[\s\S]*?\}\)\)/.test(acceptBody.split('...(goalActivityLinks')[0]));
const e1 = cap('../apps/web/lib/dayConstructorAcceptance.ts');
check('AcceptConstructedDayRequest/E1 carry no Capture provenance', !/captureId|captureLinks/.test(e1));
const route = cap('../apps/web/app/api/day-constructor/accept/route.ts');
check('the route parses captureLinks separately from parseAcceptRequest and passes them as a sibling argument', /parseCaptureLinks\(body\.captureLinks\)/.test(route) && !/parseAcceptRequest[\s\S]{0,700}captureLinks/.test(route.slice(route.indexOf('function parseAcceptRequest'), route.indexOf('function parseSourceLinks'))) && /persistAcceptedConstructedDay\(session\.userId, request, now, goalActivityLinks, captureLinks\)/.test(route));
const persist = cap('../apps/web/lib/dayConstructorAcceptancePersistence.ts');
check('the Capture link runs inside the acceptance write loop on the SAME client, after the plan insert', /createPlannedActivityWithClient\(client[\s\S]*?linkCaptureToPlannedActivity\(userId, captureId, plan\.id, client\)/.test(persist));
check('a failed Capture link throws into the outer catch (whole transaction rolls back)', /if \(!captureLinked\) throw new Error\('CAPTURE_LINK_FAILED'\)/.test(persist));
const db = cap('../apps/web/lib/db.ts');
const linkFn = db.slice(db.indexOf('export async function linkCaptureToPlannedActivity'));
check('linkCaptureToPlannedActivity is one conditional UPDATE: owned, OPEN, not completed, unlinked-or-CANCELLED', /UPDATE "Capture"[\s\S]*"userId" = \$3[\s\S]*status = 'OPEN'[\s\S]*"completedAt" IS NULL[\s\S]*"plannedActivityId" IS NULL[\s\S]*status = 'CANCELLED'/.test(linkFn));
const logFn = db.slice(db.indexOf('export async function logPlannedActivity'), db.indexOf('export async function logPlannedActivity') + 12000);
check('logPlannedActivity materializes Capture.completedAt on the SAME client with the SAME completionInstant used for loggedAt', /"loggedAt" = \$3[\s\S]*\[planId, userId, completionInstant, habitLogId\][\s\S]*client\.query\(\s*`UPDATE "Capture" SET "completedAt" = COALESCE\("completedAt", \$3\)[\s\S]*\[planId, userId, completionInstant\]/.test(logFn));
check('the materialization happens BEFORE COMMIT', logFn.indexOf('UPDATE "Capture"') > 0 && logFn.indexOf('UPDATE "Capture"') < logFn.indexOf("await client.query('COMMIT')", logFn.indexOf('UPDATE "Capture"')));
check('no separate now() is used for the Capture completion in the logging path', !/UPDATE "Capture"[^`]*now\(\)[^`]*completedAt/.test(logFn.replace(/"updatedAt" = now\(\)/g, '')));
const derive = cap('../apps/web/lib/captures.ts');
check("PR A's LOGGED compatibility rule is retained", /linkedPlanStatus === 'LOGGED'\) return 'COMPLETED'/.test(derive));

// ---- hydration: server-resolved, ids only ----
const page = cap('../apps/web/app/plan-day/page.tsx');
check('/plan-day resolves captures server-side from ids and passes only {id,title} items', /resolveCaptureHandoff\(/.test(page) && /captures=\{captures\}/.test(page));
const client = cap('../apps/web/app/plan-day/PlanDayClient.tsx');
check('PlanDayClient seeds Capture rows with the deterministic factory in the initializer', /captures\.map\(createIntentRowFromCapture\)/.test(client));
check('PlanDayClient passes captureLinks built from rows + proposed items', /captureLinks=\{buildCaptureLinksForAccept\(rows, preview\.constructedDay\.proposedItems\)\}/.test(client));

// ---- UI ----
const captures = cap('../apps/web/app/captures/CapturesClient.tsx');
const you = cap('../apps/web/components/YouView.tsx');
check('You has a single "Things you want to do" row routing to /captures, next to Goals (Goals row untouched)', /title="Things you want to do"[\s\S]{0,200}window\.location\.href = '\/captures'/.test(you) && /title="Goals"/.test(you) && !/title="Tasks"/.test(you));
check('page heading, composer label and empty-state copy match the product language', /title="Things you want to do"/.test(captures) && /What&apos;s on your mind\?/.test(read('../apps/web/app/captures/CapturesClient.tsx')) && /Capture something you want to do\. Aura will help find the time\./.test(captures));
check('the composer has a real label bound to its input', /htmlFor="capture-composer"/.test(captures) && /id="capture-composer"/.test(captures));
check('the composer asks for a title only (no date/duration/importance/deadline/goal/habit/category inputs)', !/type="date"|type="time"|<select|SelectInput|duration|deadline|importance|category/i.test(captures));
check('checkbox / Done / Remove render only for actionable (OPEN) rows; PLANNED rows are read-only', /\{actionable && \(\s*<input/.test(captures) && /\{actionable && \(\s*<div style=\{\{ display: 'flex', gap: spacing\.lg/.test(captures));
check('selection controls, Done and Remove identify their row via aria-label', /aria-label=\{`Select "\$\{item\.title\}" to plan with Aura`\}/.test(captures) && /ariaLabel=\{`Mark "\$\{item\.title\}" done`\}/.test(captures) && /ariaLabel=\{`Remove "\$\{item\.title\}"`\}/.test(captures));
check('selection is local state only (no fetch inside toggleSelected)', (() => { const m = captures.match(/const toggleSelected = [\s\S]*?\n    \}\);/); return !!m && !m[0].includes('fetch('); })());
check('the CTA is "Plan with Aura", shown only with a selection, navigating via the ids-only helper', /effectiveSelectedIds\.length > 0 &&/.test(captures) && /Plan with Aura/.test(captures) && /buildCapturePlanHref\(effectiveSelectedIds\)/.test(captures));
check('the effective selection is intersected with currently OPEN rows (never a stale id)', /selectedIds\.has\(item\.id\) && openIds\.has\(item\.id\)/.test(captures));
check('double submit is guarded for Add, Done/Remove and Plan with Aura', /if \(!trimmed \|\| adding\) return/.test(captures) && /if \(pendingIds\.has\(id\)\) return/.test(captures) && /if \(effectiveSelectedIds\.length === 0 \|\| navigating\) return/.test(captures));
check('a row is removed from the list only after the server confirms', /const ok = await run\(\);\s*if \(ok\) \{[\s\S]*?filter\(\(item\) => item\.id !== id\)/.test(captures));
check('failures show plain-language copy (no raw errors/status codes)', /Couldn&apos;t load your list\./.test(captures) && !/error\.message|status\}/.test(captures));
check('the page never creates plans/HabitLogs or touches the Constructor', !/dayConstructor|createPlannedActivity|habit-logs|acceptConstructedDay/i.test(captures));
check('re-syncs from the server on bfcache restore', /pageshow/.test(captures));

// ---- scope boundaries ----
check('no Home Capture composer', !/capture/i.test(cap('../apps/web/components/HomeDashboard.tsx')) && !/capture/i.test(cap('../apps/web/components/HomeTimeline.tsx')));
check('no History/Completed/Dismissed UI, Goal/Habit conversion, or task-manager features on the page (checked against user-visible wording and control types)', !/>[^<{]*\b(History|Completed|Dismissed|Move to Goal|Attach to Goal|Convert|Make this a habit|Priority|Reminder|Recurring|Kanban|Search|Sort|Filter|Tags?|Labels?|Project)\b[^<}]*</.test(captures) && !/type="search"|<select|SegmentedControl/.test(captures));
check('no Capture provenance in Goal or Habit domain code', !/capture/i.test(cap('../apps/web/lib/goals.ts')) && !/capture/i.test(cap('../apps/web/lib/goalsPresentation.ts')));
check('no migration added by PR B (migrations still 36)', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((f) => /^\d{4}_/.test(f)).length === 36);
const schema = read('../apps/web/prisma/schema.prisma');
check('schema unchanged: PlannedActivity still has no Capture column', (schema.match(/model PlannedActivity \{[\s\S]*?\n\}/) ?? [''])[0].split('\n').filter((l) => /Capture/.test(l) && !l.trim().startsWith('//')).every((l) => /capture\s+Capture\?/.test(l) && !l.includes('fields:')));

if (!allPassed) {
  console.error('SOME CAPTURE PR B WIRING CHECKS FAILED');
  process.exit(1);
}
console.log('ALL CAPTURE PR B WIRING CHECKS PASSED');
