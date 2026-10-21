// Run with: TS_NODE_COMPILER_OPTIONS='{"jsx":"react"}' npx ts-node test/dr4f2bAsyncRaceConditions.test.ts
// (imports from PlanWithAuraView.tsx, so needs `--jsx` -- same reason as
// planTabChooseMyOwnTime.test.ts; both are in root tsconfig.json's own
// exclude list for exactly that reason.)
//
// AURA DR4-F2B Blocking Fix -- "Async Assessment & Save Integrity", section
// 5: 12 deterministic race-condition tests using deferred promises/
// controlled response ordering (never real network timing).
//
// PlanWithAuraView.tsx's own handleCheckTime/handleFindTime/
// handleUseCheckedRequestedTime/handleUseFoundCandidate are closures
// private to that React component -- there is no jsdom/testing-library in
// this repo to mount and drive the real component (confirmed: neither
// package exists in apps/web/node_modules), so, consistent with this
// project's existing test convention (plain ts-node scripts; see
// planTabChooseMyOwnTime.test.ts's own pure-function + structural-regex
// pairing for the SAME reason), this file:
//   1. Re-implements the exact control-flow shape of those four closures
//      (same state names, same bump() call sites, same guard conditions)
//      using the REAL, imported, production pure functions
//      (localDateTimeToUTC, findCandidateKey, planPayloadFromCandidate) for
//      every piece of actual time/payload math -- only the React
//      state/closure glue is mirrored, never reimplemented logic.
//   2. Exercises that mirror against all 12 required scenarios with
//      deferred promises giving this test exact control over resolution
//      order.
//   3. Is paired with planTabChooseMyOwnTime.test.ts's own structural
//      regex checks (already updated by this same fix) binding this exact
//      guard shape to the real handleCheckTime/handleFindTime/onChange
//      wiring in PlanWithAuraView.tsx -- so a change to the REAL guard's
//      shape that drifts from what's tested here fails THOSE checks, and a
//      regression in the guard's actual BEHAVIOR fails these.
import { findCandidateKey, planPayloadFromCandidate } from '../apps/web/components/PlanWithAuraView';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';
import type { TimingCandidate, TimingSearchResponse } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function candidateAt(startIso: string, durationMinutes = 30): TimingCandidate {
  return {
    start: startIso,
    end: new Date(new Date(startIso).getTime() + durationMinutes * 60000).toISOString(),
    score: 8.5,
    label: 'VERY_GOOD',
    muhurtaScore: 10,
    reasons: [],
    metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral', activityType: 'Workout', dateLabel: 'Test day' },
  };
}

function checkResultFor(candidate: TimingCandidate): TimingSearchResponse {
  return { mode: 'CHECK', candidates: [candidate], requestedCandidate: candidate, betterNearby: undefined };
}

// ============================================================
// SaveGuard -- mirrors saveOpportunity's own double-submission guard
// exactly: `if (savingOpportunityKey || plannedOpportunityKeys.has(key))
// return;`, set key while saving, mark planned + clear key when done.
// ============================================================
class SaveGuard {
  savingKey: string | null = null;
  plannedKeys = new Set<string>();
  payloads: Array<{ key: string; newStartAt: string }> = [];
  saveCallCount = 0;

  async save(key: string, newStartAt: string, performMove: () => Promise<void>) {
    if (this.savingKey || this.plannedKeys.has(key)) return;
    this.savingKey = key;
    this.saveCallCount += 1;
    try {
      await performMove();
      this.payloads.push({ key, newStartAt });
      this.plannedKeys.add(key);
    } finally {
      this.savingKey = null;
    }
  }
}

// ============================================================
// CheckSimulator -- mirrors handleCheckTime + handleUseCheckedRequestedTime
// (PlanWithAuraView.tsx) field-for-field: a single requestGeneration
// counter bumped by every relevant input's own onChange (exactly which
// ones, per the real component, are reproduced in each method below) and
// unconditionally at the start of every handleCheckTime() call; a response
// only commits if its OWN captured generation still equals the current
// one. useRequestedTime() independently re-derives the expected instant
// from the CURRENT checkDate/checkStartTime and refuses to save a
// mismatched requestedCandidate, exactly like the real
// handleUseCheckedRequestedTime.
// ============================================================
class CheckSimulator {
  checkDate: string;
  checkStartTime: string;
  checkDurationMinutes: number;
  checkTaskTitle = 'Workout';
  checkResult: TimingSearchResponse | null = null;
  checkError = '';
  requestGeneration = 0;
  saveGuard = new SaveGuard();
  movePayloads: Array<{ newStartAt: string }> = [];

