/**
 * Daily Experience V1 PR E (focus-successor blocker correction) -- ownership of the delayed "focus the
 * Move successor" request: bounded retries, one active request, token-guarded callbacks, supersession,
 * unmount and user-intent invalidation, success cleanup and exhaustion. The controller is injectable, so
 * this runs against a fake clock and a fake DOM; structural checks pin the Home wiring.
 */
import fs from 'fs';
import path from 'path';
import { createSuccessorFocusController, successorOnAgendaDay, SUCCESSOR_FOCUS_MAX_ATTEMPTS, SUCCESSOR_FOCUS_INTERVAL_MS } from '../apps/web/lib/homeSuccessorFocus';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** A fake clock + fake DOM around a real controller. `focus` fires the "focusin" the browser would, so the automatic-focus guard is exercised. */
function harness() {
  let now = 0; let seq = 0;
  type Timer = { id: number; at: number; fn: () => void };
  let queue: Timer[] = [];
  let scheduled = 0;
  const rows = new Set<string>();
  const log: string[] = [];
  let focused = 'body';
  let findCalls = 0;
  const controller = createSuccessorFocusController<string>({
    schedule: (fn, ms) => { const t = { id: ++seq, at: now + ms, fn }; queue.push(t); scheduled++; return t; },
    clear: (h) => { queue = queue.filter((t) => t !== h); },
    findRow: (id) => { findCalls++; return rows.has(id) ? `row:${id}` : null; },
    focus: (el) => { focused = el; log.push(`focus ${el}`); controller.noteUserIntent(); /* the focusin this focus itself raises */ },
    focusFallback: () => { focused = 'right-now'; log.push('fallback'); controller.noteUserIntent(); },
  });
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const next = queue.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      now = next.at;
      queue = queue.filter((t) => t !== next);
      next.fn();
    }
    now = target;
  };
  return {
    controller, advance, rows, log,
    get focused() { return focused; }, get queued() { return queue.length; }, get scheduled() { return scheduled; }, get findCalls() { return findCalls; },
    userFocus: (el: string) => { focused = el; controller.noteUserIntent(); },
    /** The next queued timer's callback (to run it manually, as if it had already been dispatched). */
    peek: () => queue[0]?.fn,
    /** Pops the callback out of the queue WITHOUT clearing it via the controller (simulates "already queued / firing"). */
    take: () => { const t = queue.shift(); return t?.fn; },
  };
}

