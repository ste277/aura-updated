'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { FULL_ACTIVITY_CATALOG } from '../../../../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../../../../packages/recommendation/src/activityDefinitions';
import { formatMuhurtaReason } from '../../../../packages/muhurta/src/muhurtaReasonFormat';
import type { TimingCandidate, TimingTimePreference } from '../../../../packages/recommendation/src/timingSearch';
import type { PlanningHorizon } from '../../../../packages/recommendation/src/dailyAssistant';
import { RESULT_LABEL_TEXT, saveUpcomingPlanFromCandidate } from '../../components/PlanWithAuraView';
import { CITY_OPTIONS } from '../../lib/cities';
import { trackEvent } from '../../lib/trackEvent';
import { colors, spacing, radius, typography } from '../../components/theme';
import { PrimaryButton, SecondaryButton, TextButton, ActivityChip, DurationChip, StatusBadge, EmptyState, TextInput, SelectInput, FieldLabel, type StatusTone } from '../../components/ui';

/**
 * Recipient Conversion V1 -- the guest conversion loop's UI: activity ->
 * when/duration -> location -> result -> save (inline signup if needed).
 * Public, unauthenticated by default. See lib/guestTimingSearchRequest.ts /
 * app/api/guest/timing-search/route.ts for the engine call this drives
 * (GENERAL scope only, the exact same runTimingSearch() the authenticated
 * Plan flow uses) and lib/guestState.ts for how a chosen result survives
 * the magic-link auth round trip.
 */

type Phase =
  | 'CHECKING_SESSION'
  | 'ACTIVITY'
  | 'DETAILS'
  | 'LOCATION'
  | 'SEARCHING'
  | 'RESULT'
  | 'NO_RESULT'
  | 'SEARCH_ERROR'
  | 'SIGNUP'
  | 'SAVING'
  | 'SAVED'
  | 'SAVE_ERROR'
  | 'EXPIRED';

const POPULAR_ACTIVITY_IDS = ['date-night', 'dinner-date', 'coffee-tea', 'movie-night', 'road-trip', 'party'];

const HORIZON_OPTIONS: Array<{ value: PlanningHorizon; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'TOMORROW', label: 'Tomorrow' },
  { value: 'WEEKEND', label: 'Weekend' },
  { value: 'SEVEN_DAYS', label: 'Next 7 days' },
];

const TIME_PREFERENCE_OPTIONS: Array<{ value: TimingTimePreference; label: string }> = [
  { value: 'ANY', label: 'Anytime' },
  { value: 'MORNING', label: 'Morning' },
  { value: 'AFTERNOON', label: 'Afternoon' },
  { value: 'EVENING', label: 'Evening' },
  { value: 'NIGHT', label: 'Night' },
];

const LABEL_TONE: Record<string, StatusTone> = {
  EXCELLENT: 'positive',
  VERY_GOOD: 'positive',
  GOOD: 'info',
  USABLE: 'neutral',
  CAUTION: 'caution',
};

function formatCandidateWhen(startIso: string, endIso: string, timezone: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' });
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeFmt = (d: Date) => d.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const startKey = keyFmt.format(start);
  let dayLabel = dayFmt.format(start);
  if (startKey === keyFmt.format(now)) dayLabel = 'Today';
  else if (startKey === keyFmt.format(tomorrow)) dayLabel = 'Tomorrow';
  return `${dayLabel} · ${timeFmt(start)}–${timeFmt(end)}`;
}

