import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { resolveTzOffsetMinutes } from '../../../../lib/timezone';
import { buildPersonalMuhurtaContextForUser } from '../../../../lib/natalContext';
import { buildDailyBriefing } from '../../../../../../packages/recommendation/src/dailyAssistant';

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const now = new Date();
  const briefing = buildDailyBriefing({
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
  });

  // Home Good Right Now Personalization V1 -- the SAME derived
  // {natalNakshatraIndex, janmaNakshatra, janmaRashi, moonElement} shape
  // buildPersonalMuhurtaContextForUser() already produces for Ask Aura/
  // Timing Search/Day Builder (apps/web/lib/natalContext.ts), reused
  // verbatim here rather than a second Home-specific natal DTO. Never the
  // raw birthDate/birthTime/birthTimezone -- those never leave the server
  // for this feature (data minimization, matching every other consumer of
  // this same helper). Naturally `undefined` (omitted from the JSON body)
  // when the owner's birth profile is incomplete -- no error, no special
  // casing, exactly buildPersonalMuhurtaContextForUser's own existing
  // contract.
  const personalContext = buildPersonalMuhurtaContextForUser(user);

  return NextResponse.json({ ...briefing, personalContext });
}