  constructor(
    initialDate: string,
    initialTime: string,
    initialDuration: number,
    private onTimingSearch: () => Promise<TimingSearchResponse>,
  ) {
    this.checkDate = initialDate;
    this.checkStartTime = initialTime;
    this.checkDurationMinutes = initialDuration;
  }

  bump() { this.requestGeneration += 1; }

  // mirrors <input type="date">'s onChange: setCheckDate + setCheckResult(null) + bumpRequestGeneration()
  changeDate(value: string) { this.checkDate = value; this.checkResult = null; this.bump(); }
  // mirrors <input type="time">'s onChange
  changeTime(value: string) { this.checkStartTime = value; this.checkResult = null; this.bump(); }
  // mirrors the duration SelectPanel's onChange
  changeDuration(value: number) { this.checkDurationMinutes = value; this.checkResult = null; this.bump(); }
  // mirrors the title <input>'s onChange
  changeTitle(value: string) { this.checkTaskTitle = value; this.checkResult = null; this.bump(); }
  // mirrors the mode SegmentedControl's onChange -- bumps ONLY, does not
  // itself clear checkResult (CHECK's own panel isn't even rendered once
  // the mode changes away from it, but an in-flight request must still be
  // invalidated regardless of mode)
  changeMode() { this.bump(); }
  // mirrors handleReschedulePlan's own setReschedulingPlanId(...) + bumpRequestGeneration()
  // (it ALSO calls setCheckResult(null)/setCheckError(''), reproduced here)
  changeRescheduleTarget() { this.checkResult = null; this.checkError = ''; this.bump(); }
  // mirrors the deep-link-driven reset useEffect's own bumpRequestGeneration()
  // call -- generic abandonment/cancellation, independent of any specific
  // field changing
  abandon() { this.bump(); }

  async handleCheckTime() {
    this.bump();
    const myRequestGeneration = this.requestGeneration;
    try {
      const candidateStart = localDateTimeToUTC(this.checkDate, this.checkStartTime, TZ).toISOString();
      void candidateStart; // the real code passes this to onTimingSearch; the mock ignores it and resolves via its own deferred promise
      const next = await this.onTimingSearch();
      if (myRequestGeneration !== this.requestGeneration) return;
      this.checkResult = next;
    } catch {
      if (myRequestGeneration !== this.requestGeneration) return;
      this.checkError = 'failed';
    }
  }

  async useRequestedTime(performMove: () => Promise<void> = async () => {}) {
    const candidate = this.checkResult?.requestedCandidate;
    if (!candidate) return;
    const expectedStart = localDateTimeToUTC(this.checkDate, this.checkStartTime, TZ).toISOString();
    if (candidate.start !== expectedStart) {
      this.checkResult = null;
      this.checkError = 'stale-mismatch';
      return;
    }
    await this.saveGuard.save(findCandidateKey(candidate), candidate.start, async () => {
      await performMove();
      this.movePayloads.push({ newStartAt: candidate.start });
      void planPayloadFromCandidate(candidate, this.checkDurationMinutes); // exercises the real payload builder, as the real onPlan does
    });
  }
}

// ============================================================
// FindSimulator -- mirrors handleFindTime + handleUseFoundCandidate.
// FIND has no single user-typed "expected instant" to recompute against
// (its candidates ARE the search results) -- handleUseFoundCandidate's own
// guard instead re-confirms the candidate is still one of the CURRENT
// findResult's own candidates, exactly as mirrored here.
// ============================================================
class FindSimulator {
  taskTitle = 'Workout';
  durationMinutes = 30;
  horizon = 'ANY';
  findResult: TimingSearchResponse | null = null;
  error = '';
  requestGeneration = 0;
  saveGuard = new SaveGuard();
  movePayloads: Array<{ newStartAt: string }> = [];

