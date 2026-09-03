import { deriveNextMeaningfulThing } from '../apps/web/lib/nextMeaningfulThing';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import type { AuraUpdate } from '../apps/web/lib/auraUpdates';
import type { AuraReminder } from '../apps/web/lib/auraReminders';
import type { PlannedActivity } from '../apps/web/lib/db';

/**
 * Home cleanup (Daily Reflection & Tomorrow Preview V1 follow-up, brief
 * section 6/7) -- deriveNextMeaningfulThing() itself is explicitly
 * UNCHANGED by this cleanup (only which of its outcomes render a
 * standalone Home card changed). These prove its tiered priority --
 * actionable Moment update > Starting Soon > next agenda item -- is
 * exactly what it was before, so "Starting Soon behavior remains
 * unchanged" and "actionable Moment update priority remains unchanged"
 * (brief section 13 test list items 6/7) hold.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24';
const NOW = new Date('2026-08-24T12:00:00.000Z');

function auraUpdate(overrides: Partial<AuraUpdate> = {}): AuraUpdate {
  return {
    id: 'moment-token-1',
    type: 'MOMENT_ACCEPTED',
    momentToken: 'moment-token-1',
    activityTitle: 'Date Night',
    recipientDisplayName: 'Anu',
    eventStartAt: '2026-08-24T14:00:00.000Z',
    occurredAt: '2026-08-24T10:00:00.000Z',
    requiresAction: false,
    unread: true,
    ...overrides,
  };
}

function reminder(overrides: Partial<AuraReminder> = {}): AuraReminder {
  return {
    id: 'PLANNED_ACTIVITY:plan-1',
    type: 'PLAN_APPROACHING',
    scheduledItemType: 'PLANNED_ACTIVITY',
    scheduledItemId: 'plan-1',
    activityTitle: 'Deep Work',
    activityIcon: '💼',
    startAt: '2026-08-24T12:20:00.000Z',
    endAt: '2026-08-24T13:00:00.000Z',
    timezone: TZ,
    reminderAt: '2026-08-24T12:05:00.000Z',
    minutesUntilStart: 20,
    target: { type: 'PLAN', planId: 'plan-1' },
    ...overrides,
  };
}

function plan(overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id: 'plan-1', userId: 'user-1', title: 'Study · Learning', activityType: 'learning', icon: '📚',
    status: 'UPCOMING', plannedStartAt: new Date('2026-08-24T14:00:00.000Z'), plannedEndAt: new Date('2026-08-24T15:00:00.000Z'),
    durationMinutes: 60, windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', matchLabel: 'Good Match', score: 70,
    recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null,
    createdAt: new Date('2026-08-24T00:00:00.000Z'), updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  };
}

function agendaWithNextItem() {
  return buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [plan()], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
}

// ============================================================
// Tier 1 (actionable Moment update) wins over everything else
// ============================================================
{
  const result = deriveNextMeaningfulThing({ topMomentUpdate: auraUpdate(), startingSoonReminder: reminder(), agenda: agendaWithNextItem() });
  check('An actionable Moment update always wins, even with a Starting Soon reminder and a next agenda item present', result?.kind === 'MOMENT_UPDATE');
}

// ============================================================
// Tier 2 (Starting Soon) wins over the plain next agenda item
// ============================================================
{
  const result = deriveNextMeaningfulThing({ topMomentUpdate: undefined, startingSoonReminder: reminder(), agenda: agendaWithNextItem() });
  check('A Starting Soon reminder wins over a plain next agenda item when no Moment update is actionable', result?.kind === 'STARTING_SOON');
}

// ============================================================
// Tier 3 (agenda item) is the fallback when nothing else applies
// ============================================================
{
  const result = deriveNextMeaningfulThing({ topMomentUpdate: undefined, startingSoonReminder: undefined, agenda: agendaWithNextItem() });
  check('The next agenda item is the fallback tier when no Moment update or Starting Soon reminder exists', result?.kind === 'AGENDA_ITEM');
  check('The AGENDA_ITEM result carries the exact same item as agenda.nextItem (no recomputation)', result?.kind === 'AGENDA_ITEM' && result.item.id === agendaWithNextItem().nextItem?.id);
}

// ============================================================
// Nothing at any tier -> null
// ============================================================
{
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveNextMeaningfulThing({ topMomentUpdate: undefined, startingSoonReminder: undefined, agenda: emptyAgenda });
  check('Nothing at any tier -> null (Home renders no standalone card, and Your Day shows its own empty state)', result === null);
}

if (!allPassed) {
  console.error('\nSome next-meaningful-thing checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL NEXT MEANINGFUL THING CHECKS PASSED');
}
