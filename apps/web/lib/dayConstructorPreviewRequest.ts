/**
 * Day Constructor V1 -- PR F1 (Preview API). The HTTP-facing request
 * contract for `POST /api/day-constructor/preview` -- turning an
 * untrusted JSON body into a validated `ConstructDayRequest`
 * (dayConstructorOrchestrator.ts), and turning that orchestration's own
 * result into an HTTP status/body pair. Kept out of route.ts itself (this
 * ticket's own section 23: "prefer extracting a narrow pure request
 * parser/normalizer if it makes validation independently testable") so
 * every validation/normalization rule is directly unit-testable with no
 * NextRequest, no session, no database -- matching this repository's own
 * established convention of keeping API routes thin and pushing anything
 * substantive into a plain, DI-tested lib function (see
 * `dayConstructorAcceptancePersistence.ts`'s own `persistAcceptedConstructedDay`
 * for the sibling PR E2 precedent this file follows).
 *
 * SERVER-OWNED FIELDS (this ticket's own section 7): `timezone` and `now`
 * are ALWAYS caller-supplied PARAMETERS to every function here, never
 * read from the request body -- the parser has no code path that could
 * read a `timezone`/`now`/`userId` key from the body even if one were
 * present. This is a structural guarantee, not a rejection rule: those
 * keys are simply never looked at.
 */

import { isValidCalendarDateString } from '../../../packages/panchang/src/localDate';
import { getDatePartsInTimezone } from './timezone';
import { MAX_INTENT_ID_LENGTH } from './dayConstructorAcceptancePersistence';
import {
  type ConstructDayPreview,
  type ConstructDayRequest,
  type DayConstructorOrchestratorDeps,
  type RequestedDayIntent,
} from './dayConstructorOrchestrator';
import type { ConstructionWindowSource, DayIntentFlexibility, DayIntentImportance } from './dayIntent';
import { signPreviewResultBody } from './dayConstructorPreviewIntegrity';
import { orchestrateConstructDayWithShadowPolicy, type ShadowPolicyExecution } from './shadowPolicyExecution';
import type { ShadowReviewPayload } from './shadowReviewDelta';
import type { User } from './db';

// ============================================================
// Transport/input-protection limits (this ticket's own section 10: "if no
// maximum multi-intent count exists, choose a conservative UI/API safety
// limit and document it explicitly as transport/input protection, not
// scheduling policy"). None of these are a `constructDay`/`dayCapacity`
// domain rule -- that engine has no intrinsic limit on intent count, and
// this file introduces none of its own; these bounds exist solely so a
// malformed/abusive request body cannot force unbounded work (an
// unbounded number of per-intent `runTimingSearch` calls) at this HTTP
// boundary. `MAX_INTENT_ID_LENGTH` is intentionally NOT redefined here --
// imported verbatim from `dayConstructorAcceptancePersistence.ts` (PR E2)
// so an intent id accepted at preview time is, by construction, never
// longer than what the accept endpoint will later store it under.
// ============================================================

import type { DecisionFactsByIntentId } from './decisionFacts';
import { createDecisionFactPreparer } from './decisionFactPreparation';
import type { OpportunityRangeDeps } from './opportunityRangeAdapter';
import { schedulingContextDurationContext, schedulingContextOpportunityRangeDeps, type DecisionSchedulingContext } from './decisionSchedulingContext';

/** Decision Facts V1 -- a server-side, source-specific fact provider,
 * injected at the route. Receives the already-parsed (never client-
 * controlled) request and the authenticated user; returns generic facts
 * keyed by intent id. This file knows nothing about any source. */
export type DecisionFactsSource = (request: ConstructDayRequest) => Promise<DecisionFactsByIntentId>;

export const MAX_INTENTS_PER_REQUEST = 12;
export const MAX_TITLE_LENGTH = 200; // mirrors /api/plans's own `title` bound (plans/route.ts).
export const MAX_ACTIVITY_ID_LENGTH = 200;

