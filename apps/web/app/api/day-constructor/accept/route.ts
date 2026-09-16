import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { parseJsonObject } from '../../../../lib/request';
import { persistAcceptedConstructedDay, MAX_CLIENT_REQUEST_ID_LENGTH, MAX_INTENT_ID_LENGTH } from '../../../../lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../../../../lib/dayConstructorAcceptance';
import type { ConstructionWindowSource } from '../../../../lib/dayIntent';

/**
 * Day Constructor V1 PR E2 -- the sole write boundary for accepting a
 * reviewed `ConstructDayPreview`. Deliberately thin: authenticate, parse
 * the raw JSON body into a well-typed `AcceptConstructedDayRequest`, read
 * the authoritative clock ONCE, and delegate every actual decision to
 * `persistAcceptedConstructedDay` (dayConstructorAcceptancePersistence.ts)
 * -- which itself only ever calls PR E1's own unmodified
 * `evaluateAcceptance` to decide acceptability. This route makes no
 * acceptance decisions of its own.
 */

const VALID_WINDOW_SOURCES = new Set<ConstructionWindowSource>(['REMAINING_TODAY', 'EXPLICIT_RANGE']);
const VALID_PLACEMENT_SOURCES = new Set(['FIXED_CONSTRAINT', 'SELECTED_CANDIDATE']);

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseConstructionWindow(value: unknown): AcceptConstructedDayRequest['constructionWindow'] | null {
  if (!value || typeof value !== 'object') return null;
  const w = value as Record<string, unknown>;
  if (typeof w.date !== 'string' || typeof w.timezone !== 'string') return null;
  const start = parseDate(w.start);
  const end = parseDate(w.end);
  if (!start || !end) return null;
  if (typeof w.source !== 'string' || !VALID_WINDOW_SOURCES.has(w.source as ConstructionWindowSource)) return null;
  return { date: w.date, start, end, timezone: w.timezone, source: w.source as ConstructionWindowSource };
}

function parseProposedItem(value: unknown): AcceptedProposedItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.intentId !== 'string' || !item.intentId || item.intentId.length > MAX_INTENT_ID_LENGTH) return null;
  if (typeof item.title !== 'string') return null;
  const start = parseDate(item.start);
  const end = parseDate(item.end);
  if (!start || !end) return null;
  if (typeof item.placementSource !== 'string' || !VALID_PLACEMENT_SOURCES.has(item.placementSource)) return null;
  if (item.activityId !== undefined && typeof item.activityId !== 'string') return null;
  return {
    intentId: item.intentId,
    activityId: typeof item.activityId === 'string' ? item.activityId : undefined,
    title: item.title,
    start,
    end,
    placementSource: item.placementSource as AcceptedProposedItem['placementSource'],
  };
}

function parseAcceptRequest(body: Record<string, unknown>): AcceptConstructedDayRequest | null {
  if (typeof body.clientRequestId !== 'string' || !body.clientRequestId || body.clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH) return null;
  const constructionWindow = parseConstructionWindow(body.constructionWindow);
  if (!constructionWindow) return null;
  if (!Array.isArray(body.proposedItems)) return null;
  const proposedItems: AcceptedProposedItem[] = [];
  for (const raw of body.proposedItems) {
    const item = parseProposedItem(raw);
    if (!item) return null;
    proposedItems.push(item);
  }
  return { clientRequestId: body.clientRequestId, constructionWindow, proposedItems };
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const request = parseAcceptRequest(body);
  if (!request) return NextResponse.json({ error: 'A valid Day Constructor acceptance request is required.' }, { status: 400 });

  // Authoritative clock -- read EXACTLY ONCE, at this outer boundary, then
  // threaded through everything downstream (this ticket's own section 14).
  const now = new Date();

  const result = await persistAcceptedConstructedDay(session.userId, request, now);

  switch (result.status) {
    case 'SAVED':
      return NextResponse.json({ status: 'SAVED', plans: result.plans });
    case 'ALREADY_ACCEPTED':
      return NextResponse.json({ status: 'ALREADY_ACCEPTED', plans: result.plans });
    case 'REJECTED':
      return NextResponse.json({ status: 'REJECTED', reason: result.reason, diagnostics: result.diagnostics });
    case 'IDEMPOTENCY_CONFLICT':
      return NextResponse.json({ status: 'IDEMPOTENCY_CONFLICT' });
    case 'SAVE_FAILED':
      // Never leak internals (stack traces, query text) -- this ticket's
      // own section 16.
      return NextResponse.json({ status: 'SAVE_FAILED' }, { status: 500 });
  }
}
