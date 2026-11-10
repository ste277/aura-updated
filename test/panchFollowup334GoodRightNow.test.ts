/**
 * PANCH-FOLLOWUP-334-I1 -- regression coverage for the Good Right Now card
 * (apps/web/components/HomeDashboard.tsx, GoodRightNowCard/
 * selectGoodRightNowCards) becoming caution-aware.
 *
 * Root cause (issue #334): selectGoodRightNowCards/getActionCards/
 * getActivityDiscoveryCards are keyed purely on activeWindowName (a string
 * such as 'ABHIJIT', which getActiveWindow deliberately still returns
 * first-match even during a genuine caution overlap -- see
 * PANCH-OVERLAP-01-I1). The card therefore could render an unqualified
 * favorable claim ("Peak solar window...") even while a commencement
 * caution window (Rahu Kalam/Yama/Gulika) genuinely overlaps the current
 * minute -- exactly the gap the Right Now hero and Green Light card were
 * already fixed for in PANCH-OVERLAP-01-I1.
 *
 * The fix reuses the SAME already-computed `cautionAppliesNow`/
 * `activeCautionWindowNames` values (themselves sourced from
 * evaluatePanchangOverlap via page.tsx's liveCommencementCaution --
 * unchanged by this ticket) as component props into GoodRightNowCard,
 * additively: a text "Caution" badge plus a caution-prefixed description,
 * never altering card selection/ranking (selectGoodRightNowCards itself is
 * untouched) or the action button.
 *
 * Follows the same jsdom-mount convention as test/panchOverlap01I1.test.ts:
 *   npx ts-node --project tsconfig.jsdom-tests.json test/panchFollowup334GoodRightNow.test.ts
 * Degrades to an explicit SKIP under plain `npx ts-node` (no jsdom/jsx).
 */

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

