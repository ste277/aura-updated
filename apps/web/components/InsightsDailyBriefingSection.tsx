'use client';

import React, { useEffect, useState } from 'react';
import { colors, spacing, typography } from './theme';
import { SectionHeader, SurfaceCard, SegmentedControl, TextButton, StatusBadge } from './ui';
import { getDatePartsInTimezone, addDaysToDateStr } from '../lib/timezone';
import type { AstroDailyBriefing, GocharEvidenceRef } from '../lib/dailyAstroBriefing';

/**
 * AURA DB3 -- the Insights Overview "Personalized Daily Briefing" section.
 *
 * Pure presentation + fetch/async orchestration, same discipline as DB2's
 * Home card (DailyBriefingCard.tsx): every interpretive word is read
 * VERBATIM from the DB1 engine's own response (via the SAME, unmodified
 * GET /api/daily-briefing/today route, now DB3-extended with `?date=`).
 * This component never computes, reinterprets, or re-derives any
 * astrology -- it only selects which already-generated date to display
 * and translates DB1's own evidence entries into an expandable
 * explanation using their own `.summary` strings, never inventing new
 * factors or exposing raw evidence JSON.
 *
 * ASYNC SAFETY (DB3 brief section 7, "priority correctness requirement",
 * explicitly citing DB2's own in-session timezone-change bug): uses the
 * SAME per-invocation closure `cancelled` flag DB2's independent review
 * deterministically proved race-safe for cross-user/cross-timezone/
 * older-response/unmount scenarios (test/dailyBriefingCardLifecycle.test.ts)
 * -- here with `selectedDate` added as a FOURTH effect dependency
 * (alongside userId/timezone/retryKey), since a date-selection change is
 * exactly the same class of "identity that invalidates an in-flight
 * request" as a user or timezone change already was.
 *
 * DB4 -- two fixes from DB3's own independent review: (1) Daily Theme's
 * "Why this guidance?" now includes the Tara Bala evidence its own text
 * always cites (see selectSectionEvidence()'s doc comment); (2) the
 * Today/Yesterday control's `role="tablist"` is no longer duplicated --
 * it lives on SegmentedControl's own element now (via its new `ariaLabel`
 * prop), not on a second wrapping div.
 */

type FetchState =
  | { status: 'loading' }
  | { status: 'ok'; briefing: AstroDailyBriefing }
  | { status: 'unavailable'; reason: 'INCOMPLETE_BIRTH_PROFILE' | 'INVALID_BIRTH_PROFILE' }
  | { status: 'error' };

interface ReflectionSummary {
  outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW';
  followedGuidance: boolean;
  notes?: string | null;
}

const OUTPUT_LEVEL_LABEL: Record<ReflectionSummary['outputLevel'], string> = {
  LOW: 'Low',
  MODERATE: 'Balanced',
  PEAK_FLOW: 'Strong',
};

/** The user's own "yesterday", computed via the SAME utilities (getDatePartsInTimezone
 * + addDaysToDateStr) DB1/DB2 already use for every other local-date
 * resolution in this codebase -- using the viewer's current configured
 * `timezone` (never the browser's own locale/timezone). A few seconds of
 * client/server clock skew right at the user's own local midnight is the
 * only theoretical imprecision here, the same negligible-risk category
 * every other client-side "what day is it" read in this app (e.g.
 * HomeDashboard.tsx's own todayLabel/greeting) already accepts -- the
 * SERVER remains authoritative for the actual astrology; this only picks
 * which date string to request. */
function resolveYesterdayLocalDate(timezone: string): string {
  const today = getDatePartsInTimezone(timezone, new Date()).dateStr;
  return addDaysToDateStr(today, -1);
}

/**
 * DB4 -- Daily Theme evidence completeness (fixing a gap DB3's own
 * independent review found: dailyAstroBriefing.ts's composeDailyTheme()
 * UNCONDITIONALLY appends a Tara Bala sentence to the Daily Theme text
 * ("It also falls on your ... Tara ..."), but DB3's evidence filter only
 * ever matched `category === 'DAILY_THEME'`, so that claim had no
 * corresponding entry in the "Why this guidance?" expansion.
 *
 * This is a small, deterministic mapping -- not "show every evidence
 * entry": Daily Theme's prose is read, by construction, from
 * dailyAstroBriefing.ts's own composeDailyTheme(), which:
 *   - ALWAYS cites Tara Bala (the `tara` sentence is unconditional) --
 *     so the TARA_BALA evidence entry is always folded in here.
 *   - NEVER cites Chandra Bala by name -- composeDailyTheme() doesn't even
 *     take chandraBala as a parameter. Folding CHANDRA_BALA evidence in
 *     here too would both (a) attach an explanation to a claim the text
 *     never actually makes, and (b) duplicate the Moon's own per-graha
 *     DAILY_THEME entry already included (same house, same favorability,
 *     just phrased as "Chandra Bala" instead of "Moon is transiting
 *     House N..."). So CHANDRA_BALA is deliberately excluded here. If a
 *     future DB1 change makes Daily Theme's prose reference Chandra Bala
 *     too, this mapping should be revisited alongside that change --
 *     this function does not reconstruct or infer an association DB1
 *     itself doesn't assert.
 *
 * Every other section's evidence is untouched (exact `category` match,
 * same as before).
 */