const VALID_CONSTRUCTION_WINDOW_SOURCES = new Set<ConstructionWindowSource>(['REMAINING_TODAY', 'EXPLICIT_RANGE']);
const VALID_IMPORTANCE_VALUES = new Set<DayIntentImportance>(['HIGH', 'MEDIUM', 'LOW']);
const VALID_FLEXIBILITY_VALUES = new Set<DayIntentFlexibility>(['FIXED', 'FLEXIBLE']);
const MAX_DURATION_MINUTES = 24 * 60; // mirrors dayIntent.ts's own `validateEstimatedDurationMinutes` bound.

export interface ParsePreviewRequestContext {
  /** The authenticated user's own canonical timezone (User.timezone,
   * db.ts) -- NEVER the request body, NEVER a browser-reported value. */
  timezone: string;
  /** The authoritative server clock, read exactly once by the caller
   * (route.ts) before this function is invoked -- NEVER re-read here. */
  now: Date;
}

export type ParsePreviewRequestResult = { ok: true; request: ConstructDayRequest } | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseRequestedIntent(raw: unknown, index: number, seenIds: Set<string>): { ok: true; intent: RequestedDayIntent } | { ok: false; error: string } {
  const label = `intents[${index}]`;
  if (!isPlainObject(raw)) return { ok: false, error: `${label} must be an object.` };

  if (typeof raw.id !== 'string' || !raw.id.trim()) return { ok: false, error: `${label}.id is required.` };
  const id = raw.id.trim();
  if (id.length > MAX_INTENT_ID_LENGTH) return { ok: false, error: `${label}.id must be ${MAX_INTENT_ID_LENGTH} characters or fewer.` };
  if (seenIds.has(id)) return { ok: false, error: `${label}.id "${id}" duplicates an earlier intent id in this request.` };
  seenIds.add(id);

  if (typeof raw.title !== 'string' || !raw.title.trim()) return { ok: false, error: `${label}.title is required.` };
  const title = raw.title.trim();
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, error: `${label}.title must be ${MAX_TITLE_LENGTH} characters or fewer.` };

  let activityId: string | undefined;
  if (raw.activityId !== undefined) {
    if (typeof raw.activityId !== 'string' || !raw.activityId.trim()) return { ok: false, error: `${label}.activityId must be a non-empty string when present.` };
    if (raw.activityId.length > MAX_ACTIVITY_ID_LENGTH) return { ok: false, error: `${label}.activityId must be ${MAX_ACTIVITY_ID_LENGTH} characters or fewer.` };
    // Deliberately NOT re-validated against the activity catalog here --
    // the orchestrator's own `resolveActivity` already re-validates any
    // supplied activityId via `getActivityProfileById` and falls back to
    // title-based resolution for an unrecognized one (this ticket's own
    // section 16: "do not duplicate that resolution in the route").
    activityId = raw.activityId;
  }

  let durationMinutes: number | undefined;
  if (raw.durationMinutes !== undefined) {
    if (typeof raw.durationMinutes !== 'number' || !Number.isInteger(raw.durationMinutes) || raw.durationMinutes <= 0 || raw.durationMinutes > MAX_DURATION_MINUTES) {
      return { ok: false, error: `${label}.durationMinutes must be a positive integer of at most ${MAX_DURATION_MINUTES} minutes.` };
    }
    durationMinutes = raw.durationMinutes;
  }

  let importance: DayIntentImportance | undefined;
  if (raw.importance !== undefined) {
    if (typeof raw.importance !== 'string' || !VALID_IMPORTANCE_VALUES.has(raw.importance as DayIntentImportance)) {
      return { ok: false, error: `${label}.importance must be one of HIGH, MEDIUM, LOW.` };
    }
    importance = raw.importance as DayIntentImportance;
  }

  let deadline: string | undefined;
  if (raw.deadline !== undefined) {
    if (typeof raw.deadline !== 'string' || !isValidCalendarDateString(raw.deadline)) {
      return { ok: false, error: `${label}.deadline must be a valid YYYY-MM-DD calendar date.` };
    }
    deadline = raw.deadline;
  }

  if (typeof raw.flexibility !== 'string' || !VALID_FLEXIBILITY_VALUES.has(raw.flexibility as DayIntentFlexibility)) {
    return { ok: false, error: `${label}.flexibility is required and must be FIXED or FLEXIBLE.` };
  }
  const flexibility = raw.flexibility as DayIntentFlexibility;

  // Reject rather than silently ignore/downgrade a contradictory
  // FIXED/FLEXIBLE + fixedStart combination (this ticket's own sections
  // 11/12) -- never manufactured, never dropped.
  let fixedStart: Date | undefined;
  if (flexibility === 'FIXED') {
    if (raw.fixedStart === undefined) return { ok: false, error: `${label}.fixedStart is required when flexibility is FIXED.` };
    const parsed = parseIsoDate(raw.fixedStart);
    if (!parsed) return { ok: false, error: `${label}.fixedStart must be a valid date-time string.` };
    fixedStart = parsed;
  } else if (raw.fixedStart !== undefined) {
    return { ok: false, error: `${label}.fixedStart must not be supplied when flexibility is FLEXIBLE.` };
  }

  // `originalOrder` is intentionally NEVER read from the request body
  // (this ticket's own section 19's preferred behavior) -- derived
  // exclusively from this intent's own position in the submitted array,
  // so a client cannot manipulate overload-precedence tie-breaking by
  // supplying an arbitrary value.
  return {
    ok: true,
    intent: { id, title, activityId, durationMinutes, importance, deadline, flexibility, fixedStart, originalOrder: index },
  };
}

