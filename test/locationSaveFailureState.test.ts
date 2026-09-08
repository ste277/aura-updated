/**
 * Timing Location Save Failure State Correctness V1: regression suite for
 * apps/web/components/LocationPicker.tsx's two Timing Location save
 * handlers (handleSelectChange, handleCustomSubmit).
 *
 * Audited separately (not re-derived here): before this fix, neither
 * handler wrapped its PATCH /api/users/location fetch in a try/catch, so
 * a thrown network/fetch exception (offline, DNS failure, connection
 * reset) skipped the unconditional setSaving(false) that only ran after a
 * RESOLVED fetch -- leaving the relevant control permanently disabled with
 * no error shown. No component-test harness exists in this repo for
 * client component handlers, so this follows the established source-text/
 * regex structural-assertion pattern (see test/timingLocationRefresh.test.ts,
 * test/habitLogActivityIdentity.test.ts) rather than introducing one.
 * Kept separate from test/customLocationUx.test.ts, which covers only pure
 * validation helpers (parseCoordinate/isValidCustomLocation/timezone
 * search) and never references this component at all.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const source = fs.readFileSync('apps/web/components/LocationPicker.tsx', 'utf8');

function extractFunctionBody(functionName: string): string {
  const startMatch = source.match(new RegExp(`async function ${functionName}\\([^)]*\\) \\{`));
  if (!startMatch || startMatch.index === undefined) return '';
  // Brace-counting extraction -- robust against nested { } inside the
  // handler (JSX-free here, but the fetch options object, JSON.stringify
  // calls, and the try/catch/finally blocks themselves all nest braces),
  // so this doesn't rely on a fixed line count or a fragile non-greedy
  // regex that could silently stop at the wrong closing brace.
  const bodyStart = startMatch.index + startMatch[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(bodyStart, i - 1);
}

function extractTryCatchFinally(body: string): { tryBlock: string; catchBlock: string; finallyBlock: string } | null {
  const tryStart = body.indexOf('try {');
  if (tryStart === -1) return null;

  function extractBraced(startIndex: number): { content: string; endIndex: number } {
    let depth = 1;
    let i = startIndex;
    while (i < body.length && depth > 0) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') depth--;
      i++;
    }
    return { content: body.slice(startIndex, i - 1), endIndex: i };
  }

  const tryBraceStart = body.indexOf('{', tryStart) + 1;
  const { content: tryBlock, endIndex: afterTry } = extractBraced(tryBraceStart);

  // extractBraced's endIndex already points just past the block's closing
  // "}", so what follows starts directly with " catch {" / " finally {"
  // (no leading brace to match here).
  const catchMatch = body.slice(afterTry).match(/^\s*catch \{/);
  if (!catchMatch) return null;
  const catchBraceStart = afterTry + catchMatch[0].length;
  const { content: catchBlock, endIndex: afterCatch } = extractBraced(catchBraceStart);

  const finallyMatch = body.slice(afterCatch).match(/^\s*finally \{/);
  if (!finallyMatch) return null;
  const finallyBraceStart = afterCatch + finallyMatch[0].length;
  const { content: finallyBlock } = extractBraced(finallyBraceStart);

  return { tryBlock, catchBlock, finallyBlock };
}

const handleSelectChangeBody = extractFunctionBody('handleSelectChange');
const handleCustomSubmitBody = extractFunctionBody('handleCustomSubmit');
check('handleSelectChange was located in LocationPicker.tsx', handleSelectChangeBody.length > 0);
check('handleCustomSubmit was located in LocationPicker.tsx', handleCustomSubmitBody.length > 0);

const curated = extractTryCatchFinally(handleSelectChangeBody);
const custom = extractTryCatchFinally(handleCustomSubmitBody);

// ============================================================
// 1/2. Both handlers wrap their request in try/catch/finally.
// ============================================================

check('handleSelectChange contains a try { } catch { } finally { } block around its request', curated !== null);
check('handleCustomSubmit contains a try { } catch { } finally { } block around its request', custom !== null);

// ============================================================
// 3/4. Both catch blocks set a useful, non-technical error message.
// ============================================================

check('handleSelectChange\'s catch block calls setError with a concise user-facing message', /setError\("Couldn't save location\. Please try again\."\);/.test(curated?.catchBlock ?? ''));
check('handleCustomSubmit\'s catch block calls setError with a concise user-facing message', /setError\("Couldn't save location\. Please try again\."\);/.test(custom?.catchBlock ?? ''));
check('handleSelectChange\'s catch block never surfaces a raw exception/technical detail', !/\berr\b|\berror\b(?!\)|:)/i.test((curated?.catchBlock ?? '').replace(/setError/g, '')));

// ============================================================
// 5/6. Both finally blocks are the sole, unconditional cleanup for saving.
// ============================================================

check('handleSelectChange\'s finally block resets saving', /setSaving\(false\);/.test(curated?.finallyBlock ?? ''));
check('handleCustomSubmit\'s finally block resets saving', /setSaving\(false\);/.test(custom?.finallyBlock ?? ''));
// Strip // line-comments before counting -- this file's own explanatory
// comments mention "setSaving(false)" in prose, which would otherwise be
// double-counted alongside the real statement.
function stripLineComments(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}
check(
  'handleSelectChange no longer has a standalone setSaving(false) outside finally (single unconditional cleanup path)',
  (stripLineComments(handleSelectChangeBody).match(/setSaving\(false\);/g) ?? []).length === 1
);
check(
  'handleCustomSubmit no longer has a standalone setSaving(false) outside finally (single unconditional cleanup path)',
  (stripLineComments(handleCustomSubmitBody).match(/setSaving\(false\);/g) ?? []).length === 1
);

// ============================================================
// 7/8/9. onChanged remains confirmed-success-only -- inside the try
// block's res.ok branch, never in catch, never in finally (PR #88's
// confirmed-save boundary must survive this fix untouched).
// ============================================================

check('handleSelectChange calls onChanged only inside its try block\'s res.ok branch', /if \(res\.ok\) \{[\s\S]*?onChanged\(selectedCity\);/.test(curated?.tryBlock ?? ''));
check('handleCustomSubmit calls onChanged only inside its try block\'s res.ok branch', /if \(res\.ok\) \{[\s\S]*?onChanged\(newCity\);/.test(custom?.tryBlock ?? ''));
check('handleSelectChange\'s catch block never calls onChanged', !/onChanged\(/.test(curated?.catchBlock ?? ''));
check('handleCustomSubmit\'s catch block never calls onChanged', !/onChanged\(/.test(custom?.catchBlock ?? ''));
check('handleSelectChange\'s finally block never calls onChanged', !/onChanged\(/.test(curated?.finallyBlock ?? ''));
check('handleCustomSubmit\'s finally block never calls onChanged', !/onChanged\(/.test(custom?.finallyBlock ?? ''));

// ============================================================
// 10/11. Custom failure (both the HTTP-error else-branch and the network
// exception catch block) must never clear entered values or close the form.
// ============================================================

check('handleCustomSubmit never calls setCustom(...) outside its res.ok success branch', (() => {
  const tryBlock = custom?.tryBlock ?? '';
  const successBranchMatch = tryBlock.match(/if \(res\.ok\) \{([\s\S]*?)\n {6}\} else \{/);
  const successBranch = successBranchMatch?.[1] ?? '';
  const failureBranchMatch = tryBlock.match(/\} else \{([\s\S]*)$/);
  const failureBranch = failureBranchMatch?.[1] ?? '';
  return /setCustom\(/.test(successBranch) && !/setCustom\(/.test(failureBranch) && !/setCustom\(/.test(custom?.catchBlock ?? '');
})());
check('handleCustomSubmit never calls setShowCustomForm(false) outside its res.ok success branch', (() => {
  const tryBlock = custom?.tryBlock ?? '';
  const successBranchMatch = tryBlock.match(/if \(res\.ok\) \{([\s\S]*?)\n {6}\} else \{/);
  const successBranch = successBranchMatch?.[1] ?? '';
  const failureBranchMatch = tryBlock.match(/\} else \{([\s\S]*)$/);
  const failureBranch = failureBranchMatch?.[1] ?? '';
  return /setShowCustomForm\(false\)/.test(successBranch) && !/setShowCustomForm\(/.test(failureBranch) && !/setShowCustomForm\(/.test(custom?.catchBlock ?? '');
})());

// ============================================================
// 12/13. Curated non-2xx now prefers the server's real error message,
// tolerantly parsed, with a fallback when it's missing/unusable.
// ============================================================

check('handleSelectChange\'s non-2xx branch parses the response body tolerantly (res.json().catch(...))', /res\.json\(\)\.catch\(\(\) => \(\{\}\)\)/.test(curated?.tryBlock ?? ''));
check('handleSelectChange\'s non-2xx branch prefers a real server-provided error string', /data\.error/.test(curated?.tryBlock ?? ''));
check('handleSelectChange\'s non-2xx branch still falls back to a generic message when no usable server error exists', /'Could not update location\.'/.test(curated?.tryBlock ?? ''));

// ============================================================
// 14. Custom non-2xx retains its existing tolerant server-error/fallback
// behavior, unchanged by this fix.
// ============================================================

check('handleCustomSubmit\'s non-2xx branch still parses the response body tolerantly (res.json().catch(...))', /res\.json\(\)\.catch\(\(\) => \(\{\}\)\)/.test(custom?.tryBlock ?? ''));
check('handleCustomSubmit\'s non-2xx branch still prefers data.error with a generic fallback', /setError\(data\.error \?\? 'Could not save that location\.'\);/.test(custom?.tryBlock ?? ''));

// ============================================================
// 15/16. Double-submit protection (disabled={saving}) is untouched by
// this fix on both controls.
// ============================================================

check('the curated <select> still has disabled={saving}', /<select[\s\S]*?disabled=\{saving\}/.test(source));
check('the custom submit <button> still has disabled={saving}', /<button\s+type="submit"\s+disabled=\{saving\}/.test(source));

if (!allPassed) {
  console.error('\nSome Timing Location save failure-state checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL TIMING LOCATION SAVE FAILURE-STATE CHECKS PASSED');
}
