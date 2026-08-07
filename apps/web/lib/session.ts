import { NextRequest } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME, SessionPayload } from './auth';

export function getSessionFromRequest(req: NextRequest): SessionPayload | null {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
