/**
 * AURA-MP-4 (62025) -- pure Relationship Rhythm rules (lib/myPeopleRhythms.ts).
 * Run (CI: math-core-tests):  npx ts-node test/myPeopleMp4Rules.test.ts
 */
import {
  RELATIONSHIP_RHYTHM_CHOICES,
  defaultRelationshipGoalTitle,
  parseRelationshipRhythmRequest,
  relationshipRhythmCadence,
} from '../apps/web/lib/myPeopleRhythms';
import { getActivityProfileById } from '../packages/recommendation/src/personalizedTasks';

let failed = 0;
let count = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  count++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${!ok && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failed++;
}
const goal = { kind: 'NEW', title: 'Stay close to Amma' };

check('Every choice maps to an EXISTING catalog activity (no new catalog entries; ranking unchanged)', RELATIONSHIP_RHYTHM_CHOICES.every((c) => getActivityProfileById(c.activityId)?.id === c.activityId));
check('Choices cover call, visit, dinner, time together and walk', RELATIONSHIP_RHYTHM_CHOICES.map((c) => c.key).join() === 'CALL,VISIT,DINNER,TIME_TOGETHER,WALK');
check('Default titles name the person ("Call Amma", "Dinner with Amma")', RELATIONSHIP_RHYTHM_CHOICES[0].titleFor('Amma') === 'Call Amma' && RELATIONSHIP_RHYTHM_CHOICES[2].titleFor('Amma') === 'Dinner with Amma');
check('Default goal title is "Stay close to {name}"', defaultRelationshipGoalTitle('Amma') === 'Stay close to Amma');

const ok = parseRelationshipRhythmRequest({ choice: 'CALL', title: '  Call Amma ', targetPerWeek: 2, goal, activityId: 'marriage' });
check('Valid request: weekly rhythm, activity from the choice (client activityId ignored), call duration 30 min, trimmed title', ok.ok && ok.value.activityId === 'catch-up' && ok.value.rhythm.kind === 'N_PER_WEEK' && (ok.value.rhythm as any).targetPerWeek === 2 && ok.value.preferences.preferredDurationMinutes === 30 && ok.value.title === 'Call Amma', ok);
const pref = parseRelationshipRhythmRequest({ choice: 'VISIT', title: 'Visit', targetPerWeek: 1, goal, preferences: { preferredTimeOfDay: 'EVENING', preferredDurationMinutes: 90 } });
check('Optional preferences use the existing Life Rhythm parser and override the default duration', pref.ok && pref.value.preferences.preferredTimeOfDay === 'EVENING' && pref.value.preferences.preferredDurationMinutes === 90, pref);
const existing = parseRelationshipRhythmRequest({ choice: 'WALK', title: 'Walk', targetPerWeek: 1, goal: { kind: 'EXISTING', goalId: ' g1 ' } });
check('Existing-goal attachment is parsed (trimmed id)', existing.ok && existing.value.goal.kind === 'EXISTING' && (existing.value.goal as any).goalId === 'g1');

const bad = [
  { choice: 'TEXT', title: 'x', targetPerWeek: 1, goal },
  { choice: 'CALL', title: '', targetPerWeek: 1, goal },
  { choice: 'CALL', title: 'x', targetPerWeek: 0, goal },
  { choice: 'CALL', title: 'x', targetPerWeek: 1.5, goal },
  { choice: 'CALL', title: 'x', targetPerWeek: 1 },
  { choice: 'CALL', title: 'x', targetPerWeek: 1, goal: { kind: 'NEW', title: ' ' } },
  { choice: 'CALL', title: 'x', targetPerWeek: 1, goal: { kind: 'EXISTING' } },
  { choice: 'CALL', title: 'x', targetPerWeek: 1, goal, preferences: { colour: 'red' } },
  { choice: 'CALL', title: 'x'.repeat(201), targetPerWeek: 1, goal },
];
check('Invalid requests are all rejected (unknown choice, empty/long title, 0 or fractional cadence, missing/blank goal, unknown preference)', bad.every((b) => !parseRelationshipRhythmRequest(b as any).ok));

const words = [1, 2, 3, 7].map(relationshipRhythmCadence);
check('Cadence wording is plain ("Once a week", "Twice a week", "3 times a week")', words.join('|') === 'Once a week|Twice a week|3 times a week|7 times a week', words);
check('No guilt or scoring words in any wording', ![...words, defaultRelationshipGoalTitle('A'), ...RELATIONSHIP_RHYTHM_CHOICES.map((c) => c.titleFor('A'))].some((w) => /haven't|forgot|overdue|neglect|score|streak|should|don't miss/i.test(w)));

console.log(failed === 0 ? `\nALL MY PEOPLE MP-4 RULES CHECKS PASSED (${count})` : `\n${failed} MY PEOPLE MP-4 RULES CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
