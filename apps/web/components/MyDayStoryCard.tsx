'use client';

import React, { useMemo, useState } from 'react';
import type { DailyStory } from '../lib/dailyStory';
import { BROAD_CHOICES, PEOPLE_SUBGROUPS, getIntentionGroup, DailyIntentionGroupId, DailyIntentionActivity, DailyIntentionBroadChoice } from '../lib/dailyIntentions';
import { getActivityDefinition } from '../../../packages/recommendation/src/activityDefinitions';
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

type Phase = 'STORY' | 'BROAD' | 'PEOPLE_WHO' | 'ACTIVITY' | 'SEARCHING' | 'RESULT' | 'NO_RESULT' | 'ERROR' | 'CREATING' | 'DONE';

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
  onOpenPeople,
  onCreated,
  onPlanTomorrow,
}: {
  story: DailyStory | null;
  onOpenPeople: () => void;
  onCreated: () => void;
  /** Brief section 14: "only the extension point" -- routes into the
   * existing Plan flow rather than a new Tomorrow product. */
  onPlanTomorrow?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('STORY');
  const [broadChoice, setBroadChoice] = useState<DailyIntentionBroadChoice | null>(null);
  const [groupId, setGroupId] = useState<DailyIntentionGroupId | null>(null);
  const [people, setPeople] = useState<SavedPersonRow[] | null>(null);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<SavedPersonRow | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<DailyIntentionActivity | null>(null);
  const [candidate, setCandidate] = useState<ResolvedCandidate | null>(null);
  const [error, setError] = useState('');

  const dayPhase = story?.phase ?? 'MORNING';
  const group = groupId ? getIntentionGroup(groupId) : undefined;

  const openIntentionPrompt = () => {
    trackEvent('MY_DAY_INTENTION_OPENED', { metadata: { dayPhase } });
    setPhase('BROAD');
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
    const durationMinutes = getActivityDefinition(selectedActivity.activityId as string)?.experience.defaultDurationMinutes ?? 45;
    setPhase('CREATING');
    try {
      await saveUpcomingPlanFromCandidate(candidate.solo, durationMinutes);
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
          {story.nextMeaningfulThing?.action === 'PLAN_TOMORROW' && onPlanTomorrow && (
            <div style={{ marginTop: spacing.lg }}>
              <TextButton onClick={onPlanTomorrow}>{story.nextMeaningfulThing.label}</TextButton>
            </div>
          )}
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
