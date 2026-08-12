export interface PersonalizedTask {
  id: string;
  title: string;
  description: string;
  category: 'execution' | 'focus' | 'rest' | 'routine';
  recommendedWindowTypes: string[];
  elementAffinity?: 'FIRE' | 'WATER' | 'AIR' | 'EARTH';
  icon: string;
}

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
const TASK_CATALOG: PersonalizedTask[] = [
  // High Execution & Drive (Abhijit / Fire Affinity)
  {
    id: 'task-1',
    title: 'High-Stakes Decision or Pitch',
    description: 'Capitalize on peak solar clarity to finalize important deals or key architecture choices.',
    category: 'execution',
    recommendedWindowTypes: ['ABHIJIT', 'VIJAYA'],
    elementAffinity: 'FIRE',
    icon: '⚡',
  },
  {
    id: 'task-2',
    title: 'Sprint Backlog Execution',
    description: 'Drive momentum on heavy coding or team milestone tasks while energy is high.',
    category: 'execution',
    recommendedWindowTypes: ['ABHIJIT', 'NEUTRAL'],
    elementAffinity: 'FIRE',
    icon: '🚀',
  },

  // Deep Intuitive & Mental Focus (Brahma / Water Affinity)
  {
    id: 'task-3',
    title: 'Breathwork & Strategic Visioning',
    description: 'Set core daily intentions and align your mental state during tranquil early morning hours.',
    category: 'focus',
    recommendedWindowTypes: ['BRAHMA'],
    elementAffinity: 'WATER',
    icon: '🌅',
  },
  {
    id: 'task-4',
    title: 'Deep Architecture & Writing',
    description: 'Engage in uninterrupted creative problem solving and system design.',
    category: 'focus',
    recommendedWindowTypes: ['BRAHMA', 'GULIKA'],
    elementAffinity: 'WATER',
    icon: '🧠',
  },

  // Steady Progress & Organization (Gulika / Earth Affinity)
  {
    id: 'task-5',
    title: 'Process Optimization & Docs',
    description: 'Organize documentation, clean up logs, and structure routine workflows.',
    category: 'routine',
    recommendedWindowTypes: ['GULIKA', 'NEUTRAL'],
    elementAffinity: 'EARTH',
    icon: '📐',
  },

  // Active Rest & Friction Guardrails (Rahu Kalam / Yama / Air Sensitivity)
  {
    id: 'task-6',
    title: 'Active Rest & Hydration Check',
    description: 'Step away from complex screens. Reset your posture and drink water.',
    category: 'rest',
    recommendedWindowTypes: ['RAHU_KALAM', 'RAHU KALAM', 'YAMA'],
    elementAffinity: 'AIR',
    icon: '💧',
  },
  {
    id: 'task-7',
    title: 'Light Stretch & Mobility',
    description: 'Decompress physical tension and avoid high-stakes commitments during friction windows.',
    category: 'rest',
    recommendedWindowTypes: ['RAHU_KALAM', 'RAHU KALAM', 'YAMA'],
    elementAffinity: 'AIR',
    icon: '🧘',
  },
];

export function getPersonalizedTasks(
  activeWindowName: string,
  userChart?: UserChartContext,
  loggedActivitiesToday: string[] = []
): PersonalizedTask[] {
  // Global replacement ensures all underscores are converted cleanly
  const cleanWindow = (activeWindowName || 'NEUTRAL').toUpperCase().replace(/_/g, ' ');
  const moonElement = userChart?.moonSign ? ELEMENT_MAP[userChart.moonSign] : undefined;

  const normalizedLogged = new Set(
    loggedActivitiesToday.map((item) => item.trim().toLowerCase())
  );

  // Filter and score tasks by context relevance
  const scoredTasks = TASK_CATALOG.map((task) => {
    let score = 0;

    // 1. Window Match (Checks both raw and space-normalized variants)
    const windowMatches = task.recommendedWindowTypes.some((win) => {
      const cleanWinType = win.toUpperCase().replace(/_/g, ' ');
      return cleanWindow.includes(cleanWinType) || cleanWindow.includes(win.toUpperCase());
    });

    if (windowMatches) score += 50;

    // 2. Element Affinity Match
    if (moonElement && task.elementAffinity === moonElement) {
      score += 25;
    }

    // 3. Deduct if already logged today
    const isLogged = normalizedLogged.has(task.title.trim().toLowerCase());
    if (isLogged) score -= 100;

    return { task, score };
  });

  // Sort by highest score first
  const sorted = scoredTasks.sort((a, b) => b.score - a.score);

  // Fallback: If top scores are negative (all matchable tasks already logged today),
  // return fallback items from catalog to avoid empty playbook renders
  return sorted.slice(0, 3).map((item) => item.task);
}