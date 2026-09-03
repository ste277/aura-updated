import { buildDailyStory, resolveDailyStoryPhase, DailyStoryPersonalizationInput } from '../apps/web/lib/dailyStory';
import { buildDailyAgenda, DailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildDailyPriorityCoverage } from '../apps/web/lib/dayBuilder';
import { INTENTION_GROUPS, PEOPLE_SUBGROUPS, BROAD_CHOICES } from '../apps/web/lib/dailyIntentions';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import type { PlannedActivity } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24';

function emptyAgenda(now: Date): DailyAgenda {
  return buildDailyAgenda({ now, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
}

function plan(over: Partial<PlannedActivity> & { id: string; title: string; plannedStartAt: Date; plannedEndAt: Date }): PlannedActivity {
  return {
    userId: 'u', activityType: null, icon: null, status: 'UPCOMING',
    durationMinutes: Math.round((over.plannedEndAt.getTime() - over.plannedStartAt.getTime()) / 60000),
    windowType: 'NEUTRAL', windowLabel: null, matchLabel: null, score: null,
    recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null,
    createdAt: over.plannedStartAt, updatedAt: over.plannedStartAt,
    ...over,
  };
}

// ============================================================
// Section 10 -- day phase boundaries
// ============================================================
{
  check('04:59 -> NIGHT', resolveDailyStoryPhase(4 * 60 + 59) === 'NIGHT');
  check('05:00 -> MORNING', resolveDailyStoryPhase(5 * 60) === 'MORNING');
  check('11:59 -> MORNING', resolveDailyStoryPhase(11 * 60 + 59) === 'MORNING');
  check('12:00 -> MIDDAY', resolveDailyStoryPhase(12 * 60) === 'MIDDAY');
  check('13:59 -> MIDDAY', resolveDailyStoryPhase(13 * 60 + 59) === 'MIDDAY');
  check('14:00 -> AFTERNOON', resolveDailyStoryPhase(14 * 60) === 'AFTERNOON');
  check('16:59 -> AFTERNOON', resolveDailyStoryPhase(16 * 60 + 59) === 'AFTERNOON');
  check('17:00 -> EVENING', resolveDailyStoryPhase(17 * 60) === 'EVENING');
  check('20:59 -> EVENING', resolveDailyStoryPhase(20 * 60 + 59) === 'EVENING');
  check('21:00 -> NIGHT', resolveDailyStoryPhase(21 * 60) === 'NIGHT');
  check('00:00 -> NIGHT', resolveDailyStoryPhase(0) === 'NIGHT');
}

// ============================================================
// Section 52 -- deterministic story states
// ============================================================
{
  // Empty morning
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
  const story = buildDailyStory(emptyAgenda(now), 8 * 60);
  check('Empty morning -> MORNING phase', story.phase === 'MORNING');
  check('Empty morning -> has a primaryPrompt', story.primaryPrompt?.question === 'What would make today feel well spent?');
  // The 4 broad choices (Work/People/Self/Enjoyment) are a UI-level
  // constant (BROAD_CHOICES) rendered directly whenever primaryPrompt is
  // present -- DailyStory.suggestedIntentions is reserved for EVENING's
  // own specific contextual chips (tested below), not a duplicate of it.
  check('Empty morning -> suggestedIntentions is empty (broad choices come from BROAD_CHOICES, not DailyStory)', story.suggestedIntentions.length === 0);
  check('Empty morning narrative has no giant paragraph (under 200 chars)', story.narrative.length < 200);
}
{
  // Planned morning (one item)
  const now = new Date('2026-08-24T02:30:00.000Z');
  const agenda = buildDailyAgenda({
    now, localDate: LOCAL_DATE, timezone: TZ, momentIdsWithSuccessor: new Set(), habitLogs: [], moments: [],
    plans: [{
      id: 'p1', userId: 'u', title: 'Deep Work', activityType: 'deep-work', icon: '💼', status: 'UPCOMING',
      plannedStartAt: new Date('2026-08-24T05:00:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z'),
      durationMinutes: 60, windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', matchLabel: 'Good Match', score: 70,
      recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, createdAt: now, updatedAt: now,
    }],
  });
  const story = buildDailyStory(agenda, 8 * 60);
  check('One plan -> narrative mentions the plan title', story.narrative.includes('Deep Work'));
}
{
  // Recipient Conversion V1 Hardening (brief section 15) -- a newly-
  // converted user whose only Plan is an evening one (e.g. Date Night
  // saved via guest conversion) still gets a useful, non-empty My Day.
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
  const agenda = buildDailyAgenda({
    now, localDate: LOCAL_DATE, timezone: TZ, momentIdsWithSuccessor: new Set(), habitLogs: [], moments: [],
    plans: [{
      id: 'p1', userId: 'u', title: 'Date Night', activityType: 'date-night', icon: '❤️', status: 'UPCOMING',
      plannedStartAt: new Date('2026-08-24T14:00:00.000Z'), plannedEndAt: new Date('2026-08-24T16:00:00.000Z'), // 7:30-9:30 PM IST
      durationMinutes: 120, windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', matchLabel: 'Good Match', score: 70,
      recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, createdAt: now, updatedAt: now,
    }],
  });
  const story = buildDailyStory(agenda, 8 * 60);
  check('Single evening Plan -> narrative acknowledges it warmly', story.narrative.includes('Date Night') && story.narrative.toLowerCase().includes('look forward'));
  check('Single evening Plan -> narrative notes room earlier in the day', story.narrative.toLowerCase().includes('room earlier'));
  check('Single evening Plan -> still offers the well-spent prompt (morning/afternoon are open)', story.primaryPrompt?.question === 'What would make today feel well spent?');
}
{
  // Midday after completion
  const now = new Date('2026-08-24T07:00:00.000Z'); // 12:30 PM IST
  const agenda = buildDailyAgenda({
    now, localDate: LOCAL_DATE, timezone: TZ, momentIdsWithSuccessor: new Set(), moments: [], plans: [
      { id: 'p1', userId: 'u', title: 'Deep Work', activityType: 'deep-work', icon: '💼', status: 'LOGGED',
        plannedStartAt: new Date('2026-08-24T02:00:00.000Z'), plannedEndAt: new Date('2026-08-24T03:00:00.000Z'),
        durationMinutes: 60, windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', matchLabel: 'Good Match', score: 70,
        recommendation: null, calendarUrl: null, loggedAt: now, habitLogId: 'log-x', eventTimezone: null, eventLocationName: null, createdAt: now, updatedAt: now },
    ], habitLogs: [],
  });
  const story = buildDailyStory(agenda, 12 * 60 + 30);
  check('Midday after completion -> MIDDAY phase', story.phase === 'MIDDAY');
  check('Midday after completion -> headline references the completed item', story.headline.includes('Deep Work'));
}
{
  // Open evening
  const now = new Date('2026-08-24T13:00:00.000Z'); // 6:30 PM IST
  const story = buildDailyStory(emptyAgenda(now), 18 * 60 + 30);
  check('Open evening -> EVENING phase', story.phase === 'EVENING');
  check('Open evening -> suggests relationship/family/social/enjoyment intentions', story.suggestedIntentions.some((s) => s.groupId === 'RELATIONSHIPS'));
  check('Open evening -> never claims "you need" (invitational, not prescriptive)', !story.narrative.toLowerCase().includes('you need'));
}
{
  // Regression -- "Your evening is open" was shown even with several
  // evening Plans already added, because isEveningOpen() read .getHours()
  // directly (the SERVER PROCESS's own local timezone, UTC in production),
  // never the agenda's own configured timezone. Machine-independent proof:
  // a user in America/New_York (NOT this test machine's own local zone)
  // with a real 7pm New York Plan -- .getHours() on ANY machine whose own
  // local zone isn't America/New_York would compute the wrong hour for
  // this exact UTC instant, so this only passes if the fix genuinely reads
  // the Date in the AGENDA's timezone.
  const NY_TZ = 'America/New_York';
  const now = new Date('2026-08-24T22:00:00.000Z'); // 6:00 PM EDT (UTC-4) -- already EVENING locally
  const sevenPmNewYorkPlan = plan({
    id: 'ny-evening', title: 'Family Dinner',
    plannedStartAt: new Date('2026-08-24T23:00:00.000Z'), // 7:00 PM EDT -- still upcoming
    plannedEndAt: new Date('2026-08-25T00:30:00.000Z'),
  });
  const nyAgenda = buildDailyAgenda({ now, localDate: '2026-08-24', timezone: NY_TZ, plans: [sevenPmNewYorkPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const nyStory = buildDailyStory(nyAgenda, 18 * 60); // 6:00 PM local -- EVENING phase
  check('Fixture sanity: this lands in EVENING phase', nyStory.phase === 'EVENING');
  check(
    'A real 7pm New York evening Plan -> EVENING is correctly NOT reported as open (timezone-correct, not server-local)',
    nyStory.headline !== 'Your evening is open'
  );
}
{
  // Evening with a Moment
  const now = new Date('2026-08-24T13:00:00.000Z');
  const agenda = buildDailyAgenda({
    now, localDate: LOCAL_DATE, timezone: TZ, momentIdsWithSuccessor: new Set(), plans: [], habitLogs: [],
    moments: [{
      id: 'm1', ownerUserId: 'u', publicToken: 't', scope: 'SHARED', source: 'PLAN', activityId: 'date-night',
      activityTitle: 'Date Night', activityIcon: '❤️', startAt: new Date('2026-08-24T14:00:00.000Z'), endAt: new Date('2026-08-24T15:30:00.000Z'),
      timezone: TZ, locationName: null, savedPersonId: 'sp', sharedPersonDisplayName: 'Anu', senderDisplayName: 'Owner', ratingLabel: null,
      explanationSnapshot: null, status: 'ACTIVE', responseState: 'ACCEPTED', responsePreference: null, respondedAt: now,
      previousMomentId: null, plannedActivityId: null, ownerSeenResponseAt: null, firstOpenedAt: null, createdAt: now, expiresAt: null,
    }],
  });
  const story = buildDailyStory(agenda, 18 * 60 + 30);
  check('Evening with a confirmed Moment -> headline/narrative reflects it, not "open"', story.headline.includes('Date Night') || story.narrative.includes('Date Night'));
}
{
  // Night with completed items
  const now = new Date('2026-08-24T17:00:00.000Z'); // 10:30 PM IST
  const agenda = buildDailyAgenda({
    now, localDate: LOCAL_DATE, timezone: TZ, momentIdsWithSuccessor: new Set(), moments: [], plans: [],
    habitLogs: [
      { id: 'l1', userId: 'u', activityTitle: 'Deep Work', activeWindow: 'NEUTRAL', logTimestamp: new Date('2026-08-24T02:00:00.000Z'), logMinuteOfDay: 450, durationMinutes: 60 },
      { id: 'l2', userId: 'u', activityTitle: 'Workout', activeWindow: 'NEUTRAL', logTimestamp: new Date('2026-08-24T12:00:00.000Z'), logMinuteOfDay: 1050, durationMinutes: 45 },
    ],
  });
  const story = buildDailyStory(agenda, 22 * 60 + 30);
  check('Night phase resolved', story.phase === 'NIGHT');
  check('Night -> narrative reuses buildDailyReflection\'s breakdown ("2 activities you logged")', story.narrative.includes('2 activities you logged'));
  check('Night -> completedHighlights has both items', story.completedHighlights?.length === 2);
  check('Night -> nextMeaningfulThing is "Plan tomorrow" (not a built Tomorrow product)', story.nextMeaningfulThing?.action === 'PLAN_TOMORROW');
  check('Night -> no subjective judgment like "productive day"', !story.narrative.toLowerCase().includes('productive'));
}

// ============================================================
// Section 53 -- every surfaced intention resolves to a valid canonical
// activity, or is explicitly null (never a broken/fabricated id).
// ============================================================
{
  let allValid = true;
  let unsupportedCount = 0;
  for (const group of INTENTION_GROUPS) {
    for (const activity of group.activities) {
      if (activity.activityId === null) {
        unsupportedCount += 1;
        continue;
      }
      const found = FULL_ACTIVITY_CATALOG.find((a) => a.id === activity.activityId);
      if (!found) {
        allValid = false;
        console.log(`  -> BROKEN: ${group.id}/${activity.label} references unknown activityId "${activity.activityId}"`);
      }
    }
  }
  check('Every non-null intention activityId resolves to a real catalog activity', allValid);
  check('At least one intention is explicitly marked unsupported (not silently faked)', unsupportedCount > 0);
}
{
  // PEOPLE_SUBGROUPS must reference real groups.
  const ok = PEOPLE_SUBGROUPS.every((sg) => INTENTION_GROUPS.some((g) => g.id === sg.groupId));
  check('Every PEOPLE_SUBGROUPS entry references a real intention group', ok);
}
{
  check('BROAD_CHOICES has exactly the 4 first-level choices from the brief', BROAD_CHOICES.map((c) => c.id).join(',') === 'WORK,PEOPLE,SELF,ENJOYMENT');
}
{
  // Everyday-only: no RELATIONSHIPS/FAMILY/SOCIAL/WORK/SELF/ENJOYMENT
  // intention should resolve to a CEREMONIAL/IMPORTANT (Muhurtham-only)
  // activity (brief section 23: these route through everyday Timing
  // Search, never Muhurtham Finder).
  let allEveryday = true;
  for (const group of INTENTION_GROUPS) {
    for (const activity of group.activities) {
      if (!activity.activityId) continue;
      const def = getActivityDefinition(activity.activityId);
      if (def && def.experience.planningMode !== 'EVERYDAY') {
        allEveryday = false;
        console.log(`  -> NOT EVERYDAY: ${group.id}/${activity.label} (${activity.activityId}) is ${def.experience.planningMode}`);
      }
    }
  }
  check('Every surfaced intention activity is EVERYDAY planningMode (never routes to Muhurtham Finder)', allEveryday);
}

// ============================================================
// Personalized Daily Story V2
// ============================================================
{
  // No preferences preserves current story behavior -- byte-identical
  // whether personalization is omitted entirely or explicitly empty.
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
  const agenda = emptyAgenda(now);
  const withoutArg = buildDailyStory(agenda, 8 * 60);
  const withEmptyPersonalization: DailyStoryPersonalizationInput = { priorities: [], coverage: [], priorityPersonMoment: undefined };
  const withArg = buildDailyStory(agenda, 8 * 60, withEmptyPersonalization);
  check('No preferences (personalization omitted) -> unchanged headline', withoutArg.headline === 'Good morning');
  check('No preferences (personalization explicitly empty) -> byte-identical to omitting it entirely', JSON.stringify(withoutArg) === JSON.stringify(withArg));
}
{
  // Partial coverage (WORK covered, WELLBEING open) -> "Your day has structure".
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST, MIDDAY-ish window used below instead
  const agenda = buildDailyAgenda({
    now, localDate: LOCAL_DATE, timezone: TZ, momentIdsWithSuccessor: new Set(), habitLogs: [], moments: [],
    plans: [plan({ id: 'p1', title: 'Deep Work', plannedStartAt: new Date('2026-08-24T05:00:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z') })],
  });
  const priorities: DailyStoryPersonalizationInput['priorities'] = ['WORK', 'WELLBEING'];
  const personalization: DailyStoryPersonalizationInput = { priorities, coverage: buildDailyPriorityCoverage(agenda, priorities), priorityPersonMoment: undefined };
  const story = buildDailyStory(agenda, 8 * 60, personalization);
  check('Partial coverage (WORK covered, WELLBEING open) -> "Your day has structure"', story.headline === 'Your day has structure');
  check('Partial-coverage narrative mentions the covered priority factually', story.narrative.includes('focused work'));
  check('Partial-coverage narrative also invites toward the open priority', /yourself|wellbeing/.test(story.narrative));
  check('Never claims inferred behavior ("you love/always/usually")', !/you (love|always|usually)/i.test(story.narrative));
}
{
  // Full coverage (both priorities covered, not busy) -> "A balanced day ahead".
  const now = new Date('2026-08-24T02:30:00.000Z');
  const agenda = buildDailyAgenda({
    now, localDate: LOCAL_DATE, timezone: TZ, momentIdsWithSuccessor: new Set(), habitLogs: [], moments: [],
    plans: [
      plan({ id: 'p1', title: 'Deep Work', plannedStartAt: new Date('2026-08-24T05:00:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z') }),
      plan({ id: 'p2', title: 'Dinner Date', plannedStartAt: new Date('2026-08-24T13:30:00.000Z'), plannedEndAt: new Date('2026-08-24T15:00:00.000Z') }),
    ],
  });
  const priorities: DailyStoryPersonalizationInput['priorities'] = ['WORK', 'RELATIONSHIPS'];
  const personalization: DailyStoryPersonalizationInput = { priorities, coverage: buildDailyPriorityCoverage(agenda, priorities), priorityPersonMoment: undefined };
  const story = buildDailyStory(agenda, 8 * 60, personalization);
  check('Full coverage, not busy -> "A balanced day ahead"', story.headline === 'A balanced day ahead');
  check('Full-coverage narrative mentions both covered priorities', story.narrative.includes('focused work') && story.narrative.includes('time with someone important'));
}
{
  // Zero coverage on a quiet/open day -> "A mostly open day".
  const now = new Date('2026-08-24T02:30:00.000Z');
  const agenda = emptyAgenda(now);
  const priorities: DailyStoryPersonalizationInput['priorities'] = ['WORK', 'WELLBEING'];
  const personalization: DailyStoryPersonalizationInput = { priorities, coverage: buildDailyPriorityCoverage(agenda, priorities), priorityPersonMoment: undefined };
  const story = buildDailyStory(agenda, 8 * 60, personalization);
  check('Preferences but empty agenda -> "A mostly open day"', story.headline === 'A mostly open day');
  check('Quiet-day narrative invites toward the priorities, makes no accomplishment claim', story.narrative.includes('room to shape today'));
}
{
  // Busy day (3+ upcoming items) -> "A full day ahead", regardless of coverage specifics.
  const now = new Date('2026-08-24T02:30:00.000Z');
  const agenda = buildDailyAgenda({
    now, localDate: LOCAL_DATE, timezone: TZ, momentIdsWithSuccessor: new Set(), habitLogs: [], moments: [],
    plans: [
      plan({ id: 'p1', title: 'Deep Work', plannedStartAt: new Date('2026-08-24T03:00:00.000Z'), plannedEndAt: new Date('2026-08-24T04:00:00.000Z') }),
      plan({ id: 'p2', title: 'Learning', plannedStartAt: new Date('2026-08-24T05:00:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z') }),
      plan({ id: 'p3', title: 'Workout', plannedStartAt: new Date('2026-08-24T07:00:00.000Z'), plannedEndAt: new Date('2026-08-24T08:00:00.000Z') }),
    ],
  });
  const priorities: DailyStoryPersonalizationInput['priorities'] = ['WORK'];
  const personalization: DailyStoryPersonalizationInput = { priorities, coverage: buildDailyPriorityCoverage(agenda, priorities), priorityPersonMoment: undefined };
  const story = buildDailyStory(agenda, 8 * 60, personalization);
  check('Busy day (3+ upcoming items) -> "A full day ahead"', story.headline === 'A full day ahead');
}
{
  // A priority person already has a Moment today -> most specific, most human framing, takes precedence.
  const now = new Date('2026-08-24T02:30:00.000Z');
  const agenda = buildDailyAgenda({
    now, localDate: LOCAL_DATE, timezone: TZ, momentIdsWithSuccessor: new Set(), habitLogs: [], moments: [],
    plans: [plan({ id: 'p1', title: 'Deep Work', plannedStartAt: new Date('2026-08-24T05:00:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z') })],
  });
  const priorities: DailyStoryPersonalizationInput['priorities'] = ['RELATIONSHIPS'];
  const personalization: DailyStoryPersonalizationInput = {
    priorities,
    coverage: buildDailyPriorityCoverage(agenda, priorities),
    priorityPersonMoment: { personName: 'Reena', itemTitle: 'Coffee' },
  };
  const story = buildDailyStory(agenda, 8 * 60, personalization);
  check('A priority person\'s Moment -> "You\'ve made room for what matters"', story.headline === "You've made room for what matters");
  check('The narrative names the priority person naturally', story.narrative.includes('Reena'));
  check('Never exposes internal identifiers in the narrative (only the display name)', !/SavedPerson|RELATIONSHIPS|activityId/.test(story.narrative));
}

if (!allPassed) {
  console.error('\nSome daily story / intention checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL DAILY STORY / INTENTION CHECKS PASSED');
}