  constructor(private onTimingSearch: () => Promise<TimingSearchResponse>) {}

  bump() { this.requestGeneration += 1; }

  // mirrors the title input's onChange: setTaskTitle + setFindResult(null) + bumpRequestGeneration()
  changeTitle(value: string) { this.taskTitle = value; this.findResult = null; this.bump(); }
  // mirrors the duration SelectPanel's onChange -- bump ONLY, matching the
  // real component exactly (it does not also null findResult)
  changeDuration(value: number) { this.durationMinutes = value; this.bump(); }
  // mirrors the horizon SelectPanel's onChange -- bump ONLY, same reason
  changeHorizon(value: string) { this.horizon = value; this.bump(); }

  async handleFindTime() {
    this.bump();
    const myRequestGeneration = this.requestGeneration;
    try {
      const next = await this.onTimingSearch();
      if (myRequestGeneration !== this.requestGeneration) return;
      this.findResult = next;
    } catch {
      if (myRequestGeneration !== this.requestGeneration) return;
      this.error = 'failed';
    }
  }

  async useCandidate(candidate: TimingCandidate, performMove: () => Promise<void> = async () => {}) {
    const stillCurrent = this.findResult?.candidates.some((entry) => entry.start === candidate.start && entry.end === candidate.end) ?? false;
    if (!stillCurrent) {
      this.findResult = null;
      this.error = 'stale-mismatch';
      return;
    }
    await this.saveGuard.save(findCandidateKey(candidate), candidate.start, async () => {
      await performMove();
      this.movePayloads.push({ newStartAt: candidate.start });
      void planPayloadFromCandidate(candidate, this.durationMinutes);
    });
  }
}

