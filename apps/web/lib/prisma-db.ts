import { prisma } from './prisma';

// Prisma-native equivalent of lib/db.ts (the pg-based fallback used only because
// this project's build sandbox couldn't reach binaries.prisma.sh — see README).
// Requires `npx prisma generate` to have been run first, which needs normal
// internet access. Same function signatures as lib/db.ts so swapping is a
// one-line import change in the API routes.

const DEFAULT_SIGNUP_LOCATION = {
  cityName: 'Chennai',
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
};

export async function getCustomCitiesForUser(userId: string) {
  return prisma.customCity.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function saveCustomCityForUser(
  userId: string,
  city: { cityName: string; latitude: number; longitude: number; timezone: string }
) {
  return prisma.customCity.upsert({
    where: {
      userId_cityName: {
        userId,
        cityName: city.cityName,
      },
    },
    update: {
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: city.timezone,
    },
    create: {
      userId,
      cityName: city.cityName,
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: city.timezone,
    },
  });
}

export async function getOrCreateUserForAuth(email: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, ...DEFAULT_SIGNUP_LOCATION },
  });
}

export async function createHabitLog(input: {
  userId: string;
  activityTitle: string;
  activeWindow: string;
  logMinuteOfDay: number;
}) {
  return prisma.habitLog.create({ data: input });
}

export async function updateUserLocation(
  userId: string,
  location: { cityName: string; latitude: number; longitude: number; timezone: string }
) {
  return prisma.user.update({ where: { id: userId }, data: location });
}

export async function createHabit(input: {
  userId: string;
  title: string;
  category: string;
  targetWindowType: string;
}) {
  return prisma.habit.create({ data: input });
}

export async function listHabits(userId: string) {
  return prisma.habit.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: 'asc' } });
}

export async function archiveHabit(userId: string, habitId: string) {
  await prisma.habit.updateMany({ where: { id: habitId, userId }, data: { archivedAt: new Date() } });
}

export async function logHabitCompletion(
  userId: string,
  habitId: string,
  activeWindow: string,
  logMinuteOfDay: number
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma.$transaction(async (tx: any) => {
    const habit = await tx.habit.findFirst({ where: { id: habitId, userId } });
    if (!habit) throw new Error('Habit not found.');

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayLog = await tx.habitLog.findFirst({ where: { habitId, logTimestamp: { gte: startOfToday } } });
    if (todayLog) return habit;

    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const yesterdayLog = await tx.habitLog.findFirst({
      where: { habitId, logTimestamp: { gte: startOfYesterday, lt: startOfToday } },
    });

    const newStreak = yesterdayLog ? habit.currentStreak + 1 : 1;
    const newLongest = Math.max(habit.longestStreak, newStreak);

    await tx.habitLog.create({
      data: { userId, habitId, activityTitle: habit.title, activeWindow, logMinuteOfDay },
    });

    return tx.habit.update({ where: { id: habitId }, data: { currentStreak: newStreak, longestStreak: newLongest } });
  });
}

export async function recordVisit(userId: string) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const existing = await prisma.visitLog.findFirst({
    where: { userId, visitedAt: { gte: todayStart } },
  });
  if (existing) return;

  await prisma.visitLog.create({ data: { userId } });
}

export async function getMonthlyActivity(userId: string, year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const logs = await prisma.habitLog.findMany({
    where: { userId, logTimestamp: { gte: start, lt: end } },
    select: { logTimestamp: true },
  });
  const counts = new Map<number, number>();
  for (const log of logs) {
    const day = log.logTimestamp.getDate();
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day - b.day);
}

export async function getLogsForDay(userId: string, year: number, month: number, day: number) {
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);
  return prisma.habitLog.findMany({
    where: { userId, logTimestamp: { gte: start, lt: end } },
    orderBy: { logTimestamp: 'asc' },
    select: { id: true, activityTitle: true, activeWindow: true, logTimestamp: true },
  });
}

export async function getUserById(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function listHabitLogs(userId: string) {
  return prisma.habitLog.findMany({
    where: { userId },
    orderBy: { logTimestamp: 'desc' },
    take: 50,
  });
}