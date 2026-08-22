import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { getAuraMomentByToken } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { recordProductEvent } from '../../../lib/productEvents';

/**
 * Product Instrumentation V1 -- the CLIENT-side tracking endpoint, for the
 * "STARTED"/"VIEWED"/"SELECTED"-style UI intent signals that have no
 * reliable server-side equivalent (see lib/productEvents.ts's
 * CLIENT_TRACKED_EVENTS). "COMPLETED"/"CREATED" outcome events are recorded
 * directly by the relevant route handler instead -- never routed through
 * here.
 *
 * Works both authenticated (the normal in-app case) and anonymous (the
 * public /moment/[token] page, e.g. AURA_MOMENT_FIND_YOUR_OWN_CLICKED) --
 * no session is required.
 *
 * A moment can be associated two ways:
 *   - `auraMomentId` (the internal id) -- trusted only from an
 *     AUTHENTICATED caller, since it is only ever handed to a client that
 *     is the moment's own owner (the create-moment response).
 *   - `momentToken` (the PUBLIC token) -- accepted from anonymous callers
 *     and resolved server-side to the internal id here. The token itself
 *     is never stored (brief section 3: auraMomentId, never the public
 *     token).
 */
export async function POST(req: NextRequest) {
  const body = await parseJsonObject(req);
  if (!body || typeof body.eventName !== 'string') {
    return NextResponse.json({ error: 'A valid JSON body with an eventName is required.' }, { status: 400 });
  }

  const session = getSessionFromRequest(req);

  let auraMomentId: string | null = null;
  if (typeof body.momentToken === 'string' && body.momentToken.length > 0) {
    const moment = await getAuraMomentByToken(body.momentToken);
    auraMomentId = moment?.id ?? null;
  } else if (session && typeof body.auraMomentId === 'string' && body.auraMomentId.length > 0) {
    auraMomentId = body.auraMomentId;
  }

  const result = await recordProductEvent({
    eventName: body.eventName,
    userId: session?.userId ?? null,
    auraMomentId,
    metadata: body.metadata,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return new NextResponse(null, { status: 204 });
}
