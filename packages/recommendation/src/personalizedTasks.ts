import type { SolarWindowType } from '../../panchang/src/windows';

export type ActivityCategory =
  | 'WORK'
  | 'FOCUS'
  | 'WORKOUT'
  | 'TRAVEL'
  | 'RELATIONSHIP'
  | 'SOCIAL'
  | 'LEARNING'
  | 'FINANCE'
  | 'SPIRITUAL'
  | 'HOME'
  | 'MEAL'
  | 'MICRO_BREAK'
  | 'REST'
  | 'ROUTINE'
  | 'NEW_BEGINNING';

export interface ActivityProfile {
  id: string;
  title: string;
  description: string;
  category: ActivityCategory;
  nature?: 'PERFORM' | 'INITIATE' | 'CONNECT' | 'RESTORE' | 'ROUTINE' | 'LEARN' | 'NOURISH';
  defaultDurationMinutes?: number;
  recommendedWindowTypes: SolarWindowType[];
  acceptableWindowTypes: SolarWindowType[];
  avoidWindowTypes: SolarWindowType[];
  significance: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresFreshStart: boolean;
  allowDuringAvoidWindow?: boolean;
  aliases: string[];
  elementAffinity?: 'FIRE' | 'WATER' | 'AIR' | 'EARTH';
  icon: string;
}

export type PersonalizedTask = ActivityProfile;

export interface UserChartContext {
  lagnaSign?: string;
  moonSign?: string;
}

const ELEMENT_MAP: Record<string, 'FIRE' | 'EARTH' | 'AIR' | 'WATER'> = {
  Aries: 'FIRE', Leo: 'FIRE', Sagittarius: 'FIRE',
  Taurus: 'EARTH', Virgo: 'EARTH', Capricorn: 'EARTH',
  Gemini: 'AIR', Libra: 'AIR', Aquarius: 'AIR',
  Cancer: 'WATER', Scorpio: 'WATER', Pisces: 'WATER',
};

