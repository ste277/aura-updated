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

  // Onboarding V1 PR 2 -- the one place `isFirstSession` is ever computed:
  // whether this user had no VisitLog row before THIS call recorded one (see
  // recordVisit's own doc comment). Returned alongside `user` so the client
  // can decide, once per page load, whether to show the Welcome journey --
  // never re-derived from locationConfirmedAt or the presence/absence of any
  // other feature data.
  const { isFirstVisitEver } = await recordVisit(user.id);

  return NextResponse.json({ user, isFirstSession: isFirstVisitEver });
}
