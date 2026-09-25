import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { parseJsonObject } from '../../../../../lib/request';
import { acceptRemainingDayRecomposition } from '../../../../../lib/remainingDayRecompositionAcceptance';

/**
 * Remaining-Day Recomposition V1 PR F3 -- explicit, atomic acceptance of ONE server-signed proposal.
 * Body: `{ proposalToken }` and nothing else is ever read -- plan ids, slots, decisions, timezone and target date come
 * only from the verified token. No clock is read here: acceptance judges time against a `clock_timestamp()` read
 * INSIDE the transaction after its locks (lock-wait time counts).
 *   200 ACCEPTED / ALREADY_ACCEPTED   the whole proposal is (now) applied; response carries source -> successor mappings
 *   400 INVALID_TOKEN                 the token cannot be trusted (generic failure)
 *   409 STALE                         genuine token, world changed -> `reason`; nothing was written, ask for a fresh proposal
 *   401 unauthenticated, 500 SAVE_FAILED (rolled back; no internals leaked)
 */
export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const body = await parseJsonObject(req);
  const result = await acceptRemainingDayRecomposition(session.userId, body?.proposalToken);
  switch (result.status) {
    case 'ACCEPTED':
    case 'ALREADY_ACCEPTED':
      return NextResponse.json(result);
    case 'INVALID_TOKEN':
      return NextResponse.json(result, { status: 400 });
    case 'STALE':
      return NextResponse.json(result, { status: 409 });
    case 'SAVE_FAILED':
      return NextResponse.json(result, { status: 500 });
  }
}