export function selectSectionEvidence(evidence: GocharEvidenceRef[], category: GocharEvidenceRef['category']): GocharEvidenceRef[] {
  if (category === 'DAILY_THEME') {
    return evidence.filter((e) => e.category === 'DAILY_THEME' || e.category === 'TARA_BALA');
  }
  return evidence.filter((e) => e.category === category);
}

function formatLocalDateLabel(dateStr: string): string {
  // Same deliberate UTC-anchored formatting as DailyBriefingCard.tsx's
  // own formatLocalDateLabel -- dateStr is already a resolved calendar
  // date (server-side, in the user's own timezone); parsing/formatting
  // it in UTC here means the VIEWER's own browser timezone can never
  // shift the displayed day by one.
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function InsightsDailyBriefingSection({
  userId,
  timezone,
  onOpenBirthProfile,
}: {
  userId?: string;
  timezone: string;
  onOpenBirthProfile?: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState<'TODAY' | 'YESTERDAY'>('TODAY');
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [reflection, setReflection] = useState<ReflectionSummary | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [expandedWhy, setExpandedWhy] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setReflection(null);

    (async () => {
      const url = selectedDate === 'YESTERDAY' ? `/api/daily-briefing/today?date=${resolveYesterdayLocalDate(timezone)}` : '/api/daily-briefing/today';
      const res = await fetch(url).catch(() => null);
      if (cancelled) return;
      const data = await res?.json().catch(() => null);
      if (cancelled) return;

      if (!data || typeof data.status !== 'string') {
        setState({ status: 'error' });
        return;
      }
      if (data.status === 'OK' && data.briefing) {
        setState({ status: 'ok', briefing: data.briefing as AstroDailyBriefing });
        if (selectedDate === 'YESTERDAY') {
          const refRes = await fetch(`/api/daily-assistant/reflection?date=${data.briefing.localDate}`).catch(() => null);
          if (cancelled) return;
          const refData = await refRes?.json().catch(() => null);
          if (cancelled) return;
          if (refData && typeof refData.outputLevel === 'string') {
            setReflection({ outputLevel: refData.outputLevel, followedGuidance: Boolean(refData.followedGuidance), notes: refData.notes ?? null });
          }
        }
        return;
      }
      if (data.status === 'UNAVAILABLE' && (data.reason === 'INCOMPLETE_BIRTH_PROFILE' || data.reason === 'INVALID_BIRTH_PROFILE')) {
        setState({ status: 'unavailable', reason: data.reason });
        return;
      }
      setState({ status: 'error' });
    })().catch(() => {
      if (!cancelled) setState({ status: 'error' });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, timezone, selectedDate, retryKey]);

  const toggleWhy = (section: string) => {
    setExpandedWhy((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
      <SectionHeader label="Personalized Daily Briefing" color={colors.traditional} />

      <SegmentedControl
        ariaLabel="Select which day's briefing to view"
        options={[
          { value: 'TODAY', label: 'Today' },
          { value: 'YESTERDAY', label: 'Yesterday' },
        ]}
        value={selectedDate}
        onChange={setSelectedDate}
      />

      {state.status === 'loading' && (
        <SurfaceCard role="status" ariaLive="polite" style={{ minHeight: 92 }}>
          <div style={{ ...typography.body, color: colors.textMuted }}>Reading {selectedDate === 'TODAY' ? "today's" : "yesterday's"} traditional themes…</div>
        </SurfaceCard>
      )}

      {state.status === 'unavailable' && (
        <SurfaceCard>
          <div style={{ ...typography.body }}>Add your birth details to see your personalized daily briefing.</div>
          {onOpenBirthProfile && (
            <div style={{ marginTop: spacing.md }}>
              <TextButton onClick={onOpenBirthProfile} color={colors.traditional}>
                Add birth details →
              </TextButton>
            </div>
          )}
        </SurfaceCard>
      )}

      {state.status === 'error' && (
        <SurfaceCard role="alert">
          <div style={{ ...typography.body }}>Couldn't load {selectedDate === 'TODAY' ? "today's" : "yesterday's"} briefing right now.</div>
          <div style={{ marginTop: spacing.md }}>
            <TextButton onClick={() => setRetryKey((k) => k + 1)} color={colors.textMuted}>
              Try again
            </TextButton>
          </div>
        </SurfaceCard>
      )}

      {state.status === 'ok' && (
        <SurfaceCard accentColor={colors.traditional}>
          <div style={{ ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm }}>
            For {formatLocalDateLabel(state.briefing.localDate)} · Natal Moon in {state.briefing.natalMoonSign} ({state.briefing.natalNakshatra})
          </div>
          <p style={{ ...typography.caption, color: colors.textFaint, margin: `0 0 ${spacing.md}px`, lineHeight: 1.4 }}>
            {selectedDate === 'YESTERDAY'
              ? "This is the traditional interpretation calculated for yesterday's date -- not a record of what actually happened."
              : "Today's themes based on your birth chart and planetary transits."}
          </p>

          <BriefingSection label="Daily Theme" category="DAILY_THEME" text={state.briefing.dailyTheme} evidence={state.briefing.evidence} expanded={expandedWhy.has('DAILY_THEME')} onToggle={() => toggleWhy('DAILY_THEME')} />
          <BriefingSection label="Career" category="CAREER" text={state.briefing.career} evidence={state.briefing.evidence} expanded={expandedWhy.has('CAREER')} onToggle={() => toggleWhy('CAREER')} />
          <BriefingSection label="Finances" category="FINANCE" text={state.briefing.finance} evidence={state.briefing.evidence} expanded={expandedWhy.has('FINANCE')} onToggle={() => toggleWhy('FINANCE')} />
          <BriefingSection label="Focus" category="FOCUS" text={state.briefing.focus} evidence={state.briefing.evidence} expanded={expandedWhy.has('FOCUS')} onToggle={() => toggleWhy('FOCUS')} />
          <BriefingSection label="Be Mindful" category="MINDFUL" text={state.briefing.beMindful} evidence={state.briefing.evidence} expanded={expandedWhy.has('MINDFUL')} onToggle={() => toggleWhy('MINDFUL')} last={selectedDate === 'TODAY' || !reflection} />

          {selectedDate === 'YESTERDAY' && reflection && (
            <div style={{ marginTop: spacing.lg, paddingTop: spacing.lg, borderTop: `1px solid ${colors.borderSubtle}` }}>
              <div style={{ ...typography.meta, color: colors.textMuted, fontWeight: 800, marginBottom: 4 }}>Your reflection</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                <StatusBadge label={OUTPUT_LEVEL_LABEL[reflection.outputLevel]} tone={reflection.outputLevel === 'PEAK_FLOW' ? 'positive' : reflection.outputLevel === 'LOW' ? 'caution' : 'neutral'} />
                <span style={{ ...typography.caption, color: colors.textFaint }}>how you said yesterday felt -- your own record, not part of the traditional interpretation above</span>
              </div>
              {reflection.notes && <p style={{ ...typography.body, marginTop: spacing.sm }}>{reflection.notes}</p>}
            </div>
          )}
        </SurfaceCard>
      )}
    </div>
  );
}

function BriefingSection({
  label,
  category,
  text,
  evidence,
  expanded,
  onToggle,
  last,
}: {
  label: string;
  category: GocharEvidenceRef['category'];
  text: string;
  evidence: GocharEvidenceRef[];
  expanded: boolean;
  onToggle: () => void;
  last?: boolean;
}) {
  // DB3 brief section 4: "Do not expose raw internal evidence objects or
  // JSON... translate technical terms into plain language." Every string
  // shown here is DB1's OWN `.summary` sentence, already plain-language
  // (e.g. "Jupiter is transiting House 11 from your natal Moon,
  // traditionally a supportive placement.") -- never a raw object, never
  // invented. Rule version shown once, factually, not as a claim of
  // certainty. DB4: Daily Theme additionally folds in the Tara Bala
  // evidence its own text always cites -- see selectSectionEvidence()'s
  // own doc comment for the full, deterministic rationale.
  const relevant = selectSectionEvidence(evidence, category);
  return (
    <div style={{ marginBottom: last ? 0 : spacing.md }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <div style={{ ...typography.meta, color: colors.traditional, fontWeight: 800 }}>{label}</div>
        {relevant.length > 0 && (
          <TextButton onClick={onToggle} color={colors.textMuted} ariaLabel={`${expanded ? 'Hide' : 'Show'} why this guidance was given for ${label}`}>
            {expanded ? 'Hide why ↑' : 'Why this guidance? →'}
          </TextButton>
        )}
      </div>
      <p style={{ ...typography.body, margin: '2px 0 0', lineHeight: 1.45 }}>{text}</p>
      {expanded && relevant.length > 0 && (
        <ul style={{ margin: `${spacing.sm}px 0 0`, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {relevant.map((e, i) => (
            <li key={i} style={{ ...typography.caption, color: colors.textFaint, paddingLeft: spacing.md, borderLeft: `2px solid ${e.isFavorable ? colors.positive : colors.caution}` }}>
              {e.summary}
            </li>
          ))}
          <li style={{ ...typography.caption, color: colors.textMuted, marginTop: 2 }}>
            Interpretation rule: {relevant[0].ruleVersion}
          </li>
        </ul>
      )}
    </div>
  );
}