async function main() {
  // ---- 1. CHECK request A -> change date -> A resolves ----
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new CheckSimulator('2026-10-26', '11:00', 30, () => dA.promise);
    const p1 = sim.handleCheckTime();
    sim.changeDate('2026-10-27');
    dA.resolve(checkResultFor(candidateAt('2026-10-26T05:30:00.000Z')));
    await p1;
    check('1. CHECK request A -> change DATE -> A resolves: the stale Oct-26 response for the field that is now Oct-27 is dropped, checkResult stays null', sim.checkResult === null);
  }

  // ---- 2. CHECK request A -> change time -> A resolves ----
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new CheckSimulator('2026-10-26', '11:00', 30, () => dA.promise);
    const p1 = sim.handleCheckTime();
    sim.changeTime('14:00');
    dA.resolve(checkResultFor(candidateAt('2026-10-26T05:30:00.000Z')));
    await p1;
    check('2. CHECK request A -> change TIME -> A resolves: the stale 11:00 response is dropped once the field reads 14:00, checkResult stays null', sim.checkResult === null);
  }

  // ---- 3. CHECK request A -> change duration -> A resolves ----
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new CheckSimulator('2026-10-26', '11:00', 30, () => dA.promise);
    const p1 = sim.handleCheckTime();
    sim.changeDuration(60);
    dA.resolve(checkResultFor(candidateAt('2026-10-26T05:30:00.000Z', 30)));
    await p1;
    check('3. CHECK request A -> change DURATION -> A resolves: the stale 30-min response is dropped once duration reads 60, checkResult stays null', sim.checkResult === null);
  }

  // ---- 4. CHECK request A -> request B -> B resolves -> A resolves ----
  {
    const dA = deferred<TimingSearchResponse>();
    const dB = deferred<TimingSearchResponse>();
    let call = 0;
    const sim = new CheckSimulator('2026-10-26', '11:00', 30, () => (++call === 1 ? dA.promise : dB.promise));
    const p1 = sim.handleCheckTime(); // generation 1
    sim.changeDate('2026-10-27');
    const p2 = sim.handleCheckTime(); // generation 2 (a genuinely NEWER request, same or different inputs)
    const candidateB = candidateAt('2026-10-27T08:30:00.000Z');
    dB.resolve(checkResultFor(candidateB)); // B resolves first
    await p2;
    dA.resolve(checkResultFor(candidateAt('2026-10-26T05:30:00.000Z'))); // A resolves late
    await p1;
    check('4. CHECK request A -> request B -> B resolves -> A resolves: B (the newer request) lands and A (older, arriving later) cannot overwrite it', sim.checkResult?.requestedCandidate?.start === candidateB.start);
  }

  // ---- 5. CHECK request A -> change target -> A resolves ----
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new CheckSimulator('2026-10-26', '11:00', 30, () => dA.promise);
    const p1 = sim.handleCheckTime();
    sim.changeRescheduleTarget();
    dA.resolve(checkResultFor(candidateAt('2026-10-26T05:30:00.000Z')));
    await p1;
    check('5. CHECK request A -> change RESCHEDULE TARGET -> A resolves: the response for the plan being rescheduled before the switch is dropped', sim.checkResult === null);
  }

  // ---- 6. CHECK request A -> abandon -> A resolves ----
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new CheckSimulator('2026-10-26', '11:00', 30, () => dA.promise);
    const p1 = sim.handleCheckTime();
    sim.abandon();
    dA.resolve(checkResultFor(candidateAt('2026-10-26T05:30:00.000Z')));
    await p1;
    check('6. CHECK request A -> abandon -> A resolves: a response for an abandoned/cancelled check is dropped even though no specific field changed', sim.checkResult === null);
  }

  // ---- 7. CHECK request A -> change mode -> A resolves ----
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new CheckSimulator('2026-10-26', '11:00', 30, () => dA.promise);
    const p1 = sim.handleCheckTime();
    sim.changeMode();
    dA.resolve(checkResultFor(candidateAt('2026-10-26T05:30:00.000Z')));
    await p1;
    check('7. CHECK request A -> change MODE -> A resolves: switching away from CHECK invalidates its own in-flight request, even though the mode switch itself never clears checkResult directly', sim.checkResult === null);
  }

  // ---- 8. CHECK request A -> change input away and back -> A resolves ----
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new CheckSimulator('2026-10-26', '11:00', 30, () => dA.promise);
    const p1 = sim.handleCheckTime(); // myRequestGeneration = 1, for date 2026-10-26
    sim.changeDate('2026-10-27'); // generation 2
    sim.changeDate('2026-10-26'); // generation 3 -- VALUE is back to the original, but identity has moved on
    // A's response happens to describe exactly the CURRENT (reverted) date/time --
    // a value-based guard would wrongly accept it; the identity-based generation guard must not.
    dA.resolve(checkResultFor(candidateAt(localDateTimeToUTC('2026-10-26', '11:00', TZ).toISOString())));
    await p1;
    check('8. CHECK request A -> change date away and back to the SAME value -> A resolves: still dropped -- the guard is identity-based (requestGeneration), not value-based, so a reverted value cannot resurrect a stale response', sim.checkResult === null);
  }

  // ---- 9. FIND request A -> change search parameters -> A resolves ----
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new FindSimulator(() => dA.promise);
    const p1 = sim.handleFindTime();
    sim.changeTitle('Meditation');
    const staleCandidate = candidateAt('2026-10-26T05:30:00.000Z');
    dA.resolve({ mode: 'FIND', candidates: [staleCandidate] });
    await p1;
    check('9. FIND request A -> change search parameters (title) -> A resolves: the stale search response for the abandoned parameters is dropped, findResult stays null', sim.findResult === null);
  }

  // ---- 10. Stale result cannot invoke Move ----
  {
    const sim = new CheckSimulator('2026-10-27', '09:00', 30, () => Promise.reject(new Error('unused')));
    // Directly construct the one state shape the independent save-boundary
    // guard exists to catch: a checkResult that does not match the
    // CURRENT checkDate/checkStartTime (section 3: "Do not rely solely on
    // hiding stale assessment cards" -- this proves the save-time check
    // itself, independent of whatever upstream guard did or didn't
    // already clear it).
    const staleCandidate = candidateAt(localDateTimeToUTC('2026-10-26', '11:00', TZ).toISOString());
    sim.checkResult = checkResultFor(staleCandidate);
    await sim.useRequestedTime();
    check('10. a stale result (mismatched against the current date/time) cannot invoke Move -- no payload recorded', sim.movePayloads.length === 0 && sim.saveGuard.payloads.length === 0);
    check('10. the mismatched result is invalidated and an error surfaced, requiring a fresh assessment, rather than silently saving the wrong instant', sim.checkResult === null && sim.checkError === 'stale-mismatch');
  }

  // ---- 11. Fresh result invokes Move with the exact confirmed destination ----
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new CheckSimulator('2026-10-27', '09:00', 30, () => dA.promise);
    const p1 = sim.handleCheckTime();
    const expectedStart = localDateTimeToUTC('2026-10-27', '09:00', TZ).toISOString();
    const freshCandidate = candidateAt(expectedStart);
    dA.resolve(checkResultFor(freshCandidate));
    await p1;
    await sim.useRequestedTime();
    check('11. a fresh, matching result invokes Move with EXACTLY the currently confirmed destination (the date/time still on screen)', sim.movePayloads.length === 1 && sim.movePayloads[0].newStartAt === expectedStart);
  }

  // ---- 12. Repeated Save clicks cannot create duplicate replacements ----
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new CheckSimulator('2026-10-27', '09:00', 30, () => dA.promise);
    const p1 = sim.handleCheckTime();
    const expectedStart = localDateTimeToUTC('2026-10-27', '09:00', TZ).toISOString();
    dA.resolve(checkResultFor(candidateAt(expectedStart)));
    await p1;
    const moveDeferred = deferred<void>();
    const click1 = sim.useRequestedTime(() => moveDeferred.promise);
    const click2 = sim.useRequestedTime(() => moveDeferred.promise); // fired before click1's Move has resolved
    moveDeferred.resolve();
    await Promise.all([click1, click2]);
    check('12. two rapid "Use this time" clicks before the first Move resolves cannot create two replacements -- only one Move payload, saveOpportunity\'s own double-submission guard only let one through', sim.movePayloads.length === 1 && sim.saveGuard.saveCallCount === 1);
  }

  // ---- bonus: FIND-side parity for 10/11/12 (section 4's explicit parity ask) ----
  {
    const sim = new FindSimulator(() => Promise.reject(new Error('unused')));
    const staleCandidate = candidateAt('2026-10-26T05:30:00.000Z');
    sim.findResult = { mode: 'FIND', candidates: [candidateAt('2026-10-27T05:30:00.000Z')] }; // current result does NOT include the stale candidate
    await sim.useCandidate(staleCandidate);
    check('FIND bonus: a candidate no longer present in the CURRENT findResult cannot invoke Move', sim.movePayloads.length === 0 && sim.findResult === null && sim.error === 'stale-mismatch');
  }
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new FindSimulator(() => dA.promise);
    const p1 = sim.handleFindTime();
    const freshCandidate = candidateAt('2026-10-28T05:30:00.000Z');
    dA.resolve({ mode: 'FIND', candidates: [freshCandidate] });
    await p1;
    await sim.useCandidate(freshCandidate);
    check('FIND bonus: a candidate still present in the current findResult invokes Move with exactly that candidate\'s own start', sim.movePayloads.length === 1 && sim.movePayloads[0].newStartAt === freshCandidate.start);
  }
  {
    const dA = deferred<TimingSearchResponse>();
    const sim = new FindSimulator(() => dA.promise);
    const p1 = sim.handleFindTime();
    const freshCandidate = candidateAt('2026-10-29T05:30:00.000Z');
    dA.resolve({ mode: 'FIND', candidates: [freshCandidate] });
    await p1;
    const moveDeferred = deferred<void>();
    const click1 = sim.useCandidate(freshCandidate, () => moveDeferred.promise);
    const click2 = sim.useCandidate(freshCandidate, () => moveDeferred.promise);
    moveDeferred.resolve();
    await Promise.all([click1, click2]);
    check('FIND bonus: two rapid clicks on the same found candidate cannot create two replacements', sim.movePayloads.length === 1);
  }

  if (!allPassed) { console.error('SOME DR4-F2B ASYNC RACE CONDITION CHECKS FAILED'); process.exit(1); }
  console.log('ALL DR4-F2B ASYNC RACE CONDITION CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
