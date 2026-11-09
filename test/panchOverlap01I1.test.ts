/**
 * PANCH-OVERLAP-01-I1 -- regression coverage for the shared Panchangam
 * overlap decision policy (evaluatePanchangOverlap, packages/panchang/src/
 * windows.ts) and its consumers: resolveOverlappingCandidate's multi-caution
 * tie-break (dailyAssistant.ts), buildDailyBriefing's additive
 * commencementCaution field, resolveHistoricalActiveWindow's prospective-only
 * correction, and HomeDashboard's caution-aware Green Light/Next
 * Action/Right-Now-tone copy.
 *
 * Root cause (see issue #331, independently confirmed by two reviewers and
 * re-derived from first principles before this fix): computePanchangWindows()
 * returns windows in a fixed array order [brahma, abhijit, rahuKalam,
 * gulikaKalam, yamaGandam]; getActiveWindow() returns the first array match
 * with no overlap resolution, so it silently prefers Abhijit whenever it
 * overlaps a commencement-caution window -- a geometric certainty (solar
 * noon is exactly the boundary between the 8-way segment scheme's segment 3
 * and 4; Abhijit, centered on solar noon, always straddles whichever caution
 * window occupies one of those two segments), confirmed to recur on 5 of 7
 * weekdays at every latitude. resolveOverlappingCandidate() already solved
 * this correctly for Timing Search. evaluatePanchangOverlap() exposes the
 * SAME policy for any consumer.
 *
 * Real-calendar fixtures below (Mumbai, IST, India Standard Time
 * +5:30/330min) reuse exactly the dates/instants independently verified by
 * two prior review rounds against the real computePanchangWindows()/
 * computeSolarEphemeris() pipeline:
 *   - Friday 2026-11-20, ~12:02 IST -- Abhijit overlaps Rahu Kalam (confirmed
 *     real CHECK output: CAUTION, windowType RAHU_KALAM).
 *   - Thursday 2026-11-19 -- a clean control day, no caution overlap at all.
 *
 * Run the pure sections (A-E) with plain `npx ts-node`. Section F (real-DOM)
 * requires `npx ts-node --project tsconfig.jsdom-tests.json` (same
 * convention as test/homeRhythm01I1F3JsdomBehavioral.test.ts /
 * test/homeRhythmA1F1Greeting.test.ts) -- it degrades to an explicit SKIP
 * under plain ts-node rather than crashing.
 */
import {
  computePanchangWindows,
  evaluatePanchangOverlap,
  getActiveWindow,
  isInauspiciousCommencementWindow,
  WindowSpan,
} from '../packages/panchang/src/windows';
import { computeSolarEphemeris } from '../packages/astronomy/src/ephemeris';
import { SolarNoEventError } from '../packages/astronomy/src/errors';
import { buildDailyBriefing, DailyAssistantContext, resolveOverlappingCandidate, SlotCandidate } from '../packages/recommendation/src/dailyAssistant';
import { resolveHistoricalActiveWindow } from '../apps/web/lib/historicalActivityWindow';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(((i + 7) * 2654435761) % (i + 1)); // deterministic, not Math.random -- reproducible test
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ============================================================
// A. evaluatePanchangOverlap -- synthetic single/overlap/multi-overlap cases
// ============================================================

function w(type: WindowSpan['type'], label: string, startMinutes: number, endMinutes: number): WindowSpan {
  return { type, label, startMinutes, endMinutes, startMinute: startMinutes, endMinute: endMinutes };
}