/**
 * Pure. Never touches the network, the database, or a clock -- `now` is a
 * parameter, not a read. Returns the first validation error encountered
 * (this ticket's own section 10); never partially normalizes a rejected
 * request.
 */
export function parseConstructDayPreviewRequestBody(body: unknown, ctx: ParsePreviewRequestContext): ParsePreviewRequestResult {
  if (!isPlainObject(body)) return { ok: false, error: 'Request body must be a JSON object.' };

  let targetDate: string;
  if (body.targetDate !== undefined) {
    if (typeof body.targetDate !== 'string' || !isValidCalendarDateString(body.targetDate)) {
      return { ok: false, error: 'targetDate must be a valid YYYY-MM-DD calendar date.' };
    }
    targetDate = body.targetDate;
  } else {
    // Derived from the authenticated user's own timezone (this ticket's
    // own section 14) -- never a server-local date.
    targetDate = getDatePartsInTimezone(ctx.timezone, ctx.now).dateStr;
  }

  let constructionWindowSource: ConstructionWindowSource = 'REMAINING_TODAY';
  if (body.constructionWindowSource !== undefined) {
    if (typeof body.constructionWindowSource !== 'string' || !VALID_CONSTRUCTION_WINDOW_SOURCES.has(body.constructionWindowSource as ConstructionWindowSource)) {
      return { ok: false, error: 'constructionWindowSource must be REMAINING_TODAY or EXPLICIT_RANGE.' };
    }
    constructionWindowSource = body.constructionWindowSource as ConstructionWindowSource;
  }

  let explicitStart: Date | undefined;
  let explicitEnd: Date | undefined;
  if (constructionWindowSource === 'EXPLICIT_RANGE') {
    explicitStart = parseIsoDate(body.explicitStart) ?? undefined;
    explicitEnd = parseIsoDate(body.explicitEnd) ?? undefined;
    if (!explicitStart || !explicitEnd) {
      return { ok: false, error: 'explicitStart and explicitEnd are required, valid date-time strings when constructionWindowSource is EXPLICIT_RANGE.' };
    }
    // Ordering (`start < end`) is deliberately NOT re-checked here --
    // `resolveConstructionWindow`/`validateConstructionWindow`
    // (dayConstructorOrchestrator.ts/dayIntent.ts) already enforce it and
    // report `INVALID_CONSTRUCTION_WINDOW`; duplicating that check here
    // would be exactly the kind of re-derivation this ticket's own
    // sections 16/17 warn against for activityId/duration.
  } else if (body.explicitStart !== undefined || body.explicitEnd !== undefined) {
    // Contradictory input, never silently ignored (same philosophy as the
    // FIXED/FLEXIBLE + fixedStart rule above).
    return { ok: false, error: 'explicitStart/explicitEnd must not be supplied when constructionWindowSource is REMAINING_TODAY.' };
  }

  if (!Array.isArray(body.intents) || body.intents.length === 0) {
    return { ok: false, error: 'intents must be a non-empty array.' };
  }
  if (body.intents.length > MAX_INTENTS_PER_REQUEST) {
    return { ok: false, error: `intents must contain at most ${MAX_INTENTS_PER_REQUEST} items.` };
  }

  const intents: RequestedDayIntent[] = [];
  const seenIds = new Set<string>();
  for (let index = 0; index < body.intents.length; index += 1) {
    const parsed = parseRequestedIntent(body.intents[index], index, seenIds);
    if (!parsed.ok) return parsed;
    intents.push(parsed.intent);
  }

  return {
    ok: true,
    request: { targetDate, timezone: ctx.timezone, constructionWindowSource, now: ctx.now, explicitStart, explicitEnd, intents },
  };
}

