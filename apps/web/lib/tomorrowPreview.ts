import type { PanchangDay } from '../../../packages/panchang/src/panchangDay';
import { getGoodForDayCategories, DayActivityCategory } from '../../../packages/recommendation/src/dayActivitySuggestions';
import type { DailyAgenda, DailyAgendaItem } from './dailyAgenda';

/**
 * Daily Reflection & Tomorrow Preview V1 (brief section 4) -- a
 * human-readable look at tomorrow. Reuses two EXISTING pieces exactly as-is:
 * buildDailyAgenda() for whatever Plans/Moments are already scheduled
 * tomorrow (nothing new is persisted -- "the preview is derived"), and the
 * existing getGoodForDayCategories()/evaluateActivityFit() Panchang
 * aggregation that PanchangCalendarView already uses to say "good for
 * Important work / Social," never a raw Tithi/Nakshatra/Yoga/Karana/Rahu
 * dump. No new scoring engine, no new astrology calculation.
 */

export interface TomorrowPreview {
  date: string;
  timezone: string;
  /** Whatever's already scheduled tomorrow -- the SAME DailyAgenda shape
   * My Day itself uses, so this naturally becomes tomorrow's My Day once
   * the local date rolls over (brief: "do not persist a duplicate
   * 'tomorrow agenda'"). */
  agenda: DailyAgenda;
  /** Human-readable "good for" highlights, capped and thresholded by the
   * existing getGoodForDayCategories() -- empty when no category clears
   * its existing BEST/EXCEPTIONAL bar. */
  goodForCategories: DayActivityCategory[];
  headline: string;
  narrative: string;
}

function describeAgenda(items: DailyAgendaItem[], timezone: string): string {
  if (items.length === 0) return 'Nothing is on the calendar yet.';
  const first = items[0];
  const time = new Date(first.startAt).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  if (items.length === 1) return `${first.title} at ${time}.`;
  return `${first.title} at ${time}, plus ${items.length - 1} more ${items.length - 1 === 1 ? 'thing' : 'things'} already planned.`;
}

export function buildTomorrowPreview(agenda: DailyAgenda, panchangDay: PanchangDay): TomorrowPreview {
  const goodForCategories = getGoodForDayCategories(panchangDay);
  const agendaLine = describeAgenda(agenda.items, agenda.timezone);

  const narrative =
    goodForCategories.length > 0
      ? `${agendaLine} Tomorrow also looks like a good day for ${goodForCategories.map((c) => c.label.toLowerCase()).join(', ')}.`
      : agendaLine;

  return {
    date: agenda.localDate,
    timezone: agenda.timezone,
    agenda,
    goodForCategories,
    headline: 'Looking ahead to tomorrow',
    narrative,
  };
}
