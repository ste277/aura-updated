import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '../../../../lib/auth';
import { getUserById, recordVisit } from '../../../../lib/db';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ user: null });

  const session = verifySessionToken(token);
  if (!session) return NextResponse.json({ user: null });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ user: null });

  await recordVisit(user.id);

  return NextResponse.json({ user });
}
