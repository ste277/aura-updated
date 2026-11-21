/**
 * AURA-READY-02-F4 -- Find a Time (Plan tab) must tell a FAILED search apart
 * from a search that genuinely found no suitable time.
 *
 * Mounts the real PlanWithAuraView (React 18 + jsdom, shared harness) with a
 * scripted onTimingSearch whose every call the test resolves or rejects
 * explicitly. Successful results come from the real runTimingSearch engine.
 * The 20 s timeout is shortened by remapping exactly that setTimeout delay.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/findATimeErrorStatesJsdom.test.ts
 */
import { React, mount, click, flush, typeInto, act } from './jsdomReactHarness';
import { runTimingSearch, type TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import { resolveTzOffsetMinutes } from '../apps/web/lib/timezone';
import * as fs from 'fs';
import * as path from 'path';

const { FIND_TIME_TIMEOUT_MS, FIND_TIME_ERROR_COPY, classifyFindTimeError, assertFindTimeCandidates, FindTimeError } = require('../apps/web/lib/findTimeErrors');
const { PlanWithAuraView } = require('../apps/web/components/PlanWithAuraView');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// Shorten ONLY the Find a Time timeout (a 20 000 ms timer) to 40 ms.
const realSetTimeout = global.setTimeout;
(global as any).setTimeout = (fn: (...a: any[]) => void, ms?: number, ...args: any[]) => realSetTimeout(fn, ms === FIND_TIME_TIMEOUT_MS ? 40 : ms, ...args);
(window as any).setTimeout = (global as any).setTimeout;

// Unrelated child fetches (plans, goals, people...) stay pending / empty.
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
(global as any).fetch = (url: string) => {
  if (url === '/api/plans') return Promise.resolve(json(200, []));
  if (url === '/api/goals') return Promise.resolve(json(200, []));
  return new Promise(() => {});
};
(global as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);

const TZ = 'Asia/Kolkata';
const now = new Date();
const realResult = (request: any) => {
  const context = { now, latitude: 13.0827, longitude: 80.2707, timezone: TZ, tzOffsetMinutes: resolveTzOffsetMinutes(TZ, now) };
  return { ...runTimingSearch({ ...request, horizon: 'TOMORROW', context } as TimingSearchRequest), constraintsApplied: { availability: 'UNCONFIGURED', blockedPlanCount: 0 } };
};

// Scripted transport: each call is held until the test settles it.
type Call = { request: any; resolve: (v: any) => void; reject: (e: any) => void };
const calls: Call[] = [];
const onTimingSearch = (request: any) => new Promise((resolve, reject) => { calls.push({ request, resolve, reject }); });

const byText = (root: HTMLElement, sel: string, text: string) => Array.from(root.querySelectorAll(sel)).filter((el) => (el.textContent ?? '').trim() === text) as HTMLElement[];
const byTextIncludes = (root: HTMLElement, sel: string, text: string) => Array.from(root.querySelectorAll(sel)).filter((el) => (el.textContent ?? '').includes(text)) as HTMLElement[];
const settle = async () => { for (let i = 0; i < 4; i++) await flush(); };
const OLD_MISLEADING = 'Aura could not find a time for this request';

(async () => {
  // ===================== pure classification =====================
  check('U1. fetch network TypeError (Chrome/Safari/Firefox wording) -> NETWORK', ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'].every((m) => classifyFindTimeError(new TypeError(m)) === 'NETWORK'));
  check('U2. non-2xx thrown by the transport ("Unable to run timing search.") -> SERVER', classifyFindTimeError(new Error('Unable to run timing search.')) === 'SERVER');
  check('U3. unparseable body (SyntaxError) -> MALFORMED', classifyFindTimeError(new SyntaxError('Unexpected token <')) === 'MALFORMED');
  check('U4. an unrelated TypeError (a bug) is NOT called a connection problem -> SERVER', classifyFindTimeError(new TypeError("Cannot read properties of undefined (reading 'x')")) === 'SERVER');
  check('U5. typed FindTimeError keeps its kind', classifyFindTimeError(new FindTimeError('TIMEOUT')) === 'TIMEOUT');
  let threw = 0;
  for (const bad of [null, {}, { candidates: 'x' }, 'text']) { try { assertFindTimeCandidates(bad); } catch (e) { if (classifyFindTimeError(e) === 'MALFORMED') threw++; } }
  check('U6. a body without a candidates array is MALFORMED (never an empty result)', threw === 4);
  check('U7. an empty candidates array is a valid (genuine no-results) response', (() => { try { assertFindTimeCandidates({ candidates: [] }); return true; } catch { return false; } })());
  check('U8. user-facing copy matches the ticket and leaks no internals', FIND_TIME_ERROR_COPY.NETWORK.message === "We couldn't connect to Aura. Check your connection and try again." && FIND_TIME_ERROR_COPY.SERVER.message === 'Something went wrong while finding a time. Please try again.' && FIND_TIME_ERROR_COPY.TIMEOUT.message === 'This search is taking longer than expected. Please try again.');

  // ===================== mounted Plan tab =====================
  const h = await mount(React.createElement(PlanWithAuraView, { onTimingSearch, timezone: TZ }));
  const root = h.container;
  await settle();
  const input = root.querySelector('input[placeholder^="e.g. Workout"]') as HTMLInputElement;
  await typeInto(input, 'Study');
  await settle();
  const findBtn = () => byTextIncludes(root, 'button', 'Find My Best Time').concat(byTextIncludes(root, 'button', 'Finding...'))[0] as HTMLButtonElement;
  const errBox = () => root.querySelector('[data-find-error]') as HTMLElement | null;
  const tryAgain = () => (errBox() ? byTextIncludes(errBox()!, 'button', 'Try') [0] as HTMLButtonElement : undefined);
  const results = () => byTextIncludes(root, 'button', 'Use this time');
  const text = () => (root.textContent ?? '').replace(/\s+/g, ' ');
  // Pick a non-default time preference to prove the inputs survive a retry.
  await click(byTextIncludes(root, 'button', 'Evening')[0]);
  await settle();

  // 1. success with recommendations
  await click(findBtn());
  await settle();
  check('1. one request sent for "Study"', calls.length === 1 && calls[0].request.mode === 'FIND');
  calls[0].resolve(realResult(calls[0].request));
  await settle();
  check('1. success: recommendations render, no error box', results().length >= 1 && !errBox());

  // 2. success with zero results -> the EXISTING genuine no-results message
  await click(findBtn());
  await settle();
  calls[1].resolve({ candidates: [], constraintsApplied: { availability: 'UNCONFIGURED', blockedPlanCount: 0 } });
  await settle();
  check('2. zero results: the existing genuine no-results message is shown', /could not find a usable time for this request/.test(text()));
  check('2. zero results is NOT presented as a failure (no error box, no Try again)', !errBox());

  // 3. network failure
  await click(findBtn());
  await settle();
  calls[2].reject(new TypeError('Failed to fetch'));
  await settle();
  check('3. network: "Connection problem" with the connection copy', errBox()?.getAttribute('data-find-error') === 'NETWORK' && /Connection problem/.test(errBox()!.textContent ?? '') && /couldn't connect to Aura/.test(errBox()!.textContent ?? ''));
  check('3. network: role="alert" and a Try again button (>= 44 px)', errBox()?.getAttribute('role') === 'alert' && !!tryAgain() && tryAgain()!.style.minHeight === '44px');
  check('3. network: the old misleading "try a shorter duration" text is gone', !text().includes(OLD_MISLEADING));

  // 7/8. retry: same inputs, stale error cleared, one request even on rapid taps (9)
  const firstReq = JSON.stringify(calls[0].request);
  const retryBtn = tryAgain()!;
  await click(retryBtn);
  await click(retryBtn);
  await click(findBtn());
  await settle();
  check('9. rapid Try again / Find taps while in flight -> exactly one new request', calls.length === 4);
  check('7. retry clears the stale error while loading', !errBox());
  check('8. retry re-sends the identical inputs (activity, duration, time preference, horizon)', JSON.stringify(calls[3].request) === firstReq && calls[3].request.taskTitle === 'Study' && calls[3].request.timePreference === 'EVENING' && calls[3].request.durationMinutes === calls[0].request.durationMinutes);
  calls[3].resolve(realResult(calls[3].request));
  await settle();
  check('7. retry success shows recommendations', results().length >= 1 && !errBox());

  // 9b. two taps in the SAME tick (before React re-renders the disabled
  // button) still start only one search.
  const before9b = calls.length;
  await act(async () => {
    const b = findBtn();
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
  check('9b. two same-tick taps -> one request', calls.length === before9b + 1);
  calls[calls.length - 1].resolve(realResult(calls[calls.length - 1].request));
  await settle();

  // 4. server error
  await click(findBtn());
  await settle();
  calls[5].reject(new Error('Unable to run timing search.'));
  await settle();
  check('4. server error: "Search unavailable" + generic copy, no internals', errBox()?.getAttribute('data-find-error') === 'SERVER' && /Search unavailable/.test(errBox()!.textContent ?? '') && !/Unable to run timing search/.test(text()));

  // 6. malformed response (200 with no candidates array)
  await click(tryAgain()!);
  await settle();
  calls[6].resolve({ unexpected: true });
  await settle();
  check('6. malformed response: safe generic error, never an empty/no-results state', errBox()?.getAttribute('data-find-error') === 'MALFORMED' && !/could not find a usable time/.test(text()));

  // 5. timeout, and 10. the late answer can't overwrite a newer result
  await click(tryAgain()!);
  await settle();
  check('5. (setup) search in flight', calls.length === 8 && /Finding/.test(findBtn().textContent ?? ''));
  await act(async () => { await new Promise((r) => realSetTimeout(r, 80)); });
  await settle();
  check('5. timeout: "Request timed out" with Try again', errBox()?.getAttribute('data-find-error') === 'TIMEOUT' && /taking longer than expected/.test(errBox()!.textContent ?? '') && !!tryAgain());
  check('5. timeout: loading ends so the user can retry', !/Finding/.test(findBtn().textContent ?? ''));
  await click(tryAgain()!);
  await settle();
  check('10. (setup) retry after timeout sends a new request', calls.length === 9);
  calls[8].resolve({ candidates: [], constraintsApplied: { availability: 'UNCONFIGURED', blockedPlanCount: 0 } });
  await settle();
  calls[7].resolve(realResult(calls[7].request)); // the timed-out request answers late
  await settle();
  check('10. the late answer of the timed-out request does NOT overwrite the newer result', results().length === 0 && /could not find a usable time/.test(text()));

  // 5b. timeout with NO retry: a late answer must not silently replace the
  // timeout message (which would leave "timed out" next to results).
  await click(findBtn());
  await settle();
  await act(async () => { await new Promise((r) => realSetTimeout(r, 80)); });
  await settle();
  check('5b. (setup) second timeout shown', errBox()?.getAttribute('data-find-error') === 'TIMEOUT' && calls.length === 10);
  calls[9].resolve(realResult(calls[9].request));
  await settle();
  check('5b. a late answer after a timeout (no retry) is ignored: timeout message stays, no results appear underneath it', errBox()?.getAttribute('data-find-error') === 'TIMEOUT' && results().length === 0);

  // 10b. a stale FAILURE can't overwrite a newer success either
  await click(findBtn());
  await settle();
  await typeInto(input, 'Study session'); // input change invalidates the in-flight request
  await settle();
  calls[10].reject(new TypeError('Failed to fetch'));
  await settle();
  check('10. a failure from an abandoned request is not shown after the inputs changed', !errBox());
  await h.unmount();

  // ===================== structural guards =====================
  const strip = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const view = strip(fs.readFileSync(path.join(__dirname, '..', 'apps/web/components/PlanWithAuraView.tsx'), 'utf8'));
  const guest = strip(fs.readFileSync(path.join(__dirname, '..', 'apps/web/app/find/GuestFindClient.tsx'), 'utf8'));
  check('S1. the misleading catch-all message is removed from Find a Time', !view.includes(OLD_MISLEADING));
  check('S2. CHECK / COMPARE paths untouched (no timeout/classification added there)', (view.match(/withFindTimeTimeout\(/g) ?? []).length === 2);
  check('11. guest /find still calls the unauthenticated guest endpoint and keeps its own SEARCH_ERROR / NO_RESULT states', /'\/api\/guest\/timing-search'/.test(guest) && /setPhase\('SEARCH_ERROR'\)/.test(guest) && /setPhase\('NO_RESULT'\)/.test(guest));
  check('12. guest save still goes through email sign-in (Continue with email -> verify-code)', /Continue with email/.test(guest) && /\/api\/auth\/verify-code/.test(guest));

  console.log(`\n${count} checks`);
  if (!allPassed) { console.log('SOME CHECKS FAILED'); process.exit(1); }
  console.log('All Find a Time error-state checks passed.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
