import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { listGoalsForUser, createGoalWithActivities, getGoalForUser, listGoalActivitiesWithLinkedPlanStatus } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { isGoalTemplateCategory, isValidCivilDateString, resolveGoalTemplateActivities, classifyGoalCreateRequestMode } from '../../../lib/goals';
import { validateGoalActivityRhythm, normalizeGoalActivityRhythm, NONE_GOAL_ACTIVITY_RHYTHM, type GoalActivityRhythm } from '../../../lib/goalActivityRhythm';
import { validateCompletionRequirement, normalizeGoalActivityCompletionRequirement, type CompletionRequirement } from '../../../lib/goalCompletion';
import { deriveIdempotentGoalId, goalCreateRequestMatchesExisting } from '../../../lib/goalCreateIdempotency';
import { getActivityProfileById } from '../../../../../packages/recommendation/src/personalizedTasks';

const MAX_TITLE_LENGTH = 200;
// Goals V2 Candidate B3.1 -- mirrors Day Constructor's own established
// clientRequestId bound (dayConstructorAcceptancePersistence.ts's own
// MAX_CLIENT_REQUEST_ID_LENGTH), same rationale: a generous, purely
// defensive ceiling, never a product constraint.
const MAX_CLIENT_REQUEST_ID_LENGTH = 200;
// Goals V2 Candidate B3 -- a pure abuse/safety ceiling on the explicit
// reviewed-activities array, never a UX guidance limit (the Candidate B
// product principle is 2-4 core activities per Goal; B2's own review UX
// keeps proposals small on its own). Chosen generously above the richest
// existing template (3) plus a few freeform additions, while matching the
// closest existing precedent for bounding a client-submitted array of
// comparable shape: dayConstructorPreviewRequest.ts's own
// MAX_INTENTS_PER_REQUEST = 12. No current product requirement needs more
// than this; nothing here blocks any legitimate Goal.
const MAX_REVIEWED_ACTIVITIES = 20;

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get('status');
  const status = statusParam === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';

  const goals = await listGoalsForUser(session.userId, status);
  return NextResponse.json(goals);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json({ error: `A goal title of up to ${MAX_TITLE_LENGTH} characters is required.` }, { status: 400 });
  }

  let targetDate: string | null = null;
  if (body.targetDate !== undefined && body.targetDate !== null) {
    if (!isValidCivilDateString(body.targetDate)) {
      return NextResponse.json({ error: 'targetDate must be a valid "YYYY-MM-DD" calendar date.' }, { status: 400 });
    }
    // Passed straight through as a string -- see Goal.targetDate's own doc
    // comment in db.ts for why no Date object is ever constructed here.
    targetDate = body.targetDate;
  }

  // Goals V2 Candidate B3 -- two mutually exclusive request modes (never
  // silently blended, this ticket's own section 5/31): LEGACY_TEMPLATE is
  // every shipped Goal-create client's existing shape; EXPLICIT_REVIEW is
  // a future B2 review UX submitting its own final, already-approved
  // activity set directly. AMBIGUOUS (both `activities` and
  // `activityRhythms` present) rejects outright, zero writes.
  const requestMode = classifyGoalCreateRequestMode(body);
  if (requestMode === 'AMBIGUOUS') {
    return NextResponse.json({ error: 'Provide either activities or activityRhythms, never both.' }, { status: 400 });
  }

  type ActivityToPersist = { title: string; activityId: string | null; completionRequirement?: CompletionRequirement; rhythm: GoalActivityRhythm };
  let activitiesWithRhythm: ActivityToPersist[];

  if (requestMode === 'EXPLICIT_REVIEW') {
    // The request's own `activities` array IS the final, user-reviewed set
    // to persist verbatim -- `templateCategory`, even if present, is never
    // read here and can never re-expand/reintroduce a removed activity
    // (this ticket's own section 6). Every row is fully validated BEFORE
    // the transaction opens (createGoalWithActivities itself performs no
    // validation, same convention as the legacy path below) -- an invalid
    // row anywhere rejects the WHOLE request with zero writes (section 13).
    if (!Array.isArray(body.activities)) {
      return NextResponse.json({ error: 'activities must be an array.' }, { status: 400 });
    }
    if (body.activities.length > MAX_REVIEWED_ACTIVITIES) {
      return NextResponse.json({ error: `activities must contain at most ${MAX_REVIEWED_ACTIVITIES} entries.` }, { status: 400 });
    }

    const validated: ActivityToPersist[] = [];
    for (const candidate of body.activities) {
      if (typeof candidate !== 'object' || candidate === null) {
        return NextResponse.json({ error: 'Each activities entry must be an object.' }, { status: 400 });
      }
      const row = candidate as Record<string, unknown>;

      const rowTitle = typeof row.title === 'string' ? row.title.trim() : '';
      if (!rowTitle || rowTitle.length > MAX_TITLE_LENGTH) {
        return NextResponse.json({ error: `Each activity title must be 1-${MAX_TITLE_LENGTH} characters.` }, { status: 400 });
      }

      // Closes the known activityId trust gap for this route: any
      // non-null client-supplied activityId must resolve through the
      // exact same canonical, exact-match catalog lookup
      // POST /api/goals/:goalId/activities already uses -- never
      // inferred/rematched from title (section 10), never silently
      // coerced to null (section 8). An unknown id rejects the whole
      // request rather than silently becoming freeform.
      let rowActivityId: string | null = null;
      if (row.activityId !== undefined && row.activityId !== null) {
        if (typeof row.activityId !== 'string' || !row.activityId.trim()) {
          return NextResponse.json({ error: 'Unknown activity.' }, { status: 400 });
        }
        const profile = getActivityProfileById(row.activityId.trim());
        if (!profile) return NextResponse.json({ error: 'Unknown activity.' }, { status: 400 });
        rowActivityId = profile.id;
      }

      // Omitted -> canonical default (DONE), same convention as
      // createGoalWithActivities's own `?? { kind: 'DONE' }`. Present but
      // invalid -> reject the whole request, never silently normalized
      // (section 11's explicit "omitted vs invalid" distinction).
      let rowCompletion: CompletionRequirement | undefined;
      if (row.completionRequirement !== undefined && row.completionRequirement !== null) {
        if (typeof row.completionRequirement !== 'object') {
          return NextResponse.json({ error: 'completionRequirement must be an object with a kind field.' }, { status: 400 });
        }
        const result = validateCompletionRequirement(row.completionRequirement as { kind: unknown; targetValue?: unknown; unit?: unknown });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        rowCompletion = result.requirement;
      }

      let rowRhythm: GoalActivityRhythm = NONE_GOAL_ACTIVITY_RHYTHM;
      if (row.rhythm !== undefined && row.rhythm !== null) {
        if (typeof row.rhythm !== 'object') {
          return NextResponse.json({ error: 'rhythm must be an object with a kind field.' }, { status: 400 });
        }
        const result = validateGoalActivityRhythm(row.rhythm as { kind: unknown; targetPerWeek?: unknown });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        rowRhythm = result.rhythm;
      }

      validated.push({ title: rowTitle, activityId: rowActivityId, completionRequirement: rowCompletion, rhythm: rowRhythm });
    }
    activitiesWithRhythm = validated;
  } else {
    // LEGACY_TEMPLATE -- byte-identical to every Goal-create request
    // before this ticket. No deterministic template exists for arbitrary
    // free text -- a Goal is never decomposed by guessing from its title.
    // templateCategory must be an explicit, valid choice or omitted
    // entirely (design section 17/29: an unmatched/omitted category means
    // the Goal persists with zero auto-generated activities, never a
    // forced/incorrect guess).
    let activities: ReturnType<typeof resolveGoalTemplateActivities> = [];
    if (body.templateCategory !== undefined && body.templateCategory !== null) {
      if (!isGoalTemplateCategory(body.templateCategory)) {
        return NextResponse.json({ error: 'templateCategory must be one of GET_FITTER, MEDITATE_REGULARLY, FINISH_PROJECT, STUDY_CONSISTENTLY.' }, { status: 400 });
      }
      activities = resolveGoalTemplateActivities(body.templateCategory);
    }

    // Goals V2 Rhythm R5 -- optional, additive, per-activity (this
    // ticket's own section 13 domain-truth decision: Rhythm belongs to
    // GoalActivity, never a single Goal-level frequency blindly copied
    // across every template activity). Omitted entirely means every
    // activity persists NONE -- identical to every Goal creation before
    // this ticket (section 42/50). When present, it must align 1:1 with
    // the resolved template activities (this ticket's own section 49 "no
    // partial GoalActivity write" -- a length mismatch or any single
    // invalid entry rejects the WHOLE request before anything is
    // persisted, never a partial/best-effort application). Only
    // meaningful alongside templateCategory -- "Start from scratch"
    // creates zero activities, so there is nothing to apply a rhythm to
    // (this ticket's own section 17).
    let activityRhythms: GoalActivityRhythm[] | null = null;
    if (body.activityRhythms !== undefined && body.activityRhythms !== null) {
      if (!Array.isArray(body.activityRhythms) || body.activityRhythms.length !== activities.length) {
        return NextResponse.json({ error: `activityRhythms must be an array with exactly ${activities.length} entries, matching the template's own activities.` }, { status: 400 });
      }
      const validated: GoalActivityRhythm[] = [];
      for (const candidate of body.activityRhythms) {
        if (typeof candidate !== 'object' || candidate === null) {
          return NextResponse.json({ error: 'Each activityRhythms entry must be an object with a kind field.' }, { status: 400 });
        }
        const result = validateGoalActivityRhythm(candidate as { kind: unknown; targetPerWeek?: unknown });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        validated.push(result.rhythm);
      }
      activityRhythms = validated;
    }
    activitiesWithRhythm = activities.map((activity, index) => ({ ...activity, rhythm: activityRhythms ? activityRhythms[index] : NONE_GOAL_ACTIVITY_RHYTHM }));
  }

  // Goals V2 Candidate B3.1 -- optional, additive (this ticket's own
  // section 14 rollout decision): omitted entirely preserves every
  // existing caller's exact current behavior (every test in this
  // repository that calls this route directly, plus any hypothetical
  // future caller that doesn't yet send one), including a fresh
  // randomUUID() Goal id and zero idempotency protection. Only a client
  // that explicitly supplies clientRequestId opts into protection -- the
  // production B2 client (GoalsListClient.tsx) always does.
  let clientRequestId: string | null = null;
  if (body.clientRequestId !== undefined && body.clientRequestId !== null) {
    if (typeof body.clientRequestId !== 'string' || !body.clientRequestId.trim() || body.clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH) {
      return NextResponse.json({ error: 'clientRequestId must be a non-blank string.' }, { status: 400 });
    }
    clientRequestId = body.clientRequestId;
  }

  if (!clientRequestId) {
    const { goal, activities: created } = await createGoalWithActivities({ userId: session.userId, title, targetDate, activities: activitiesWithRhythm });
    return NextResponse.json({ goal, activities: created });
  }

  const idempotentGoalId = deriveIdempotentGoalId(session.userId, clientRequestId);
  try {
    const { goal, activities: created } = await createGoalWithActivities({ userId: session.userId, title, targetDate, activities: activitiesWithRhythm, id: idempotentGoalId });
    return NextResponse.json({ goal, activities: created });
  } catch (err) {
    // This ticket's own sections 8/10/16/17 -- a concurrent OR earlier
    // identical clientRequestId already won this exact deterministic id;
    // Postgres's own primary-key uniqueness is what actually guarantees
    // "exactly one Goal" under real concurrency (not an app-level
    // check-then-insert, which would itself race). Re-fetch and decide
    // replay vs. conflict from the real, already-committed state.
    const pgError = err as { code?: string };
    if (pgError.code !== '23505') throw err;

    const existingGoal = await getGoalForUser(session.userId, idempotentGoalId);
    if (!existingGoal) throw err; // genuinely unexpected (e.g. a real id collision) -- never swallowed

    const existingActivityRows = await listGoalActivitiesWithLinkedPlanStatus(session.userId, idempotentGoalId);
    const existingActivities = existingActivityRows.map((row) => ({
      title: row.title,
      activityId: row.activityId,
      completionRequirement: normalizeGoalActivityCompletionRequirement({ completionKind: row.completionKind, completionTargetValue: row.completionTargetValue, completionUnit: row.completionUnit }),
      rhythm: normalizeGoalActivityRhythm({ rhythmKind: row.rhythmKind, rhythmTargetPerWeek: row.rhythmTargetPerWeek }),
    }));

    // This ticket's own section 9/18 -- a materially different request
    // reusing the same (userId, clientRequestId) fails closed: never a
    // second Goal, never a silent mutation of the first.
    if (!goalCreateRequestMatchesExisting({ title, targetDate, activities: activitiesWithRhythm }, { title: existingGoal.title, targetDate: existingGoal.targetDate, activities: existingActivities })) {
      return NextResponse.json({ error: 'A different Goal-create request already used this clientRequestId.', code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 });
    }

    // Genuine idempotent replay -- the exact same logical request,
    // zero new write. Response shape is identical to a fresh creation
    // (no "replayed" marker) -- the client treats both identically.
    const replayedActivities = existingActivityRows.map(({ linkedPlanStatus, currentValue, ...activity }) => activity);
    return NextResponse.json({ goal: existingGoal, activities: replayedActivities });
  }
}
