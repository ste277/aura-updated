'use client';

import React, { useEffect, useState } from 'react';
import { colors, spacing, typography } from './theme';
import { SectionHeader, SurfaceCard, PrimaryButton, TextButton } from './ui';
import { loadLastExpandedLocalDate, saveLastExpandedLocalDate } from '../lib/dailyBriefingViewState';
import type { AstroDailyBriefing } from '../lib/dailyAstroBriefing';

/**
 * AURA DB2 -- the Home "Personalized Daily Briefing" card.
 *
 * Pure presentation + fetch/view-state orchestration. Every interpretive
 * word shown here (dailyTheme/career/finance/focus/beMindful) is read
 * VERBATIM from the DB1 engine's own response -- this component never
 * computes, reinterprets, or re-derives any astrology of its own (DB2
 * brief section 8: "DB2 consumes the DB1 contract; it must not recreate
 * the interpretation logic in React").
 */

type FetchState =
  | { status: 'loading' }
  | { status: 'ok'; briefing: AstroDailyBriefing }
  | { status: 'unavailable'; reason: 'INCOMPLETE_BIRTH_PROFILE' | 'INVALID_BIRTH_PROFILE' }
  | { status: 'error' };

/**
 * Module-level (NOT component-local useRef/useState) guard against the
 * expand/compact decision being re-derived twice for the same user+date.
 * This matters because React 18 dev-mode StrictMode intentionally
 * double-invokes effects on mount (and, transitively, the data-fetch
 * effect below can resolve twice with two distinct-by-reference `state`
 * objects for the SAME logical visit) -- a component-local ref reset
 * between those two passes would let the SECOND pass re-read localStorage
 * AFTER the first pass's own write, wrongly conclude "not first visit",
 * and flip an already-correctly-expanded card back to compact. Confirmed
 * live during DB2's own verification pass. A plain module-scope Set
 * survives that double-invoke regardless of the exact component-instance
 * lifecycle, so the expand decision is made exactly once per user+date
 * per page load, never re-derived out from under itself.
 */
const sessionDecidedExpandKeys = new Set<string>();

