/**
 * Day Constructor V1 -- PR F2 planning-date hardening regression suite.
 * Exercises `resolvePlanDayBootstrap`/`resolvePlanDayServerProps`
 * (planDayBootstrap.ts) entirely through plain JS values and injected
 * fake closures -- no `next/headers`, no NextRequest, no database --
 * matching this repository's own established convention (see PR F1's own
 * `handleDayConstructorPreviewRequest` and its test suite).
 */
import { resolvePlanDayBootstrap, resolvePlanDayServerProps, type PlanDayBootstrapDeps } from '../apps/web/lib/planDayBootstrap';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

interface DepsFixture {
  deps: PlanDayBootstrapDeps;
  calls: { getSessionToken: number; verifySession: number; getUser: number; now: number };
  getUserArgs: string[];
}

function fixture(overrides: {
  /** `null` simulates no cookie present; omitted/undefined uses the default real token. */
  token?: string | null;
  session?: { userId: string } | null;
  user?: { timezone: string } | null;
  now?: Date;
} = {}): DepsFixture {
  const calls = { getSessionToken: 0, verifySession: 0, getUser: 0, now: 0 };
  const getUserArgs: string[] = [];
  const token = overrides.token === null ? undefined : (overrides.token ?? 'real-token');
  const session = overrides.session === undefined ? { userId: 'user-A' } : overrides.session;
  const user = overrides.user === undefined ? { timezone: 'Asia/Kolkata' } : overrides.user;
  const now = overrides.now ?? new Date('2026-09-16T12:00:00.000Z');

  const deps: PlanDayBootstrapDeps = {
    getSessionToken: () => {
      calls.getSessionToken += 1;
      return token;
    },
    verifySession: (t) => {
      calls.verifySession += 1;
      return session;
    },
    getUser: async (userId) => {
      calls.getUser += 1;
      getUserArgs.push(userId);
      return user;
    },
    now: () => {
      calls.now += 1;
      return now;
    },
  };
  return { deps, calls, getUserArgs };
}

async function main() {
  // ============================================================
  // resolvePlanDayBootstrap -- pure civil-date derivation (1-4)
  // ============================================================
  check('1. derives planningDate from the SUPPLIED now, in the user\'s own timezone', resolvePlanDayBootstrap('Asia/Kolkata', new Date('2026-09-16T20:00:00.000Z')).planningDate === '2026-09-17');
  check('2. timezone passes through unchanged', resolvePlanDayBootstrap('America/New_York', new Date('2026-09-16T12:00:00.000Z')).timezone === 'America/New_York');
  check('3. a different timezone for the SAME instant can yield a different civil date (never a fixed/UTC date)', resolvePlanDayBootstrap('America/Los_Angeles', new Date('2026-09-17T02:00:00.000Z')).planningDate === '2026-09-16');
  check('4. this function has no clock of its own -- now is always a parameter', resolvePlanDayBootstrap.length === 2);

  // ============================================================
  // resolvePlanDayServerProps -- full sequence (5-15)
  // ============================================================
  {
    const f = fixture();
    const result = await resolvePlanDayServerProps(f.deps);
    check('5. a valid session + real user resolves a real bootstrap', result !== null);
    check('6. the resolved timezone matches the user\'s own', result?.timezone === 'Asia/Kolkata');
    check('7. the clock is read exactly once', f.calls.now === 1);
    check('8. getUser is called with the session\'s own userId', f.getUserArgs.length === 1 && f.getUserArgs[0] === 'user-A');
  }
  {
    const f = fixture({ token: null });
    const result = await resolvePlanDayServerProps(f.deps);
    check('9. no cookie token -> null (unauthenticated), never throws', result === null);
    check('10. no cookie token means verifySession/getUser/now are never called', f.calls.verifySession === 0 && f.calls.getUser === 0 && f.calls.now === 0);
  }
  {
    const f = fixture({ session: null });
    const result = await resolvePlanDayServerProps(f.deps);
    check('11. an invalid/expired token (verifySession returns null) -> null', result === null);
    check('12. an invalid token never reaches getUser or the clock', f.calls.getUser === 0 && f.calls.now === 0);
  }
  {
    const f = fixture({ user: null });
    const result = await resolvePlanDayServerProps(f.deps);
    check('13. a valid session whose user no longer exists -> null', result === null);
    check('14. a missing user never reads the clock (no planning date computed for a non-existent user)', f.calls.now === 0);
  }
  {
    const f = fixture();
    await resolvePlanDayServerProps(f.deps);
    check('15. getSessionToken is called exactly once per resolution', f.calls.getSessionToken === 1);
  }

  if (!allPassed) {
    console.error('\nSome Plan Day Bootstrap checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL PLAN DAY BOOTSTRAP CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