// Base Catalog of Personalized Actions
export const ACTIVITY_CATALOG: ActivityProfile[] = [
  // High Execution & Drive (Abhijit / Fire Affinity)
  {
    id: 'task-1',
    title: 'High-Stakes Decision or Pitch',
    description: 'Capitalize on peak solar clarity to finalize important deals or key architecture choices.',
    category: 'WORK',
    recommendedWindowTypes: ['ABHIJIT'],
    acceptableWindowTypes: ['GULIKA', 'NEUTRAL'],
    avoidWindowTypes: ['RAHU_KALAM', 'YAMA'],
    significance: 'HIGH', requiresFreshStart: true,
    aliases: ['high stakes decision', 'important decision', 'pitch', 'architecture choice'],
    elementAffinity: 'FIRE',
    icon: '⚡',
  },
  {
    id: 'task-2',
    title: 'Sprint Backlog Execution',
    description: 'Drive momentum on heavy coding or team milestone tasks while energy is high.',
    category: 'WORK',
    recommendedWindowTypes: ['ABHIJIT', 'NEUTRAL'],
    acceptableWindowTypes: ['GULIKA', 'BRAHMA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'],
    significance: 'HIGH', requiresFreshStart: false,
    aliases: ['sprint backlog', 'backlog execution', 'coding sprint', 'milestone task'],
    elementAffinity: 'FIRE',
    icon: '🚀',
  },

  // Deep Intuitive & Mental Focus (Brahma / Water Affinity)
  {
    id: 'task-3',
    title: 'Breathwork & Strategic Visioning',
    description: 'Set core daily intentions and align your mental state during tranquil early morning hours.',
    category: 'SPIRITUAL',
    recommendedWindowTypes: ['BRAHMA'],
    acceptableWindowTypes: ['NEUTRAL', 'GULIKA'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false,
    aliases: ['breathwork', 'strategic vision', 'daily intention'],
    elementAffinity: 'WATER',
    icon: '🌅',
  },
  {
    id: 'task-4',
    title: 'Deep Architecture & Writing',
    description: 'Engage in uninterrupted creative problem solving and system design.',
    category: 'FOCUS',
    recommendedWindowTypes: ['BRAHMA', 'GULIKA'],
    acceptableWindowTypes: ['ABHIJIT', 'NEUTRAL'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: false,
    aliases: ['deep architecture', 'architecture writing', 'deep writing', 'system design'],
    elementAffinity: 'WATER',
    icon: '🧠',
  },

  // Steady Progress & Organization (Gulika / Earth Affinity)
  {
    id: 'task-5',
    title: 'Process Optimization & Docs',
    description: 'Organize documentation, clean up logs, and structure routine workflows.',
    category: 'ROUTINE',
    recommendedWindowTypes: ['GULIKA', 'NEUTRAL'],
    acceptableWindowTypes: ['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'YAMA'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false,
    aliases: ['process optimization', 'documentation', 'docs', 'clean logs', 'organize workflow'],
    elementAffinity: 'EARTH',
    icon: '📐',
  },

  // Active Rest & Friction Guardrails (Rahu Kalam / Yama / Air Sensitivity)
  {
    id: 'task-6',
    title: 'Active Rest & Hydration Check',
    description: 'Step away from complex screens. Reset your posture and drink water.',
    category: 'REST',
    recommendedWindowTypes: ['RAHU_KALAM', 'YAMA'],
    acceptableWindowTypes: ['NEUTRAL', 'GULIKA'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false,
    aliases: ['active rest', 'hydration', 'water break'],
    elementAffinity: 'AIR',
    icon: '💧',
  },
  {
    id: 'task-7',
    title: 'Light Stretch & Mobility',
    description: 'Decompress physical tension and avoid high-stakes commitments during friction windows.',
    category: 'REST',
    recommendedWindowTypes: ['RAHU_KALAM', 'YAMA'],
    acceptableWindowTypes: ['NEUTRAL', 'GULIKA'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false,
    aliases: ['stretch', 'mobility', 'light stretch'],
    elementAffinity: 'AIR',
    icon: '🧘',
  },
];

const EXTENDED_ACTIVITY_CATALOG: ActivityProfile[] = [
  { id: 'start-journey', title: 'Start a Journey', description: 'Choose a supportive window for beginning a journey or important trip.', category: 'TRAVEL', recommendedWindowTypes: ['ABHIJIT'], acceptableWindowTypes: ['NEUTRAL', 'GULIKA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: true, aliases: ['start journey', 'start a journey', 'start trip', 'begin trip', 'start travel', 'road trip', 'leave for trip', 'start my road trip'], icon: '🚗' },
  { id: 'deep-work', title: 'Deep Work', description: 'Protect a focused block for coding, research, writing, or complex thinking.', category: 'FOCUS', recommendedWindowTypes: ['ABHIJIT', 'BRAHMA'], acceptableWindowTypes: ['NEUTRAL', 'GULIKA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: false, aliases: ['deep work', 'focus work', 'coding', 'research', 'writing', 'write', 'focus session'], elementAffinity: 'WATER', icon: '🧠' },
  { id: 'workout', title: 'Workout', description: 'Use a supportive energy window for training, exercise, or a gym session.', category: 'WORKOUT', recommendedWindowTypes: ['ABHIJIT', 'NEUTRAL'], acceptableWindowTypes: ['GULIKA', 'BRAHMA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: false, aliases: ['workout', 'exercise', 'gym', 'training', 'run', 'lifting', 'heavy workout'], elementAffinity: 'FIRE', icon: '🏋️' },
  { id: 'tea-break', title: 'Tea Break', description: 'Take a short reset without needing a special auspicious start.', category: 'MICRO_BREAK', recommendedWindowTypes: ['NEUTRAL', 'GULIKA'], acceptableWindowTypes: ['ABHIJIT', 'BRAHMA', 'RAHU_KALAM', 'YAMA'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['tea break', 'coffee break', 'break', 'snack'], icon: '☕' },
  { id: 'dating', title: 'Dating', description: 'Plan a date or meaningful social connection during a supportive period.', category: 'RELATIONSHIP', recommendedWindowTypes: ['GULIKA', 'NEUTRAL'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: [], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['date', 'dating', 'go on a date', 'romantic dinner', 'meet someone'], icon: '❤️' },
  { id: 'party', title: 'Party', description: 'Enjoy a social gathering during an easy, relaxed period.', category: 'SOCIAL', recommendedWindowTypes: ['NEUTRAL', 'GULIKA'], acceptableWindowTypes: ['ABHIJIT', 'YAMA', 'RAHU_KALAM'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['party', 'partying', 'social gathering', 'night out', 'celebration'], icon: '🎉' },
  { id: 'financial-decision', title: 'Financial Decision', description: 'Handle a meaningful financial commitment in a clear, supportive window.', category: 'FINANCE', recommendedWindowTypes: ['ABHIJIT'], acceptableWindowTypes: ['GULIKA', 'NEUTRAL'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: true, aliases: ['investment', 'property purchase', 'sign contract', 'financial decision', 'loan', 'major purchase'], icon: '💰' },
  { id: 'new-beginning', title: 'New Beginning', description: 'Start a new project, habit, role, or chapter with intention.', category: 'NEW_BEGINNING', recommendedWindowTypes: ['ABHIJIT', 'BRAHMA'], acceptableWindowTypes: ['GULIKA', 'NEUTRAL'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: true, aliases: ['start a project', 'launch', 'new job', 'new business', 'start a habit', 'begin something new'], icon: '🚀' },
  { id: 'learning', title: 'Learning', description: 'Study, read, practice, or build a new skill.', category: 'LEARNING', recommendedWindowTypes: ['BRAHMA', 'ABHIJIT'], acceptableWindowTypes: ['NEUTRAL', 'GULIKA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['learn', 'study', 'reading', 'course', 'exam', 'practice'], icon: '📚' },
];

export const FULL_ACTIVITY_CATALOG = [...ACTIVITY_CATALOG, ...EXTENDED_ACTIVITY_CATALOG];

export function findActivityIntent(input: string): ActivityProfile | undefined {
  const normalized = input.trim().toLowerCase();
  return FULL_ACTIVITY_CATALOG
    .slice()
    .sort((a, b) => b.aliases.reduce((max, alias) => Math.max(max, alias.length), 0) - a.aliases.reduce((max, alias) => Math.max(max, alias.length), 0))
    .find((activity) => activity.aliases.some((alias) => normalized.includes(alias)));
}

export function getPersonalizedTasks(
  activeWindowName: string,
  userChart?: UserChartContext,
  loggedActivitiesToday: string[] = [],
  loggedActivityIds: string[] = []
): PersonalizedTask[] {
  // Global replacement ensures all underscores are converted cleanly
  const cleanWindow = normalizeWindowType(activeWindowName);
  const moonElement = userChart?.moonSign ? ELEMENT_MAP[userChart.moonSign] : undefined;

  const normalizedLogged = new Set(
    loggedActivitiesToday.map((item) => item.trim().toLowerCase())
  );
  const loggedIds = new Set(loggedActivityIds);

  // Filter and score tasks by context relevance
  const scoredTasks = FULL_ACTIVITY_CATALOG.map((task) => {
    let score = 0;

    // 1. Window Match (Checks both raw and space-normalized variants)
    const windowMatches = task.recommendedWindowTypes.some((win) => {
      return cleanWindow === win;
    });

    if (windowMatches) score += 50;

    // Acceptable windows remain useful suggestions, but preferred windows lead.
    const acceptableMatch = task.acceptableWindowTypes.includes(cleanWindow);
    if (acceptableMatch) score += 18;

    // 2. Element Affinity Match (a light personalization modifier)
    if (moonElement && task.elementAffinity === moonElement) {
      score += 25;
    }

    // 3. Deduct if already logged today
    const isLogged = loggedIds.has(task.id) || normalizedLogged.has(task.title.trim().toLowerCase());
    if (isLogged) score -= 100;

    return { task, score };
  });

  // Sort by highest score first
  const sorted = scoredTasks.sort((a, b) => b.score - a.score);

  // Fallback: If top scores are negative (all matchable tasks already logged today),
  // return fallback items from catalog to avoid empty playbook renders
  return sorted.slice(0, 3).map((item) => item.task);
}

export function normalizeWindowType(window: string): SolarWindowType {
  const clean = String(window || 'NEUTRAL').replace(/_/g, ' ').toUpperCase();
  if (clean.includes('RAHU')) return 'RAHU_KALAM';
  if (clean.includes('YAMA')) return 'YAMA';
  if (clean.includes('BRAHMA')) return 'BRAHMA';
  if (clean.includes('ABHIJIT') || clean.includes('VIJAYA')) return 'ABHIJIT';
  if (clean.includes('GULIKA')) return 'GULIKA';
  return 'NEUTRAL';
}