function formatLocalDateLabel(dateStr: string): string {
  // briefing.localDate is already a resolved "YYYY-MM-DD" calendar date
  // (server-side, in the user's own configured timezone) -- parsed here
  // as a fixed UTC midnight and formatted with timeZone: 'UTC' so the
  // VIEWER's own browser timezone can never shift the displayed day by
  // one, which a plain `new Date(dateStr)` + local-format would risk.
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function DailyBriefingCard({
  userId,
  timezone,
  onOpenBirthProfile,
  onPlanClick,
}: {
  /** Used only to namespace the per-user "already shown expanded today"
   * localStorage key (see lib/dailyBriefingViewState.ts) -- never sent
   * anywhere, never used to request another user's data (the API route
   * itself is strictly session-scoped regardless of any prop here). */
  userId?: string;
  /** DB2 review fix: the viewer's OWN current configured timezone
   * (HomeDashboard's existing `effectiveTimezone`) -- included ONLY as a
   * fetch-effect dependency, never sent to the API (the route resolves
   * "today" server-side from the session's own user row, same as
   * before). Without this, changing timezone mid-session (Location &
   * Time settings -> handleLocationChanged in page.tsx, the SAME trigger
   * that already refreshes My Day's own agenda/story/reflection and the
   * daily-assistant briefing/insight signals for exactly this reason)
   * left this card showing a stale, wrong-timezone briefing until an
   * unrelated remount or manual retry -- confirmed during DB2's
   * independent final review. Reusing the EXISTING effectiveTimezone the
   * rest of Home already recomputes reactively on every user.timezone
   * change needs no new state/fetch of its own. */
  timezone?: string;
  onOpenBirthProfile?: () => void;
  onPlanClick?: (activity?: string) => void;
}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [expanded, setExpanded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    fetch('/api/daily-briefing/today')
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!data || typeof data.status !== 'string') {
          setState({ status: 'error' });
          return;
        }
        if (data.status === 'OK' && data.briefing) {
          setState({ status: 'ok', briefing: data.briefing as AstroDailyBriefing });
          return;
        }
        if (data.status === 'UNAVAILABLE' && (data.reason === 'INCOMPLETE_BIRTH_PROFILE' || data.reason === 'INVALID_BIRTH_PROFILE')) {
          setState({ status: 'unavailable', reason: data.reason });
          return;
        }
        // AUTH_REQUIRED / CALCULATION_UNAVAILABLE / SERVER_ERROR / any
        // unrecognized shape -- DB2 brief section 7: "Temporary failure...
        // Allow retry without disrupting Home" and "Unavailable
        // interpretation: show a clear unavailable state rather than
        // misleading generic astrological content." Both collapse to the
        // same retry-able error treatment here; neither ever fabricates
        // briefing text.
        setState({ status: 'error' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, timezone, retryKey]);

  // DB2 brief section 4 (merge-critical): "Do not mark a briefing as
  // viewed merely because Home mounted or an API request started. Only
  // persist the daily viewed state after valid personalized content has
  // successfully rendered." This effect only ever runs once `state` has
  // already become `{status:'ok', ...}` -- never from the loading/error/
  // unavailable branches above, and never speculatively.
  useEffect(() => {
    if (state.status !== 'ok' || !userId) return;
    const localDate = state.briefing.localDate;
    const key = `${userId}:${localDate}`;
    if (sessionDecidedExpandKeys.has(key)) return;
    sessionDecidedExpandKeys.add(key);
    const lastExpanded = loadLastExpandedLocalDate(userId);
    const isFirstVisitToday = lastExpanded !== localDate;
    if (isFirstVisitToday) {
      setExpanded(true);
      saveLastExpandedLocalDate(userId, localDate);
    } else {
      setExpanded(false);
    }
  }, [state, userId]);

  if (state.status === 'loading') {
    return (
      <SurfaceCard role="status" ariaLive="polite" style={{ minHeight: 92 }}>
        <SectionHeader label="Personalized Daily Briefing" />
        <div style={{ ...typography.body, color: colors.textMuted }}>Reading today's traditional themes…</div>
      </SurfaceCard>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <SurfaceCard>
        <SectionHeader label="Personalized Daily Briefing" />
        <div style={{ ...typography.body }}>Add your birth details to see your personalized daily briefing.</div>
        {onOpenBirthProfile && (
          <div style={{ marginTop: spacing.md }}>
            <TextButton onClick={onOpenBirthProfile} color={colors.traditional}>
              Add birth details →
            </TextButton>
          </div>
        )}
      </SurfaceCard>
    );
  }

  if (state.status === 'error') {
    return (
      <SurfaceCard role="alert">
        <SectionHeader label="Personalized Daily Briefing" />
        <div style={{ ...typography.body }}>Couldn't load your daily briefing right now.</div>
        <div style={{ marginTop: spacing.md }}>
          <TextButton onClick={() => setRetryKey((k) => k + 1)} color={colors.textMuted}>
            Try again
          </TextButton>
        </div>
      </SurfaceCard>
    );
  }

  const b = state.briefing;
  const dateLabel = formatLocalDateLabel(b.localDate);

  if (!expanded) {
    return (
      <SurfaceCard accentColor={colors.traditional}>
        <SectionHeader
          label="Personalized Daily Briefing"
          color={colors.traditional}
          right={
            <TextButton onClick={() => setExpanded(true)} color={colors.traditional} ariaLabel="Expand today's full briefing">
              Read more →
            </TextButton>
          }
        />
        <div style={{ ...typography.caption, color: colors.textMuted, marginBottom: 4 }}>For {dateLabel}</div>
        <div style={{ ...typography.bodyStrong }}>{firstSentence(b.dailyTheme)}</div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard accentColor={colors.traditional}>
      <SectionHeader
        label="Personalized Daily Briefing"
        color={colors.traditional}
        right={
          <TextButton onClick={() => setExpanded(false)} color={colors.textMuted} ariaLabel="Collapse the briefing">
            Collapse ↑
          </TextButton>
        }
      />
      <div style={{ ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm }}>
        For {dateLabel} · Natal Moon in {b.natalMoonSign} ({b.natalNakshatra})
      </div>
      <p style={{ ...typography.caption, color: colors.textFaint, margin: `0 0 ${spacing.md}px`, lineHeight: 1.4 }}>
        Today's themes based on your birth chart and planetary transits.
      </p>

      <BriefingSection label="Daily Theme" text={b.dailyTheme} />
      <BriefingSection label="Career" text={b.career} />
      <BriefingSection label="Finances" text={b.finance} />
      <BriefingSection label="Focus" text={b.focus} />
      <BriefingSection label="Be Mindful" text={b.beMindful} last />

      {onPlanClick && (
        <div style={{ marginTop: spacing.lg, paddingTop: spacing.lg, borderTop: `1px solid ${colors.borderSubtle}` }}>
          <PrimaryButton onClick={() => onPlanClick('Focused work')} style={{ background: colors.traditional }}>
            Find time for focused work
          </PrimaryButton>
        </div>
      )}
    </SurfaceCard>
  );
}

function firstSentence(text: string): string {
  const match = text.match(/^[^.]+\./);
  return match ? match[0] : text;
}

function BriefingSection({ label, text, last }: { label: string; text: string; last?: boolean }) {
  return (
    <div style={{ marginBottom: last ? 0 : spacing.md }}>
      <div style={{ ...typography.meta, color: colors.traditional, fontWeight: 800, marginBottom: 2 }}>{label}</div>
      <p style={{ ...typography.body, margin: 0, lineHeight: 1.45 }}>{text}</p>
    </div>
  );
}