// ============================================================
// Response composition (this ticket's own section 20/21). Maps the
// already-exhaustively-tested `OrchestrateConstructDayResult` union
// (dayConstructorOrchestrator.ts) onto an HTTP status/body pair -- never
// re-deriving or re-wording a domain result, mirroring
// `POST /api/day-constructor/accept`'s own precedent of returning every
// legitimate domain outcome as a normal (status 200) response body with
// its own `status` discriminant, reserving a non-200 code for genuine
// protocol/infrastructure failure.
// ============================================================

export interface DayConstructorPreviewHttpResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

/**
 * Takes `deps` as an explicit parameter -- exactly like
 * `orchestrateConstructDay` itself -- so this function is directly
 * testable with an injected fake (no DB, no network) while production
 * wiring (route.ts) passes `createRealDayConstructorOrchestratorDeps`.
 * `timezone`/`now` are parameters here too, never read from `body` --
 * the ONLY two places this file ever reads a timezone or an instant.
 */
/**
 * O5 P2d -- how a preview obtains the decision evidence's database-derived inputs from ONE coherent snapshot. `loadContext`
 * reads them all inside one REPEATABLE READ transaction (decisionSchedulingContextLoader.ts); `decisionFactsFromContext`
 * derives the recurrence facts from that context only. When a binding is supplied it REPLACES the independent live
 * providers (`decisionFactsSource`, `opportunityRangeDeps`) -- there is no mixing of the two.
 */
export interface DecisionSchedulingBinding {
  loadContext: (request: ConstructDayRequest) => Promise<DecisionSchedulingContext>;
  decisionFactsFromContext: (request: ConstructDayRequest, context: DecisionSchedulingContext) => Promise<DecisionFactsByIntentId>;
}

