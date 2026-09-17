/**
 * Day Constructor V1 -- PR F1 (Preview API) request/response regression
 * suite. Exercises `parseConstructDayPreviewRequestBody` and
 * `runDayConstructorPreview` (dayConstructorPreviewRequest.ts) entirely
 * through plain JS values and injected fake `DayConstructorOrchestratorDeps`
 * -- no live DB, no network, no NextRequest -- matching this repository's
 * own established convention (see dayConstructorOrchestrator.test.ts) of a
 * DB-free behavioral suite, run via `npx ts-node
 * test/dayConstructorPreviewRequest.test.ts`.
 */
import {
  parseConstructDayPreviewRequestBody,
  runDayConstructorPreview,
  handleDayConstructorPreviewRequest,
  MAX_INTENTS_PER_REQUEST,
  MAX_TITLE_LENGTH,
  type DayConstructorPreviewBoundaryDeps,
  type DayConstructorPreviewSession,
} from '../apps/web/lib/dayConstructorPreviewRequest';
import { MAX_INTENT_ID_LENGTH } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { DayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import type { TimingCandidate, TimingCandidateLabel } from '../packages/recommendation/src/timingSearch';
import type { User } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

const TZ = 'UTC';
const NOW = iso('2026-09-16T09:00:00Z');
const CTX = { timezone: TZ, now: NOW };

function validIntent(overrides: Record<string, unknown> = {}) {
  return { id: 'i1', title: 'Draft the deck', flexibility: 'FLEXIBLE', ...overrides };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return { intents: [validIntent()], ...overrides };
}

function timingCandidate(start: string, end: string, label: TimingCandidateLabel): TimingCandidate {
  return {
    start,
    end,
    score: 5,
    label,
    muhurtaScore: 0,
    reasons: [],
    metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: '2026-09-16' },
  };
}

interface CountingDeps extends DayConstructorOrchestratorDeps {
  calls: { loadBlockingPlans: number; loadDurationContext: number; searchTiming: number };
}

function countingDeps(overrides: Partial<DayConstructorOrchestratorDeps> = {}): CountingDeps {
  const calls = { loadBlockingPlans: 0, loadDurationContext: 0, searchTiming: 0 };
  return {
    calls,
    loadBlockingPlans: async (bounds) => {
      calls.loadBlockingPlans += 1;
      return overrides.loadBlockingPlans ? overrides.loadBlockingPlans(bounds) : [];
    },
    loadDurationContext: async () => {
      calls.loadDurationContext += 1;
      return overrides.loadDurationContext ? overrides.loadDurationContext() : { preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} };
    },
    searchTiming: (request) => {
      calls.searchTiming += 1;
      return overrides.searchTiming ? overrides.searchTiming(request) : { candidates: [] };
    },
    // Availability Context V1 PR H1 -- UNCONFIGURED default, byte-
    // equivalent to this file's own pre-H1 behavior for every test that
    // doesn't override it.
    loadAvailabilityConfiguration: overrides.loadAvailabilityConfiguration ?? (async () => ({ configured: false, periods: [] })),
  };
}

// ============================================================
// Boundary-helper fixtures (pre-commit hardening). `fakeUser` is
// intentionally minimal -- only `id`/`timezone` are ever read by
// `handleDayConstructorPreviewRequest` or `createOrchestratorDeps` in
// these tests -- cast to `User` (db.ts) since the real signature demands
// it; no other User field is touched anywhere in this file.
// ============================================================

function fakeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-A', timezone: 'Asia/Kolkata', ...overrides } as User;
}

interface BoundaryCalls {
  getSession: number;
  getUser: number;
  getBody: number;
  now: number;
  createOrchestratorDeps: number;
}

interface BoundaryDepsFixture {
  deps: DayConstructorPreviewBoundaryDeps;
  calls: BoundaryCalls;
  orchestratorDeps: CountingDeps;
  createOrchestratorDepsArgs: { user: User; now: Date }[];
  getUserArgs: string[];
}

