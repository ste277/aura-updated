import type { DailyAgenda, DailyAgendaItem } from './dailyAgenda';

/**
 * Daily Reflection & Tomorrow Preview V1 (brief section 3) -- the evening
 * reflection, derived purely from an already-built DailyAgenda. No DB
 * access, no LLM, not persisted -- exactly the same "derive, don't
 * duplicate" shape as dailyStory.ts. Consumes DailyAgenda's own MISSED/
 * COMPLETED distinction rather than re-deciding completion here (brief:
 * "do not invent completion").
 */

export interface DailyReflection {
  date: string;
  completed: DailyAgendaItem[];
  missed: DailyAgendaItem[];
  upcoming: DailyAgendaItem[];
  loggedActivities: DailyAgendaItem[];
  meaningfulMoments: DailyAgendaItem[];
  summary: string;
}

const UPCOMING_STATUSES = new Set(['UPCOMING', 'STARTING_SOON', 'CURRENT', 'WAITING', 'CONFIRMED']);

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function buildSummary(completed: DailyAgendaItem[], loggedActivities: DailyAgendaItem[], meaningfulMoments: DailyAgendaItem[]): string {
  // Brief section 3/13: never manufacture accomplishments on a quiet day --
  // a plain, calm sentence, not a fabricated highlight.
  const meaningfulCount = completed.length + loggedActivities.length + meaningfulMoments.length;
  if (meaningfulCount === 0) {
    return "Today was quieter than most. Nothing logged, and that's alright.";
  }

  const parts: string[] = [];
  if (completed.length) parts.push(`${completed.length} planned ${pluralize(completed.length, 'thing', 'things')}`);
  if (loggedActivities.length) parts.push(`${loggedActivities.length} ${pluralize(loggedActivities.length, 'activity', 'activities')} you logged`);
  if (meaningfulMoments.length) parts.push(`${meaningfulMoments.length} ${pluralize(meaningfulMoments.length, 'moment', 'moments')} shared with someone`);

  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `You made time for ${joined} today.`;
}

export function buildDailyReflection(agenda: DailyAgenda): DailyReflection {
  const completed = agenda.items.filter((item) => item.type === 'PLAN' && item.status === 'COMPLETED');
  const missed = agenda.items.filter((item) => item.status === 'MISSED');
  const upcoming = agenda.items.filter((item) => UPCOMING_STATUSES.has(item.status));
  const loggedActivities = agenda.items.filter((item) => item.type === 'COMPLETED_ACTIVITY');
  // A "meaningful moment" is a coordinated Moment that actually happened
  // (COMPLETED) or is confirmed for later today (CONFIRMED) -- not a
  // WAITING one that never got a response.
  const meaningfulMoments = agenda.items.filter((item) => item.type === 'MOMENT' && (item.status === 'COMPLETED' || item.status === 'CONFIRMED'));

  return {
    date: agenda.localDate,
    completed,
    missed,
    upcoming,
    loggedActivities,
    meaningfulMoments,
    summary: buildSummary(completed, loggedActivities, meaningfulMoments),
  };
}