export async function runDayConstructorPreview(
  body: unknown,
  timezone: string,
  now: Date,
  deps: DayConstructorOrchestratorDeps,
  decisionFactsSource?: DecisionFactsSource,
  opportunityRangeDeps?: OpportunityRangeDeps,
  schedulingBinding?: DecisionSchedulingBinding,
  shadowPolicy?: ShadowPolicyExecution
): Promise<DayConstructorPreviewHttpResult> {
  const parsed = parseConstructDayPreviewRequestBody(body, { timezone, now });
  if (!parsed.ok) return { httpStatus: 400, body: { error: parsed.error } };

  // Decision Facts V1 -- facts are inert metadata in V1 (nothing reads
  // them for ordering/eligibility), so a provider failure must never
  // fail an otherwise-valid preview: continue with no facts, exactly the
  // behavior of a request that had no provider at all.
  let decisionFactsByIntentId: DecisionFactsByIntentId | undefined;
  // O5 P1 -- opportunity facts are PREPARED inside the orchestration, after
  // duration resolution and before the Constructor runs (see
  // decisionFactPreparation.ts); this boundary only supplies the generic
  // preparer. Preparing is fail-open there, and the facts are inert.
  let orchestrationDeps: DayConstructorOrchestratorDeps = opportunityRangeDeps ? { ...deps, prepareDecisionFacts: createDecisionFactPreparer(opportunityRangeDeps) } : deps;
  if (schedulingBinding) {
    // O5 P2d -- ONE coherent read of every database-derived evidence input (one REPEATABLE READ transaction, already ended
    // when `loadContext` resolves). The recurrence facts, the duration resolution, the availability / blocker adaptation and
    // the opportunity projection below read this context only. If it cannot be acquired there is NO decision evidence for
    // this request: the independent live reads are never used as a substitute and their result never labelled authoritative
    // (the Constructor keeps its own live duration / blocker inputs, exactly as a request with no evidence provider).
    let context: DecisionSchedulingContext | undefined;
    try {
      context = await schedulingBinding.loadContext(parsed.request);
    } catch (err) {
      console.warn('day-constructor/preview: coherent scheduling context unavailable, continuing without decision evidence', err);
    }
    orchestrationDeps = deps;
    if (context) {
      const coherent = context;
      try {
        decisionFactsByIntentId = await schedulingBinding.decisionFactsFromContext(parsed.request, coherent);
      } catch (err) {
        console.warn('day-constructor/preview: decision facts unavailable, continuing without', err);
      }
      orchestrationDeps = {
        ...deps,
        loadDurationContext: async () => schedulingContextDurationContext(coherent, timezone, now),
        prepareDecisionFacts: createDecisionFactPreparer(schedulingContextOpportunityRangeDeps(coherent)),
      };
    }
  } else if (decisionFactsSource) {
    try {
      decisionFactsByIntentId = await decisionFactsSource(parsed.request);
    } catch (err) {
      console.warn('day-constructor/preview: decision facts unavailable, continuing without', err);
    }
  }
  // O5 P4b5 -- the ONE orchestration of this request. OFF (the default; `shadowPolicy` absent or OFF): the plain `orchestrateConstructDay` call, unchanged. SHADOW: the same
  // single orchestration run through the diagnostic composition, whose baseline result is returned untouched (shadowPolicyExecution.ts). The mode is server-supplied only.
  const result = await orchestrateConstructDayWithShadowPolicy(decisionFactsByIntentId ? { ...parsed.request, decisionFactsByIntentId } : parsed.request, orchestrationDeps, shadowPolicy);

  // Every branch below is a legitimate, already-typed domain outcome --
  // returned verbatim, at HTTP 200, never reinterpreted (this ticket's
  // own section 21). There is no "unexpected exception" branch here:
  // `orchestrateConstructDay` itself only ever throws for something
  // outside its own typed contract, which route.ts's own try/catch (the
  // genuine HTTP/infrastructure boundary) is responsible for turning into
  // a 500 -- this function never swallows that distinction.
  return { httpStatus: 200, body: result };
}