function boundaryDeps(overrides: {
  session?: DayConstructorPreviewSession | null;
  user?: User | null;
  body?: unknown;
  now?: Date;
  orchestratorDepsOverrides?: Partial<DayConstructorOrchestratorDeps>;
  createOrchestratorDepsThrows?: boolean;
} = {}): BoundaryDepsFixture {
  const calls: BoundaryCalls = { getSession: 0, getUser: 0, getBody: 0, now: 0, createOrchestratorDeps: 0 };
  const getUserArgs: string[] = [];
  const createOrchestratorDepsArgs: { user: User; now: Date }[] = [];
  const orchestratorDeps = countingDeps(overrides.orchestratorDepsOverrides);
  const session = overrides.session === undefined ? { userId: 'user-A' } : overrides.session;
  const user = overrides.user === undefined ? fakeUser() : overrides.user;
  const body = overrides.body === undefined ? validBody() : overrides.body;
  const now = overrides.now ?? NOW;

  const deps: DayConstructorPreviewBoundaryDeps = {
    getSession: () => {
      calls.getSession += 1;
      return session;
    },
    getUser: async (userId) => {
      calls.getUser += 1;
      getUserArgs.push(userId);
      return user;
    },
    getBody: async () => {
      calls.getBody += 1;
      return body;
    },
    now: () => {
      calls.now += 1;
      return now;
    },
    createOrchestratorDeps: (u, n) => {
      calls.createOrchestratorDeps += 1;
      createOrchestratorDepsArgs.push({ user: u, now: n });
      if (overrides.createOrchestratorDepsThrows) throw new Error('orchestrator wiring exploded -- internal detail that must never reach the client');
      return orchestratorDeps;
    },
  };

  return { deps, calls, orchestratorDeps, createOrchestratorDepsArgs, getUserArgs };
}

