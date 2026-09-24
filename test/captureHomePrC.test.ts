/**
 * Quick Capture V1 PR C -- Home composer: submit behavior (pure, with an
 * injected fetch) and structural/scope checks (source-reading, same
 * convention as the other wiring suites).
 */
import fs from 'fs';
import path from 'path';
import { createQuickCaptureSubmitter } from '../apps/web/lib/quickCaptureSubmit';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

type Call = { url: string; body: any; method?: string };
function fakeFetch(responder: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const impl = (async (url: any, init: any) => {
    const call = { url: String(url), body: init?.body ? JSON.parse(init.body) : undefined, method: init?.method };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const ok = () => new Response(JSON.stringify({ id: 'c1', title: 'x', derivedState: 'OPEN', createdAt: 'now' }), { status: 200 });

async function main() {
  // C/D trimmed title, existing endpoint, title-only body
  const a = fakeFetch(ok);
  const r1 = await createQuickCaptureSubmitter(a.impl)('  Call John  ');
  check('C. a trimmed title is submitted', r1 === 'SAVED' && a.calls[0].body.title === 'Call John');
  check('D. the existing POST /api/captures is the only request', a.calls.length === 1 && a.calls[0].url === '/api/captures' && a.calls[0].method === 'POST');
  check('B. the request body is title-only', Object.keys(a.calls[0].body).join() === 'title');
  check('K/L/M. no Plan My Day, Constructor, Timing Search, acceptance or plan request is ever made', a.calls.every((c) => /^\/api\/captures$/.test(c.url)));

  // G whitespace / empty
  const g = fakeFetch(ok);
  const sub = createQuickCaptureSubmitter(g.impl);
  check('G. whitespace-only and empty titles are blocked without a request', (await sub('   \n ')) === 'INVALID' && (await sub('')) === 'INVALID' && g.calls.length === 0);
  check('over-long title is blocked without a request', (await sub('x'.repeat(201))) === 'INVALID' && g.calls.length === 0);

  // F failure classification (draft preservation is the component keeping its own state; the result never clears it)
  const f500 = createQuickCaptureSubmitter(fakeFetch(() => new Response('{}', { status: 500 })).impl);
  const fNet = createQuickCaptureSubmitter((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
  const f400 = createQuickCaptureSubmitter(fakeFetch(() => new Response(JSON.stringify({ error: 'x' }), { status: 400 })).impl);
  check('F. a server error is FAILED (never SAVED), a network error is FAILED, a 400 is REJECTED', (await f500('a')) === 'FAILED' && (await fNet('a')) === 'FAILED' && (await f400('a')) === 'REJECTED');
  check('F. a 200 without a created id is not treated as saved', (await createQuickCaptureSubmitter(fakeFetch(() => new Response('{}', { status: 200 })).impl)('a')) === 'FAILED');
  const retry = fakeFetch(() => (retry.calls.length === 1 ? new Response('{}', { status: 500 }) : ok()));
  const rs = createQuickCaptureSubmitter(retry.impl);
  check('F. after a failure the same submitter can retry and succeed', (await rs('Retry me')) === 'FAILED' && (await rs('Retry me')) === 'SAVED' && retry.calls.length === 2);

  // J synchronous duplicate
  let resolveFetch: (r: Response) => void = () => {};
  const slow = fakeFetch(() => new Promise<Response>((res) => { resolveFetch = res; }));
  const dupSub = createQuickCaptureSubmitter(slow.impl);
  const p1 = dupSub('Only once');
  const p2 = dupSub('Only once');
  const p3 = dupSub('Only once');
  const [x2, x3] = await Promise.all([p2, p3]);
  resolveFetch(ok());
  check('J. synchronous duplicate submits are blocked (BUSY) and only ONE request is made', x2 === 'BUSY' && x3 === 'BUSY' && slow.calls.length === 1 && (await p1) === 'SAVED');
  const seq = createQuickCaptureSubmitter(fakeFetch(ok).impl);
  check('J. after completion a new submit is allowed again (sequential submits both save)', (await seq('One')) === 'SAVED' && (await seq('Two')) === 'SAVED');

  // ---- structural ----
  const composer = strip(read('../apps/web/components/HomeQuickCapture.tsx'));
  const dash = strip(read('../apps/web/components/HomeDashboard.tsx'));
  const timeline = strip(read('../apps/web/components/HomeTimeline.tsx'));
  check('A. HomeTimeline exposes "+ Add something" that opens capture (onQuickCapture)', /onQuickCapture \? \(\s*<span data-home-add-something>\s*<TextButton onClick=\{onQuickCapture\}>\+ Add something<\/TextButton>/.test(timeline));
  check("O. the previous Add-something behavior is preserved: handleAddSomething unchanged and reachable via 'See suggestions'", /const handleAddSomething = \(\) => \{\s*if \(dayBuilderBlock\) \{\s*setShowDayBuilder\(\(current\) => !current\);\s*\} else \{\s*onExploreClick\?\.\(\);/.test(dash) && /handleSeeSuggestions = \(\) => \{\s*setCaptureOpen\(false\);\s*handleAddSomething\(\);/.test(dash) && /onAddSomething=\{handleAddSomething\}/.test(dash));
  check('O. the empty-state "Plan your day →" still uses the existing onAddSomething', /action=\{onAddSomething \? <TextButton onClick=\{onAddSomething\}>Plan your day →<\/TextButton> : undefined\}/.test(timeline));
  check('B. the composer asks for a title only (no date/time/duration/importance/deadline/goal/habit/category controls)', !/type="date"|type="time"|<select|SelectInput|durationMinutes|deadline|importance|category|goalId|habit/i.test(composer));
  check('copy: "What do you want to do?" with the supporting line; no task/inbox/schedule wording', /What do you want to do\?/.test(composer) && /Aura can help you find time for it later\./.test(composer) && !/Create task|New task|Add to inbox|Schedule task/i.test(composer + dash));
  check('accessible: real label bound to the input, alert region for errors', /htmlFor="home-capture-input"/.test(composer) && /id="home-capture-input"/.test(composer) && /role="alert"/.test(composer));
  check('H. Enter submits through a real <form onSubmit>', /<form\s+onSubmit=\{submit\}/.test(composer) && /type="submit"/.test(composer));
  check('I. Escape and Cancel close without a request (onClose only)', /event\.key === 'Escape'[\s\S]{0,80}onClose\(\)/.test(composer) && /<SecondaryButton onClick=\{onClose\}/.test(composer));
  check('the composer focuses its input on open and never re-focuses an input after success', /inputRef\.current\?\.focus\(\)/.test(composer) && (composer.match(/\.focus\(\)/g) ?? []).length === 1);
  check('success closes the composer, shows a status confirmation, and returns focus to the opener BUTTON (no keyboard summoned)', /handleCaptureSaved = \(\) => \{\s*setCaptureOpen\(false\);\s*setCaptureConfirmed\(true\);\s*focusAddSomethingOpener\(\);/.test(dash) && /\[data-home-add-something\] button/.test(dash) && /role="status"/.test(dash) && /Added to Things you want to do/.test(dash));
  check('the composer does not automatically reopen after success', !/setCaptureOpen\(true\)/.test(dash.replace(/onQuickCapture=\{\(\) => \{ setCaptureConfirmed\(false\); setCaptureOpen\(true\); \}\}/, '')));
  check('N. Home shows no Capture list (no /api/captures GET, no list rendering)', !/method: 'GET'|fetch\('\/api\/captures'\)|listCaptures/.test(composer + dash + timeline) && !/\.map\(\(capture/.test(composer + dash + timeline));
  check('K/L. no Plan My Day / Constructor / Timing Search / acceptance references in the composer', !/plan-day|dayConstructor|timingSearch|acceptConstructedDay|createPlannedActivity|fetch\('\/api\/(plans|day-constructor|timing)/.test(composer + strip(read('../apps/web/lib/quickCaptureSubmit.ts'))));
  check('the composer only writes through the existing endpoint', (strip(read('../apps/web/lib/quickCaptureSubmit.ts')).match(/fetchImpl\('/g) ?? []).length === 1 && /'\/api\/captures'/.test(read('../apps/web/lib/quickCaptureSubmit.ts')));
  check('the only new Home wiring is the composer slot + opener (Right Now / Timeline / Opportunities props untouched)', /quickCaptureSlot=/.test(dash) && /onQuickCapture=/.test(dash) && /onPlanOpportunity=\{handlePlanOpportunity\}/.test(dash) && /nextItemId=\{myDayAgenda\?\.nextItem\?\.id\}/.test(dash));
  check('scope: no schema/migration change, no lifecycle/planning/acceptance file references Home capture', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((f) => /^\d{4}_/.test(f)).length === 38 && !/quickCapture|HomeQuickCapture/i.test(strip(read('../apps/web/lib/planDayEntry.ts')) + strip(read('../apps/web/lib/dayConstructorAcceptancePersistence.ts')) + strip(read('../apps/web/lib/captures.ts'))));

  if (!allPassed) {
    console.error('SOME CAPTURE HOME PR C CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL CAPTURE HOME PR C CHECKS PASSED');
}
main();
