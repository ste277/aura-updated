import { Page } from '@playwright/test';

/**
 * Product Journey / E2E Hardening V1 -- thin wrappers over the app's own
 * real APIs (never a second, parallel data-creation path). Every helper
 * here calls exactly the endpoint the real UI flow would call, so a
 * journey test can set up prerequisite state quickly (e.g. "a SavedPerson
 * already exists") without click-driving every single upstream step, while
 * the test itself still click-drives the actual journey under test.
 */

export interface PlanFixture {
  id: string;
  title: string;
  status: string;
}

export async function createPlan(
  page: Page,
  input: { title: string; icon?: string; startIso: string; endIso: string; durationMinutes?: number }
): Promise<PlanFixture> {
  const durationMinutes = input.durationMinutes ?? Math.round((new Date(input.endIso).getTime() - new Date(input.startIso).getTime()) / 60000);
  const res = await page.request.post('/api/plans', {
    data: {
      title: input.title,
      activityType: input.title,
      icon: input.icon ?? '✨',
      plannedStartAt: input.startIso,
      plannedEndAt: input.endIso,
      durationMinutes,
      windowType: 'NEUTRAL',
      windowLabel: 'Neutral Flow',
      matchLabel: 'Good Match',
      score: 70,
    },
  });
  if (!res.ok()) throw new Error(`createPlan failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function logPlan(page: Page, planId: string): Promise<void> {
  const res = await page.request.post(`/api/plans/${planId}/log`);
  if (!res.ok()) throw new Error(`logPlan failed: ${res.status()} ${await res.text()}`);
}

export interface SavedPersonFixture {
  id: string;
  name: string;
}

export async function createSavedPerson(
  page: Page,
  input: { name: string; relationshipType?: 'PARTNER' | 'SPOUSE' | 'FAMILY' | 'FRIEND' | 'OTHER'; birthDate?: string; birthTime?: string; birthTimezone?: string }
): Promise<SavedPersonFixture> {
  const res = await page.request.post('/api/people', {
    data: {
      name: input.name,
      relationshipType: input.relationshipType ?? 'PARTNER',
      birthDate: input.birthDate ?? '1994-05-10',
      birthTime: input.birthTime ?? '08:15',
      birthTimezone: input.birthTimezone ?? 'Asia/Kolkata',
    },
  });
  if (!res.ok()) throw new Error(`createSavedPerson failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export interface MomentFixture {
  id: string;
  shareUrl: string;
}

export async function createSharedMoment(
  page: Page,
  input: { savedPersonId: string; activityId: string; startIso: string; endIso: string; ratingLabel?: string }
): Promise<MomentFixture> {
  const res = await page.request.post('/api/aura-moments', {
    data: {
      scope: 'SHARED',
      source: 'PLAN',
      activityId: input.activityId,
      startAt: input.startIso,
      endAt: input.endIso,
      ratingLabel: input.ratingLabel ?? 'STRONG_SHARED_FIT',
      savedPersonId: input.savedPersonId,
    },
  });
  if (!res.ok()) throw new Error(`createSharedMoment failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function logHabitInstant(page: Page, input: { activityTitle: string; activeWindow?: string; logMinuteOfDay?: number }): Promise<{ id: string; durationMinutes: number }> {
  const res = await page.request.post('/api/habit-logs', {
    data: {
      activityTitle: input.activityTitle,
      activeWindow: input.activeWindow ?? 'NEUTRAL',
      logMinuteOfDay: input.logMinuteOfDay ?? 600,
      durationMinutes: 0,
      logSource: 'AURA_DO_NOW',
    },
  });
  if (!res.ok()) throw new Error(`logHabitInstant failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function fetchMyDay(page: Page, dateStr?: string): Promise<any> {
  const url = dateStr ? `/api/my-day?date=${dateStr}` : '/api/my-day';
  const res = await page.request.get(url);
  if (!res.ok()) throw new Error(`GET /api/my-day failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function fetchAuraUpdates(page: Page): Promise<any> {
  const res = await page.request.get('/api/aura-updates');
  if (!res.ok()) throw new Error(`GET /api/aura-updates failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function listPlans(page: Page): Promise<any[]> {
  const res = await page.request.get('/api/plans');
  if (!res.ok()) throw new Error(`GET /api/plans failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function listHabitLogs(page: Page): Promise<any[]> {
  const res = await page.request.get('/api/habit-logs');
  if (!res.ok()) throw new Error(`GET /api/habit-logs failed: ${res.status()} ${await res.text()}`);
  return res.json();
}
