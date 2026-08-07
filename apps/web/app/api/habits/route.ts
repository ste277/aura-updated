import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { createHabit, listHabits } from '../../../lib/db';

const VALID_CATEGORIES = ['WORKOUT', 'MEAL', 'MICRO_BREAK', 'FOCUS', 'REST'];
const VALID_WINDOWS = ['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'GULIKA', 'YAMA', 'NEUTRAL'];

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const habits = await listHabits(session.userId);
  return NextResponse.json(habits);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const { title, category, targetWindowType } = await req.json();

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return NextResponse.json({ error: 'A habit title is required.' }, { status: 400 });
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `category must be one of ${VALID_CATEGORIES.join(', ')}` }, { status: 400 });
  }
  if (!VALID_WINDOWS.includes(targetWindowType)) {
    return NextResponse.json({ error: `targetWindowType must be one of ${VALID_WINDOWS.join(', ')}` }, { status: 400 });
  }

  const habit = await createHabit({ userId: session.userId, title: title.trim(), category, targetWindowType });
  return NextResponse.json(habit);
}