// ============================================================
// Framework-independent server boundary (pre-commit hardening). Every
// production decision route.ts makes BEFORE the JSON-extraction/
// NextResponse-conversion work that genuinely requires `next/server` is
// captured here as a plain, injectable function -- session lookup, user
// lookup, the authoritative clock, and orchestrator-deps construction --
// so the exact sequence production runs (auth -> user -> body -> now ->
// deps -> preview) is directly executable in a root-level test with zero
// NextRequest/NextResponse involvement (this repository's own established
// reason to avoid that: see `auraMoments.test.ts`'s own doc comment on
// why `next/server` isn't reliably resolvable from root `ts-node`).
//
// route.ts itself is reduced to exactly the framework-specific residue
// this ticket's own section 4 describes: adapting a real `NextRequest`
// into these five closures, and converting the returned
// `DayConstructorPreviewHttpResult` into a `NextResponse` -- it makes no
// security/context decision of its own anymore.
// ============================================================

/** The only fact this file needs out of a verified session -- never the
 * full `SessionPayload` (auth.ts), so this file has no reason to import
 * anything from `./auth`. */
export interface DayConstructorPreviewSession {
  userId: string;
}

export interface DayConstructorPreviewBoundaryDeps {
  /** `() => getSessionFromRequest(req)` in production -- synchronous,
   * matching `getSessionFromRequest`'s own real signature exactly. */
  getSession: () => DayConstructorPreviewSession | null;
  /** `getUserById` in production, passed by reference (same signature). */
  getUser: (userId: string) => Promise<User | null>;
  /** `() => parseJsonObject(req)` in production -- the one genuinely
   * `NextRequest`-bound piece of body extraction (`req.json()`), kept
   * behind this seam so this file never imports `next/server` itself.
   * `null` means malformed/absent JSON. */
  getBody: () => Promise<unknown | null>;
  /** `() => new Date()` in production -- the authoritative clock, read
   * through this seam so a test can count invocations and capture the
   * exact instant used, without this file introducing a second, hidden
   * clock of its own (this ticket's own section 9: "no second `new
   * Date()` in downstream F1 code" -- there still is exactly one, and it
   * lives only here). */
  now: () => Date;
  /** `createRealDayConstructorOrchestratorDeps` in production, passed by
   * reference (same signature: `(user, now) => DayConstructorOrchestratorDeps`). */
  createOrchestratorDeps: (user: User, now: Date) => DayConstructorOrchestratorDeps;
  /** Decision Facts V1 -- OPTIONAL. Production wiring (route.ts) supplies
   * the source-specific provider; omitting it is byte-identical to this
   * ticket never having existed. */
  loadDecisionFacts?: (user: User, request: ConstructDayRequest) => Promise<DecisionFactsByIntentId>;
  /** Opportunity Scarcity V1 O4 -- OPTIONAL. Production wiring supplies
   * the authenticated user's own read-only range loaders; omitting it is
   * byte-identical to this ticket never having existed. */
  createOpportunityRangeDeps?: (user: User) => OpportunityRangeDeps;
  /** O5 P2d -- OPTIONAL, used together with `loadDecisionFactsFromContext`. Reads the decision evidence's database-derived
   * inputs in ONE coherent snapshot. When both are supplied they REPLACE the independent live providers above. */
  loadSchedulingContext?: (user: User, request: ConstructDayRequest) => Promise<DecisionSchedulingContext>;
  loadDecisionFactsFromContext?: (user: User, request: ConstructDayRequest, context: DecisionSchedulingContext) => Promise<DecisionFactsByIntentId>;
  /** O5 P4b5 -- OPTIONAL, SERVER-SUPPLIED ONLY (never derived from the request body): the shadow policy execution settings. Omitted => OFF => byte-identical to before. */
  shadowPolicy?: () => ShadowPolicyExecution;
}

/**
 * The production sequence, framework-independent. Ordering is deliberate
 * and unchanged from the original route: unauthenticated (401) and
 * missing-user (404) both short-circuit before the body is ever read, the
 * clock is ever read, or `deps.createOrchestratorDeps` is ever called --
 * so an unauthenticated request costs nothing beyond the session check
 * (this ticket's own section 9: "do not call the clock for unauthenticated
 * requests").
 */
