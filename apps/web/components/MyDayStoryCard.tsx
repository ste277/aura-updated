'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { DailyStory } from '../lib/dailyStory';
import type { DailyReflection } from '../lib/dailyReflection';
import type { TomorrowPreview } from '../lib/tomorrowPreview';
import { BROAD_CHOICES, PEOPLE_SUBGROUPS, getIntentionGroup, DailyIntentionGroupId, DailyIntentionActivity, DailyIntentionBroadChoice } from '../lib/dailyIntentions';
import { getActivityDefinition } from '../../../packages/recommendation/src/activityDefinitions';
import { FULL_ACTIVITY_CATALOG } from '../../../packages/recommendation/src/personalizedTasks';
import type { TimingCandidate } from '../../../packages/recommendation/src/timingSearch';
import type { EverydaySharedCandidate } from '../../../packages/recommendation/src/everydayTimingFit';
import { RESULT_LABEL_TEXT, EVERYDAY_SHARED_RATING_TEXT, saveUpcomingPlanFromCandidate } from './PlanWithAuraView';
import { RELATIONSHIP_ICON, SavedPersonRow } from './PeopleView';
import { trackEvent } from '../lib/trackEvent';
import { colors, spacing, radius, typography } from './theme';
import { PrimaryButton, SecondaryButton, TextButton, ActivityChip, StatusBadge, type StatusTone } from './ui';

/**
 * My Day V1 -- the Daily Story narrative card + inline intention-discovery
 * flow (brief section 9/16/19-27). One self-contained widget: broad choice
 * -> (for PEOPLE) who -> activity -> find a time -> Add to my day / Invite
 * someone, reusing the exact same Timing Search / Shared Timing / Plan /
 * AuraMoment APIs the rest of the app already uses -- no new scoring, no
 * new creation model (brief section 17/21/26).
 */

type Phase =
  | 'STORY'
  | 'BROAD'
  | 'PEOPLE_WHO'
  | 'ACTIVITY'
  | 'SEARCHING'
  | 'RESULT'
  | 'NO_RESULT'
  | 'ERROR'
  | 'CREATING'
  | 'DONE'
  // Daily Reflection & Tomorrow Preview V1 (brief section 5/7) -- a
  // SEPARATE, shorter "Make room for tomorrow?" flow: broad category ->
  // (who, for PEOPLE) -> activity -> straight to the Plan/Timing Search
  // handoff. Deliberately never touches SEARCHING/RESULT/CREATING -- it
  // never calls Timing Search or creates anything itself.
  | 'TOMORROW_BROAD'
  | 'TOMORROW_WHO'
  | 'TOMORROW_ACTIVITY';

/** The exact FULL_ACTIVITY_CATALOG title for a dailyIntentions activityId --
 * required so the Plan handoff's initialActivity prop resolves via
 * resolveActivitySelection()'s exact-title match (PlanWithAuraView.tsx)
 * rather than falling through to a free-text search for a curated label
 * that doesn't happen to match the catalog's own title string. */
function catalogTitleFor(activityId: string): string | undefined {
  return FULL_ACTIVITY_CATALOG.find((a) => a.id === activityId)?.title;
}

function formatTimeRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${new Date(startIso).toLocaleTimeString('en-US', opts)} – ${new Date(endIso).toLocaleTimeString('en-US', opts)}`;
}

interface ResolvedCandidate {
  kind: 'SOLO' | 'SHARED';
  solo?: TimingCandidate;
  shared?: EverydaySharedCandidate;
}

export function MyDayStoryCard({
  story,
  reflection,
  tomorrowPreview,
  onOpenPeople,
  onCreated,
  onPlanTomorrow,
}: {
  story: DailyStory | null;
  /** Daily Reflection & Tomorrow Preview V1 (brief section 3) -- null until
   * loaded; only meaningfully rendered at the NIGHT phase. */
  reflection?: DailyReflection | null;
  /** Brief section 4/8 -- only ever populated at the NIGHT phase (see
   * myDayOrchestrator.ts); null the rest of the day by design. */
  tomorrowPreview?: TomorrowPreview | null;
  onOpenPeople: () => void;
  onCreated: () => void;
  /** Brief section 5/14: routes into the existing Plan/Timing Search flow
   * with the TOMORROW horizon (and, when a specific suggestion was picked,
   * an activity preselected) -- never creates a Plan itself. */
  onPlanTomorrow?: (activityTitle?: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('STORY');
  const [broadChoice, setBroadChoice] = useState<DailyIntentionBroadChoice | null>(null);
  const [groupId, setGroupId] = useState<DailyIntentionGroupId | null>(null);
  const [people, setPeople] = useState<SavedPersonRow[] | null>(null);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<SavedPersonRow | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<DailyIntentionActivity | null>(null);
  // Product Journey / E2E Hardening V1 -- the exact duration the search
  // actually ran with, so the later "Add to my day" save can reuse it
  // verbatim. Previously handleAddToMyDay recomputed a duration with a
  // SHORTER fallback chain (defaultDurationMinutes ?? 45, dropping
  // suggestedDurations) than chooseActivity's own search call
  // (defaultDurationMinutes ?? suggestedDurations[0] ?? 45) -- for any
  // USER_SELECTED-duration activity with no defaultDurationMinutes (e.g.
  // Deep Work: suggestedDurations [30, 60, 90], no default), the search
  // window was sized to 30 minutes while the save attempted 45, and
  // POST /api/plans correctly rejected the mismatch every time. Found via
  // this brief's E2E coverage (My Day -> Add Plan journey), not a
  // hypothetical.
  const [selectedDurationMinutes, setSelectedDurationMinutes] = useState<number>(45);
  const [candidate, setCandidate] = useState<ResolvedCandidate | null>(null);
  const [error, setError] = useState('');
  const [tomorrowBroadChoice, setTomorrowBroadChoice] = useState<DailyIntentionBroadChoice | null>(null);
  const [tomorrowGroupId, setTomorrowGroupId] = useState<DailyIntentionGroupId | null>(null);

  const dayPhase = story?.phase ?? 'MORNING';
  const group = groupId ? getIntentionGroup(groupId) : undefined;
  const tomorrowGroup = tomorrowGroupId ? getIntentionGroup(tomorrowGroupId) : undefined;

  // Brief section 15 -- one impression event each, fired once per mount of
  // an actually-populated NIGHT view (never on every render/poll).
  useEffect(() => {
    if (dayPhase !== 'NIGHT' || !reflection) return;
    trackEvent('DAILY_REFLECTION_VIEWED', { metadata: { completedCount: reflection.completed.length, missedCount: reflection.missed.length } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayPhase, reflection?.date]);

  useEffect(() => {
    if (!tomorrowPreview) return;
    trackEvent('TOMORROW_PREVIEW_VIEWED', { metadata: { hasScheduledItems: tomorrowPreview.agenda.items.length > 0, goodForCategoryCount: tomorrowPreview.goodForCategories.length } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tomorrowPreview?.date]);

  const openIntentionPrompt = () => {
    trackEvent('MY_DAY_INTENTION_OPENED', { metadata: { dayPhase } });
    setPhase('BROAD');
  };

  // Daily Reflection & Tomorrow Preview V1 (brief section 7) -- "Make room
  // for tomorrow?" reuses the exact same taxonomy (BROAD_CHOICES/
  // PEOPLE_SUBGROUPS/INTENTION_GROUPS) as today's own intention prompt, but
  // every path below terminates in onPlanTomorrow(), never a search.
  const openTomorrowPrompt = () => {
    setTomorrowBroadChoice(null);
    setTomorrowGroupId(null);
    setPhase('TOMORROW_BROAD');
  };

  const chooseTomorrowBroad = (choice: DailyIntentionBroadChoice) => {
    setTomorrowBroadChoice(choice);
    if (choice === 'PEOPLE') {
      setPhase('TOMORROW_WHO');
      return;
    }
    setTomorrowGroupId(choice as DailyIntentionGroupId);
    setPhase('TOMORROW_ACTIVITY');
  };

  const chooseTomorrowSubgroup = (id: DailyIntentionGroupId) => {
    setTomorrowGroupId(id);
    setPhase('TOMORROW_ACTIVITY');
  };

  const chooseTomorrowActivity = (activity: DailyIntentionActivity) => {
    if (!activity.activityId) return;
    trackEvent('TOMORROW_PROMPT_SELECTED', { metadata: { intentionCategory: tomorrowGroupId ?? 'WORK', activityId: activity.activityId } });
    onPlanTomorrow?.(catalogTitleFor(activity.activityId) ?? activity.label);
  };

  const choosePeople = async () => {
    setBroadChoice('PEOPLE');
    setPhase('PEOPLE_WHO');
    if (people === null) {
      setPeopleLoading(true);
      try {
        const res = await fetch('/api/people');
        const data = await res.json().catch(() => []);
        setPeople(res.ok && Array.isArray(data) ? data : []);
      } catch {
        setPeople([]);
      } finally {
        setPeopleLoading(false);
      }
    }
  };

  const chooseBroad = (choice: DailyIntentionBroadChoice) => {
    if (choice === 'PEOPLE') {
      void choosePeople();
      return;
    }
    setBroadChoice(choice);
    setGroupId(choice as DailyIntentionGroupId); // WORK/SELF/ENJOYMENT are also real group ids
    setPhase('ACTIVITY');
  };

  const choosePerson = (person: SavedPersonRow) => {
    setSelectedPerson(person);
    const inferredGroup: DailyIntentionGroupId = person.relationshipType === 'PARTNER' || person.relationshipType === 'SPOUSE' ? 'RELATIONSHIPS' : person.relationshipType === 'FAMILY' ? 'FAMILY' : 'SOCIAL';
    setGroupId(inferredGroup);
    setPhase('ACTIVITY');
  };

  const chooseSubgroup = (id: DailyIntentionGroupId) => {
    setSelectedPerson(null);
    setGroupId(id);
    setPhase('ACTIVITY');
  };

  const chooseActivity = async (activity: DailyIntentionActivity) => {
    if (!activity.activityId) return;
    setSelectedActivity(activity);
    trackEvent('MY_DAY_INTENTION_SELECTED', { metadata: { intentionCategory: groupId ?? 'WORK', activityId: activity.activityId, dayPhase } });

    const definition = getActivityDefinition(activity.activityId);
    const durationMinutes = definition?.experience.defaultDurationMinutes ?? definition?.experience.suggestedDurations?.[0] ?? 45;
    setSelectedDurationMinutes(durationMinutes);

    setPhase('SEARCHING');
    setError('');
    trackEvent('MY_DAY_ADD_STARTED', { metadata: { intentionCategory: groupId ?? 'WORK', activityId: activity.activityId, dayPhase } });

    try {
      if (selectedPerson) {
        const res = await fetch('/api/timing-search/shared', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activityId: activity.activityId, durationMinutes, horizon: 'TODAY', savedPersonId: selectedPerson.id }),
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'OK' || !data.candidates?.length) {
          setPhase(res.ok ? 'NO_RESULT' : 'ERROR');
          return;
        }
        setCandidate({ kind: 'SHARED', shared: data.candidates[0] });
      } else {
        const res = await fetch('/api/timing-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'FIND', activityId: activity.activityId, durationMinutes, horizon: 'TODAY', limit: 3 }),
        });
        const data = await res.json();
        if (!res.ok || !data.candidates?.length) {
          setPhase(res.ok ? 'NO_RESULT' : 'ERROR');
          return;
        }
        setCandidate({ kind: 'SOLO', solo: data.candidates[0] });
      }
      setPhase('RESULT');
    } catch {
      setPhase('ERROR');
    }
  };

  const handleAddToMyDay = async () => {
    if (!candidate?.solo || !selectedActivity) return;
    setPhase('CREATING');
    try {
      await saveUpcomingPlanFromCandidate(candidate.solo, selectedDurationMinutes);
      // Product Journey / E2E Hardening V1 (brief section 26) -- the
      // My Day intention flow's own doc comment already claimed this
      // reuses PLAN_RESULT_SELECTED "via the existing reused APIs", but
      // that never actually fired here -- a real gap in the
      // MY_DAY_INTENTION_OPENED -> ... -> Plan/Moment created funnel
      // (the Moment side already fires AURA_MOMENT_CREATED server-side
      // from POST /api/aura-moments regardless of caller; the Plan side
      // had no equivalent). Reuses the exact same event
      // PlanWithAuraView's own "Use this time" already fires for the
      // identical outcome, not a new My-Day-specific event.
      trackEvent('PLAN_RESULT_SELECTED', { metadata: { mode: 'FIND' } });
      setPhase('DONE');
    } catch {
      setError('Could not add this to your day. Try again.');
      setPhase('RESULT');
    }
  };

  const handleInvite = async () => {
    if (!candidate?.shared || !selectedActivity || !selectedPerson) return;
    setPhase('CREATING');
    try {
      const res = await fetch('/api/aura-moments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'SHARED',
          source: 'PLAN',
          activityId: selectedActivity.activityId,
          startAt: candidate.shared.generalCandidate.start,
          endAt: candidate.shared.generalCandidate.end,
          ratingLabel: candidate.shared.rating,
          savedPersonId: selectedPerson.id,
        }),
      });
      if (!res.ok) throw new Error('failed');
      setPhase('DONE');
    } catch {
      setError('Could not send this invite. Try again.');
      setPhase('RESULT');
    }
  };

  const reset = () => {
    setPhase('STORY');
    setBroadChoice(null);
    setGroupId(null);
    setSelectedPerson(null);
    setSelectedActivity(null);
    setSelectedDurationMinutes(45);
    setCandidate(null);
    setError('');
    onCreated();
  };

  const relevantPeople = useMemo(() => people ?? [], [people]);

  return (
    <section
      style={{
        background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.96), rgba(13, 28, 62, 0.82))',
        border: '1px solid rgba(96, 165, 250, 0.18)',
        borderRadius: radius.lg,
        padding: spacing.xxl,
      }}
    >
      {phase === 'STORY' && story && (
        <>
          <h2 style={{ ...typography.pageTitle, fontSize: 21, margin: 0 }}>{story.headline}</h2>
          <p style={{ ...typography.body, marginTop: spacing.sm, lineHeight: 1.5 }}>{story.narrative}</p>
          {story.completedHighlights && story.completedHighlights.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              {story.completedHighlights.map((item) => (
                <StatusBadge key={item.id} label={`${item.icon ?? '✓'} ${item.title}`} tone="positive" />
              ))}
            </div>
          )}
          {story.primaryPrompt && (
            <div style={{ marginTop: spacing.lg }}>
              <TextButton onClick={openIntentionPrompt}>{story.primaryPrompt.question}</TextButton>
            </div>
          )}
          {story.suggestedIntentions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg }}>
              {story.suggestedIntentions.map((s) => (
                <ActivityChip key={s.groupId} label={s.label} icon={s.icon} onClick={() => chooseSubgroup(s.groupId)} />
              ))}
            </div>
          )}
          {dayPhase === 'NIGHT' && (
            <div style={{ marginTop: spacing.lg }}>
              <TextButton onClick={openTomorrowPrompt}>What would make tomorrow feel well spent?</TextButton>
            </div>
          )}

          {dayPhase === 'NIGHT' && tomorrowPreview && (
            <div style={{ marginTop: spacing.xl, paddingTop: spacing.lg, borderTop: '1px solid rgba(148, 163, 184, 0.16)' }}>
              <div style={{ ...typography.sectionEyebrow }}>{tomorrowPreview.headline}</div>
              <p style={{ ...typography.body, marginTop: spacing.sm, lineHeight: 1.5 }}>{tomorrowPreview.narrative}</p>
              {tomorrowPreview.goodForCategories.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                  {tomorrowPreview.goodForCategories.map((c) => (
                    <StatusBadge key={c.activityId} label={`${c.icon} ${c.label}`} tone="neutral" />
                  ))}
                </div>
              )}
              {tomorrowPreview.agenda.items.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs, marginTop: spacing.md }}>
                  {tomorrowPreview.agenda.items.map((item) => (
                    <div key={item.id} style={{ ...typography.meta, color: colors.textSecondary }}>
                      {item.icon ?? '•'} {item.title} · {new Date(item.startAt).toLocaleTimeString('en-US', { timeZone: tomorrowPreview.timezone, hour: 'numeric', minute: '2-digit' })}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: spacing.md }}>
                <TextButton onClick={() => onPlanTomorrow?.()}>Plan tomorrow →</TextButton>
              </div>
            </div>
          )}
        </>
      )}

      {phase === 'TOMORROW_BROAD' && (
        <>
          <BackRow onBack={() => setPhase('STORY')} />
          <h2 style={{ ...typography.pageTitle, fontSize: 19, marginTop: spacing.md }}>What would make tomorrow feel well spent?</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, marginTop: spacing.lg }}>
            {BROAD_CHOICES.map((choice) => (
              <SecondaryButton key={choice.id} onClick={() => chooseTomorrowBroad(choice.id)} style={{ width: '100%', justifyContent: 'flex-start' }}>
                {choice.icon} {choice.label}
              </SecondaryButton>
            ))}
          </div>
        </>
      )}

      {phase === 'TOMORROW_WHO' && (
        <>
          <BackRow onBack={() => setPhase('TOMORROW_BROAD')} />
          <h2 style={{ ...typography.pageTitle, fontSize: 19, marginTop: spacing.md }}>Who with?</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg }}>
            {PEOPLE_SUBGROUPS.map((sg) => (
              <ActivityChip key={sg.groupId} label={sg.label} icon={sg.icon} onClick={() => chooseTomorrowSubgroup(sg.groupId)} />
            ))}
          </div>
        </>
      )}

      {phase === 'TOMORROW_ACTIVITY' && tomorrowGroup && (
        <>
          <BackRow onBack={() => setPhase(tomorrowBroadChoice === 'PEOPLE' ? 'TOMORROW_WHO' : 'TOMORROW_BROAD')} />
          <h2 style={{ ...typography.pageTitle, fontSize: 19, marginTop: spacing.md }}>What sounds good?</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg }}>
            {tomorrowGroup.activities
              .filter((a) => a.activityId)
              .map((activity) => (
                <ActivityChip key={activity.label} label={activity.label} icon={activity.icon} onClick={() => chooseTomorrowActivity(activity)} />
              ))}
          </div>
        </>
      )}

      {phase === 'BROAD' && (
        <>
          <BackRow onBack={() => setPhase('STORY')} />
          <h2 style={{ ...typography.pageTitle, fontSize: 19, marginTop: spacing.md }}>What would make today feel well spent?</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, marginTop: spacing.lg }}>
            {BROAD_CHOICES.map((choice) => (
              <SecondaryButton key={choice.id} onClick={() => chooseBroad(choice.id)} style={{ width: '100%', justifyContent: 'flex-start' }}>
                {choice.icon} {choice.label}
              </SecondaryButton>
            ))}
          </div>
        </>
      )}

      {phase === 'PEOPLE_WHO' && (
        <>
          <BackRow onBack={() => setPhase('BROAD')} />
          <h2 style={{ ...typography.pageTitle, fontSize: 19, marginTop: spacing.md }}>Who with?</h2>
          {peopleLoading ? (
            <div style={{ ...typography.body, marginTop: spacing.md }}>Loading…</div>
          ) : (
            <>
              {relevantPeople.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg }}>
                  {relevantPeople.map((person) => (
                    <ActivityChip key={person.id} label={person.name} icon={RELATIONSHIP_ICON[person.relationshipType]} onClick={() => choosePerson(person)} />
                  ))}
                </div>
              )}
              <div style={{ ...typography.meta, marginTop: spacing.lg, marginBottom: spacing.sm }}>Or by relationship</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
                {PEOPLE_SUBGROUPS.map((sg) => (
                  <ActivityChip key={sg.groupId} label={sg.label} icon={sg.icon} onClick={() => chooseSubgroup(sg.groupId)} />
                ))}
              </div>
              <div style={{ marginTop: spacing.lg }}>
                <TextButton onClick={onOpenPeople}>+ Add person</TextButton>
              </div>
            </>
          )}
        </>
      )}

      {phase === 'ACTIVITY' && group && (
        <>
          <BackRow onBack={() => setPhase(broadChoice === 'PEOPLE' ? 'PEOPLE_WHO' : 'BROAD')} />
          <h2 style={{ ...typography.pageTitle, fontSize: 19, marginTop: spacing.md }}>What sounds good?</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg }}>
            {group.activities
              .filter((a) => a.activityId)
              .map((activity) => (
                <ActivityChip key={activity.label} label={activity.label} icon={activity.icon} onClick={() => chooseActivity(activity)} />
              ))}
          </div>
        </>
      )}

      {phase === 'SEARCHING' && <div style={{ ...typography.body, textAlign: 'center', padding: `${spacing.xl}px 0` }}>Finding a good time…</div>}

      {phase === 'ERROR' && (
        <EmptyPhase title="Search unavailable" description="Couldn't find a time right now." action={<SecondaryButton onClick={() => selectedActivity && chooseActivity(selectedActivity)}>Try again</SecondaryButton>} />
      )}

      {phase === 'NO_RESULT' && (
        <EmptyPhase title="No strong times found today" description="Try again another day, or from the full Plan screen for a wider search." action={<SecondaryButton onClick={reset}>Done</SecondaryButton>} />
      )}

      {(phase === 'RESULT' || phase === 'CREATING') && candidate && selectedActivity && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ ...typography.sectionEyebrow }}>Best time today</div>
          <h2 style={{ ...typography.pageTitle, fontSize: 20, marginTop: spacing.sm }}>{selectedActivity.icon} {selectedActivity.label}</h2>
          {candidate.kind === 'SOLO' && candidate.solo && (
            <>
              <div style={{ ...typography.bodyStrong, marginTop: spacing.sm }}>{formatTimeRange(candidate.solo.start, candidate.solo.end)}</div>
              <div style={{ marginTop: spacing.md }}>
                <StatusBadge label={RESULT_LABEL_TEXT[candidate.solo.label]} tone="positive" />
              </div>
            </>
          )}
          {candidate.kind === 'SHARED' && candidate.shared && (
            <>
              <div style={{ ...typography.bodyStrong, marginTop: spacing.sm }}>{formatTimeRange(candidate.shared.generalCandidate.start, candidate.shared.generalCandidate.end)}</div>
              <div style={{ marginTop: spacing.md }}>
                <StatusBadge label={EVERYDAY_SHARED_RATING_TEXT[candidate.shared.rating] ?? 'Good fit'} tone="relationship" />
              </div>
            </>
          )}
          {error && <div style={{ color: colors.danger, fontSize: 12, marginTop: spacing.md }}>{error}</div>}
          <PrimaryButton onClick={candidate.kind === 'SOLO' ? handleAddToMyDay : handleInvite} disabled={phase === 'CREATING'} style={{ width: '100%', marginTop: spacing.xl }}>
            {phase === 'CREATING' ? 'Saving…' : candidate.kind === 'SOLO' ? 'Add to my day' : `Invite ${selectedPerson?.name ?? 'them'}`}
          </PrimaryButton>
          <div style={{ marginTop: spacing.md }}>
            <TextButton onClick={reset} color={colors.textMuted}>Cancel</TextButton>
          </div>
        </div>
      )}

      {phase === 'DONE' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 30 }}>✓</div>
          <h2 style={{ ...typography.pageTitle, fontSize: 19, marginTop: spacing.sm }}>{candidate?.kind === 'SHARED' ? 'Invite sent' : 'Added to your day'}</h2>
          <SecondaryButton onClick={reset} style={{ marginTop: spacing.lg }}>Done</SecondaryButton>
        </div>
      )}
    </section>
  );
}

function BackRow({ onBack }: { onBack: () => void }) {
  return <TextButton onClick={onBack} color={colors.textMuted}>← Back</TextButton>;
}

function EmptyPhase({ title, description, action }: { title: string; description: string; action: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: `${spacing.lg}px 0` }}>
      <div style={{ ...typography.bodyStrong }}>{title}</div>
      <p style={{ ...typography.body, marginTop: spacing.xs }}>{description}</p>
      <div style={{ marginTop: spacing.md }}>{action}</div>
    </div>
  );
}
