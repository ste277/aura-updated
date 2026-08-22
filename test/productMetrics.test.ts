import {
  computeFunnelMetrics,
  countByGroupForEvent,
  isMetricsTimeWindow,
  percentile,
  rate,
  totalCountForEvent,
  windowStart,
  type FunnelMetricsInput,
} from '../apps/web/lib/productMetrics';
import type { ProductEventCountRow } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Time windows
// ============================================================

check('isMetricsTimeWindow accepts 24h/7d/30d', ['24h', '7d', '30d'].every(isMetricsTimeWindow));
check('isMetricsTimeWindow rejects an unsupported window', isMetricsTimeWindow('90d') === false);

const now = new Date('2026-08-22T12:00:00.000Z');
check('windowStart(24h) is exactly 24 hours before now', now.getTime() - windowStart('24h', now).getTime() === 24 * 60 * 60 * 1000);
check('windowStart(7d) is exactly 7 days before now', now.getTime() - windowStart('7d', now).getTime() === 7 * 24 * 60 * 60 * 1000);
check('windowStart(30d) is exactly 30 days before now', now.getTime() - windowStart('30d', now).getTime() === 30 * 24 * 60 * 60 * 1000);

// ============================================================
// percentile -- nearest-rank
// ============================================================

check('percentile of an empty array is null (no data, not a misleading 0)', percentile([], 0.5) === null);
check('percentile(50) of [1,2,3,4] is 2', percentile([1, 2, 3, 4], 0.5) === 2);
check('percentile is order-independent (unsorted input)', percentile([4, 1, 3, 2], 0.5) === 2);
check('percentile(95) of 1..100 is 95', percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95) === 95);
check('percentile(100) returns the max value', percentile([10, 30, 20], 1) === 30);

// ============================================================
// rate -- null (not 0) on a zero denominator
// ============================================================

check('rate(0, 0) is null, not 0 -- "no data" is distinct from "0% conversion"', rate(0, 0) === null);
check('rate(1, 0) is null', rate(1, 0) === null);
check('rate(1, 4) is 0.25', rate(1, 4) === 0.25);
check('rate(0, 4) is 0 (genuinely zero conversion, valid distinct case)', rate(0, 4) === 0);

// ============================================================
// Grouped-count row helpers
// ============================================================

const rows: ProductEventCountRow[] = [
  { eventName: 'MUHURTHAM_SEARCH_COMPLETED', group: 'GENERAL', count: 5 },
  { eventName: 'MUHURTHAM_SEARCH_COMPLETED', group: 'PERSONAL', count: 2 },
  { eventName: 'MUHURTHAM_SEARCH_COMPLETED', group: 'SHARED', count: 3 },
  { eventName: 'AURA_HOME_VIEWED', group: null, count: 10 },
];

check('totalCountForEvent sums across all groups (including null-group rows)', totalCountForEvent(rows, 'MUHURTHAM_SEARCH_COMPLETED') === 10);
check('totalCountForEvent handles a null-group-only event', totalCountForEvent(rows, 'AURA_HOME_VIEWED') === 10);
check('totalCountForEvent is 0 for an event with no rows', totalCountForEvent(rows, 'PLAN_STARTED') === 0);

const byScope = countByGroupForEvent(rows, 'MUHURTHAM_SEARCH_COMPLETED');
check('countByGroupForEvent breaks totals down per group', byScope.GENERAL === 5 && byScope.PERSONAL === 2 && byScope.SHARED === 3);
check('countByGroupForEvent excludes null-group rows from the breakdown', Object.keys(countByGroupForEvent(rows, 'AURA_HOME_VIEWED')).length === 0);

// ============================================================
// Funnel metrics (A-J) -- computed purely from already-fetched counts
// ============================================================

const funnelInput: FunnelMetricsInput = {
  planStartedUsers: 20,
  planSearchCompletedUsers: 10,
  muhurthamSearchCompletedTotal: 10,
  muhurthamSearchCompletedByScope: { GENERAL: 4, PERSONAL: 2, SHARED: 4 },
  momentsCreated: 4,
  momentsShareInitiated: 3,
  momentsOpened: 2,
  momentsAccepted: 1,
  momentsAnotherTime: 1,
  momentsResponded: 2,
  momentsAlternativeCreated: 1,
  momentsFindYourOwnClicked: 1,
};
const funnel = computeFunnelMetrics(funnelInput);

check('A: Plan activation = completed/started', funnel.planActivationRate === 0.5);
check('B: Personalization rate = (PERSONAL+SHARED)/total', funnel.personalizationRate === 0.6);
check('C: Shared adoption = SHARED/total', funnel.sharedAdoptionRate === 0.4);
check('D: Moment creation = created/SHARED searches', funnel.momentCreationRate === 1);
check('E: Share rate = shared/created', funnel.shareRate === 0.75);
check('F: Open rate = opened/shared', Math.abs((funnel.openRate ?? 0) - 2 / 3) < 1e-9);
check('G: Response rate = responded/opened', funnel.responseRate === 1);
check('H: Accept rate = accepted/responded', funnel.acceptRate === 0.5);
check('I: Rescheduling rate = alternativeCreated/anotherTime', funnel.reschedulingRate === 1);
check('J: Acquisition intent = findYourOwn/opened', funnel.acquisitionIntentRate === 0.5);

const emptyFunnel = computeFunnelMetrics({
  planStartedUsers: 0,
  planSearchCompletedUsers: 0,
  muhurthamSearchCompletedTotal: 0,
  muhurthamSearchCompletedByScope: {},
  momentsCreated: 0,
  momentsShareInitiated: 0,
  momentsOpened: 0,
  momentsAccepted: 0,
  momentsAnotherTime: 0,
  momentsResponded: 0,
  momentsAlternativeCreated: 0,
  momentsFindYourOwnClicked: 0,
});
check('Every funnel rate is null (not 0 or NaN) with zero data across the board', Object.values(emptyFunnel).every((v) => v === null));

console.log(allPassed ? '\nALL PRODUCT METRICS CHECKS PASSED' : '\nSOME PRODUCT METRICS CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
