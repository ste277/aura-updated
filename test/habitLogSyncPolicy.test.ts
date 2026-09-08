import { classifyHabitLogSyncOutcome } from '../apps/web/lib/habitLogSyncPolicy';

/**
 * Good Right Now / Log Activity Failure State Correctness V1 -- the pure
 * decision behind both handleLogActivity's own primary attempt and the
 * offline-queue replay loop (page.tsx). Every classification case the
 * bug's own reproduction exercised live (200, 400, 401, 500, and a
 * genuine ERR_CONNECTION_REFUSED network exception) is covered here at
 * the unit level, plus the boundary cases between the four outcome bands.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// 2xx -> confirmed. The only outcome that means the server actually
// persisted the row.
// ============================================================
check('200 -> confirmed', classifyHabitLogSyncOutcome(200) === 'confirmed');
check('201 -> confirmed', classifyHabitLogSyncOutcome(201) === 'confirmed');
check('299 -> confirmed (upper 2xx boundary)', classifyHabitLogSyncOutcome(299) === 'confirmed');

// ============================================================
// 4xx -> permanent-failure. A definitive, permanent server rejection --
// retrying the identical request will fail identically forever. Must
// never be queued, never treated as confirmed.
// ============================================================
check('400 (bad request) -> permanent-failure', classifyHabitLogSyncOutcome(400) === 'permanent-failure');
check('401 (not authenticated) -> permanent-failure', classifyHabitLogSyncOutcome(401) === 'permanent-failure');
check('403 (forbidden) -> permanent-failure', classifyHabitLogSyncOutcome(403) === 'permanent-failure');
check('404 -> permanent-failure', classifyHabitLogSyncOutcome(404) === 'permanent-failure');
check('409 -> permanent-failure (this endpoint never returns 409 today, but the classification itself must still hold if it ever did)', classifyHabitLogSyncOutcome(409) === 'permanent-failure');
check('499 -> permanent-failure (upper 4xx boundary)', classifyHabitLogSyncOutcome(499) === 'permanent-failure');

// ============================================================
// 5xx -> retry. The server was reachable and explicitly reported its own
// failure -- NOT ambiguous like a network exception, but still worth a
// later automatic retry (unlike a 4xx). The primary handleLogActivity
// path still surfaces this as a real, visible failure rather than
// silently queuing it (see page.tsx's own handling) -- this function only
// answers "is this outcome retry-worthy in principle", not "what should
// happen right now", which is each caller's own context-specific choice.
// ============================================================
check('500 (the exact status this bug incident reproduced) -> retry', classifyHabitLogSyncOutcome(500) === 'retry');
check('502 -> retry', classifyHabitLogSyncOutcome(502) === 'retry');
check('503 -> retry', classifyHabitLogSyncOutcome(503) === 'retry');

// ============================================================
// The network-error sentinel -- a fetch call that never received any
// HTTP response at all (ERR_CONNECTION_REFUSED, DNS failure, timeout).
// This is the ONE genuinely ambiguous outcome (the server's real state is
// unknown) and the sole legitimate justification for queuing.
// ============================================================
check("network-error sentinel -> retry", classifyHabitLogSyncOutcome('network-error') === 'retry');

if (!allPassed) {
  console.error('\nSome HabitLog sync policy checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL HABITLOG SYNC POLICY CHECKS PASSED');
}
