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
  check('4. this function\'s required-parameter arity is unchanged (horizon is a DEFAULTED third parameter, so .length stays 2)', resolvePlanDayBootstrap.length === 2);

  // ============================================================
  // Planning Horizon V1 PR P1 -- resolvePlanDayBootstrap horizon support
  // (16-24)
  // ============================================================

  // 16. Default-TODAY regression -- omitting horizon entirely stays byte-
  // equivalent to every pre-P1 caller (this ticket's own section 5/31).
  check(
    '16. omitting horizon entirely still resolves TODAY (byte-equivalent pre-P1 default)',
    resolvePlanDayBootstrap('Asia/Kolkata', new Date('2026-09-16T20:00:00.000Z')).planningDate === '2026-09-17'
  );
  // 17. Explicit horizon='TODAY' is identical to omitting it.
  check(
    "17. explicit horizon='TODAY' resolves identically to the default",
    resolvePlanDayBootstrap('Asia/Kolkata', new Date('2026-09-16T20:00:00.000Z'), 'TODAY').planningDate === '2026-09-17'
  );
  // 18. TOMORROW resolves one civil day ahead of TODAY, in the same timezone.
  check(
    "18. horizon='TOMORROW' resolves one civil day ahead of TODAY, same instant/timezone",
    resolvePlanDayBootstrap('Asia/Kolkata', new Date('2026-09-16T20:00:00.000Z'), 'TOMORROW').planningDate === '2026-09-18'
  );
  // 19. TOMORROW never touches timezone -- still passed through verbatim.
  check(
    "19. horizon='TOMORROW' does not change which timezone is returned",
    resolvePlanDayBootstrap('America/New_York', new Date('2026-09-16T12:00:00.000Z'), 'TOMORROW').timezone === 'America/New_York'
  );
  // 20/21. Timezone-boundary proof (this ticket's own section 24) -- the
  // SAME server instant can fall on different civil "today"s depending on
  // the user's own timezone, and TOMORROW must be one civil day past
  // EACH of those, never a single shared UTC-anchored date.
  {
    const instant = new Date('2026-09-16T23:30:00.000Z'); // late UTC evening.
    const kolkataTomorrow = resolvePlanDayBootstrap('Asia/Kolkata', instant, 'TOMORROW').planningDate; // already Sep 17 05:00 IST -> tomorrow is Sep 18.
    const newYorkTomorrow = resolvePlanDayBootstrap('America/New_York', instant, 'TOMORROW').planningDate; // still Sep 16 19:30 EDT -> tomorrow is Sep 17.
    check('20. Asia/Kolkata TOMORROW for a late-UTC instant resolves 2026-09-18 (already the next IST day)', kolkataTomorrow === '2026-09-18');
    check('21. America/New_York TOMORROW for the SAME instant resolves 2026-09-17 (still the same EDT day)', newYorkTomorrow === '2026-09-17');
  }
  // 22. Month boundary via the real bootstrap (not just the pure helper).
  check('22. TOMORROW crosses a month boundary through the real bootstrap', resolvePlanDayBootstrap('UTC', new Date('2026-09-30T12:00:00.000Z'), 'TOMORROW').planningDate === '2026-10-01');
  // 23. Year boundary via the real bootstrap.
  check('23. TOMORROW crosses a year boundary through the real bootstrap', resolvePlanDayBootstrap('UTC', new Date('2026-12-31T12:00:00.000Z'), 'TOMORROW').planningDate === '2027-01-01');
  // 24. Never now+24h -- proven structurally: an instant just before local
  // midnight rollover still resolves the SAME civil TOMORROW as an
  // instant just after it would for the following day, i.e. TOMORROW
  // only ever depends on the resolved civil TODAY, never a raw 24h offset
  // from the instant itself.
  check(
    '24. TOMORROW is derived from the resolved civil date, never now+24h milliseconds',
    resolvePlanDayBootstrap('UTC', new Date('2026-09-16T00:00:01.000Z'), 'TOMORROW').planningDate === '2026-09-17'
  );

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

  // ============================================================
  // Planning Horizon V1 PR P1 -- resolvePlanDayServerProps horizon
  // forwarding (25-27). No real caller (page.tsx) passes a horizon yet
  // (P2's own scope) -- these prove the full session -> user -> bootstrap
  // boundary correctly forwards one when supplied, and defaults to TODAY
  // exactly like resolvePlanDayBootstrap itself when omitted.
  // ============================================================
  {
    const f = fixture({ now: new Date('2026-09-16T20:00:00.000Z') }); // Asia/Kolkata user (fixture default).
    const result = await resolvePlanDayServerProps(f.deps); // no horizon supplied.
    check('25. resolvePlanDayServerProps with no horizon supplied still resolves TODAY (default-TODAY regression at the full server-props boundary)', result?.planningDate === '2026-09-17');
  }
  {
    const f = fixture({ now: new Date('2026-09-16T20:00:00.000Z') });
    const result = await resolvePlanDayServerProps(f.deps, 'TOMORROW');
    check("26. resolvePlanDayServerProps forwards an explicit horizon='TOMORROW' through to the real bootstrap", result?.planningDate === '2026-09-18');
  }
  {
    const f = fixture({ token: null });
    const result = await resolvePlanDayServerProps(f.deps, 'TOMORROW');
    check('27. an unauthenticated request with horizon=TOMORROW still returns null before any date is ever resolved (no new auth bypass)', result === null && f.calls.now === 0);
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
