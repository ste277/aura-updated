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
    defaultDurationMinutes: 10,
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
    defaultDurationMinutes: 10,
    recommendedWindowTypes: ['RAHU_KALAM', 'YAMA'],
    acceptableWindowTypes: ['NEUTRAL', 'GULIKA'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false,
    aliases: ['stretch', 'mobility', 'light stretch'],
    elementAffinity: 'AIR',
    icon: '🧘',
  },
];

const EXTENDED_ACTIVITY_CATALOG: ActivityProfile[] = [
  // 'road trip' / 'start my road trip' moved to the new road-trip entry
  // below (Product Structure V2 section 3: a casual weekend road trip is a
  // different occasion from an important journey/relocation -- see
  // road-trip's own EVERYDAY/STANDARD classification vs this activity's
  // IMPORTANT/DEEP one). Removing the overlap also avoids findActivityIntent()
  // ever having two catalog entries compete for the same alias.
  { id: 'start-journey', title: 'Start a Journey', description: 'Choose a supportive window for beginning a journey or important trip.', category: 'TRAVEL', recommendedWindowTypes: ['ABHIJIT'], acceptableWindowTypes: ['NEUTRAL', 'GULIKA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: true, aliases: ['start journey', 'start a journey', 'start trip', 'begin trip', 'start travel', 'leave for trip'], icon: '🚗' },
  { id: 'deep-work', title: 'Deep Work', description: 'Protect a focused block for coding, research, writing, or complex thinking.', category: 'FOCUS', recommendedWindowTypes: ['ABHIJIT', 'BRAHMA'], acceptableWindowTypes: ['NEUTRAL', 'GULIKA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: false, aliases: ['deep work', 'focus work', 'coding', 'research', 'writing', 'write', 'focus session'], elementAffinity: 'WATER', icon: '🧠' },
  { id: 'workout', title: 'Workout', description: 'Use a supportive energy window for training, exercise, or a gym session.', category: 'WORKOUT', recommendedWindowTypes: ['ABHIJIT', 'NEUTRAL'], acceptableWindowTypes: ['GULIKA', 'BRAHMA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: false, aliases: ['workout', 'exercise', 'gym', 'training', 'run', 'lifting', 'heavy workout'], elementAffinity: 'FIRE', icon: '🏋️' },
  { id: 'tea-break', title: 'Tea Break', description: 'Take a short reset without needing a special auspicious start.', category: 'MICRO_BREAK', defaultDurationMinutes: 10, recommendedWindowTypes: ['NEUTRAL', 'GULIKA'], acceptableWindowTypes: ['ABHIJIT', 'BRAHMA', 'RAHU_KALAM', 'YAMA'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['tea break', 'coffee break', 'break', 'snack'], icon: '☕' },
  { id: 'dating', title: 'Dating', description: 'Plan a date or meaningful social connection during a supportive period.', category: 'RELATIONSHIP', recommendedWindowTypes: ['GULIKA', 'NEUTRAL'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: [], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['date', 'dating', 'go on a date', 'romantic dinner', 'meet someone'], icon: '❤️' },
  { id: 'party', title: 'Party', description: 'Enjoy a social gathering during an easy, relaxed period.', category: 'SOCIAL', recommendedWindowTypes: ['NEUTRAL', 'GULIKA'], acceptableWindowTypes: ['ABHIJIT', 'YAMA', 'RAHU_KALAM'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['party', 'partying', 'social gathering', 'night out', 'celebration'], icon: '🎉' },
  // 'property purchase' moved to the new property-purchase entry below (see
  // brief section 11: prefer the more specific intent when one exists).
  { id: 'financial-decision', title: 'Financial Decision', description: 'Handle a meaningful financial commitment in a clear, supportive window.', category: 'FINANCE', recommendedWindowTypes: ['ABHIJIT'], acceptableWindowTypes: ['GULIKA', 'NEUTRAL'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: true, aliases: ['investment', 'sign contract', 'financial decision', 'loan', 'major purchase'], icon: '💰' },
  // 'new business' moved to the new business-start entry below (see brief
  // section 11: prefer BUSINESS_START over NEW_BEGINNING when resolvable).
  { id: 'new-beginning', title: 'New Beginning', description: 'Start a new project, habit, role, or chapter with intention.', category: 'NEW_BEGINNING', recommendedWindowTypes: ['ABHIJIT', 'BRAHMA'], acceptableWindowTypes: ['GULIKA', 'NEUTRAL'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: true, aliases: ['start a project', 'launch', 'new job', 'start a habit', 'begin something new'], icon: '🚀' },
  { id: 'learning', title: 'Learning', description: 'Study, read, practice, or build a new skill.', category: 'LEARNING', recommendedWindowTypes: ['BRAHMA', 'ABHIJIT'], acceptableWindowTypes: ['NEUTRAL', 'GULIKA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['learn', 'study', 'reading', 'course', 'exam', 'practice'], icon: '📚' },

  // -- Explicit occasion activities (replacing financial-decision/new-beginning
  // as the long-term canonical representation for these specific occasions;
  // see activityDefinitions.ts's ACTIVITY_METADATA notes and the completion
  // report's rule coverage matrix). category is chosen to match whichever
  // legacy family (via CATEGORY_FAMILY in auraFitEngine.ts) the activity's
  // MuhurtaRulePack base is documented as reusing, so real scoring and the
  // documented rule-pack coverage never diverge -- see muhurtaRulePacks.ts.
  { id: 'business-start', title: 'Start a Business', description: 'Begin a new business venture in a clear, supportive window.', category: 'NEW_BEGINNING', nature: 'INITIATE', recommendedWindowTypes: ['ABHIJIT', 'BRAHMA'], acceptableWindowTypes: ['GULIKA', 'NEUTRAL'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: true, aliases: ['start a business', 'business start', 'launch a business', 'open a business', 'start my business', 'new business'], icon: '🏢' },
  { id: 'property-purchase', title: 'Property Purchase', description: 'Finalize a property purchase or closing in a clear, supportive window.', category: 'FINANCE', nature: 'INITIATE', recommendedWindowTypes: ['ABHIJIT'], acceptableWindowTypes: ['GULIKA', 'NEUTRAL'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: true, aliases: ['property purchase', 'buy a property', 'buy a house', 'buy an apartment', 'real estate purchase', 'close on a house', 'sign property papers'], icon: '🏠' },
  { id: 'engagement', title: 'Engagement Ceremony', description: 'Choose a supportive window for an engagement or ring ceremony.', category: 'RELATIONSHIP', nature: 'CONNECT', recommendedWindowTypes: ['ABHIJIT', 'GULIKA'], acceptableWindowTypes: ['NEUTRAL'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: true, aliases: ['engagement', 'get engaged', 'engagement ceremony', 'ring ceremony', 'proposal ceremony'], icon: '💍' },
  { id: 'griha-pravesh', title: 'Griha Pravesh', description: 'Choose a supportive window for a housewarming / home-entry ceremony.', category: 'NEW_BEGINNING', nature: 'INITIATE', recommendedWindowTypes: ['ABHIJIT'], acceptableWindowTypes: ['GULIKA', 'NEUTRAL'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'HIGH', requiresFreshStart: true, aliases: ['griha pravesh', 'housewarming', 'house warming ceremony', 'move into new home', 'home entry ceremony'], icon: '🏡' },

  // -- Product Structure V2: everyday moments (brief section 5) -- LIGHT/
  // STANDARD depth only (activityDefinitions.ts's ACTIVITY_METADATA below),
  // so none of these can ever appear in Muhurtham Finder's supported-activity
  // list (muhurthamFinder.ts's isMuhurthamEligible requires DEEP/CEREMONIAL --
  // see test/activityCatalogEveryday.test.ts for the regression proof). These
  // are Plan-searchable occasions, not the Home daily-assistant playbook
  // cards (task-1..7), so momentEligible is true for all of them.
  { id: 'date-night', title: 'Date Night', description: 'Plan a date night together during a supportive, easy-going window.', category: 'RELATIONSHIP', nature: 'CONNECT', defaultDurationMinutes: 120, recommendedWindowTypes: ['GULIKA', 'NEUTRAL'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['date night', 'plan a date', 'date with my partner'], icon: '❤️' },
  // 'romantic dinner' stays exclusively on 'dating' below -- not repeated
  // here, so findActivityIntent() (which sorts candidates by each
  // activity's own longest alias, not by match specificity) never has two
  // activities competing for the same phrase.
  { id: 'dinner-date', title: 'Dinner Date', description: 'Plan a dinner date during a relaxed, supportive evening window.', category: 'RELATIONSHIP', nature: 'CONNECT', defaultDurationMinutes: 90, recommendedWindowTypes: ['GULIKA', 'NEUTRAL'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['dinner date', 'dinner with my partner'], icon: '🍽️' },
  // Deliberately no bare 'coffee'/'tea' aliases (too generic -- would
  // shadow existing 'tea-break' matches like "tea break"/"coffee break"
  // via findActivityIntent()'s longest-alias sort) and no alias longer
  // than tea-break's own longest ('coffee break', 12 chars), so tea-break
  // keeps winning on its own phrases.
  { id: 'coffee-tea', title: 'Coffee / Tea', description: 'Meet someone for coffee or tea -- no special window needed, just an easy time.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 45, recommendedWindowTypes: ['NEUTRAL', 'GULIKA'], acceptableWindowTypes: ['ABHIJIT', 'BRAHMA'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['grab coffee', 'get tea', 'meet for coffee'], icon: '☕' },
  { id: 'movie-night', title: 'Movie Night', description: 'Plan a movie night during a relaxed, easy-going window.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 150, recommendedWindowTypes: ['NEUTRAL', 'GULIKA'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['movie night', 'watch a movie', 'movie with friends'], icon: '🎬' },
  { id: 'walk-together', title: 'Walk Together', description: 'A relaxed walk together -- easy timing, no special window needed.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 45, recommendedWindowTypes: ['NEUTRAL', 'GULIKA', 'BRAHMA'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['walk together', 'go for a walk', 'evening walk'], icon: '🚶' },
  { id: 'family-dinner', title: 'Family Dinner', description: 'Plan a family dinner during a relaxed, supportive window.', category: 'MEAL', nature: 'CONNECT', defaultDurationMinutes: 90, recommendedWindowTypes: ['GULIKA', 'NEUTRAL'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['family dinner', 'dinner with family', 'family meal'], icon: '🍽️' },
  { id: 'family-outing', title: 'Family Outing', description: 'Plan a family outing during a supportive window.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 180, recommendedWindowTypes: ['NEUTRAL', 'GULIKA', 'ABHIJIT'], acceptableWindowTypes: ['BRAHMA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['family outing', 'family day out', 'outing with family'], icon: '🌳' },
  { id: 'visit-family', title: 'Visit Family / Relatives', description: 'Plan a visit with family or relatives during a supportive window.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 120, recommendedWindowTypes: ['GULIKA', 'NEUTRAL'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['visit family', 'visit relatives', 'see family'], icon: '👪' },
  { id: 'family-movie-night', title: 'Family Movie Night', description: 'Plan a family movie night during a relaxed, easy-going window.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 150, recommendedWindowTypes: ['NEUTRAL', 'GULIKA'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['family movie night', 'movie night with family', 'family film night'], icon: '🎬' },
  { id: 'dinner-with-friends', title: 'Dinner With Friends', description: 'Plan a dinner with friends during a relaxed, supportive window.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 120, recommendedWindowTypes: ['GULIKA', 'NEUTRAL'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['dinner with friends', 'friends dinner', 'dinner with the group'], icon: '🍽️' },
  { id: 'catch-up', title: 'Catch Up', description: 'Catch up with a friend -- no special window needed, just an easy time.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 60, recommendedWindowTypes: ['NEUTRAL', 'GULIKA'], acceptableWindowTypes: ['ABHIJIT', 'BRAHMA'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['catch up', 'catch up with a friend', 'chat with a friend'], icon: '💬' },
  { id: 'game-night', title: 'Game Night', description: 'Plan a game night during a relaxed, easy-going window.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 150, recommendedWindowTypes: ['NEUTRAL', 'GULIKA'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['game night', 'games with friends', 'board game night'], icon: '🎲' },
  { id: 'birthday-party', title: 'Birthday Party', description: 'Plan a birthday celebration during a supportive window.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 180, recommendedWindowTypes: ['GULIKA', 'NEUTRAL', 'ABHIJIT'], acceptableWindowTypes: ['YAMA', 'RAHU_KALAM'], avoidWindowTypes: [], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['birthday party', 'birthday celebration', "birthday's party"], icon: '🎂' },
  { id: 'anniversary-dinner', title: 'Anniversary Dinner', description: 'Plan an anniversary dinner during a supportive, meaningful window.', category: 'RELATIONSHIP', nature: 'CONNECT', defaultDurationMinutes: 120, recommendedWindowTypes: ['GULIKA', 'ABHIJIT'], acceptableWindowTypes: ['NEUTRAL'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['anniversary dinner', 'anniversary celebration', 'our anniversary'], icon: '💑' },
  { id: 'celebration-dinner', title: 'Celebration Dinner', description: 'Plan a celebration dinner during a supportive window.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 120, recommendedWindowTypes: ['GULIKA', 'ABHIJIT', 'NEUTRAL'], acceptableWindowTypes: [], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: false, aliases: ['celebration dinner', 'celebratory dinner', 'celebration meal'], icon: '🥂' },
  { id: 'road-trip', title: 'Road Trip', description: 'Plan a road trip during a supportive window for setting off.', category: 'TRAVEL', nature: 'INITIATE', defaultDurationMinutes: 240, recommendedWindowTypes: ['ABHIJIT', 'NEUTRAL'], acceptableWindowTypes: ['GULIKA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: true, aliases: ['road trip', 'start my road trip', 'weekend road trip', 'drive trip'], icon: '🚗' },
  { id: 'day-trip', title: 'Day Trip', description: 'Plan a day trip during a supportive window for setting off.', category: 'TRAVEL', nature: 'INITIATE', defaultDurationMinutes: 300, recommendedWindowTypes: ['ABHIJIT', 'NEUTRAL'], acceptableWindowTypes: ['GULIKA'], avoidWindowTypes: ['RAHU_KALAM', 'YAMA'], significance: 'MEDIUM', requiresFreshStart: true, aliases: ['day trip', 'day excursion', 'one day trip'], icon: '🗺️' },
  { id: 'picnic', title: 'Picnic', description: 'Plan a picnic during a relaxed, easy-going window.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 120, recommendedWindowTypes: ['NEUTRAL', 'GULIKA', 'ABHIJIT'], acceptableWindowTypes: ['BRAHMA'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['picnic', 'go on a picnic', 'park picnic'], icon: '🧺' },
  { id: 'shopping-trip', title: 'Shopping Trip', description: 'Plan a shopping trip during a relaxed, easy-going window.', category: 'SOCIAL', nature: 'CONNECT', defaultDurationMinutes: 90, recommendedWindowTypes: ['NEUTRAL', 'GULIKA'], acceptableWindowTypes: ['ABHIJIT'], avoidWindowTypes: [], significance: 'LOW', requiresFreshStart: false, aliases: ['shopping trip', 'go shopping', 'shopping together'], icon: '🛍️' },
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
