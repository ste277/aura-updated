/**
 * HOME-INTENT-1 -- Connect Home Input to Existing Ask Aura.
 *
 * Pure, DI-free regression coverage for the real production functions in
 * `apps/web/lib/homeAskAuraHandoff.ts` (`resolveHomeAskAuraSubmission`,
 * `createAskAuraHandoff`, `shouldConsumeAskAuraHandoff`) -- the EXACT same
 * functions `HomeDashboard.tsx`'s new input, `page.tsx`'s new handoff
 * state, and `AskAuraView.tsx`'s new one-shot consumption effect actually
 * call, never a reimplementation of their logic.
 *
 * This repo has no jsdom/testing-library (confirmed absent from
 * package.json/node_modules, the same established, disclosed limitation
 * HGR1/HGR2's own test files and their independent reviews already
 * documented) so a handful of checks below are explicitly structural
 * source assertions, each labeled `[STRUCTURAL]` -- never presented as
 * component-rendered behavioral coverage. Everything else calls the real
 * exported functions directly.
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveHomeAskAuraSubmission, createAskAuraHandoff, shouldConsumeAskAuraHandoff, type AskAuraHandoffRequest } from '../apps/web/lib/homeAskAuraHandoff';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function main() {
  // ============================================================
  // 1/2. Home renders a real input, with the correct placeholder and an
  // accessible label (real `<FieldLabel htmlFor>`/`<TextInput id>` pair,
  // not just placeholder text). [STRUCTURAL] -- no jsdom to query the
  // rendered DOM; this is a direct source inspection of HomeDashboard.tsx.
  // ============================================================
  {
    const home = read('apps/web/components/HomeDashboard.tsx');
    check(
      '1. [STRUCTURAL] Home renders a real <TextInput>, not a decorative <button>, for the Ask Aura entry point',
      /<TextInput\s+id="home-ask-aura-input"/.test(home)
    );
    check(
      '2a. [STRUCTURAL] the input carries the exact placeholder "What would you like to do?"',
      /placeholder="What would you like to do\?"/.test(home)
    );
    check(
      '2b. [STRUCTURAL] a real <FieldLabel htmlFor="home-ask-aura-input"> association exists (not placeholder-only)',
      /<FieldLabel htmlFor="home-ask-aura-input" visuallyHidden>/.test(home)
    );
  }

  // ============================================================
  // 3/4. Enter submits non-empty text; the submit button performs the
  // identical action. [STRUCTURAL] -- both are wired through ONE native
  // <form onSubmit>, which is itself a standard, browser-guaranteed
  // behavior (Enter in a text input submits its form; a type="submit"
  // button submits the same form) -- not something a non-DOM test can
  // meaningfully re-prove. What CAN and must be verified is that both
  // paths funnel into the SAME handler rather than two independently
  // wired call sites that could drift apart.
  // ============================================================
  {
    const home = read('apps/web/components/HomeDashboard.tsx');
    const submitCallIndex = home.indexOf('handleHomeAskAuraSubmit();');
    const formStart = submitCallIndex >= 0 ? home.lastIndexOf('<form', submitCallIndex) : -1;
    const formEnd = home.indexOf('</form>', formStart);
    const formBlock = formStart >= 0 && formEnd > formStart ? home.slice(formStart, formEnd) : '';
    check('3/4a. [STRUCTURAL] a <form> wraps the input and its submit button, submitting via handleHomeAskAuraSubmit (single call site for both Enter and the button)', formBlock.includes('onSubmit') && formBlock.includes('handleHomeAskAuraSubmit();') && formBlock.includes('style={inputShellStyle}'));
    check('3/4b. [STRUCTURAL] the submit button inside that form is type="submit" (so it submits the SAME form, not a second handler)', /type="submit"/.test(formBlock));
  }

  // ============================================================
  // 5. Empty and whitespace-only requests do nothing -- the REPLACED
  // behavior: the old decorative button always navigated regardless of
  // state; the new input's empty/whitespace submit must be a pure no-op.
  // ============================================================
  {
    const empty = resolveHomeAskAuraSubmission('');
    const whitespaceOnly = resolveHomeAskAuraSubmission('   \t\n  ');
    const nonEmpty = resolveHomeAskAuraSubmission('  go for a run  ');
    check('5a. an empty string does not submit', empty.shouldSubmit === false);
    check('5b. a whitespace-only string does not submit', whitespaceOnly.shouldSubmit === false);
    check('5c. genuinely non-empty text (after trimming) does submit', nonEmpty.shouldSubmit === true);
  }

  // ============================================================
  // 6. The original text survives the handoff completely unchanged --
  // exact string equality, including punctuation/casing, beyond a
  // leading/trailing trim (never normalized/rewritten).
  // ============================================================
  {
    const raw = '  Is 4 PM good for a Call?? ';
    const { text } = resolveHomeAskAuraSubmission(raw);
    check('6a. leading/trailing whitespace is trimmed, nothing else', text === 'Is 4 PM good for a Call??');
    const handoff = createAskAuraHandoff(text, () => 12345);
    check('6b. createAskAuraHandoff carries the exact text through verbatim (casing/punctuation untouched)', handoff.text === 'Is 4 PM good for a Call??');
  }

  // ============================================================
  // 7. The existing Ask Aura execution path genuinely receives the
  // request. Real: `shouldConsumeAskAuraHandoff` (the actual gating
  // function AskAuraView's effect calls) correctly admits a fresh
  // handoff. [STRUCTURAL]: AskAuraView's source shows that admitted
  // handoff being passed into handleSend -- the SAME existing function a
  // manually typed request already uses -- never a second fetch/parser
  // call site.
  // ============================================================
  {
    const handoff: AskAuraHandoffRequest = { text: 'find the best time for a meeting', key: 1 };
    check('7a. a fresh handoff (never consumed before) is admitted', shouldConsumeAskAuraHandoff(handoff, null) === true);

    const askAuraView = read('apps/web/components/AskAuraView.tsx');
    check(
      "7b. [STRUCTURAL] the one-shot effect calls the EXISTING handleSend(pendingHandoffRequest!.text) -- no new fetch/parser call site",
      /handleSend\(pendingHandoffRequest!\.text\);/.test(askAuraView)
    );
    const fetchCallSites = askAuraView.match(/fetch\(/g) ?? [];
    // The pre-existing call sites are: handleSend's own /api/ask-aura,
    // runAction's /api/plans, /api/aura-moments, and the FORWARD_PLAN
    // CHECK call to /api/timing-search -- exactly 4, unchanged by this
    // PR. If HOME-INTENT-1 had added a second /api/ask-aura (or any
    // other) call site, this count would grow.
    check('7c. [STRUCTURAL] no new fetch() call site was introduced in AskAuraView.tsx (still exactly 4, all pre-existing)', fetchCallSites.length === 4);
  }

  // ============================================================
  // 8/9. The request auto-submits exactly once; a rerender does not
  // resubmit. This IS the real one-shot decision function itself.
  // ============================================================
  {
    const handoff: AskAuraHandoffRequest = { text: 'plan my day', key: 100 };
    let lastConsumedKey: number | null = null;

    const admittedFirstTime = shouldConsumeAskAuraHandoff(handoff, lastConsumedKey);
    check('8. a new handoff is admitted the first time it is checked', admittedFirstTime === true);
    if (admittedFirstTime) lastConsumedKey = handoff.key; // mirrors AskAuraView's own ref update

    // Simulate N subsequent rerenders with the exact same pending object
    // (as would happen if the component rerenders for an unrelated
    // reason while pendingAskAuraHandoff hasn't changed).
    let resubmittedOnRerender = false;
    for (let i = 0; i < 5; i++) {
      if (shouldConsumeAskAuraHandoff(handoff, lastConsumedKey)) resubmittedOnRerender = true;
    }
    check('9. five subsequent rerenders with the SAME handoff never re-admit it', resubmittedOnRerender === false);
  }

  // ============================================================
  // 10/11. Navigating to another tab and back, or returning to Home,
  // does not replay the old request -- both are the same underlying
  // case as 9 from this function's point of view: the pending object's
  // `key` is unchanged across the navigation (page.tsx never creates a
  // NEW handoff just from a tab switch), so the ref-based guard still
  // blocks it.
  // ============================================================
  {
    const handoff: AskAuraHandoffRequest = { text: 'what should i focus on now', key: 200 };
    const consumedKey = handoff.key; // as if already consumed once
    check('10. navigating to another tab and back (pending object unchanged) does not replay', shouldConsumeAskAuraHandoff(handoff, consumedKey) === false);
    check('11. returning to Home and back to Ask Aura (pending object unchanged) does not replay', shouldConsumeAskAuraHandoff(handoff, consumedKey) === false);
  }

  // ============================================================
  // 12. A refresh does not unexpectedly replay. REASONED, not executed:
  // `pendingAskAuraHandoff` lives only in page.tsx's in-memory useState,
  // never written to localStorage/sessionStorage/a cookie/a URL param --
  // a real browser refresh discards all in-memory React state
  // unconditionally, so there is nothing left to replay. [STRUCTURAL]:
  // confirm no persistence call was introduced for this state.
  // ============================================================
  {
    const pageSrc = read('apps/web/app/page.tsx');
    const handoffStateLine = pageSrc.match(/const \[pendingAskAuraHandoff, setPendingAskAuraHandoff\] = useState[^;]*;/)?.[0] ?? '';
    check(
      '12. [STRUCTURAL + REASONED] pendingAskAuraHandoff is plain in-memory useState with no persistence call anywhere near it (localStorage/sessionStorage/cookie) -- a refresh naturally discards it, nothing to replay',
      /useState<AskAuraHandoffRequest \| null>\(null\)/.test(handoffStateLine) && !/localStorage|sessionStorage|document\.cookie/.test(pageSrc.slice(pageSrc.indexOf('pendingAskAuraHandoff') - 200, pageSrc.indexOf('pendingAskAuraHandoff') + 400))
    );
  }

  // ============================================================
  // 13. Two distinct requests can be submitted independently -- even if
  // their TEXT happens to be identical, a fresh key must still admit the
  // second one (never coalesced/ignored as "the same one").
  // ============================================================
  {
    let tick = 1000;
    const now = () => tick++;
    const first = createAskAuraHandoff('read for a while', now);
    const second = createAskAuraHandoff('read for a while', now); // identical text, later key
    check('13a. two createAskAuraHandoff calls with identical text get DIFFERENT keys', first.key !== second.key);

    let lastConsumedKey: number | null = null;
    check('13b. the first is admitted', shouldConsumeAskAuraHandoff(first, lastConsumedKey) === true);
    lastConsumedKey = first.key;
    check('13c. the second, distinct (even if textually identical) request is ALSO admitted afterward', shouldConsumeAskAuraHandoff(second, lastConsumedKey) === true);
  }

  // ============================================================
  // 14. Rapid repeated submission (double-click/double-Enter) does not
  // duplicate the request. Drives the REAL resolveHomeAskAuraSubmission
  // through the same two-step clear-then-reuse flow
  // handleHomeAskAuraSubmit itself performs (read current input -> if
  // submittable, clear it -> hand off) -- proving a second call reading
  // the now-cleared value is correctly a no-op, exactly as it would be
  // inside the real synchronous event handler.
  // ============================================================
  {
    let homeInputValue = 'go for a run';
    const handoffsSent: string[] = [];
    function simulateHomeSubmitHandlerCall() {
      const { shouldSubmit, text } = resolveHomeAskAuraSubmission(homeInputValue);
      if (!shouldSubmit) return;
      homeInputValue = ''; // mirrors setHomeAskAuraInput('') firing synchronously before handing off
      handoffsSent.push(text);
    }
    simulateHomeSubmitHandlerCall(); // first Enter/click
    simulateHomeSubmitHandlerCall(); // a second, rapid-fire Enter/click reading the already-cleared value
    check('14. a rapid second submit call (reading the already-cleared input) sends exactly one handoff, not two', handoffsSent.length === 1 && handoffsSent[0] === 'go for a run');
  }

  // ============================================================
  // 15. Existing Ask Aura error handling remains functional for a
  // handed-off request. [STRUCTURAL]: confirm the pre-existing catch
  // branch (the UNKNOWN/"hit a snag" fallback message) is unchanged
  // except for the added mountedRef guard -- handleSend's error path is
  // identical regardless of whether it was triggered by a manual type or
  // a Home handoff, since both call the exact same function.
  // ============================================================
  {
    const askAuraView = read('apps/web/components/AskAuraView.tsx');
    check(
      '15. [STRUCTURAL] the existing error fallback message is unchanged, now additionally guarded by mountedRef (not removed/altered)',
      /if \(mountedRef\.current\) \{\s*setMessages\(\(prev\) => \[\s*\.\.\.prev,\s*\{ sender: 'aura', response: \{ intent: 'UNKNOWN', message: 'Sorry, I hit a snag\. Please try again\.' \} \},\s*\]\);\s*\}/.test(askAuraView)
    );
  }

  // ============================================================
  // 16. No automatic Plan commitment occurs anywhere in this flow.
  // [STRUCTURAL]: every write-triggering action in AskAuraView
  // (PLAN_THIS/CREATE_MOMENT/SCHEDULE_FORWARD_PLAN) still requires an
  // explicit runAction(...) call from a rendered, user-clicked button --
  // confirmed unchanged by this PR (diffed against the pre-existing
  // runAction definition, which this PR does not touch at all) -- and
  // Home's own new submit path never calls any of /api/plans,
  // /api/aura-moments, or /api/timing-search directly.
  // ============================================================
  {
    const home = read('apps/web/components/HomeDashboard.tsx');
    const handlerStart = home.indexOf('const handleHomeAskAuraSubmit');
    const handlerEnd = home.indexOf('};', handlerStart);
    const handlerBlock = handlerStart >= 0 && handlerEnd > handlerStart ? home.slice(handlerStart, handlerEnd) : '';
    check(
      "16. [STRUCTURAL] Home's new submit handler body contains no fetch()/write call -- only validates, clears local input state, and calls onAskAuraSubmit (a navigation hand-off, not a write)",
      handlerBlock.length > 0 && handlerBlock.includes('onAskAuraSubmit?.(text)') && !/fetch\(|\/api\//.test(handlerBlock)
    );
  }

  // ============================================================
  // 17. The existing explicit Plan-navigation affordance (the "Ideas"
  // chips) remains available and working, unchanged -- still calling
  // onPlanClick directly, bypassing Ask Aura entirely, exactly as before
  // this PR. (The old arrow button's role changed -- see delivery report
  // -- but the chips were always the OTHER, already-explicit mechanism.)
  // ============================================================
  {
    const home = read('apps/web/components/HomeDashboard.tsx');
    check(
      '17. [STRUCTURAL] the "Ideas" PROMPT_CHIPS still call onPlanClick?.(chip) directly and unchanged, as the separate explicit Plan-navigation path',
      /PROMPT_CHIPS\.map\(\(chip\) => \(\s*<ActivityChip key=\{chip\} label=\{chip\} onClick=\{\(\) => onPlanClick\?\.\(chip\)\} \/>/.test(home)
    );
  }
}

main();
if (!allPassed) {
  console.error('SOME HOME INTENT 1 ASK AURA HANDOFF CHECKS FAILED');
  process.exit(1);
}
console.log('ALL HOME INTENT 1 ASK AURA HANDOFF CHECKS PASSED');