function main() {
  // 16/23. successor appears while the request is current
  {
    const h = harness();
    h.controller.request('B');
    h.advance(0);
    check('16. B absent at the first attempt: a retry is scheduled, nothing focused yet', h.focused === 'body' && h.queued === 1);
    h.rows.add('B');
    h.advance(SUCCESSOR_FOCUS_INTERVAL_MS);
    check('16. B appears while the request is current: B is focused', h.focused === 'row:B');
    check('16/10. focus happens exactly once, the request ends, no retry remains', h.log.join() === 'focus row:B' && !h.controller.isPending() && h.queued === 0);
    h.advance(10_000);
    check('23. after success, timers well past the old window cause no further focus and no Right Now fallback', h.log.join() === 'focus row:B' && h.focused === 'row:B');
  }
  // 17. user moves focus while B is absent
  {
    const h = harness();
    h.controller.request('B');
    h.advance(0);
    h.userFocus('other-button');
    h.rows.add('B');
    h.advance(5_000);
    check('17. the user focuses another control before B renders: that control keeps focus, B is NOT focused, no Right Now fallback', h.focused === 'other-button' && h.log.length === 0 && !h.controller.isPending() && h.queued === 0);
  }
  // 18. keyboard / pointer intent
  for (const kind of ['keydown', 'pointerdown']) {
    const h = harness();
    h.controller.request('B');
    h.advance(120);
    h.controller.noteUserIntent(); // the document-level ${kind} listener reports this
    h.rows.add('B');
    h.advance(5_000);
    check(`18. a ${kind} during the wait invalidates the request: B never takes focus later, no fallback`, h.log.length === 0 && h.focused === 'body');
  }
  // 19. a newer Move supersedes the older one
  {
    const h = harness();
    h.controller.request('B');
    h.advance(0);
    h.controller.request('D');
    h.rows.add('B'); h.rows.add('D');
    h.advance(5_000);
    check('19. Move A->B then Move C->D before B renders: B never receives delayed focus; only D does, exactly once', h.log.join() === 'focus row:D' && h.queued === 0);
    const h2 = harness();
    h2.controller.request('B');
    h2.advance(0);
    h2.controller.request('D');
    h2.rows.add('B');
    h2.advance(5_000);
    check('19. with only the OLD successor rendered the superseded request cannot focus it (D never rendered -> D\'s own bounded fallback only)', !h2.log.includes('focus row:B') && h2.log.join() === 'fallback');
  }
  // 20. unmount
  {
    const h = harness();
    h.controller.request('B');
    h.advance(0);
    const scheduledBefore = h.scheduled;
    h.controller.cancel(); // Home unmounts
    h.rows.add('B');
    h.advance(10_000);
    check('20. unmount cancels the wait: no focus, no fallback, no continued retry chain (no new timers)', h.log.length === 0 && h.queued === 0 && h.scheduled === scheduledBefore && !h.controller.isPending());
    const inFlight = harness();
    const sinceFlight = inFlight.controller.epoch(); // Move submitted, response still in flight
    inFlight.controller.cancel(); // Home unmounts
    inFlight.rows.add('B');
    inFlight.controller.request('B', { since: sinceFlight }); // the response arrives after unmount
    inFlight.advance(10_000);
    check('20. a Move whose response arrives AFTER unmount starts no request: zero timers, no polling, no focus, no fallback', inFlight.scheduled === 0 && inFlight.log.length === 0 && inFlight.queued === 0);
    h.controller.request('E'); // StrictMode-style remount: the controller is reusable
    h.rows.add('E');
    h.advance(0);
    check('20. the controller stays reusable after cancel (effects can re-run)', h.log.join() === 'focus row:E');
  }
  // 21. exhaustion
  {
    const h = harness();
    h.controller.request('B');
    h.advance(SUCCESSOR_FOCUS_INTERVAL_MS * (SUCCESSOR_FOCUS_MAX_ATTEMPTS - 1) - 1);
    const before = h.log.length;
    h.advance(1);
    check('21. B never renders: the documented fallback (Right Now) runs once, only at the end of the bound', before === 0 && h.log.join() === 'fallback' && h.focused === 'right-now' && !h.controller.isPending() && h.queued === 0);
    check('25. the retry is bounded: exactly 9 attempts were scheduled, 60ms apart (~480ms)', h.scheduled === SUCCESSOR_FOCUS_MAX_ATTEMPTS && SUCCESSOR_FOCUS_MAX_ATTEMPTS === 9 && SUCCESSOR_FOCUS_INTERVAL_MS === 60);
    h.advance(10_000);
    check('21. nothing further after exhaustion', h.log.join() === 'fallback' && h.scheduled === 9);
    const g = harness();
    g.controller.request('B');
    g.advance(180);
    g.userFocus('elsewhere');
    g.advance(10_000);
    check('21. the user invalidates the request BEFORE exhaustion: no Right Now fallback, focus stays where the user put it', g.log.length === 0 && g.focused === 'elsewhere' && g.queued === 0);
  }
  // 22. already-queued callback: token correctness, not only clearTimeout
  {
    const a = harness();
    a.controller.request('B');
    a.advance(0);
    const oldCallback = a.take()!; // the retry is "already firing" -- popped from the queue so clearTimeout cannot save us
    a.controller.request('D');
    a.rows.add('B');
    oldCallback();
    check('22. a queued callback of a SUPERSEDED request executes: it sees a stale token and focuses nothing', a.log.length === 0 && a.focused === 'body');
    const b = harness();
    b.controller.request('B');
    b.advance(0);
    const cb2 = b.take()!;
    b.userFocus('other');
    b.rows.add('B');
    cb2();
    check('22. a queued callback of an INVALIDATED request executes: no focus, no fallback', b.log.length === 0 && b.focused === 'other');
    const c = harness();
    c.controller.request('B');
    c.advance(0);
    const cb3 = c.take()!;
    c.controller.cancel();
    c.rows.add('B');
    cb3();
    check('22. a queued callback after UNMOUNT executes: no focus, no fallback', c.log.length === 0 && c.focused === 'body');
  }
  // user acts during the NETWORK wait (before the success even arrives)
  {
    const h = harness();
    const since = h.controller.epoch(); // Move submitted
    h.userFocus('other-input'); // the user focuses something else while the request is in flight
    h.rows.add('B');
    h.controller.request('B', { since }); // server confirms
    h.advance(10_000);
    check('9/17. the user moves focus while the Move request is still IN FLIGHT: on success NO focus request starts -- focus stays where the user put it, B not focused, no fallback', h.focused === 'other-input' && h.log.length === 0 && h.queued === 0 && h.scheduled === 0);
    const g = harness();
    g.userFocus('earlier-interaction'); // the submit gesture itself happened before the epoch was captured
    const s2 = g.controller.epoch();
    g.rows.add('B');
    g.controller.request('B', { since: s2 });
    g.advance(0);
    check('9. interaction BEFORE submit (the submit gesture itself) does not block the successor focus', g.log.join() === 'focus row:B');
    const k = harness();
    const s3 = k.controller.epoch();
    k.controller.noteUserIntent(); // keydown
    k.controller.request('B', { since: s3, expectRow: false });
    k.advance(1_000);
    check('9/12. the same in-flight rule applies to the Tomorrow fallback (no Right Now focus after the user moved on)', k.log.length === 0);
  }
  // 12. Tomorrow: nothing to poll for; same token rules
  {
    const h = harness();
    h.controller.request('B', { expectRow: false });
    h.advance(0);
    check('12. a Move to tomorrow (no Today row) goes straight to the stable target with NO polling for an impossible row', h.log.join() === 'fallback' && h.findCalls === 0 && h.scheduled === 1 && h.queued === 0);
    const g = harness();
    g.controller.request('B', { expectRow: false });
    g.userFocus('other');
    g.advance(1_000);
    check('12. the tomorrow fallback also obeys invalidation (no stolen focus)', g.log.length === 0 && g.focused === 'other');
    const day = { localDate: '2026-08-24', timezone: 'Asia/Kolkata' };
    check('12. successorOnAgendaDay: same local day true; next local day false; time-zone aware (23:30 IST is still today, 00:30 IST is tomorrow); no agenda -> wait (true)', successorOnAgendaDay(new Date('2026-08-24T18:00:00Z'), day) === true && successorOnAgendaDay(new Date('2026-08-24T19:00:00Z'), day) === false && successorOnAgendaDay('2026-08-25T03:45:00.000Z', day) === false && successorOnAgendaDay(new Date('2026-08-24T05:00:00Z'), day) === true && successorOnAgendaDay(new Date(), null) === true);
  }
  // 24. two Move triggers: each request belongs to its own successful Move
  {
    const h = harness();
    h.rows.add('B1'); h.rows.add('B2');
    h.controller.request('B1');
    h.advance(0);
    const first = h.focused;
    h.controller.request('B2');
    h.advance(0);
    check('24. Right Now Move then Missed Move: each request focuses ITS OWN successor (B1 then B2), never the other', first === 'row:B1' && h.focused === 'row:B2' && h.log.join() === 'focus row:B1,focus row:B2');
  }
  // one active request at a time
  {
    const h = harness();
    for (const id of ['a', 'b', 'c', 'd']) h.controller.request(id);
    check('4. at most ONE timer is ever pending however many requests start (each new one cancels the previous)', h.queued === 1);
  }

  // ---------- structural: Home wiring ----------
  const dash = strip(read('../apps/web/components/HomeDashboard.tsx'));
  const lib = strip(read('../apps/web/lib/homeSuccessorFocus.ts'));
  check('3. the controller is component-owned (useRef in HomeDashboard), created via the factory; the helper has no module-level mutable state', /const successorFocus = useRef<SuccessorFocusController \| null>\(null\)/.test(dash) && /createSuccessorFocusController<HTMLElement>\(/.test(dash) && !/^(let|var)\s/m.test(lib));
  check('6. Home unmount cancels the active request (effect cleanup calls controller.cancel())', /useEffect\(\(\) => \{\s*const controller = successorFocus\.current!;[\s\S]{0,700}return \(\) => \{[\s\S]{0,400}controller\.cancel\(\);\s*\};\s*\}, \[\]\);/.test(dash));
  check('9/17. Home captures the intent epoch at submit and passes it as `since` on success', /const focusIntentEpoch = successorFocus\.current!\.epoch\(\);/.test(dash) && /since: focusIntentEpoch/.test(dash));
  check('8/9. user intent is reported from document-level focusin, pointerdown and keydown (capture) listeners, and all three are removed on cleanup', ['focusin', 'pointerdown', 'keydown'].every((e) => new RegExp(`document\\.addEventListener\\('${e}', onUserIntent, true\\)`).test(dash) && new RegExp(`document\\.removeEventListener\\('${e}', onUserIntent, true\\)`).test(dash)));
  check('4/5. exactly one call site starts a request (the confirmed-Move branch) and the old recursive helper is gone', (dash.match(/successorFocus\.current!\.request\(/g) ?? []).length === 1 && !/focusMoveSuccessor/.test(dash));
  check('5. no timer is created outside the controller\'s injected scheduler for successor focus, and every callback checks its token first', /if \(!isCurrent\(token\)\) return;\s*active!\.timer = null;/.test(lib) && (lib.match(/deps\.schedule\(/g) ?? []).length === 1);
  check('11. the Right Now fallback lives only in the injected focusFallback and is reachable only from the still-current exhaustion path', (lib.match(/deps\.focusFallback\(\)/g) ?? []).length === 1 && (dash.match(/\[data-home-right-now-label\]/g) ?? []).length >= 2);
  check('13/24. Cancel/Escape still return to the originating Move trigger by plan id (untouched)', /const focusMoveTrigger = \(\) => setTimeout\(\(\) => document\.getElementById\(`home-move-trigger-\$\{moveTriggerPlanRef\.current\}`\)\?\.focus\(\), 0\);/.test(dash) && /moveTriggerPlanRef\.current = planId;/.test(dash));
  check('14. Done/Skip focus behavior is unchanged (Right Now label for Right Now, resolved row for the Timeline)', /if \(origin === 'TIMELINE'\) focusTimelineRow\(planId\);\s*else setTimeout\(\(\) => document\.querySelector<HTMLElement>\('\[data-home-right-now-label\]'\)\?\.focus\(\), 0\);/.test(dash));
  check('25. no MutationObserver / unbounded polling infrastructure', !/MutationObserver|setInterval/.test(lib + dash.slice(dash.indexOf('successorFocus = useRef'), dash.indexOf('const handleMoveRightNow'))));

  console.log(allPassed ? '\nALL HOME SUCCESSOR FOCUS CHECKS PASSED' : '\nSOME HOME SUCCESSOR FOCUS CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}
main();