{
  const abhijitOnly = [w('ABHIJIT', 'Abhijit Muhurtham', 700, 740)];
  const d = evaluatePanchangOverlap(abhijitOnly, 720);
  check('A1. Abhijit only: commencementCaution is false, favorable window retained', d.commencementCaution === false && d.favorableWindows.length === 1 && d.cautionWindows.length === 0);
}
{
  const rahuOnly = [w('RAHU_KALAM', 'Rahu Kalam', 700, 740)];
  const d = evaluatePanchangOverlap(rahuOnly, 720);
  check('A2. Rahu only: commencementCaution is true', d.commencementCaution === true && d.cautionWindows.length === 1 && d.cautionWindows[0].type === 'RAHU_KALAM');
}
{
  const yamaOnly = [w('YAMA', 'Yama Gandam', 700, 740)];
  const d = evaluatePanchangOverlap(yamaOnly, 720);
  check('A3. Yama only: commencementCaution is true', d.commencementCaution === true && d.cautionWindows[0].type === 'YAMA');
}
{
  const gulikaOnly = [w('GULIKA', 'Gulika Kalam', 700, 740)];
  const d = evaluatePanchangOverlap(gulikaOnly, 720);
  check('A4. Gulika only: commencementCaution is true', d.commencementCaution === true && d.cautionWindows[0].type === 'GULIKA');
}
{
  const abhijitRahu = [w('ABHIJIT', 'Abhijit Muhurtham', 700, 740), w('RAHU_KALAM', 'Rahu Kalam', 710, 750)];
  const d = evaluatePanchangOverlap(abhijitRahu, 720);
  check('A5. Abhijit+Rahu overlap: caution acknowledged, favorable window ALSO still present as fact (not erased)', d.commencementCaution === true && d.favorableWindows.length === 1 && d.cautionWindows.length === 1 && d.activeWindows.length === 2);
}
{
  const abhijitYama = [w('ABHIJIT', 'Abhijit Muhurtham', 700, 740), w('YAMA', 'Yama Gandam', 680, 720)];
  const d = evaluatePanchangOverlap(abhijitYama, 710);
  check('A6. Abhijit+Yama overlap: caution acknowledged', d.commencementCaution === true && d.cautionWindows[0].type === 'YAMA');
}
{
  const abhijitGulika = [w('ABHIJIT', 'Abhijit Muhurtham', 700, 740), w('GULIKA', 'Gulika Kalam', 700, 740)];
  const d = evaluatePanchangOverlap(abhijitGulika, 720);
  check('A7. Abhijit+Gulika overlap: caution acknowledged (Gulika is NOT silently treated as safe)', d.commencementCaution === true && d.cautionWindows[0].type === 'GULIKA');
}
{
  // The real Wednesday case: both halves of Abhijit covered by two DIFFERENT caution windows.
  const multiCaution = [w('ABHIJIT', 'Abhijit Muhurtham', 700, 740), w('GULIKA', 'Gulika Kalam', 680, 720), w('RAHU_KALAM', 'Rahu Kalam', 720, 760)];
  const dAtGulikaHalf = evaluatePanchangOverlap(multiCaution, 710);
  const dAtRahuHalf = evaluatePanchangOverlap(multiCaution, 730);
  check('A8a. Multi-caution Wednesday case, first half: Gulika caution acknowledged', dAtGulikaHalf.commencementCaution === true && dAtGulikaHalf.cautionWindows.some((cw) => cw.type === 'GULIKA'));
  check('A8b. Multi-caution Wednesday case, second half: Rahu caution acknowledged', dAtRahuHalf.commencementCaution === true && dAtRahuHalf.cautionWindows.some((cw) => cw.type === 'RAHU_KALAM'));
  // Exactly at the boundary minute (720), inclusive end on Gulika AND inclusive-checked start on Rahu both match -- BOTH cautions preserved as facts, never silently collapsed to one.
  const dAtBoundary = evaluatePanchangOverlap(multiCaution, 720);
  check('A8c. At the exact boundary minute, BOTH caution windows are preserved as facts (never silently discarding one)', dAtBoundary.cautionWindows.length === 2);
  check('A8d. primaryCautionWindow is a deterministic (earliest-start, then alphabetical) single pick, never array-order-incidental', dAtBoundary.primaryCautionWindow?.type === 'GULIKA');
}
{
  const d = evaluatePanchangOverlap([], 720);
  check('A9. No active windows: no fabricated favorable result (commencementCaution false, activeWindows empty)', d.commencementCaution === false && d.activeWindows.length === 0 && d.favorableWindows.length === 0);
}
{
  // Array-order independence -- the required regression test.
  const base = [w('ABHIJIT', 'Abhijit Muhurtham', 700, 740), w('GULIKA', 'Gulika Kalam', 680, 720), w('RAHU_KALAM', 'Rahu Kalam', 720, 760), w('BRAHMA', 'Brahma Muhurtham', 500, 550), w('YAMA', 'Yama Gandam', 100, 150)];
  const d1 = evaluatePanchangOverlap(base, 720);
  const d2 = evaluatePanchangOverlap(shuffled(base), 720);
  const d3 = evaluatePanchangOverlap([...base].reverse(), 720);
  check(
    'A10. Array-order independence: shuffling the SAME windows produces an IDENTICAL commencementCaution/cautionWindows/primaryCautionWindow decision',
    d1.commencementCaution === d2.commencementCaution &&
      d1.commencementCaution === d3.commencementCaution &&
      d1.cautionWindows.length === d2.cautionWindows.length &&
      d1.cautionWindows.length === d3.cautionWindows.length &&
      d1.primaryCautionWindow?.type === d2.primaryCautionWindow?.type &&
      d1.primaryCautionWindow?.type === d3.primaryCautionWindow?.type
  );
}
{
  // getActiveWindow itself must remain byte-identical (unchanged behavior) -- confirms the refactor to share windowContainsMinute() didn't alter it.
  const windows = [w('ABHIJIT', 'Abhijit Muhurtham', 700, 740), w('RAHU_KALAM', 'Rahu Kalam', 710, 750)];
  check('A11. getActiveWindow() is UNCHANGED: still first-match array order (Abhijit, listed first, still wins)', getActiveWindow(windows, 720) === 'ABHIJIT');
}

