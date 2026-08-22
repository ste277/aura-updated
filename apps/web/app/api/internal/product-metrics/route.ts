import { NextRequest, NextResponse } from 'next/server';
import {
  countDistinctMomentsForAnyEventSince,
  countDistinctMomentsForEventSince,
  countDistinctUsersForEventSince,
  listProductEventCountsSince,
  listProductEventDurationsSince,
} from '../../../../lib/db';
import {
  computeFunnelMetrics,
  countByGroupForEvent,
  isMetricsTimeWindow,
  percentile,
  totalCountForEvent,
  windowStart,
  type MetricsTimeWindow,
} from '../../../../lib/productMetrics';

/**
 * Product Instrumentation V1 -- developer-only internal metrics API.
 *
 * Deliberately an API, not an HTML page: this app has no admin/role system,
 * so gating a whole page would mean building one just for this. Gated by a
 * shared secret compared in a request header, fail-closed like AUTH_SECRET
 * (lib/auth.ts) -- a missing or mismatched secret returns 404, not 401, so
 * the route's existence isn't revealed to an unauthenticated prober.
 *
 * No astrology-correlated breakdowns exist here (brief section 14 -- e.g.
 * never "Rohini users share more often"): every grouping is by scope, mode,
 * or event name only.
 */

// Force per-request execution -- this is a secret-gated, time-windowed
// endpoint (auth check + `?window=` both must be re-evaluated on every call),
// not a fixed response Next should ever be allowed to statically cache.
export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_METRICS_SECRET;
  if (!secret) return false;
  const provided = req.headers.get('x-internal-metrics-secret');
  return provided === secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const windowParam = req.nextUrl.searchParams.get('window') ?? '7d';
  const window: MetricsTimeWindow = isMetricsTimeWindow(windowParam) ? windowParam : '7d';
  const since = windowStart(window);

  const [
    scopeCounts,
    planSearchDurationsByMode,
    muhurthamSearchDurationsByScope,
    planStartedUsers,
    planSearchCompletedUsers,
    momentsCreated,
    momentsShareInitiated,
    momentsOpened,
    momentsAccepted,
    momentsAnotherTime,
    momentsResponded,
    momentsAlternativeCreated,
    momentsFindYourOwnClicked,
  ] = await Promise.all([
    listProductEventCountsSince(since, 'scope'),
    listProductEventDurationsSince('PLAN_SEARCH_COMPLETED', since, 'mode'),
    listProductEventDurationsSince('MUHURTHAM_SEARCH_COMPLETED', since, 'scope'),
    countDistinctUsersForEventSince('PLAN_STARTED', since),
    countDistinctUsersForEventSince('PLAN_SEARCH_COMPLETED', since),
    countDistinctMomentsForEventSince('AURA_MOMENT_CREATED', since),
    countDistinctMomentsForEventSince('AURA_MOMENT_SHARE_INITIATED', since),
    countDistinctMomentsForEventSince('AURA_MOMENT_OPENED', since),
    countDistinctMomentsForEventSince('AURA_MOMENT_ACCEPTED', since),
    countDistinctMomentsForEventSince('AURA_MOMENT_ANOTHER_TIME', since),
    countDistinctMomentsForAnyEventSince(['AURA_MOMENT_ACCEPTED', 'AURA_MOMENT_ANOTHER_TIME'], since),
    countDistinctMomentsForEventSince('AURA_MOMENT_ALTERNATIVE_CREATED', since),
    countDistinctMomentsForEventSince('AURA_MOMENT_FIND_YOUR_OWN_CLICKED', since),
  ]);

  const muhurthamSearchCompletedTotal = totalCountForEvent(scopeCounts, 'MUHURTHAM_SEARCH_COMPLETED');
  const muhurthamSearchCompletedByScope = countByGroupForEvent(scopeCounts, 'MUHURTHAM_SEARCH_COMPLETED');

  const funnel = computeFunnelMetrics({
    planStartedUsers,
    planSearchCompletedUsers,
    muhurthamSearchCompletedTotal,
    muhurthamSearchCompletedByScope,
    momentsCreated,
    momentsShareInitiated,
    momentsOpened,
    momentsAccepted,
    momentsAnotherTime,
    momentsResponded,
    momentsAlternativeCreated,
    momentsFindYourOwnClicked,
  });

  const eventNames = Array.from(new Set(scopeCounts.map((r) => r.eventName))).sort();
  const volumeByEvent = Object.fromEntries(eventNames.map((name) => [name, totalCountForEvent(scopeCounts, name)]));

  return NextResponse.json({
    window,
    since: since.toISOString(),
    // Raw volume, total events regardless of who fired them or how many
    // times per user/moment -- distinct from the funnel's per-user/per-moment
    // denominators below.
    volumeByEvent,
    muhurthamSearchCompletedByScope,
    uniqueCounts: {
      planStartedUsers,
      planSearchCompletedUsers,
      momentsCreated,
      momentsShareInitiated,
      momentsOpened,
      momentsAccepted,
      momentsAnotherTime,
      momentsResponded,
      momentsAlternativeCreated,
      momentsFindYourOwnClicked,
    },
    funnel,
    performance: {
      planSearchCompleted: planSearchDurationsByMode.map((g) => ({
        mode: g.group,
        count: g.durationsMs.length,
        p50Ms: percentile(g.durationsMs, 0.5),
        p95Ms: percentile(g.durationsMs, 0.95),
      })),
      muhurthamSearchCompleted: muhurthamSearchDurationsByScope.map((g) => ({
        scope: g.group,
        count: g.durationsMs.length,
        p50Ms: percentile(g.durationsMs, 0.5),
        p95Ms: percentile(g.durationsMs, 0.95),
      })),
    },
  });
}
