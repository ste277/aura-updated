import { NextRequest, NextResponse } from 'next/server';
import { getDailyReflection, upsertDailyReflection } from '../../../../lib/db';
import { getSessionFromRequest } from '../../../../lib/session';
import { parseJsonObject } from '../../../../lib/request';

const OUTPUT_LEVELS = new Set(['LOW', 'MODERATE', 'PEAK_FLOW']);

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const date = getReflectionDate(req.nextUrl.searchParams.get('date'));
  const reflection = await getDailyReflection(session.userId, date);
  return NextResponse.json(reflection);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const outputLevel = String(body?.outputLevel || '').toUpperCase();
  if (!OUTPUT_LEVELS.has(outputLevel)) {
    return NextResponse.json({ error: 'Invalid output level.' }, { status: 400 });
  }

  const reflection = await upsertDailyReflection({
    userId: session.userId,
    reflectionDate: getReflectionDate(typeof body?.date === 'string' ? body.date : null),
    outputLevel: outputLevel as 'LOW' | 'MODERATE' | 'PEAK_FLOW',
    followedGuidance: Boolean(body?.followedGuidance),
    notes: body?.notes ? String(body.notes).trim() : undefined,
  });

  return NextResponse.json(reflection);
}

function getReflectionDate(rawDate?: string | null): Date {
  const dateKey = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : new Date().toISOString().slice(0, 10);
  return new Date(`${dateKey}T00:00:00.000Z`);
}