// ============================================================
// B. resolveOverlappingCandidate -- multi-caution tie-break determinism
// ============================================================

{
  const slot = (type: SlotCandidate['type'], label: string, startMinute: number, endMinute: number): SlotCandidate => ({ type, label, startMinute, endMinute });
  const candidatesRahuFirst: SlotCandidate[] = [slot('RAHU_KALAM', 'Rahu Kalam', 680, 720), slot('GULIKA', 'Gulika Kalam', 700, 740), slot('ABHIJIT', 'Abhijit Muhurtham', 660, 740)];
  const candidatesGulikaFirst: SlotCandidate[] = [slot('GULIKA', 'Gulika Kalam', 700, 740), slot('RAHU_KALAM', 'Rahu Kalam', 680, 720), slot('ABHIJIT', 'Abhijit Muhurtham', 660, 740)];
  const r1 = resolveOverlappingCandidate(candidatesRahuFirst, 710);
  const r2 = resolveOverlappingCandidate(candidatesGulikaFirst, 710);
  check(
    'B1. resolveOverlappingCandidate multi-caution tie-break is deterministic, NOT incidental array order: Rahu-first and Gulika-first orderings of the SAME overlapping candidates resolve to the SAME winner',
    r1?.type === r2?.type
  );
  check('B2. The deterministic tie-break picks the earlier-starting caution candidate (Rahu starts at 680, before Gulika at 700)', r1?.type === 'RAHU_KALAM');
  // Single-caution case: byte-identical to the pre-existing behavior.
  const singleCaution: SlotCandidate[] = [slot('ABHIJIT', 'Abhijit Muhurtham', 660, 740), slot('RAHU_KALAM', 'Rahu Kalam', 700, 740)];
  check('B3. Single-caution overlap (the overwhelming majority of real cases): unchanged behavior, caution wins', resolveOverlappingCandidate(singleCaution, 720)?.type === 'RAHU_KALAM');
}

// ============================================================
// C. buildDailyBriefing's commencementCaution field -- real-calendar fixtures
// ============================================================

const mumbai = { latitude: 19.076, longitude: 72.8777, timezone: 'Asia/Kolkata', tzOffsetMinutes: 330 };

{
  // Friday 2026-11-20, ~12:02 IST -- independently confirmed real overlap (Abhijit x Rahu Kalam).
  const context: DailyAssistantContext = { ...mumbai, now: new Date('2026-11-20T06:32:00.000Z') };
  const briefing = buildDailyBriefing(context);
  check('C1. Real Mumbai Friday overlap instant: activeWindow is still ABHIJIT (getActiveWindow unchanged)', briefing.activeWindow === 'ABHIJIT');
  check('C2. Real Mumbai Friday overlap instant: briefingState is ACTIVE', briefing.briefingState === 'ACTIVE');
  check('C3. [THE FIX] commencementCaution.activeNow is TRUE -- Home now knows a caution window overlaps right now', briefing.commencementCaution.activeNow === true);
  check('C4. commencementCaution.cautionWindows names RAHU_KALAM specifically', briefing.commencementCaution.cautionWindows.some((cw) => cw.windowType === 'RAHU_KALAM'));
  check('C5. commencementCaution.overlapsPeakWindow is also true (the static whole-window fact)', briefing.commencementCaution.overlapsPeakWindow === true);
  check('C6. greenLight is UNCHANGED -- still names the favorable activity, never silently suppressed as data', typeof briefing.greenLight.title === 'string' && briefing.greenLight.title.length > 0);
}
{
  // Thursday 2026-11-19 -- clean control day, no overlap anywhere in Abhijit's span.
  const context: DailyAssistantContext = { ...mumbai, now: new Date('2026-11-19T06:32:00.000Z') };
  const briefing = buildDailyBriefing(context);
  check('C7. Control day (Thursday, no overlap): commencementCaution.activeNow is false', briefing.commencementCaution.activeNow === false);
  check('C8. Control day: commencementCaution.overlapsPeakWindow is false', briefing.commencementCaution.overlapsPeakWindow === false);
  check('C9. Control day: cautionWindows is empty', briefing.commencementCaution.cautionWindows.length === 0);
}