export function GuestFindClient({ initialSource, initialRestoreToken }: { initialSource: 'AURA_MOMENT' | 'DIRECT'; initialRestoreToken: string | null }) {
  const [phase, setPhase] = useState<Phase>('CHECKING_SESSION');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState('');

  const [activityQuery, setActivityQuery] = useState('');
  const [activityId, setActivityId] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<PlanningHorizon>('TODAY');
  const [timePreference, setTimePreference] = useState<TimingTimePreference>('ANY');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [cityName, setCityName] = useState(CITY_OPTIONS[0]?.cityName ?? '');

  const [candidates, setCandidates] = useState<TimingCandidate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showOthers, setShowOthers] = useState(false);

  const [email, setEmail] = useState('');
  const [signupStep, setSignupStep] = useState<'EMAIL' | 'CODE'>('EMAIL');
  const [code, setCode] = useState('');
  const [signupBusy, setSignupBusy] = useState(false);
  const [devLoginUrl, setDevLoginUrl] = useState<string | null>(null);
  const [devLoginCode, setDevLoginCode] = useState<string | null>(null);

  const activity = activityId ? FULL_ACTIVITY_CATALOG.find((a) => a.id === activityId) : undefined;
  const activityDefinition = activity ? getActivityDefinition(activity) : undefined;

  const everydayActivities = useMemo(
    () => FULL_ACTIVITY_CATALOG.filter((a) => getActivityDefinition(a)?.experience.planningMode === 'EVERYDAY'),
    []
  );
  const popularActivities = useMemo(
    () => POPULAR_ACTIVITY_IDS.map((id) => FULL_ACTIVITY_CATALOG.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => Boolean(a)),
    []
  );
  const searchResults = useMemo(() => {
    const q = activityQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return everydayActivities.filter((a) => a.title.toLowerCase().includes(q) || a.aliases.some((alias) => alias.includes(q))).slice(0, 8);
  }, [activityQuery, everydayActivities]);

  // Section 16/33: an already-signed-in visitor never sees the guest
  // wizard -- straight to the authenticated Plan flow. Section 24/25:
  // restoring a guest search reuses the SAME session check to know whether
  // the magic-link click already authenticated this visitor.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/session');
        const data = await res.json().catch(() => ({ user: null }));
        if (cancelled) return;
        const authed = Boolean(data?.user);
        setIsAuthenticated(authed);

        if (initialRestoreToken) {
          await restoreGuestState(initialRestoreToken, authed);
          return;
        }
        if (authed) {
          window.location.href = '/?tab=plan';
          return;
        }
        setPhase('ACTIVITY');
      } catch {
        if (!cancelled) setPhase('ACTIVITY');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreGuestState(token: string, authed: boolean) {
    try {
      const res = await fetch(`/api/guest/state?token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        setPhase('EXPIRED');
        return;
      }
      const restored = await res.json();
      setActivityId(restored.activityId);
      setHorizon(restored.horizon);
      setTimePreference(restored.timePreference);
      setDurationMinutes(restored.durationMinutes);
      setCityName(restored.cityName);

      // Re-run the same GENERAL search rather than trusting a stale
      // candidate list -- the guest-state token only carries the search
      // inputs plus which instant they chose, never the full computed
      // result (brief section 25's "expired" fallback below covers the
      // rare case that exact instant no longer appears).
      const searchRes = await runGuestSearch({
        activityId: restored.activityId,
        horizon: restored.horizon,
        timePreference: restored.timePreference,
        durationMinutes: restored.durationMinutes,
        cityName: restored.cityName,
      });
      if (!searchRes || searchRes.candidates.length === 0) {
        setPhase('EXPIRED');
        return;
      }
      const matchIndex = searchRes.candidates.findIndex((c) => c.start === restored.candidateStart);
      setCandidates(searchRes.candidates);
      setSelectedIndex(matchIndex >= 0 ? matchIndex : 0);
      setPhase('RESULT');
    } catch {
      setPhase('EXPIRED');
    }
  }

  async function runGuestSearch(params: {
    activityId: string;
    horizon: PlanningHorizon;
    timePreference: TimingTimePreference;
    durationMinutes: number;
    cityName: string;
  }): Promise<{ candidates: TimingCandidate[] } | null> {
    const res = await fetch('/api/guest/timing-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    return res.json();
  }

  const handleSelectActivity = (id: string) => {
    setActivityId(id);
    setActivityQuery('');
    const def = getActivityDefinition(id);
    const found = FULL_ACTIVITY_CATALOG.find((a) => a.id === id);
    setDurationMinutes(def?.experience.defaultDurationMinutes ?? def?.experience.suggestedDurations?.[0] ?? found?.defaultDurationMinutes ?? 60);
    setPhase('DETAILS');
  };

  const handleSearch = async () => {
    if (!activityId) return;
    setPhase('SEARCHING');
    setError('');
    trackEvent('GUEST_TIMING_SEARCH_STARTED', { metadata: { activityId, horizon, timePreference, source: initialSource } });
    try {
      const result = await runGuestSearch({ activityId, horizon, timePreference, durationMinutes, cityName });
      if (!result) {
        setPhase('SEARCH_ERROR');
        return;
      }
      setCandidates(result.candidates);
      setSelectedIndex(0);
      setShowOthers(false);
      if (result.candidates.length === 0) {
        setPhase('NO_RESULT');
        return;
      }
      trackEvent('GUEST_TIMING_RESULT_VIEWED', { metadata: { activityId, resultCount: result.candidates.length, source: initialSource } });
      setPhase('RESULT');
    } catch {
      setPhase('SEARCH_ERROR');
    }
  };

  const selectedCandidate = candidates[selectedIndex];

  const handleSaveClick = async () => {
    if (!selectedCandidate || !activityId) return;

    if (isAuthenticated) {
      await performSave();
      return;
    }

    // Mint the short-lived guest-state token BEFORE showing the signup step
    // so it's ready to ride along on the magic link regardless of whether
    // the guest ends up clicking the link or typing the code (brief
    // section 10/24).
    try {
      await fetch('/api/guest/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId,
          horizon,
          timePreference,
          durationMinutes,
          cityName,
          candidateStart: selectedCandidate.start,
          candidateEnd: selectedCandidate.end,
          source: initialSource,
        }),
      });
    } catch {
      // Non-fatal: the code-entry path below never needs this token since
      // it never leaves the page. Only the magic-link-click path would be
      // degraded, and that's still a working (if less seamless) fallback.
    }
    setPhase('SIGNUP');
  };

  const performSave = async () => {
    if (!selectedCandidate || !activityId) return;
    setPhase('SAVING');
    try {
      await saveUpcomingPlanFromCandidate(selectedCandidate, durationMinutes);
      trackEvent('GUEST_RESULT_SAVED', { metadata: { activityId, source: initialSource } });
      setPhase('SAVED');
    } catch {
      setPhase('SAVE_ERROR');
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupBusy(true);
    setError('');
    trackEvent('GUEST_SIGNUP_STARTED', { metadata: { source: initialSource } });
    try {
      const guestStateRes = await fetch('/api/guest/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId,
          horizon,
          timePreference,
          durationMinutes,
          cityName,
          candidateStart: selectedCandidate?.start,
          candidateEnd: selectedCandidate?.end,
          source: initialSource,
        }),
      });
      const guestStateData = await guestStateRes.json().catch(() => ({}));

      const res = await fetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, guestStateToken: guestStateData?.token }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'Unable to send a sign-in link. Try again.');
        return;
      }
      if (data?.devLoginUrl) setDevLoginUrl(data.devLoginUrl);
      if (data?.devLoginCode) setDevLoginCode(data.devLoginCode);
      setSignupStep('CODE');
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSignupBusy(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'That code did not work. Try again.');
        return;
      }
      trackEvent('GUEST_SIGNUP_COMPLETED', { metadata: { source: initialSource } });
      setIsAuthenticated(true);
      await performSave();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSignupBusy(false);
    }
  };

  if (phase === 'CHECKING_SESSION') return null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--as-bg)', color: colors.textPrimary, fontFamily: 'var(--as-font-body)', display: 'flex', justifyContent: 'center', padding: `${spacing.xxxl}px ${spacing.lg}px` }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {phase === 'EXPIRED' && (
          <EmptyState
            title="Your previous search expired."
            description="Guest searches only stay available for a little while."
            action={<PrimaryButton onClick={() => setPhase('ACTIVITY')}>Find a new moment</PrimaryButton>}
          />
        )}

        {phase === 'ACTIVITY' && (
          <>
            <h1 style={{ ...typography.pageTitle, fontSize: 22, textAlign: 'center' }}>What are you planning?</h1>
            <div style={{ marginTop: spacing.xl }}>
              <FieldLabel>Popular</FieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                {popularActivities.map((a) => (
                  <ActivityChip key={a.id} label={a.title} icon={a.icon} onClick={() => handleSelectActivity(a.id)} />
                ))}
              </div>
            </div>
            <div style={{ marginTop: spacing.xl }}>
              <FieldLabel htmlFor="guest-activity-search">Search activities</FieldLabel>
              <TextInput id="guest-activity-search" placeholder="e.g. Dinner, Study, Workout" value={activityQuery} onChange={(e) => setActivityQuery(e.target.value)} />
              {searchResults.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  {searchResults.map((a) => (
                    <ActivityChip key={a.id} label={a.title} icon={a.icon} onClick={() => handleSelectActivity(a.id)} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {phase === 'DETAILS' && activity && (
          <>
            <BackRow onBack={() => setPhase('ACTIVITY')} />
            <h1 style={{ ...typography.pageTitle, fontSize: 22, textAlign: 'center', marginTop: spacing.md }}>
              {activity.icon} {activity.title}
            </h1>
            <div style={{ marginTop: spacing.xl }}>
              <FieldLabel>When</FieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                {HORIZON_OPTIONS.map((opt) => (
                  <ActivityChip key={opt.value} label={opt.label} selected={horizon === opt.value} onClick={() => setHorizon(opt.value)} />
                ))}
              </div>
            </div>
            <div style={{ marginTop: spacing.lg }}>
              <FieldLabel>Time of day (optional)</FieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                {TIME_PREFERENCE_OPTIONS.map((opt) => (
                  <ActivityChip key={opt.value} label={opt.label} selected={timePreference === opt.value} onClick={() => setTimePreference(opt.value)} />
                ))}
              </div>
            </div>
            {activityDefinition?.experience.durationMode === 'USER_SELECTED' && (
              <div style={{ marginTop: spacing.lg }}>
                <FieldLabel>How long?</FieldLabel>
                <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.sm }}>
                  {(activityDefinition.experience.suggestedDurations ?? [30, 60, 90]).map((minutes) => (
                    <DurationChip key={minutes} label={minutes >= 60 ? `${minutes / 60} hr` : `${minutes} min`} selected={durationMinutes === minutes} onClick={() => setDurationMinutes(minutes)} />
                  ))}
                </div>
              </div>
            )}
            <PrimaryButton onClick={() => setPhase('LOCATION')} style={{ width: '100%', marginTop: spacing.xxl }}>
              Continue
            </PrimaryButton>
          </>
        )}

        {phase === 'LOCATION' && (
          <>
            <BackRow onBack={() => setPhase('DETAILS')} />
            <h1 style={{ ...typography.pageTitle, fontSize: 22, textAlign: 'center', marginTop: spacing.md }}>Where are you?</h1>
            <p style={{ ...typography.body, textAlign: 'center', marginTop: spacing.sm }}>Aura's timing is based on your location.</p>
            <div style={{ marginTop: spacing.xl }}>
              <FieldLabel htmlFor="guest-city">City</FieldLabel>
              <SelectInput id="guest-city" value={cityName} onChange={(e) => setCityName(e.target.value)}>
                {CITY_OPTIONS.map((c) => (
                  <option key={c.cityName} value={c.cityName}>{c.cityName}</option>
                ))}
              </SelectInput>
            </div>
            <PrimaryButton onClick={handleSearch} style={{ width: '100%', marginTop: spacing.xxl }}>
              Find my moment
            </PrimaryButton>
          </>
        )}

        {phase === 'SEARCHING' && <div style={{ textAlign: 'center', ...typography.body, padding: `${spacing.xxxl}px 0` }}>Finding your best moment…</div>}

        {phase === 'SEARCH_ERROR' && (
          <EmptyState title="Search unavailable" description="Couldn't find your moment right now." action={<SecondaryButton onClick={handleSearch}>Try again</SecondaryButton>} />
        )}

        {phase === 'NO_RESULT' && (
          <EmptyState title="No strong times found" description="Aura couldn't find a strong match within this window." action={<SecondaryButton onClick={() => setPhase('DETAILS')}>Try another day</SecondaryButton>} />
        )}

        {(phase === 'RESULT' || phase === 'SAVING' || phase === 'SAVE_ERROR') && selectedCandidate && activity && (
          <>
            <div style={{ ...typography.sectionEyebrow, textAlign: 'center' }}>Your best moment</div>
            <div style={{ background: colors.surfaceSubtle, border: `1px solid ${colors.borderSubtle}`, borderRadius: radius.lg, padding: spacing.xxl, marginTop: spacing.md, textAlign: 'center' }}>
              <div style={{ fontSize: 34 }}>{activity.icon}</div>
              <h2 style={{ ...typography.pageTitle, fontSize: 20, marginTop: spacing.sm }}>{activity.title}</h2>
              <div style={{ ...typography.bodyStrong, marginTop: spacing.sm }}>{formatCandidateWhen(selectedCandidate.start, selectedCandidate.end, CITY_OPTIONS.find((c) => c.cityName === cityName)?.timezone ?? 'UTC')}</div>
              <div style={{ marginTop: spacing.md }}>
                <StatusBadge label={RESULT_LABEL_TEXT[selectedCandidate.label]} tone={LABEL_TONE[selectedCandidate.label] ?? 'neutral'} />
              </div>
              <p style={{ ...typography.body, marginTop: spacing.lg }}>
                {selectedCandidate.reasons.length > 0 ? formatMuhurtaReason(selectedCandidate.reasons[0]) : 'A comfortable window with no major timing conflict.'}
              </p>

              {phase === 'SAVE_ERROR' && <div style={{ color: colors.danger, fontSize: 12, marginTop: spacing.md }}>Couldn't save this moment. Try again.</div>}

              <PrimaryButton onClick={handleSaveClick} disabled={phase === 'SAVING'} style={{ width: '100%', marginTop: spacing.xl }}>
                {phase === 'SAVING' ? 'Saving…' : 'Save this moment'}
              </PrimaryButton>
            </div>

            {candidates.length > 1 && (
              <div style={{ textAlign: 'center', marginTop: spacing.lg }}>
                <TextButton onClick={() => setShowOthers((v) => !v)}>{showOthers ? 'Hide other times' : 'Other good times →'}</TextButton>
                {showOthers && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, marginTop: spacing.md }}>
                    {candidates.map((c, i) =>
                      i === selectedIndex ? null : (
                        <button
                          key={c.start}
                          type="button"
                          onClick={() => setSelectedIndex(i)}
                          style={{ textAlign: 'left', padding: spacing.md, borderRadius: radius.md, border: `1px solid ${colors.borderSubtle}`, background: 'transparent', color: colors.textSecondary, cursor: 'pointer' }}
                        >
                          {formatCandidateWhen(c.start, c.end, CITY_OPTIONS.find((ct) => ct.cityName === cityName)?.timezone ?? 'UTC')} · {RESULT_LABEL_TEXT[c.label]}
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {phase === 'SIGNUP' && (
          <>
            <h1 style={{ ...typography.pageTitle, fontSize: 20, textAlign: 'center' }}>Save this moment</h1>
            <p style={{ ...typography.body, textAlign: 'center', marginTop: spacing.sm }}>Create your Aura profile to:</p>
            <ul style={{ ...typography.body, margin: `${spacing.md}px 0`, paddingLeft: 18 }}>
              <li>Save this time</li>
              <li>Personalize future recommendations</li>
              <li>Share moments with people you care about</li>
              <li>Receive reminders</li>
            </ul>

            {signupStep === 'EMAIL' ? (
              <form onSubmit={handleSignupSubmit}>
                <TextInput type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                <PrimaryButton type="submit" disabled={signupBusy} style={{ width: '100%', marginTop: spacing.md }}>
                  {signupBusy ? 'Sending…' : 'Continue with email'}
                </PrimaryButton>
              </form>
            ) : (
              <form onSubmit={handleVerifyCode}>
                <p style={{ ...typography.meta, marginBottom: spacing.sm }}>We emailed you a sign-in link and a 6-digit code.</p>
                <TextInput
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  style={{ textAlign: 'center', letterSpacing: 6, fontFamily: 'var(--as-font-mono)' }}
                />
                <PrimaryButton type="submit" disabled={signupBusy || code.length !== 6} style={{ width: '100%', marginTop: spacing.md }}>
                  {signupBusy ? 'Checking…' : 'Sign in and save'}
                </PrimaryButton>
                {(devLoginUrl || devLoginCode) && (
                  <div style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, background: colors.surfaceSubtle, border: `1px dashed ${colors.borderDefault}`, fontSize: 12, color: colors.textMuted }}>
                    Dev mode — no email provider configured:
                    {devLoginCode && <div>Code: {devLoginCode}</div>}
                    {devLoginUrl && <a href={devLoginUrl} style={{ color: colors.info, wordBreak: 'break-all' }}>{devLoginUrl}</a>}
                  </div>
                )}
              </form>
            )}
            {error && <div style={{ color: colors.danger, fontSize: 12, marginTop: spacing.md, textAlign: 'center' }}>{error}</div>}
          </>
        )}

        {phase === 'SAVED' && activity && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 34 }}>✓</div>
            <h1 style={{ ...typography.pageTitle, fontSize: 20, marginTop: spacing.sm }}>Saved to your plan</h1>
            <p style={{ ...typography.body, marginTop: spacing.sm }}>{activity.title} is on your calendar.</p>
            <SecondaryButton onClick={() => { window.location.href = '/'; }} style={{ marginTop: spacing.xl }}>
              Open Aura →
            </SecondaryButton>
          </div>
        )}
      </div>
    </div>
  );
}

function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <TextButton onClick={onBack} color={colors.textMuted}>← Back</TextButton>
    </div>
  );
}
