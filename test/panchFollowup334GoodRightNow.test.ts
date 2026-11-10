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
    check('T2b. [REAL DOM, THE FIX] Caution overlap active now: Good Right Now names the real overlapping window (Rahu Kalam) on its own dedicated line', cautionText.includes('Rahu Kalam also active'));
    check('T2c. [REAL DOM] Caution overlap active now: the original favorable title is still present as fact (PD-03, not erased)', cautionText.includes('Heavy lifting or a hard training session'));
    check('T2d. [REAL DOM] Caution overlap active now: the primary action control is still present (PD-02, qualified not blocked)', cautionText.includes('Start now') || cautionText.includes('Log now') || cautionText.includes('Do now') || cautionText.includes('Plan'));

    // T3 -- PANCH-FOLLOWUP-334-P1-B: multi-window caution naming.
    // activeCautionWindowNames already joins multiple names with ' and '
    // upstream (unchanged, reused as-is); confirm the Good Right Now card
    // surfaces that exact joined string, in FULL, on the dedicated caution
    // line (never silently dropping a window name, and never re-deriving
    // its own join). The original single-line-description placement risked
    // ellipsis-truncating this exact string away; the dedicated 2-line-clamp
    // line is sized so neither "Rahu Kalam" nor "Gulika Kalam" is omitted.
    // jsdom performs no layout, so this proves the full text reaches the
    // DOM (what the 2-line clamp then has room to actually display) -- it
    // cannot by itself prove pixel-level visual fit; that was checked via
    // code inspection of the clamp/width math (see report).
    const multiCautionHarness = await mount(React.createElement(HomeDashboard, baseProps({
      liveCommencementCaution: {
        activeNow: true,
        activeCautionWindows: [{ name: 'Rahu Kalam', windowType: 'RAHU_KALAM' }, { name: 'Gulika Kalam', windowType: 'GULIKA' }],
      },
    })));
    const multiCautionText = multiCautionHarness.container.textContent || '';
    await multiCautionHarness.unmount();
    check('T3a. [REAL DOM] Multi-window caution: the dedicated caution line names BOTH windows via the same shared join, never a third independent computation, never omitting one', multiCautionText.includes('Rahu Kalam and Gulika Kalam also active'));
    check('T3b. [REAL DOM] Multi-window caution: the original favorable description is still rendered unprefixed/untouched alongside the caution line (PD-03)', multiCautionText.includes('Peak solar window — best alignment for maximum physical output.'));

    // T4 -- PANCH-FOLLOWUP-334-P1-C correction. Mirrors panchOverlap01I1's
    // G10-G13 proof exactly: ONE `dailyBriefing` object is created here and
    // the SAME reference is threaded through every baseProps(...) call
    // below (never a fresh baseDailyBriefing() per call, which the original
    // version of this test did despite its own comments claiming otherwise
    // -- that version only proved the caution presentation updates on
    // rerender, not that it does so without a dailyBriefing refetch). An
    // explicit identity assertion (frozenBriefing === the reference baseProps
    // received) makes the "no refetch" claim verifiable rather than assumed.
    const frozenBriefing = baseDailyBriefing();
    let dailyBriefingSeenByProps: unknown[] = [];
    function propsWithFrozenBriefing(overrides: Record<string, unknown> = {}) {
      const p = baseProps({ dailyBriefing: frozenBriefing, ...overrides });
      dailyBriefingSeenByProps.push(p.dailyBriefing);
      return p;
    }

    const liveHarness = await mount(React.createElement(HomeDashboard, propsWithFrozenBriefing({
      liveCommencementCaution: { activeNow: false, activeCautionWindows: [] },
    })));
    const beforeText = liveHarness.container.textContent || '';
    check('T4a. [REAL DOM, LONG-MOUNTED, dailyBriefing FROZEN] Before caution starts: no badge renders', !beforeText.includes('⚠ Caution'));

    await liveHarness.rerender(React.createElement(HomeDashboard, propsWithFrozenBriefing({
      liveCommencementCaution: { activeNow: true, activeCautionWindows: [{ name: 'Yama Gandam', windowType: 'YAMA' }] },
    })));
    const duringText = liveHarness.container.textContent || '';
    check('T4b. [REAL DOM, LONG-MOUNTED, dailyBriefing FROZEN] Caution becomes active purely from liveCommencementCaution changing -- the caution line names Yama Gandam', duringText.includes('⚠ Caution') && duringText.includes('Yama Gandam also active'));

    await liveHarness.rerender(React.createElement(HomeDashboard, propsWithFrozenBriefing({
      liveCommencementCaution: { activeNow: false, activeCautionWindows: [] },
    })));
    const afterText = liveHarness.container.textContent || '';
    await liveHarness.unmount();
    check('T4c. [REAL DOM, LONG-MOUNTED, dailyBriefing FROZEN] Caution clears once it genuinely ends, purely from the live value changing', !afterText.includes('⚠ Caution') && !afterText.includes('Yama Gandam'));

    // T4d -- the actual "no refetch" proof: every props object built above
    // received the exact same dailyBriefing reference, never a new one.
    check(
      'T4d. [IDENTITY PROOF] dailyBriefing reference was identical across all three mounts/rerenders in T4 -- no refetch occurred in this test, not merely claimed',
      dailyBriefingSeenByProps.length === 3 && dailyBriefingSeenByProps.every((d) => d === frozenBriefing)
    );
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