export async function handleDayConstructorPreviewRequest(deps: DayConstructorPreviewBoundaryDeps): Promise<DayConstructorPreviewHttpResult> {
  const session = deps.getSession();
  if (!session) return { httpStatus: 401, body: { error: 'Not authenticated.' } };

  const user = await deps.getUser(session.userId);
  if (!user) return { httpStatus: 404, body: { error: 'User not found.' } };

  const body = await deps.getBody();
  if (body === null) return { httpStatus: 400, body: { error: 'A valid JSON request body is required.' } };

  // Authoritative clock -- read EXACTLY ONCE, then threaded through both
  // orchestrator-deps construction and (inside `runDayConstructorPreview`)
  // the request parser's own `targetDate` defaulting. Identity/timezone
  // are ALWAYS this authenticated `user`'s own values -- `session.userId`
  // (never anything the body could supply) selected `user` above, and
  // `user.timezone` (never the body) is the only timezone this function
  // ever reads.
  const now = deps.now();

  try {
    const orchestratorDeps = deps.createOrchestratorDeps(user, now);
    const decisionFactsSource: DecisionFactsSource | undefined = deps.loadDecisionFacts ? (request) => deps.loadDecisionFacts!(user, request) : undefined;
    const opportunityRangeDeps = deps.createOpportunityRangeDeps ? deps.createOpportunityRangeDeps(user) : undefined;
    const schedulingBinding: DecisionSchedulingBinding | undefined =
      deps.loadSchedulingContext && deps.loadDecisionFactsFromContext
        ? { loadContext: (request) => deps.loadSchedulingContext!(user, request), decisionFactsFromContext: (request, context) => deps.loadDecisionFactsFromContext!(user, request, context) }
        : undefined;
    // O5 SHADOW ROLLOUT R3 -- the Preview-only manual review hand-off: an OUTPUT-ONLY closure receives whatever `shadowPolicyExecution.ts`
    // hands back (nothing, unless the server's own `reviewEligible` AND the run's own evidence both say so -- see createServerShadowPolicyExecution
    // and shadowEvidence.ts). This file never decides eligibility itself; it only wires the hand-off and, if present, attaches the minimal
    // display payload to the body BEFORE signing, as a plain sibling field `shadowReview` that `signPreviewResultBody` passes through
    // untouched (it only ever rewrites `preview.constructedDay.proposedItems`), so the review alternative carries no acceptance token.
    // Delegated via the PROTOTYPE chain (never spread/Object.assign-copied): `sink` and every other settings accessor stay exactly as lazy
    // as before (a hostile `get sink()` is still touched only once, at the one existing call site that reads it) -- only `onReview` is an
    // own property of this new object.
    let review: ShadowReviewPayload | undefined;
    const shadowPolicy = deps.shadowPolicy ? deps.shadowPolicy() : undefined;
    const executionWithReviewHandoff: ShadowPolicyExecution | undefined = shadowPolicy ? Object.assign(Object.create(shadowPolicy), { onReview: (r: ShadowReviewPayload) => { review = r; } }) : undefined;
    const result = await runDayConstructorPreview(body, user.timezone, now, orchestratorDeps, decisionFactsSource, opportunityRangeDeps, schedulingBinding, executionWithReviewHandoff);
    const bodyWithReview = review ? { ...result.body, shadowReview: review } : result.body;
    // F1 trust correction: sign each proposed item for THIS user so acceptance can verify what it means.
    return { ...result, body: signPreviewResultBody(session.userId, bodyWithReview) };
  } catch (err) {
    // Genuine infrastructure/unexpected failure -- never leaked to the
    // client (this ticket's own section 13), distinct from every typed
    // domain outcome, which `runDayConstructorPreview` already returns at
    // HTTP 200 without ever reaching this catch.
    console.error('day-constructor/preview: unexpected failure', err);
    return { httpStatus: 500, body: { error: 'Something went wrong building your preview.' } };
  }
}
