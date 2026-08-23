import { NextRequest, NextResponse } from 'next/server';
import { getUserById } from '../../../lib/db';
import { getSessionFromRequest } from '../../../lib/session';
import { parseJsonObject } from '../../../lib/request';
import { resolveTzOffsetMinutes } from '../../../lib/timezone';
import { buildPersonalMuhurtaContextForUser } from '../../../lib/natalContext';
import { DailyAssistantContext } from '../../../../../packages/recommendation/src/dailyAssistant';
import { parseAskAuraRequest, parseFollowUpChange, ParsedAskAuraRequest } from '../../../../../packages/recommendation/src/askAuraIntent';
import { orchestrateAskAura } from '../../../lib/askAuraOrchestrator';
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
  // only a change to the previous turn's fields.
  const followUpChange = previous ? parseFollowUpChange(prompt, previous) : null;
  const parsed = followUpChange ?? parseAskAuraRequest(prompt, { now, previous });

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

  const response = await orchestrateAskAura(parsed, { userId: session.userId, context, activeWindow });
  return NextResponse.json(response);
}

function isParsedAskAuraRequest(value: unknown): value is ParsedAskAuraRequest {
  return Boolean(value) && typeof value === 'object' && typeof (value as { intent?: unknown }).intent === 'string';
}