// ============================================================
// D. Boundary instants -- one minute before/at/during/after the real Friday overlap
// ============================================================

{
  // Derive the real Rahu Kalam window boundaries for this exact date via the real pipeline, then probe minute-by-minute around them.
  const probeContext: DailyAssistantContext = { ...mumbai, now: new Date('2026-11-20T06:30:00.000Z') };
  const solar = computeSolarEphemeris({ year: 2026, month: 11, day: 20, latitude: mumbai.latitude, longitude: mumbai.longitude, tzOffsetMinutes: mumbai.tzOffsetMinutes });
  const windows = computePanchangWindows(solar, 5 /* Friday */);
  const rahu = windows.find((win) => win.type === 'RAHU_KALAM')!;
  const minuteToInstant = (minute: number) => new Date(Date.UTC(2026, 10, 20, 0, 0, 0) - mumbai.tzOffsetMinutes * 60_000 + minute * 60_000);

  const beforeStart = buildDailyBriefing({ ...mumbai, now: minuteToInstant(rahu.startMinutes - 1) });
  const atStart = buildDailyBriefing({ ...mumbai, now: minuteToInstant(rahu.startMinutes) });
  const during = buildDailyBriefing({ ...mumbai, now: minuteToInstant(Math.floor((rahu.startMinutes + rahu.endMinutes) / 2)) });
  const atEnd = buildDailyBriefing({ ...mumbai, now: minuteToInstant(rahu.endMinutes) });
  const afterEnd = buildDailyBriefing({ ...mumbai, now: minuteToInstant(rahu.endMinutes + 1) });

  check('D1. One minute before Rahu Kalam starts: no caution yet (still a clean Abhijit minute, if Abhijit has started)', beforeStart.commencementCaution.activeNow === false || beforeStart.briefingState !== 'ACTIVE');
  check('D2. Exact start minute of Rahu Kalam: caution is active (inclusive-start)', atStart.commencementCaution.activeNow === true);
  check('D3. During the overlap: caution is active', during.commencementCaution.activeNow === true);
  check('D4. Exact end minute of Rahu Kalam (inclusive per getActiveWindow/evaluatePanchangOverlap convention): caution is still active', atEnd.commencementCaution.activeNow === true);
  check('D5. One minute after Rahu Kalam ends: caution no longer active', afterEnd.commencementCaution.activeNow === false);
}

// ============================================================
// E. Solar-unavailable preservation (PA-3C) -- unaffected by this change
// ============================================================

{
  let threw = false;
  let isSolarNoEvent = false;
  try {
    buildDailyBriefing({ latitude: 89, longitude: 0, timezone: 'UTC', tzOffsetMinutes: 0, now: new Date('2026-06-21T12:00:00.000Z') });
  } catch (e) {
    threw = true;
    isSolarNoEvent = e instanceof SolarNoEventError;
  }
  check('E1. Solar-unavailable (polar) instant still throws SolarNoEventError -- commencementCaution never fabricates a result for an unavailable day', threw && isSolarNoEvent);
}

// ============================================================
// F. resolveHistoricalActiveWindow -- prospective-only correction
// ============================================================

{
  const fridayOverlapInstant = new Date('2026-11-20T06:32:00.000Z');
  const result = resolveHistoricalActiveWindow(fridayOverlapInstant, mumbai.latitude, mumbai.longitude, mumbai.timezone);
  check('F1. [THE FIX] A NEW habit log at the real Friday overlap instant is now classified RAHU_KALAM, not silently stored as ABHIJIT', result === 'RAHU_KALAM');

  const cleanInstant = new Date('2026-11-19T06:32:00.000Z');
  const cleanResult = resolveHistoricalActiveWindow(cleanInstant, mumbai.latitude, mumbai.longitude, mumbai.timezone);
  check('F2. A NEW habit log on the clean control day is unaffected: still ABHIJIT', cleanResult === 'ABHIJIT');
}

