'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { colors, spacing } from './theme';
import { SurfaceCard, PrimaryButton, TextButton } from './ui';
import { isMyPeoplePresentationEnabled } from '../lib/myPeopleGate';
import {
  KIND_ICON,
  formatCivilDay,
  homeOccasionHeadline,
  planHandoffForOccasion,
  selectHomeOccasion,
  turningText,
  type PersonPlanHandoff,
  type UpcomingRow,
} from '../lib/myPeopleOccasionUi';

/**
 * AURA-MP-3 -- the ONE My People card on Home (design 5.7 / 4.4).
 *
 * - Shown only when the public flag is on AND the server answers the
 *   upcoming request (404 while AURA_MY_PEOPLE_ENABLED is off -> nothing).
 * - At most one card: the soonest special day inside its own reminder
 *   window (the user's per-day choice) that is not dismissed; "+N more"
 *   opens My People.
 * - Ahead of the day: "Not now" (back on the day) or "Not this year".
 *   On the day: "Not this year". Nothing repeats after a dismissal.
 * - Warm and factual: no counts of neglect, no scores, no notes or chart
 *   details (the upcoming data carries neither).
 * - "Plan" only opens Plan with the person and dates pre-filled; a plan is
 *   created only when the user picks and confirms a time there.
 */
export function MyPeopleHomeCard({ onPlan, onOpenMyPeople }: { onPlan: (handoff: PersonPlanHandoff) => void; onOpenMyPeople: () => void }) {
  const [upcoming, setUpcoming] = useState<UpcomingRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!isMyPeoplePresentationEnabled()) return setUpcoming([]);
    try {
      const res = await fetch('/api/people/occasions/upcoming?days=30');
      setUpcoming(res.ok ? await res.json() : []);
    } catch {
      setUpcoming([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selection = upcoming ? selectHomeOccasion(upcoming) : null;
  if (!selection) return null;
  const { item, moreCount } = selection;
  const turning = turningText(item.kind, item.turning);

  const dismiss = async (scope: 'NOT_NOW' | 'NOT_THIS_YEAR') => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/people/occasions/${item.occasionId}/dismissal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope }) });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError("Couldn't update this. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SurfaceCard accentColor={colors.relationship}>
      <section aria-label="My People" data-testid="my-people-home-card" style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        <div style={{ display: 'flex', gap: spacing.md, alignItems: 'flex-start' }}>
          <span aria-hidden style={{ fontSize: 22, lineHeight: '26px' }}>{KIND_ICON[item.kind]}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: colors.textPrimary }}>{homeOccasionHeadline(item)}</div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              {formatCivilDay(item.date)}{item.observedFromLeapDay ? ' (for 29 Feb)' : ''}{turning ? ` · ${turning}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg }}>
          <PrimaryButton onClick={() => onPlan(planHandoffForOccasion(item))} disabled={busy}>Plan something</PrimaryButton>
          {item.daysUntil > 0 && <TextButton onClick={() => dismiss('NOT_NOW')} disabled={busy}>Not now</TextButton>}
          <TextButton onClick={() => dismiss('NOT_THIS_YEAR')} disabled={busy}>Not this year</TextButton>
          {moreCount > 0 && <TextButton onClick={onOpenMyPeople}>+{moreCount} more</TextButton>}
        </div>
        {error && <div role="alert" style={{ fontSize: 12, color: colors.danger }}>{error}</div>}
      </section>
    </SurfaceCard>
  );
}
