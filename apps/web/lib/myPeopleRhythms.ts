/**
 * AURA-MP-4 (62025) -- Relationship Rhythms: pure rules shared by the
 * `/api/people/:personId/rhythms` route and the My People screen.
 *
 * A relationship rhythm is an ordinary Life Rhythm (GoalActivity,
 * N_PER_WEEK) linked to a saved person (design 6.2). These choices map onto
 * EXISTING catalog activities (no new catalog entries, so recommendation
 * ranking is unchanged): the activity drives Panchang ranking and Daily
 * Rhythm placement exactly as for any other rhythm; the title only says who
 * it is with. Weekly cadences only (monthly is deferred, design 9).
 */
import { validateGoalActivityRhythm, type GoalActivityRhythm } from './goalActivityRhythm';
import {
  NO_RHYTHM_PREFERENCES,
  parseGoalActivityRhythmPreferencesPatch,
  resolveGoalActivityRhythmSettingsUpdate,
  type GoalActivityRhythmPreferences,
} from './goalActivityRhythmPreferences';
import { normalizeGoalActivityDailyFrequency } from './goalActivityDailyFrequency';

export type RelationshipRhythmChoice = 'CALL' | 'VISIT' | 'DINNER' | 'TIME_TOGETHER' | 'WALK';

export interface RelationshipRhythmChoiceDefinition {
  key: RelationshipRhythmChoice;
  label: string;
  /** An existing catalog activity: its Panchang profile and Daily Rhythm class are used unchanged. */
  activityId: string;
  defaultDurationMinutes: number;
  titleFor: (name: string) => string;
}

export const RELATIONSHIP_RHYTHM_CHOICES: readonly RelationshipRhythmChoiceDefinition[] = [
  { key: 'CALL', label: 'Call', activityId: 'catch-up', defaultDurationMinutes: 30, titleFor: (n) => `Call ${n}` },
  { key: 'VISIT', label: 'Visit', activityId: 'visit-family', defaultDurationMinutes: 120, titleFor: (n) => `Visit ${n}` },
  { key: 'DINNER', label: 'Dinner', activityId: 'family-dinner', defaultDurationMinutes: 90, titleFor: (n) => `Dinner with ${n}` },
  { key: 'TIME_TOGETHER', label: 'Time together', activityId: 'catch-up', defaultDurationMinutes: 60, titleFor: (n) => `Time with ${n}` },
  { key: 'WALK', label: 'Walk', activityId: 'walk-together', defaultDurationMinutes: 45, titleFor: (n) => `Walk with ${n}` },
];

export function relationshipRhythmChoice(key: unknown): RelationshipRhythmChoiceDefinition | null {
  return RELATIONSHIP_RHYTHM_CHOICES.find((c) => c.key === key) ?? null;
}

/** The visible, editable goal offered when the user creates a new one (D8). */
export const defaultRelationshipGoalTitle = (name: string) => `Stay close to ${name}`;

export const MAX_RELATIONSHIP_RHYTHM_TITLE = 200;
export const MAX_RELATIONSHIP_GOAL_TITLE = 200;
/** Weekly cadences a relationship rhythm offers (the Life Rhythm validator still has the final word). */
export const RELATIONSHIP_RHYTHM_TARGETS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Plain, factual cadence wording -- no streaks, scores or "you should". */
export function relationshipRhythmCadence(targetPerWeek: number | null): string {
  if (!targetPerWeek) return 'Weekly';
  return targetPerWeek === 1 ? 'Once a week' : targetPerWeek === 2 ? 'Twice a week' : `${targetPerWeek} times a week`;
}

export type ParsedRelationshipRhythmRequest =
  | {
      ok: true;
      value: {
        title: string;
        activityId: string;
        rhythm: GoalActivityRhythm;
        preferences: GoalActivityRhythmPreferences;
        goal: { kind: 'NEW'; title: string } | { kind: 'EXISTING'; goalId: string };
      };
    }
  | { ok: false; error: string };

/**
 * Validates an untrusted create request. The activity is derived from the
 * `choice` on the server (a client activityId is never accepted); the
 * rhythm and preferences go through the existing Life Rhythm validators,
 * and their combination through the same resolver an edit uses.
 */
export function parseRelationshipRhythmRequest(body: Record<string, unknown>): ParsedRelationshipRhythmRequest {
  const choice = relationshipRhythmChoice(body.choice);
  if (!choice) return { ok: false, error: 'choice must be one of CALL, VISIT, DINNER, TIME_TOGETHER or WALK.' };

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_RELATIONSHIP_RHYTHM_TITLE) return { ok: false, error: `A title of up to ${MAX_RELATIONSHIP_RHYTHM_TITLE} characters is required.` };

  const validated = validateGoalActivityRhythm({ kind: 'N_PER_WEEK', targetPerWeek: body.targetPerWeek });
  if (!validated.ok) return { ok: false, error: validated.error };

  let preferencesPatch = {};
  if (body.preferences !== undefined) {
    const parsed = parseGoalActivityRhythmPreferencesPatch(body.preferences);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    preferencesPatch = parsed.value;
  }
  const resolved = resolveGoalActivityRhythmSettingsUpdate(
    { rhythm: validated.rhythm, preferences: NO_RHYTHM_PREFERENCES, dailyFrequency: normalizeGoalActivityDailyFrequency({ dailyFrequencyKind: null, dailyFrequencyLimit: null }) },
    { preferences: { preferredDurationMinutes: choice.defaultDurationMinutes, ...preferencesPatch } }
  );
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const goal = body.goal as Record<string, unknown> | null | undefined;
  if (!goal || typeof goal !== 'object') return { ok: false, error: 'goal must be { kind: "NEW", title } or { kind: "EXISTING", goalId }.' };
  let parsedGoal: { kind: 'NEW'; title: string } | { kind: 'EXISTING'; goalId: string };
  if (goal.kind === 'NEW') {
    const goalTitle = typeof goal.title === 'string' ? goal.title.trim() : '';
    if (!goalTitle || goalTitle.length > MAX_RELATIONSHIP_GOAL_TITLE) return { ok: false, error: `A goal title of up to ${MAX_RELATIONSHIP_GOAL_TITLE} characters is required.` };
    parsedGoal = { kind: 'NEW', title: goalTitle };
  } else if (goal.kind === 'EXISTING') {
    if (typeof goal.goalId !== 'string' || !goal.goalId.trim()) return { ok: false, error: 'goalId is required for an existing goal.' };
    parsedGoal = { kind: 'EXISTING', goalId: goal.goalId.trim() };
  } else {
    return { ok: false, error: 'goal must be { kind: "NEW", title } or { kind: "EXISTING", goalId }.' };
  }

  return { ok: true, value: { title, activityId: choice.activityId, rhythm: resolved.value.rhythm, preferences: resolved.value.preferences, goal: parsedGoal } };
}