async function main() {
  // ============================================================
  // PARSER -- valid shapes (1-6)
  // ============================================================
  {
    const result = parseConstructDayPreviewRequestBody(validBody(), CTX);
    check('1. a minimal valid FLEXIBLE-intent body parses ok', result.ok === true);
    if (result.ok) {
      check('1b. timezone/now come from ctx, never the body', result.request.timezone === TZ && result.request.now === NOW);
      check('1c. targetDate defaults to ctx-derived today when omitted', result.request.targetDate === '2026-09-16');
      check('1d. constructionWindowSource defaults to REMAINING_TODAY', result.request.constructionWindowSource === 'REMAINING_TODAY');
      check('1e. originalOrder is derived from array position, not read from the body', result.request.intents[0].originalOrder === 0);
    }
  }
  {
    const result = parseConstructDayPreviewRequestBody(
      validBody({ intents: [validIntent({ flexibility: 'FIXED', fixedStart: '2026-09-16T10:00:00Z' })] }),
      CTX
    );
    check('2. a valid FIXED intent with fixedStart parses ok', result.ok === true);
    if (result.ok) {
      const intent = result.request.intents[0];
      check('2b. fixedStart normalizes to a real Date instance', intent.fixedStart instanceof Date && intent.fixedStart!.getTime() === iso('2026-09-16T10:00:00Z').getTime());
    }
  }
  {
    const result = parseConstructDayPreviewRequestBody(
      validBody({ intents: [validIntent({ id: 'a', originalOrder: 99 }), validIntent({ id: 'b', originalOrder: -5 })] }),
      CTX
    );
    check('3. multiple intents parse ok; a client-supplied originalOrder is ignored in favor of array position', result.ok === true && result.ok && result.request.intents[0].originalOrder === 0 && result.request.intents[1].originalOrder === 1);
  }
  {
    const result = parseConstructDayPreviewRequestBody(validBody({ targetDate: '2026-12-25' }), CTX);
    check('4. an explicit valid targetDate is honored', result.ok === true && result.ok && result.request.targetDate === '2026-12-25');
  }
  {
    const result = parseConstructDayPreviewRequestBody(
      validBody({ constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: '2026-09-16T09:00:00Z', explicitEnd: '2026-09-16T17:00:00Z' }),
      CTX
    );
    check('5. EXPLICIT_RANGE with both bounds parses ok', result.ok === true);
    if (result.ok) {
      check('5b. explicitStart/explicitEnd normalize to Date instances', result.request.explicitStart instanceof Date && result.request.explicitEnd instanceof Date);
    }
  }
  {
    const result = parseConstructDayPreviewRequestBody(
      validBody({ intents: [validIntent({ activityId: 'workout', durationMinutes: 45, importance: 'HIGH', deadline: '2026-09-20' })] }),
      CTX
    );
    check('6. optional activityId/durationMinutes/importance/deadline are accepted and pass through', result.ok === true);
    if (result.ok) {
      const intent = result.request.intents[0];
      check('6b. deadline stays a YYYY-MM-DD string (never coerced to a Date)', intent.deadline === '2026-09-20' && typeof intent.deadline === 'string');
    }
  }

  // ============================================================
  // PARSER -- malformed top-level body (7-11)
  // ============================================================
  check('7. null body is rejected', parseConstructDayPreviewRequestBody(null, CTX).ok === false);
  check('8. an array body is rejected', parseConstructDayPreviewRequestBody([validIntent()], CTX).ok === false);
  check('9. a string body is rejected', parseConstructDayPreviewRequestBody('hello', CTX).ok === false);
  check('10. missing intents is rejected', parseConstructDayPreviewRequestBody({}, CTX).ok === false);
  check('11. an empty intents array is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [] }), CTX).ok === false);

  // ============================================================
  // PARSER -- intent count bound (12-13)
  // ============================================================
  check(
    `12. exactly ${MAX_INTENTS_PER_REQUEST} intents is accepted`,
    parseConstructDayPreviewRequestBody(validBody({ intents: Array.from({ length: MAX_INTENTS_PER_REQUEST }, (_, i) => validIntent({ id: `i${i}` })) }), CTX).ok === true
  );
  check(
    `13. ${MAX_INTENTS_PER_REQUEST + 1} intents is rejected (transport safety limit, not a scheduling rule)`,
    parseConstructDayPreviewRequestBody(validBody({ intents: Array.from({ length: MAX_INTENTS_PER_REQUEST + 1 }, (_, i) => validIntent({ id: `i${i}` })) }), CTX).ok === false
  );

  // ============================================================
  // PARSER -- per-intent id/title (14-20)
  // ============================================================
  check('14. missing intent id is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ id: undefined })] }), CTX).ok === false);
  check('15. blank intent id is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ id: '   ' })] }), CTX).ok === false);
  check(
    '16. an id longer than MAX_INTENT_ID_LENGTH is rejected',
    parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ id: 'x'.repeat(MAX_INTENT_ID_LENGTH + 1) })] }), CTX).ok === false
  );
  check(
    '17. a duplicate intent id across the same request is rejected',
    parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ id: 'dup' }), validIntent({ id: 'dup' })] }), CTX).ok === false
  );
  check('18. missing title is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ title: undefined })] }), CTX).ok === false);
  check('19. blank title is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ title: '   ' })] }), CTX).ok === false);
  check(
    '20. a title longer than MAX_TITLE_LENGTH is rejected',
    parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1) })] }), CTX).ok === false
  );

  // ============================================================
  // PARSER -- duration/importance/deadline (21-28)
  // ============================================================
  check('21. a non-integer durationMinutes is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ durationMinutes: 30.5 })] }), CTX).ok === false);
  check('22. a zero durationMinutes is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ durationMinutes: 0 })] }), CTX).ok === false);
  check('23. a negative durationMinutes is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ durationMinutes: -30 })] }), CTX).ok === false);
  check('24. a durationMinutes over 1440 is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ durationMinutes: 1441 })] }), CTX).ok === false);
  check('25. durationMinutes of exactly 1440 is accepted', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ durationMinutes: 1440 })] }), CTX).ok === true);
  check('26. an invalid importance value is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ importance: 'URGENT' })] }), CTX).ok === false);
  check('27. an invalid deadline format is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ deadline: '09/20/2026' })] }), CTX).ok === false);
  check('28. a non-existent calendar date deadline is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ deadline: '2026-13-40' })] }), CTX).ok === false);

  // ============================================================
  // PARSER -- flexibility / fixedStart contradictions (29-34)
  // ============================================================
  check('29. missing flexibility is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ flexibility: undefined })] }), CTX).ok === false);
  check('30. an invalid flexibility value is rejected', parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ flexibility: 'SOMETIMES' })] }), CTX).ok === false);
  check(
    '31. FIXED without fixedStart is rejected (never manufactured downstream)',
    parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ flexibility: 'FIXED' })] }), CTX).ok === false
  );
  check(
    '32. FIXED with an unparseable fixedStart is rejected',
    parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ flexibility: 'FIXED', fixedStart: 'not-a-date' })] }), CTX).ok === false
  );
  check(
    '33. FLEXIBLE with a fixedStart present is rejected as contradictory input, never silently dropped',
    parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ flexibility: 'FLEXIBLE', fixedStart: '2026-09-16T10:00:00Z' })] }), CTX).ok === false
  );
  check(
    '34. FIXED never downgrades to FLEXIBLE to route around a missing fixedStart -- the request is rejected outright',
    parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ flexibility: 'FIXED', fixedStart: undefined })] }), CTX).ok === false
  );

  // ============================================================
  // PARSER -- targetDate / constructionWindowSource / explicit range (35-42)
  // ============================================================
  check('35. an invalid targetDate format is rejected', parseConstructDayPreviewRequestBody(validBody({ targetDate: 'tomorrow' }), CTX).ok === false);
  check('36. an invalid constructionWindowSource is rejected', parseConstructDayPreviewRequestBody(validBody({ constructionWindowSource: 'WORKING_HOURS' }), CTX).ok === false);
  check(
    '37. EXPLICIT_RANGE without explicitStart/explicitEnd is rejected',
    parseConstructDayPreviewRequestBody(validBody({ constructionWindowSource: 'EXPLICIT_RANGE' }), CTX).ok === false
  );
  check(
    '38. EXPLICIT_RANGE with only explicitStart is rejected',
    parseConstructDayPreviewRequestBody(validBody({ constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: '2026-09-16T09:00:00Z' }), CTX).ok === false
  );
  check(
    '39. EXPLICIT_RANGE with an unparseable explicitEnd is rejected',
    parseConstructDayPreviewRequestBody(
      validBody({ constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: '2026-09-16T09:00:00Z', explicitEnd: 'nonsense' }),
      CTX
    ).ok === false
  );
  check(
    '40. REMAINING_TODAY with an explicitStart present is rejected as contradictory input',
    parseConstructDayPreviewRequestBody(validBody({ constructionWindowSource: 'REMAINING_TODAY', explicitStart: '2026-09-16T09:00:00Z' }), CTX).ok === false
  );
  check(
    '41. an omitted constructionWindowSource (defaults to REMAINING_TODAY) with an explicitStart present is also rejected',
    parseConstructDayPreviewRequestBody(validBody({ explicitStart: '2026-09-16T09:00:00Z' }), CTX).ok === false
  );
  check(
    '42. no working-hours/sleep-schedule default is ever introduced -- an unrecognized source string is rejected outright, never coerced to one',
    parseConstructDayPreviewRequestBody(validBody({ constructionWindowSource: 'DEFAULT_WORKING_HOURS' }), CTX).ok === false
  );

  // ============================================================
  // PARSER -- server-owned fields structurally unreachable from the body (43-44)
  // ============================================================
  {
    const attackerBody = validBody({ userId: 'someone-elses-id', timezone: 'Fake/Zone', now: '2000-01-01T00:00:00Z' });
    const result = parseConstructDayPreviewRequestBody(attackerBody, CTX);
    check(
      '43. a body-supplied userId/timezone/now is simply never read -- the parsed request still uses ctx.timezone/ctx.now exactly',
      result.ok === true && result.ok && result.request.timezone === TZ && result.request.now === NOW
    );
  }
  {
    const result = parseConstructDayPreviewRequestBody(validBody({ intents: [validIntent({ activityId: 'workout' })] }), CTX);
    check('44. a supplied activityId passes through unresolved -- the orchestrator, not this parser, re-validates it', result.ok === true && result.ok && result.request.intents[0].activityId === 'workout');
  }

  // ============================================================
  // runDayConstructorPreview -- protocol-level rejection never touches deps (45-46)
  // ============================================================
  {
    const deps = countingDeps();
    const result = await runDayConstructorPreview({}, TZ, NOW, deps);
    check('45. an invalid body yields HTTP 400', result.httpStatus === 400);
    check('46. an invalid body never invokes any orchestrator dependency (no DB read attempted)', deps.calls.loadBlockingPlans === 0 && deps.calls.loadDurationContext === 0 && deps.calls.searchTiming === 0);
  }

  // ============================================================
  // runDayConstructorPreview -- orchestrator passthrough (47-52)
  // ============================================================
  {
    const deps = countingDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'GOOD')] }) });
    const body = validBody({
      constructionWindowSource: 'EXPLICIT_RANGE',
      explicitStart: '2026-09-16T09:00:00Z',
      explicitEnd: '2026-09-16T17:00:00Z',
      intents: [validIntent({ activityId: 'workout', durationMinutes: 30 })],
    });
    const result = await runDayConstructorPreview(body, TZ, NOW, deps);
    check('47. a fully valid request reaches the orchestrator and returns HTTP 200', result.httpStatus === 200);
    check('48. a READY domain result is returned verbatim, keyed by its own status', (result.body as { status?: string }).status === 'READY');
    check('49. the orchestrator is invoked exactly once per call (one loadBlockingPlans read), never once per intent', deps.calls.loadBlockingPlans === 1 && deps.calls.loadDurationContext === 1);
    const serialized = JSON.parse(JSON.stringify(result.body));
    check(
      '50. Date fields serialize to ISO strings through the same JSON path NextResponse.json uses',
      typeof serialized.preview.constructionWindow.start === 'string' && !Number.isNaN(Date.parse(serialized.preview.constructionWindow.start))
    );
  }
  {
    // Mirrors dayConstructorOrchestrator.test.ts's own NO_USABLE_CAPACITY
    // trigger: a blocking Plan that fully covers the explicit window.
    const deps = countingDeps({ loadBlockingPlans: async () => [{ start: iso('2026-09-16T09:00:00Z'), end: iso('2026-09-16T10:00:00Z'), status: 'UPCOMING' as const }] });
    const body = validBody({
      constructionWindowSource: 'EXPLICIT_RANGE',
      explicitStart: '2026-09-16T09:00:00Z',
      explicitEnd: '2026-09-16T10:00:00Z',
      intents: [validIntent({ activityId: 'workout', durationMinutes: 30 })],
    });
    const result = await runDayConstructorPreview(body, TZ, NOW, deps);
    check('51. a NO_USABLE_CAPACITY domain result is preserved verbatim at HTTP 200, not reinterpreted as an error', result.httpStatus === 200 && (result.body as { status?: string }).status === 'NO_USABLE_CAPACITY');
  }
  {
    const deps = countingDeps({
      searchTiming: () => {
        throw new Error('timing engine unavailable');
      },
    });
    const body = validBody({
      constructionWindowSource: 'EXPLICIT_RANGE',
      explicitStart: '2026-09-16T09:00:00Z',
      explicitEnd: '2026-09-16T17:00:00Z',
      intents: [validIntent({ id: 'search-fail', activityId: 'workout', durationMinutes: 30 })],
    });
    const result = await runDayConstructorPreview(body, TZ, NOW, deps);
    check(
      '52. a thrown search failure surfaces as TIMING_SEARCH_FAILED at HTTP 200, never a generic 500 (a caught, typed domain outcome, not an unhandled exception)',
      result.httpStatus === 200 && (result.body as { status?: string; requestedIntentId?: string }).status === 'TIMING_SEARCH_FAILED' && (result.body as { requestedIntentId?: string }).requestedIntentId === 'search-fail'
    );
  }

  // ============================================================
  // runDayConstructorPreview -- no side effects (53)
  // ============================================================
  {
    const deps = countingDeps();
    check(
      '53. the injected deps object exposes only read-shaped operations -- no save/accept/persist-style method exists for this function to have called even by accident',
      Object.keys(deps).sort().join(',') === ['calls', 'loadBlockingPlans', 'loadDurationContext', 'searchTiming', 'loadAvailabilityConfiguration'].sort().join(',')
    );
  }

  // ============================================================
  // handleDayConstructorPreviewRequest -- the framework-independent
  // server boundary (pre-commit hardening). Exercises the EXACT sequence
  // route.ts's own production closures drive, with no NextRequest
  // involved (54-68).
  // ============================================================

  // A. unauthenticated -- 401, and nothing downstream of the session
  // check is ever touched.
  {
    const f = boundaryDeps({ session: null });
    const result = await handleDayConstructorPreviewRequest(f.deps);
    check('54. no session yields HTTP 401', result.httpStatus === 401);
    check(
      '55. an unauthenticated request never calls getUser, getBody, the clock, or createOrchestratorDeps',
      f.calls.getUser === 0 && f.calls.getBody === 0 && f.calls.now === 0 && f.calls.createOrchestratorDeps === 0
    );
  }

  // B. valid session, missing User row -- 404, and nothing past the user
  // lookup is ever touched.
  {
    const f = boundaryDeps({ user: null });
    const result = await handleDayConstructorPreviewRequest(f.deps);
    check('56. a valid session whose user no longer exists yields HTTP 404', result.httpStatus === 404);
    check('57. getUser is called exactly once for a missing-user request', f.calls.getUser === 1);
    check('58. a missing-user request never reads the body, the clock, or constructs orchestrator deps', f.calls.getBody === 0 && f.calls.now === 0 && f.calls.createOrchestratorDeps === 0);
  }

  // C/G. session identity is authoritative -- the session's own userId
  // drives the user lookup, regardless of anything the body claims.
  {
    const f = boundaryDeps({
      session: { userId: 'the-real-authenticated-user' },
      user: fakeUser({ id: 'the-real-authenticated-user', timezone: 'Asia/Kolkata' }),
      body: validBody({ userId: 'attacker-supplied-id' }),
    });
    const result = await handleDayConstructorPreviewRequest(f.deps);
    check('59. getUser is called with the SESSION\'s own userId, never a body-supplied one', f.getUserArgs.length === 1 && f.getUserArgs[0] === 'the-real-authenticated-user');
    check(
      '60. createOrchestratorDeps receives the session-identified user, never a body-supplied identity',
      f.createOrchestratorDepsArgs.length === 1 && f.createOrchestratorDepsArgs[0].user.id === 'the-real-authenticated-user'
    );
    check('61. the request still succeeds -- a stray body.userId is inert, never rejected, never authoritative', result.httpStatus === 200);
  }

  // D/E. user.timezone is authoritative -- a body-supplied timezone is
  // never read (this repeats test 43's proof end-to-end, through the real
  // production sequence rather than calling the parser directly).
  {
    const f = boundaryDeps({
      user: fakeUser({ timezone: 'America/New_York' }),
      body: validBody({ timezone: 'Fake/Attacker/Zone' }),
    });
    await handleDayConstructorPreviewRequest(f.deps);
    check(
      '62. createOrchestratorDeps receives the AUTHENTICATED USER\'s own timezone, never a body-supplied one',
      f.createOrchestratorDepsArgs.length === 1 && f.createOrchestratorDepsArgs[0].user.timezone === 'America/New_York'
    );
  }

  // F/H. the authoritative clock: read exactly once, and the exact
  // instant it returns is what reaches orchestrator-deps construction --
  // never a body-supplied `now`.
  {
    const injectedNow = iso('2026-11-03T04:00:00Z');
    const f = boundaryDeps({ now: injectedNow, body: validBody({ now: '2000-01-01T00:00:00Z' }) });
    await handleDayConstructorPreviewRequest(f.deps);
    check('63. the clock is invoked exactly once for one valid, authenticated request', f.calls.now === 1);
    check(
      '64. the EXACT Date instance the clock returned reaches createOrchestratorDeps, never a body-supplied now',
      f.createOrchestratorDepsArgs.length === 1 && f.createOrchestratorDepsArgs[0].now === injectedNow
    );
  }

  // I/J. constructor invocation count -- once for a valid request, never
  // for a request whose body fails domain validation.
  {
    const f = boundaryDeps({
      body: validBody({
        constructionWindowSource: 'EXPLICIT_RANGE',
        explicitStart: '2026-09-16T09:00:00Z',
        explicitEnd: '2026-09-16T17:00:00Z',
        intents: [validIntent({ activityId: 'workout', durationMinutes: 30 })],
      }),
    });
    const result = await handleDayConstructorPreviewRequest(f.deps);
    check('65. a fully valid, authenticated request reaches the real orchestrator exactly once end-to-end', result.httpStatus === 200 && f.orchestratorDeps.calls.loadBlockingPlans === 1 && f.orchestratorDeps.calls.loadDurationContext === 1);
  }
  {
    const f = boundaryDeps({ body: { intents: [] } }); // syntactically valid JSON, domain-invalid (empty intents).
    const result = await handleDayConstructorPreviewRequest(f.deps);
    check('66. an authenticated request with a domain-invalid body yields HTTP 400', result.httpStatus === 400);
    check(
      '67. a domain-invalid body never reaches the real orchestrator\'s own read operations, even though orchestrator-deps were constructed',
      f.orchestratorDeps.calls.loadBlockingPlans === 0 && f.orchestratorDeps.calls.loadDurationContext === 0 && f.orchestratorDeps.calls.searchTiming === 0
    );
  }

  // K. unexpected-failure privacy -- a genuine infrastructure throw maps
  // to a generic 500, never leaking the raw error text.
  {
    const f = boundaryDeps({ createOrchestratorDepsThrows: true });
    const result = await handleDayConstructorPreviewRequest(f.deps);
    check('68. an unexpected internal throw yields a generic HTTP 500, never the raw error text', result.httpStatus === 500 && !JSON.stringify(result.body).includes('internal detail that must never reach the client'));
  }

  if (!allPassed) {
    console.error('\nSome Day Constructor Preview Request checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAY CONSTRUCTOR PREVIEW REQUEST CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
