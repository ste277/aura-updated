/**
 * Opportunity Scarcity V1 -- O2: real, user-scoped wiring for
 * `OpportunityRangeDeps` (opportunityRangeAdapter.ts), kept in its own
 * leaf module so the adapter core stays free of any database import.
 *
 * Both loaders are scoped to the authenticated `user` by construction --
 * the same scoped reads the constructor's own real wiring uses -- so no
 * client-supplied availability or blocker list can reach the adapter.
 * Read-only.
 */

import { listPlannedActivitiesOverlappingRange, listUserAvailabilityPeriods, type User } from './db';
import type { AvailabilityConfiguration } from './availabilityContext';
import type { OpportunityRangeDeps } from './opportunityRangeAdapter';

export function createRealOpportunityRangeDeps(user: User): OpportunityRangeDeps {
  return {
    loadAvailabilityConfiguration: async () => {
      const periods = await listUserAvailabilityPeriods(user.id);
      return {
        configured: user.availabilityConfigured === true,
        periods: periods.map((row) => ({ weekday: row.weekday as AvailabilityConfiguration['periods'][number]['weekday'], startTime: row.startTime, endTime: row.endTime })),
      };
    },
    loadPlansOverlappingRange: async (bounds) => {
      const plans = await listPlannedActivitiesOverlappingRange(user.id, bounds.from, bounds.to);
      return plans.map((plan) => ({ start: new Date(plan.plannedStartAt), end: new Date(plan.plannedEndAt), status: plan.status }));
    },
  };
}