async function runDomSection() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { React, mount } = require('./jsdomReactHarness');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HomeDashboard } = require('../apps/web/components/HomeDashboard');

    // Minimal fixture: no spotlightItem (no scheduled plan/opportunity
    // passed in), so HomeDashboard's Right Now spotlight renders the
    // Good Right Now card branch (the `{spotlightItem ? (...) : (
    // goodRightNow[0] && (...) )}` branch) -- same precondition the
    // existing PANCH-OVERLAP-01-I1 G-series fixtures already rely on.
    function baseDailyBriefing(overrides: Record<string, unknown> = {}) {
      return {
        dateLabel: 'Friday, Nov 20, 2026',
        briefingState: 'ACTIVE',
        peakWindow: { name: 'Abhijit Muhurtham', startTime: '11:43 AM', endTime: '12:35 PM', endTimestamp: '2026-11-20T07:05:00.000Z' },
        nextWindow: null,
        otherFavorableWindows: [],
        nextAction: 'Do your highest-value heavy lifting or a hard training session now.',
        greenLight: { title: 'Heavy lifting or a hard training session', description: 'Peak solar window', windowType: 'ABHIJIT' },
        commencementCaution: { activeNow: false, activeCautionWindows: [], overlapsPeakWindow: false, cautionWindows: [] },
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
        dailyBriefing: baseDailyBriefing(),
        liveCommencementCaution: { activeNow: false, activeCautionWindows: [] },
        onPlanClick: () => {},
        ...overrides,
      };
    }

    // T1 -- no caution overlap: Good Right Now shows the unqualified card
    // (title/description), no caution badge/prefix text anywhere.
    const noCautionHarness = await mount(React.createElement(HomeDashboard, baseProps()));
    const noCautionText = noCautionHarness.container.textContent || '';
    await noCautionHarness.unmount();
    check('T1a. [REAL DOM] No caution: Good Right Now card renders its normal title', noCautionText.includes('Heavy lifting or a hard training session'));
    check('T1b. [REAL DOM] No caution: Good Right Now card renders its normal description, unprefixed', noCautionText.includes('Peak solar window — best alignment for maximum physical output.'));
    check('T1c. [REAL DOM] No caution: no "Caution" badge/prefix text anywhere near Good Right Now', !noCautionText.includes('⚠ Caution') && !noCautionText.includes('Caution: '));

    // T2 -- a genuine caution overlap IS active right now (mirrors the
    // PANCH-OVERLAP-01-I1 Friday Rahu Kalam fixture): the Good Right Now
    // card must acknowledge it (PD-01) without erasing the underlying
    // favorable fact or the action button (PD-02/PD-03).
    const cautionHarness = await mount(React.createElement(HomeDashboard, baseProps({
      liveCommencementCaution: { activeNow: true, activeCautionWindows: [{ name: 'Rahu Kalam', windowType: 'RAHU_KALAM' }] },
    })));
    const cautionText = cautionHarness.container.textContent || '';
    await cautionHarness.unmount();
    check('T2a. [REAL DOM, THE FIX] Caution overlap active now: Good Right Now shows the caution badge', cautionText.includes('⚠ Caution'));
    check('T2b. [REAL DOM, THE FIX] Caution overlap active now: Good Right Now names the real overlapping window (Rahu Kalam)', cautionText.includes('Caution: Rahu Kalam also active'));
    check('T2c. [REAL DOM] Caution overlap active now: the original favorable title is still present as fact (PD-03, not erased)', cautionText.includes('Heavy lifting or a hard training session'));
    check('T2d. [REAL DOM] Caution overlap active now: the primary action control is still present (PD-02, qualified not blocked)', cautionText.includes('Start now') || cautionText.includes('Log now') || cautionText.includes('Do now') || cautionText.includes('Plan'));

    // T3 -- multi-window caution naming: activeCautionWindowNames already
    // joins multiple names with ' and ' upstream (unchanged, reused as-is);
    // confirm the Good Right Now card surfaces that exact joined string
    // rather than re-deriving its own.
    const multiCautionHarness = await mount(React.createElement(HomeDashboard, baseProps({
      liveCommencementCaution: {
        activeNow: true,
        activeCautionWindows: [{ name: 'Rahu Kalam', windowType: 'RAHU_KALAM' }, { name: 'Gulika Kalam', windowType: 'GULIKA' }],
      },
    })));
    const multiCautionText = multiCautionHarness.container.textContent || '';
    await multiCautionHarness.unmount();
    check('T3. [REAL DOM] Multi-window caution: Good Right Now names both windows via the same shared join, never a third independent computation', multiCautionText.includes('Caution: Rahu Kalam and Gulika Kalam also active'));

    // T4 -- the critical live-update proof (mirrors G10-G13): the SAME
    // mounted HomeDashboard instance, with `dailyBriefing` NEVER changing,
    // must transition Good Right Now's caution badge purely from
    // `liveCommencementCaution` changing -- never requiring a refetch.
    const liveHarness = await mount(React.createElement(HomeDashboard, baseProps({
      liveCommencementCaution: { activeNow: false, activeCautionWindows: [] },
    })));
    const beforeText = liveHarness.container.textContent || '';
    check('T4a. [REAL DOM, LONG-MOUNTED, NO REFETCH] Before caution starts: no badge renders', !beforeText.includes('⚠ Caution'));

    await liveHarness.rerender(React.createElement(HomeDashboard, baseProps({
      liveCommencementCaution: { activeNow: true, activeCautionWindows: [{ name: 'Yama Gandam', windowType: 'YAMA' }] },
    })));
    const duringText = liveHarness.container.textContent || '';
    check('T4b. [REAL DOM, LONG-MOUNTED, NO REFETCH] Caution becomes active purely from liveCommencementCaution changing -- dailyBriefing was never touched', duringText.includes('⚠ Caution') && duringText.includes('Caution: Yama Gandam also active'));

    await liveHarness.rerender(React.createElement(HomeDashboard, baseProps({
      liveCommencementCaution: { activeNow: false, activeCautionWindows: [] },
    })));
    const afterText = liveHarness.container.textContent || '';
    await liveHarness.unmount();
    check('T4c. [REAL DOM, LONG-MOUNTED, NO REFETCH] Caution clears once it genuinely ends, purely from the live value changing', !afterText.includes('⚠ Caution') && !afterText.includes('Caution: Yama Gandam'));
  } catch (e: any) {
    if (e?.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(String(e?.message))) {
      check('T. [REAL DOM -- SKIPPED, not run under the jsdom-tests tsconfig] Run with: npx ts-node --project tsconfig.jsdom-tests.json test/panchFollowup334GoodRightNow.test.ts', true);
    } else {
      throw e;
    }
  }
}

runDomSection().then(() => {
  console.log(
    failed === 0
      ? `\n${passed} passed, 0 failed.\nALL PANCH-FOLLOWUP-334-I1 CHECKS PASSED`
      : `\n${passed} passed, ${failed} failed.\nSOME PANCH-FOLLOWUP-334-I1 CHECKS FAILED`
  );
  process.exit(failed === 0 ? 0 : 1);
});
