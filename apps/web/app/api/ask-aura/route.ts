import { NextRequest, NextResponse } from 'next/server';
import { getUserById } from '../../../lib/db';
import { getSessionFromRequest } from '../../../lib/session';
import { parseJsonObject } from '../../../lib/request';
import { resolveTzOffsetMinutes } from '../../../lib/timezone';
import { buildPersonalMuhurtaContextForUser } from '../../../lib/natalContext';
import { DailyAssistantContext } from '../../../../../packages/recommendation/src/dailyAssistant';
import { extractLocationQuery, parseAskAuraRequest, parseFollowUpChange, ParsedAskAuraRequest } from '../../../../../packages/recommendation/src/askAuraIntent';
import { findActivityIntent } from '../../../../../packages/recommendation/src/personalizedTasks';
import { isSupportedMuhurthamActivity } from '../../../../../packages/recommendation/src/muhurthamFinder';
import { orchestrateAskAura, resolveEventLocationQuery } from '../../../lib/askAuraOrchestrator';
import { recordProductEvent } from '../../../lib/productEvents';

export const runtime = 'nodejs';

/**
 * Ask Aura Orchestration V1 -- this route no longer contains any parsing
 * or scoring logic of its own (brief section 6). It is a thin HTTP wrapper:
 * resolve the session user's DailyAssistantContext (the same pattern every
 * other search route in this app already follows -- see
 * /api/timing-search/route.ts), parse the prompt into a ParsedAskAuraRequest
 * (packages/recommendation/src/askAuraIntent.ts, pure/deterministic), then
 * orchestrate it into an AskAuraResponse (apps/web/lib/askAuraOrchestrator.ts,
 * which only ever calls EXISTING domain entry points). No LLM -- the prior
 * Gemini fallback path is removed; UNKNOWN/low-confidence prompts now
 * return a structured CLARIFICATION response instead (brief section 19/20).
 */

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return NextResponse.json({ error: 'Prompt is required.' }, { status: 400 });
  if (prompt.length > 400) return NextResponse.json({ error: 'Prompt is too long.' }, { status: 400 });

  const activeWindow = typeof body.activeWindow === 'string' && body.activeWindow ? body.activeWindow : 'NEUTRAL';
  // Structured continuity only (brief section 15: "a small structured
  // conversation context", never raw chat history as product state) -- the
  // client echoes back exactly the `context` field the PREVIOUS response
  // returned, nothing else.
  const previous = isParsedAskAuraRequest(body.previousContext) ? body.previousContext : undefined;

  void recordProductEvent({ eventName: 'ASK_AURA_SUBMITTED', userId: session.userId });

  const now = new Date();

  // Ask Aura Event Location V1 -- resolved BEFORE the main parse (brief
  // section 10) so weekday/absolute-date text ("next Friday") is
  // interpreted in the STATED location's own local calendar, not always
  // the caller's Timing Location -- the same requirement PR #67's early-
  // bound weekday/implicit-year date handling already established for
  // Timing Location. Pre-parse resolution is possible with a single parse
  // call (no async two-pass re-parsing) precisely because this lookup is a
  // synchronous, in-memory CITY_OPTIONS scan, never a remote geocoding
  // round-trip.
  const preParseLocationQuery = extractLocationQuery(prompt);
  const preParseEventLocation = preParseLocationQuery ? resolveEventLocationQuery(preParseLocationQuery) : undefined;

  // Ceremonial-only ceiling on the timezone gate itself (fix for the
  // "mixed context" bug: an everyday activity's temporal grammar must
  // NEVER be interpreted in the stated location's timezone, since the
  // everyday engines always execute against the caller's own Timing
  // Location -- resolving "tomorrow"/"next Friday" against a different
  // timezone than the one that will actually be searched is an invalid
  // mixed state, even though the final coordinates were always correct).
  // findActivityIntent() (personalizedTasks.ts) + isSupportedMuhurthamActivity()
  // (muhurthamFinder.ts) are the SAME two existing, exported, pure,
  // timezone-independent functions parseAskAuraRequest's own
  // buildMuhurthamSearchIfEligible() composes internally (resolveActivity()
  // there is just this same findActivityIntent() call plus a taskTitle
  // fallback that can never be Muhurtham-eligible anyway, since
  // isSupportedMuhurthamActivity() only ever recognizes a real catalog
  // activityId) -- reused here verbatim, pre-parse, rather than adding a
  // second capability list or duplicating any activity-resolution logic.
  const promptActivity = findActivityIntent(prompt);
  const promptTargetsCeremonialActivity = Boolean(promptActivity && isSupportedMuhurthamActivity(promptActivity.id));
  const useEventTimezoneForParse = Boolean(preParseEventLocation) && promptTargetsCeremonialActivity;
  // An unresolved "in X" on a ceremonial prompt still parses fine here --
  // it just means the following parseAskAuraRequest() call falls back to
  // the user's own timezone for date math, same as always; the fail-closed
  // "couldn't match that location" clarification only fires once
  // orchestrateAskAura() confirms the resolved activity is actually
  // Muhurtham-eligible (V1 is ceremonial-only -- brief section 1/2/13). An
  // "in X" on a non-ceremonial prompt has ZERO effect on parse timezone,
  // regardless of whether it resolves -- the location is never even looked
  // at for an everyday request.
  const parseTimezone = useEventTimezoneForParse ? preParseEventLocation!.timezone : user.timezone;

  const context: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: buildPersonalMuhurtaContextForUser(user),
  };

  // "What about morning?" style deltas are checked before the main parser
  // (brief section 16) -- they carry no independent intent of their own,
  // only a change to the previous turn's fields; parseFollowUpChange never
  // needs a timezone (see its own implementation), so it is unaffected by
  // parseTimezone above.
  const followUpChange = previous ? parseFollowUpChange(prompt, previous) : null;
  const parsed = followUpChange ?? parseAskAuraRequest(prompt, { now, timezone: parseTimezone, previous });

  // Resolved from the FINAL parsed.locationQuery, not the pre-parse
  // extraction above -- for a fresh parse these are always identical (the
  // same deterministic extractLocationQuery() over the same text), but for
  // a follow-up turn (followUpChange truthy) parsed.locationQuery may
  // instead be CARRIED OVER from the previous turn's own context (brief
  // section 29: "do not throw away the resolved Event Location
  // immediately") -- re-resolving here, rather than reusing
  // preParseEventLocation, keeps eventLocation always consistent with
  // whatever locationQuery actually ends up on this response's context,
  // so a carried-over location is never mistaken for an unresolved one.
  const eventLocation = parsed.locationQuery ? resolveEventLocationQuery(parsed.locationQuery) : undefined;

  void recordProductEvent({
    eventName: 'ASK_AURA_INTENT_RESOLVED',
    userId: session.userId,
    metadata: {
      intent: parsed.intent,
      ...(parsed.activityId ? { activityId: parsed.activityId } : {}),
      ...(parsed.scope ? { scope: parsed.scope } : {}),
      ...(parsed.horizonPhrase ? { horizon: parsed.horizonPhrase } : {}),
      ...(parsed.timePreference ? { timePreference: parsed.timePreference } : {}),
    },
  });

  const response = await orchestrateAskAura(parsed, { userId: session.userId, context, activeWindow, eventLocation });
  return NextResponse.json(response);
}

function isParsedAskAuraRequest(value: unknown): value is ParsedAskAuraRequest {
  return Boolean(value) && typeof value === 'object' && typeof (value as { intent?: unknown }).intent === 'string';
}
