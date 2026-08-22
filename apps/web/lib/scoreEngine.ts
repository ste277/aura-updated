import { WindowSpan, SolarWindowType } from '../../../packages/panchang/src/windows';

export interface DailyEnergyInsight {
  score: number;
  stars: number;
  themeText: string;
  bestForToday: string[];
  cautionItems: string[];
  nextShift: {
    windowName: string;
    startsIn: string;
    startTime: string;
    /** The upcoming window's OWN score/theme -- deliberately separate from
     * this insight's top-level `score`/`themeText`, which describe the
     * CURRENT window (activeType). "Next Best Moment" cards must use these,
     * not the top-level fields, or they end up showing the current window's
     * score/description under the next window's name. */
    score: number;
    themeText: string;
  };
}

type LegacyWindowStart = WindowSpan & {
  start?: number | string;
  startMin?: number | string;
  startTime?: number | string;
};

// Helper to safely extract total minutes of the day from numbers or strings.
function parseMinuteVal(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    if (val.includes(':')) {
      const [h, m] = val.split(':').map(Number);
      if (!Number.isNaN(h) && !Number.isNaN(m)) return h * 60 + m;
    }
    const parsed = parseFloat(val);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

interface WindowEnergyProfile {
  score: number;
  themeText: string;
  bestForToday: string[];
  cautionItems: string[];
}

/**
 * The score/theme/best-for/caution profile for a given solar window TYPE --
 * pure function of the type alone (no time-of-day state), so it can be
 * called once for the CURRENT active window and again for whichever window
 * is coming up NEXT, without duplicating this data. Previously this mapping
 * lived inline in computeDailyEnergyInsight() and was only ever evaluated
 * for `activeType`, which is what caused the "Next Best Moment" card to
 * silently reuse the current window's score/description (see
 * HomeDashboard.tsx's nextShift.score/themeText usage).
 */
function energyProfileForWindowType(type: SolarWindowType): WindowEnergyProfile {
  switch (type) {
    case 'ABHIJIT':
      return {
        score: 9.5,
        themeText: 'Peak solar clarity. Ideal for major decisions and high-impact launches.',
        bestForToday: ['Key Decisions', 'Important Meetings', 'Product Launches'],
        cautionItems: ['Hesitation', 'Postponing actions'],
      };
    case 'RAHU_KALAM':
      return {
        score: 3.5,
        themeText: 'High friction period. Rest, reflect, and avoid starting new initiatives.',
        bestForToday: ['Internal Audits', 'Routine Maintenance', 'Meditation'],
        cautionItems: ['New Contracts', 'Major Purchases', 'Crucial Conversations'],
      };
    case 'YAMA': // Matched exact enum type from windows.ts
      return {
        score: 4.2,
        themeText: 'Subtle energy dip. Double-check details and hold off on major financial moves.',
        bestForToday: ['Proofreading', 'Organization', 'Quiet Focus'],
        cautionItems: ['Financial Commitments', 'Signing Agreements'],
      };
    case 'GULIKA':
      return {
        score: 6.0,
        themeText: 'Steady repetitive energy. Great for routines, habits, and foundational work.',
        bestForToday: ['Habit Stacking', 'System Building', 'Documentation'],
        cautionItems: ['Impulsive Changes'],
      };
    case 'NEUTRAL':
    default:
      return {
        score: 7.8,
        themeText: 'Balanced and stable energy. Good for consistent, incremental execution.',
        bestForToday: ['Learning', 'Exercise', 'Planning'],
        cautionItems: ['Overcommitting'],
      };
  }
}

export function computeDailyEnergyInsight(
  windows: WindowSpan[],
  activeType: SolarWindowType,
  currentMinuteOfDay: number
): DailyEnergyInsight {
  const { score, themeText, bestForToday, cautionItems } = energyProfileForWindowType(activeType);

  // Normalize and sort windows safely checking startMinutes (plural) first
  const normalizedWindows = (windows || []).map((w: LegacyWindowStart) => ({
    ...w,
    startMinuteParsed: parseMinuteVal(
      w.startMinutes ?? w.startMinute ?? w.start ?? w.startMin ?? w.startTime,
      0
    ),
  }));

  const sortedWindows = [...normalizedWindows].sort(
    (a, b) => a.startMinuteParsed - b.startMinuteParsed
  );

  let upcomingWindow = sortedWindows.find((w) => w.startMinuteParsed > currentMinuteOfDay);

  if (!upcomingWindow && sortedWindows.length > 0) {
    upcomingWindow = sortedWindows[0];
  }

  let nextShift = {
    windowName: 'Next Window',
    startsIn: 'Soon',
    startTime: '--:--',
    score: 7.8,
    themeText: 'Balanced and stable energy. Good for consistent, incremental execution.',
  };

  if (upcomingWindow) {
    const sMin = upcomingWindow.startMinuteParsed;
    let diffMinutes = sMin - currentMinuteOfDay;
    if (diffMinutes < 0) {
      diffMinutes += 1440;
    }

    const hrs = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    const startsIn = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

    const startHr = Math.floor(sMin / 60) % 24;
    const startMin = sMin % 60;
    const period = startHr >= 12 ? 'PM' : 'AM';
    const formattedHr = startHr % 12 === 0 ? 12 : startHr % 12;
    const startTime = `${formattedHr}:${String(startMin).padStart(2, '0')} ${period}`;
    const upcomingProfile = energyProfileForWindowType((upcomingWindow.type || 'NEUTRAL') as SolarWindowType);

    nextShift = {
      windowName: formatWindowName(upcomingWindow.type || upcomingWindow.label || 'NEUTRAL'),
      startsIn: `In ${startsIn}`,
      startTime,
      score: upcomingProfile.score,
      themeText: upcomingProfile.themeText,
    };
  }

  const stars = Math.min(5, Math.max(1, Math.round((score / 10) * 5)));

  return {
    score,
    stars,
    themeText,
    bestForToday,
    cautionItems,
    nextShift,
  };
}

function formatWindowName(type: SolarWindowType | string): string {
  const cleanType = String(type).replace('_', ' ').toUpperCase();
  if (cleanType.includes('ABHIJIT')) return 'Peak Clarity (Abhijit)';
  if (cleanType.includes('VIJAYA')) return 'Victorious Window (Vijaya)';
  if (cleanType.includes('BRAHMA')) return 'Deep Focus (Brahma)';
  if (cleanType.includes('RAHU')) return 'Friction Period (Rahu Kalam)';
  if (cleanType.includes('YAMA')) return 'Caution Window (Yamaganda)';
  if (cleanType.includes('GULIKA')) return 'Steady Foundation (Gulika)';
  return 'Neutral Flow';
}
