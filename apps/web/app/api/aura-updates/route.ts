import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { listMomentIdsWithSuccessorForOwner, listRecentRespondedAuraMomentsForOwner } from '../../../lib/db';
import { summarizeAuraUpdates } from '../../../lib/auraUpdates';

/**
 * Authenticated only -- returns the current user's own actionable/recent
 * moment updates, derived on the fly from AuraMoment (brief section 3: no
 * generic notifications table). This is ordinary database retrieval (brief
 * section 17): no Panchang/Muhurta/natal/Shared Fit computation happens
 * anywhere in this path.
 */

/** The DB query's own cap -- deliberately higher than
 * auraUpdates.ts's API_UPDATE_DISPLAY_LIMIT so unreadCount stays accurate
 * even when more responses exist than the display list shows. */
const RECENT_MOMENT_QUERY_LIMIT = 50;

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const [moments, momentIdsWithSuccessor] = await Promise.all([
    listRecentRespondedAuraMomentsForOwner(session.userId, RECENT_MOMENT_QUERY_LIMIT),
    listMomentIdsWithSuccessorForOwner(session.userId),
  ]);

  return NextResponse.json(summarizeAuraUpdates(moments, momentIdsWithSuccessor));
}