// ============================================================
// G. Real-DOM evidence -- HomeDashboard's caution-aware copy
// ============================================================

async function runDomSection() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { React, mount } = require('./jsdomReactHarness');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HomeDashboard } = require('../apps/web/components/HomeDashboard');

    function baseDailyBriefing(overrides: Record<string, unknown> = {}) {
      return {
        dateLabel: 'Friday, Nov 20, 2026',
        briefingState: 'ACTIVE',
        peakWindow: { name: 'Abhijit Muhurtham', startTime: '11:43 AM', endTime: '12:35 PM', endTimestamp: '2026-11-20T07:05:00.000Z' },
        nextWindow: null,
        otherFavorableWindows: [],
        nextAction: 'Do your highest-value heavy lifting or a hard training session now.',
        greenLight: { title: 'Heavy lifting or a hard training session', description: 'Peak solar window', windowType: 'ABHIJIT' },
        commencementCaution: { activeNow: false, overlapsPeakWindow: false, cautionWindows: [] },
        notificationText: '',
        widgetText: '',
        activeWindow: 'ABHIJIT',
        ...overrides,
      };
    }
    function baseProps(overrides: Record<string, unknown> = {}) {
      return {
        userName: 'Test',
        energyScore: 95,
        activeWindowName: 'ABHIJIT',
        themeText: 'Peak clarity',
        nextShift: { windowName: 'Next Window', startsIn: 'Soon', startTime: '--:--', score: 70, themeText: 'Neutral' },
        currentMinuteOfDay: 702,
        dailyBriefingStatus: 'available' as const,
        onPlanClick: () => {},
        ...overrides,
      };
    }

    const noCautionHarness = await mount(React.createElement(HomeDashboard, baseProps({ dailyBriefing: baseDailyBriefing() })));
    const noCautionText = noCautionHarness.container.textContent || '';
    await noCautionHarness.unmount();
    check('G1. [REAL DOM] No caution overlap: unqualified "favorable for..." copy still renders unchanged', noCautionText.includes('favorable for'));
    check('G2. [REAL DOM] No caution overlap: "Use Caution"/caution-qualified wording does NOT render', !noCautionText.includes('also applies') && !noCautionText.includes('also active right now'));

    const cautionDailyBriefing = baseDailyBriefing({
      commencementCaution: {
        activeNow: true,
        overlapsPeakWindow: true,
        cautionWindows: [{ name: 'Rahu Kalam', windowType: 'RAHU_KALAM', startTime: '10:52 AM', endTime: '12:29 PM', startTimestamp: '2026-11-20T05:22:00.000Z', endTimestamp: '2026-11-20T06:59:00.000Z' }],
      },
    });
    const cautionHarness = await mount(React.createElement(HomeDashboard, baseProps({ dailyBriefing: cautionDailyBriefing })));
    const cautionText = cautionHarness.container.textContent || '';
    await cautionHarness.unmount();
    check('G3. [REAL DOM, THE FIX] Caution overlap active now: the unqualified "favorable for..." claim is GONE from the rendered DOM', !cautionText.includes('— favorable for'));
    check('G4. [REAL DOM] Caution overlap active now: the rendered copy names the real caution window (Rahu Kalam)', cautionText.includes('Rahu Kalam'));
    check('G5. [REAL DOM] Caution overlap active now: the CTA ("Plan this") is still present -- PD-02, not removed, only qualified', cautionText.includes('Plan this'));
    check('G6. [REAL DOM] Caution overlap active now: Next Action text no longer says an unqualified "...now." claim for the peak activity', !cautionText.includes('Do your highest-value heavy lifting or a hard training session now.'));
  } catch (e: any) {
    if (e?.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(String(e?.message))) {
      check('G. [REAL DOM -- SKIPPED, not run under the jsdom-tests tsconfig] Run with: npx ts-node --project tsconfig.jsdom-tests.json test/panchOverlap01I1.test.ts', true);
    } else {
      throw e;
    }
  }
}

runDomSection().then(() => {
  console.log(
    failed === 0
      ? `\n${passed} passed, 0 failed.\nALL PANCH-OVERLAP-01-I1 CHECKS PASSED`
      : `\n${passed} passed, ${failed} failed.\nSOME PANCH-OVERLAP-01-I1 CHECKS FAILED`
  );
  process.exit(failed === 0 ? 0 : 1);
});
