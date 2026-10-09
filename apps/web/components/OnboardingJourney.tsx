'use client';

import { useState, useEffect, useCallback } from 'react';
import { colors, spacing, radius, typography } from './theme';
import { PrimaryButton, SecondaryButton, TextButton, FieldLabel, TextInput } from './ui';
import { LocationPicker } from './LocationPicker';
import { RhythmPicker, type RhythmPickerValue } from './RhythmPicker';
import { DayPlanPreviewController } from './DayPlanPreviewController';
import { findCity } from '../lib/cities';
import type { DailyEnergyInsight } from '../lib/scoreEngine';
import type { ConstructDayPreview } from '../lib/dayConstructorOrchestrator';
import type { GoalActivityLink } from '../lib/acceptConstructedDay';
import { previewConstructedDay } from '../lib/dayConstructorPreviewClient';
import {
  ONBOARDING_GOAL_CATEGORIES,
  ONBOARDING_GOAL_TITLE_MAX_LENGTH,
  isOnboardingGoalTitleValid,
  buildOnboardingGoalCreateRequestBody,
  resolveOnboardingPlanningDate,
  buildOnboardingFirstActivityIntent,
  buildOnboardingFirstActivityGoalLinks,
  presentOnboardingFirstActivityPreviewFailure,
  type OnboardingGoalCategory,
  type OnboardingGoalActivityRef,
} from '../lib/onboardingGoalStep';

interface CityOption {
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

type OnboardingStep = 'WELCOME' | 'LOCATION' | 'RECOMMENDATION' | 'GOAL' | 'FIRST_STEP';

interface OnboardingJourneyProps {
  userName: string;
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string;
  locationConfirmed: boolean;
  /** Same shape `page.tsx`'s own `handleLocationChanged` already takes --
   * reused verbatim, never a second location-update path. */
  onLocationChanged: (city: CityOption & { locationConfirmedAt: string | null }) => void;
  /** `energyInsight.nextShift` as `page.tsx` already computes it from the
   * REAL solar ephemeris/Panchang windows -- `undefined` only when the
   * client hasn't mounted yet (brief hydration window). Never the
   * separate, cosmetic `safeNextShift` fallback Home's own banner uses. */
  nextShift: DailyEnergyInsight['nextShift'] | undefined;
  /** True only when the real engine actually produced at least one window
   * for today -- false means "no suitable window found," never papered
   * over with `nextShift`'s own defensive placeholder text. */
  hasRealRecommendation: boolean;
  /** Skip (any step) / Go to Home -- returns to the normal tab UI. */
  onExit: () => void;
  /** "Plan my day" -- exits onboarding AND navigates to /plan-day. */
  onPlanMyDay: () => void;
}

const CONTAINER_MAX_WIDTH = 420;

/**
 * Onboarding V1 PR 2 -- Welcome, Location Confirmation & First Useful
 * Recommendation. Renders INSTEAD OF the normal tab UI in page.tsx, only
 * while the account's onboarding remains unresolved (`onboardingResolved`,
 * a durable, check-not-consume server fact derived from
 * `User.onboardingResolvedAt` -- see app/api/auth/session/route.ts and
 * db.ts's own `markOnboardingResolved`; First-Run Reliability Correction
 * deliberately decoupled this from VisitLog, which an earlier version
 * used as a one-shot, consumable proxy). Every step offers an explicit
 * way to reach Home without completing the rest, so this journey can
 * never trap a user or block general app access.
 *
 * Reuses the EXISTING LocationPicker and PATCH /api/users/location
 * contract for every location change -- this file introduces no new
 * location state, no new timing calculation, and no second profile
 * endpoint. The recommendation step reads the REAL, already-computed
 * Panchang/energy-insight values passed down from page.tsx; it never
 * invents a time, a score or a description of its own.
 */
export function OnboardingJourney({
  userName,
  cityName,
  latitude,
  longitude,
  timezone,
  locationConfirmed,
  onLocationChanged,
  nextShift,
  hasRealRecommendation,
  onExit,
  onPlanMyDay,
}: OnboardingJourneyProps) {
  const [step, setStep] = useState<OnboardingStep>('WELCOME');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [locationConfirmedLocal, setLocationConfirmedLocal] = useState(locationConfirmed);
  // Onboarding V1 PR 4 -- carries the just-created GoalActivity from GOAL
  // into FIRST_STEP. Pure component state, never persisted (same
  // established convention as LocationPicker's own `pending` -- a refresh
  // here simply restarts the journey at WELCOME, exactly like a refresh
  // during the pre-existing LOCATION step already does today).
  const [goalActivity, setGoalActivity] = useState<OnboardingGoalActivityRef | null>(null);

  // GOAL/FIRST_STEP are an optional continuation past the core 3-step
  // journey, not additional steps to "complete" (section G: "should feel
  // like starting something meaningful, not completing setup") -- the
  // step-progress indicator is omitted for them entirely rather than
  // showing a confusing "Step 4 of 3".
  const stepIndex = step === 'WELCOME' ? 1 : step === 'LOCATION' ? 2 : step === 'RECOMMENDATION' ? 3 : null;

  // Explicit "Confirm [city]" action -- the ONE thing the existing
  // LocationPicker's bare <select> genuinely cannot do (a browser never
  // fires onChange for re-selecting an already-selected option). Reuses
  // the SAME PATCH /api/users/location contract LocationPicker itself
  // uses, branching curated-vs-custom the same way that component does,
  // so this is the identical server-side validation/persistence path --
  // never a second confirmation mechanism.
  async function confirmSuggestedCity() {
    setConfirming(true);
    setConfirmError(null);
    try {
      const curated = findCity(cityName);
      const res = await fetch('/api/users/location', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(curated ? { cityName } : { custom: { cityName, latitude, longitude, timezone } }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        onLocationChanged({
          cityName,
          latitude,
          longitude,
          timezone,
          locationConfirmedAt: typeof data.locationConfirmedAt === 'string' ? data.locationConfirmedAt : null,
        });
        setLocationConfirmedLocal(true);
        setStep('RECOMMENDATION');
      } else {
        const data = await res.json().catch(() => ({}));
        setConfirmError(typeof data.error === 'string' && data.error ? data.error : 'Could not confirm location.');
      }
    } catch {
      setConfirmError("Couldn't confirm location. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--as-bg, #0b0f2e)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 'calc(env(safe-area-inset-top, 16px) + 24px) 16px calc(env(safe-area-inset-bottom, 16px) + 24px)',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: '100%', maxWidth: CONTAINER_MAX_WIDTH }}>
        {stepIndex !== null && (
          <div
            role="status"
            aria-label={`Step ${stepIndex} of 3`}
            style={{ display: 'flex', gap: spacing.xs, marginBottom: spacing.xl, justifyContent: 'center' }}
          >
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                aria-hidden="true"
                style={{
                  width: n === stepIndex ? 22 : 8,
                  height: 8,
                  borderRadius: radius.pill,
                  background: n <= stepIndex ? colors.positive : colors.borderDefault,
                  transition: 'width 0.2s ease',
                }}
              />
            ))}
          </div>
        )}

        {step === 'WELCOME' && (
          <WelcomeStep userName={userName} onGetStarted={() => setStep('LOCATION')} onSkip={onExit} />
        )}

        {step === 'LOCATION' && (
          <LocationStep
            cityName={cityName}
            confirming={confirming}
            confirmError={confirmError}
            onConfirmSuggested={confirmSuggestedCity}
            onLocationChanged={(city) => {
              onLocationChanged(city);
              setLocationConfirmedLocal(city.locationConfirmedAt != null);
              setStep('RECOMMENDATION');
            }}
            onSkip={() => setStep('RECOMMENDATION')}
          />
        )}

        {step === 'RECOMMENDATION' && (
          <RecommendationStep
            cityName={cityName}
            locationConfirmed={locationConfirmedLocal}
            nextShift={nextShift}
            hasRealRecommendation={hasRealRecommendation}
            onPlanMyDay={onPlanMyDay}
            // Onboarding V1 PR 4 -- "Go to Home" is now the on-ramp to the
            // optional first-Goal offer (section B: "After the first
            // recommendation, offer..."). "Plan my day" is deliberately left
            // unchanged (still exits onboarding and navigates directly to
            // /plan-day): a user who already chose to plan their day has
            // already reached a real, more-actionable next step than the
            // Goal offer would add, and interposing it there would be an
            // extra bit of friction after an explicit choice -- never the
            // "turn onboarding into a questionnaire" outcome section B
            // warns against. Location confirmation remains independent of
            // this (section F) -- the offer appears identically whether or
            // not the user confirmed their location on this visit.
            onGoHome={() => setStep('GOAL')}
          />
        )}

        {step === 'GOAL' && (
          <GoalStep
            onGoalCreated={(activity) => {
              setGoalActivity(activity);
              setStep('FIRST_STEP');
            }}
            onSkip={onExit}
          />
        )}

        {step === 'FIRST_STEP' && goalActivity && (
          <FirstActivityStep goalActivity={goalActivity} timezone={timezone} onDone={onExit} />
        )}
      </div>
    </main>
  );
}

function StepCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.96), rgba(13, 28, 62, 0.82))',
        border: `1px solid ${colors.borderSubtle}`,
        borderRadius: radius.lg,
        padding: spacing.xxl,
      }}
    >
      {children}
    </div>
  );
}

function WelcomeStep({ userName, onGetStarted, onSkip }: { userName: string; onGetStarted: () => void; onSkip: () => void }) {
  return (
    <StepCard>
      <h1 style={{ ...typography.pageTitle, textWrap: 'balance' }}>Make time for what matters.</h1>
      <p style={{ ...typography.body, marginTop: spacing.md }}>
        Aura helps you plan your day around your priorities and the timing of your location.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.xxl }}>
        <PrimaryButton onClick={onGetStarted} style={{ width: '100%' }}>
          Get started
        </PrimaryButton>
        <SecondaryButton onClick={onSkip} style={{ width: '100%', minHeight: 44 }}>
          Skip for now
        </SecondaryButton>
      </div>
      <span aria-hidden="true" style={{ display: 'none' }}>{userName}</span>
    </StepCard>
  );
}

function LocationStep({
  cityName,
  confirming,
  confirmError,
  onConfirmSuggested,
  onLocationChanged,
  onSkip,
}: {
  cityName: string;
  confirming: boolean;
  confirmError: string | null;
  onConfirmSuggested: () => void;
  onLocationChanged: (city: CityOption & { locationConfirmedAt: string | null }) => void;
  onSkip: () => void;
}) {
  return (
    <StepCard>
      <h2 style={typography.sectionTitle}>Confirm your location</h2>
      <p style={{ ...typography.body, marginTop: spacing.sm }}>
        Aura uses your location to time today's guidance accurately -- sunrise, timing windows, and the recommendation you're about to see.
      </p>

      <div
        style={{
          marginTop: spacing.xl,
          background: colors.surfaceSubtle,
          border: `1px solid ${colors.borderSubtle}`,
          borderRadius: radius.md,
          padding: spacing.lg,
        }}
      >
        <div id="onboarding-suggested-city-label" style={{ ...typography.caption, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Suggested location
        </div>
        <div style={{ ...typography.bodyStrong, marginTop: spacing.xs, fontSize: 18 }}>{cityName}</div>
        <p style={{ ...typography.caption, marginTop: spacing.xs }}>Not yet confirmed.</p>
        <div style={{ marginTop: spacing.md }}>
          <PrimaryButton onClick={onConfirmSuggested} disabled={confirming} loading={confirming} style={{ width: '100%' }} ariaLabel={`Confirm ${cityName} as your location`}>
            Confirm {cityName}
          </PrimaryButton>
        </div>
        {confirmError && (
          <p role="alert" style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
            {confirmError}
          </p>
        )}
      </div>

      <div style={{ marginTop: spacing.xl }}>
        <div style={{ ...typography.caption, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: spacing.sm }}>
          Or choose a different location
        </div>
        <LocationPicker currentCity={cityName} onChanged={onLocationChanged} />
      </div>

      <div style={{ marginTop: spacing.xxl }}>
        <TextButton onClick={onSkip} color={colors.textFaint} style={{ minHeight: 44, width: '100%', justifyContent: 'center', display: 'flex' }}>
          Skip for now
        </TextButton>
      </div>
    </StepCard>
  );
}

function RecommendationStep({
  cityName,
  locationConfirmed,
  nextShift,
  hasRealRecommendation,
  onPlanMyDay,
  onGoHome,
}: {
  cityName: string;
  locationConfirmed: boolean;
  nextShift: DailyEnergyInsight['nextShift'] | undefined;
  hasRealRecommendation: boolean;
  onPlanMyDay: () => void;
  onGoHome: () => void;
}) {
  // Onboarding V1 PR 2 -- never presents a computed window as the user's
  // own personalized guidance while their location remains unconfirmed,
  // regardless of what the engine technically produced for the stored
  // (possibly still-default) coordinates.
  if (!locationConfirmed) {
    return (
      <StepCard>
        <h2 style={typography.sectionTitle}>Confirm your location to see timing guidance</h2>
        <p style={{ ...typography.body, marginTop: spacing.sm }}>
          Timing guidance for {cityName} isn't personalized to you yet -- confirm your location any time from Settings to unlock it.
        </p>
        <div style={{ marginTop: spacing.xxl }}>
          <PrimaryButton onClick={onGoHome} style={{ width: '100%' }}>
            Go to Home
          </PrimaryButton>
        </div>
      </StepCard>
    );
  }

  if (!hasRealRecommendation || !nextShift) {
    return (
      <StepCard>
        <h2 style={typography.sectionTitle}>No timing window available right now</h2>
        <p style={{ ...typography.body, marginTop: spacing.sm }}>
          Aura couldn't find a suitable timing window for {cityName} at the moment. You can still plan your day or head to Home.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.xxl }}>
          <PrimaryButton onClick={onPlanMyDay} style={{ width: '100%' }}>
            Plan my day
          </PrimaryButton>
          <SecondaryButton onClick={onGoHome} style={{ width: '100%', minHeight: 44 }}>
            Go to Home
          </SecondaryButton>
        </div>
      </StepCard>
    );
  }

  return (
    <StepCard>
      <div style={{ ...typography.sectionEyebrow, color: colors.positive }}>Your next useful window</div>
      <h2 style={{ ...typography.sectionTitle, marginTop: spacing.sm }}>{nextShift.windowName}</h2>
      <p style={{ ...typography.bodyStrong, marginTop: spacing.sm, fontSize: 18 }}>
        Today, starting around {nextShift.startTime} ({nextShift.startsIn})
      </p>
      <p style={{ ...typography.body, marginTop: spacing.sm }}>
        Aura suggests this as a suitable period for focused activity based on today's timing guidance for {cityName}.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.xxl }}>
        <PrimaryButton onClick={onPlanMyDay} style={{ width: '100%' }}>
          Plan my day
        </PrimaryButton>
        <SecondaryButton onClick={onGoHome} style={{ width: '100%', minHeight: 44 }}>
          Go to Home
        </SecondaryButton>
      </div>
    </StepCard>
  );
}

/**
 * Onboarding V1 PR 4 -- Section B/C: the optional first-Goal offer.
 * CHOOSE (category chips, purely UI-level discovery aids -- never a
 * persisted category/enum, see onboardingGoalStep.ts's own doc comment) ->
 * COMPOSE (an editable title plus the SAME RhythmPicker CreateGoalModal
 * already uses, defaulting to "Once"/NONE, always visible -- never a
 * silent default). Submits via the EXISTING POST /api/goals contract with
 * a fresh clientRequestId (the SAME idempotency mechanism CreateGoalModal
 * already relies on) -- this step creates no new Goal field, no new
 * category persisted anywhere.
 */
function GoalStep({ onGoalCreated, onSkip }: { onGoalCreated: (goalActivity: OnboardingGoalActivityRef) => void; onSkip: () => void }) {
  const [phase, setPhase] = useState<'CHOOSE' | 'COMPOSE'>('CHOOSE');
  const [title, setTitle] = useState('');
  // `null` represents "currently invalid" (e.g. Custom rhythm with an
  // empty/invalid number) -- RhythmPicker's own doc comment is explicit
  // that a caller must never silently fall back to NONE in that case, so
  // Create goal is disabled on `rhythm === null` below rather than reusing
  // a stale prior value. Initial value is "Once" ({kind:'NONE'}) -- the
  // SAME disclosed default CreateGoalModal's own RhythmPicker shows.
  const [rhythm, setRhythm] = useState<RhythmPickerValue | null>({ kind: 'NONE' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per GoalStep mount, reused across every retry within this mount
  // -- the exact same clientRequestId lifecycle CreateGoalModal's own
  // `useState(() => crypto.randomUUID())` already establishes, giving this
  // step the identical double-submit/retry idempotency guarantee for free.
  const [clientRequestId] = useState(() => crypto.randomUUID());

  function chooseCategory(category: OnboardingGoalCategory) {
    setTitle(category.suggestedTitle);
    setError(null);
    setPhase('COMPOSE');
  }

  function chooseCustom() {
    setTitle('');
    setError(null);
    setPhase('COMPOSE');
  }

  async function handleCreate() {
    if (!isOnboardingGoalTitleValid(title) || rhythm === null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildOnboardingGoalCreateRequestBody(title, rhythm, clientRequestId)),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.activities?.[0]) {
        const created = data.activities[0];
        onGoalCreated({ id: created.id, title: created.title, activityId: created.activityId ?? null });
      } else {
        setError(typeof data.error === 'string' && data.error ? data.error : "Couldn't create your goal. Please try again.");
      }
    } catch {
      setError("Couldn't create your goal. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'CHOOSE') {
    return (
      <StepCard>
        <h2 style={typography.sectionTitle}>What would you like Aura to help you accomplish?</h2>
        <p style={{ ...typography.body, marginTop: spacing.sm }}>Optional -- pick a starting point, or skip for now.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, marginTop: spacing.xl }}>
          {ONBOARDING_GOAL_CATEGORIES.map((category) => (
            <SecondaryButton key={category.id} onClick={() => chooseCategory(category)} style={{ width: '100%', minHeight: 44, justifyContent: 'flex-start' }}>
              {category.label}
            </SecondaryButton>
          ))}
          <SecondaryButton onClick={chooseCustom} style={{ width: '100%', minHeight: 44, justifyContent: 'flex-start' }}>
            Enter my own
          </SecondaryButton>
        </div>
        <div style={{ marginTop: spacing.xxl }}>
          <TextButton onClick={onSkip} color={colors.textFaint} style={{ minHeight: 44, width: '100%', justifyContent: 'center', display: 'flex' }}>
            Skip for now
          </TextButton>
        </div>
      </StepCard>
    );
  }

  return (
    <StepCard>
      <h2 style={typography.sectionTitle}>What would you like Aura to help you accomplish?</h2>
      <div style={{ marginTop: spacing.lg }}>
        <FieldLabel htmlFor="onboarding-goal-title">Goal</FieldLabel>
        <TextInput
          id="onboarding-goal-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Move my body regularly"
          maxLength={ONBOARDING_GOAL_TITLE_MAX_LENGTH}
          autoFocus
        />
      </div>
      <div style={{ marginTop: spacing.lg }}>
        <RhythmPicker value={rhythm ?? { kind: 'NONE' }} onChange={setRhythm} idPrefix="onboarding-goal" />
      </div>
      {error && (
        <p role="alert" style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.xxl }}>
        <PrimaryButton onClick={handleCreate} disabled={!isOnboardingGoalTitleValid(title) || rhythm === null || submitting} loading={submitting} style={{ width: '100%' }}>
          Create goal
        </PrimaryButton>
        <SecondaryButton onClick={() => setPhase('CHOOSE')} disabled={submitting} style={{ width: '100%', minHeight: 44 }}>
          Back
        </SecondaryButton>
        <TextButton onClick={onSkip} color={colors.textFaint} style={{ minHeight: 44, width: '100%', justifyContent: 'center', display: 'flex' }}>
          Skip for now
        </TextButton>
      </div>
    </StepCard>
  );
}

/**
 * Onboarding V1 PR 4 -- Section D: "Find time for your first activity."
 * Reuses the EXISTING Day Constructor preview/accept pipeline exactly as
 * PlanDayClient.tsx's own Goal-handoff path already does for a manually
 * added row -- `DayPlanPreviewController`/`DayPlanPreview` are reused
 * UNMODIFIED (never forked/relabeled), carrying the SAME FIXED commitment
 * protection, availability gates, capacity checks and accept-time
 * locking/idempotency those components already provide, with zero new
 * scheduling code in this file. Never automatically schedules anything --
 * `onSaved` only fires after the user's own explicit "Continue" tap inside
 * that controller. When no feasible window exists (ALL_DEFERRED) or the
 * whole preview request fails, the created Goal is left exactly as
 * created (this step performs no delete/rollback of it) and the user is
 * told why, then offered Home (where "Plan my day" already lives) as a
 * normal planning entry point.
 */
function FirstActivityStep({ goalActivity, timezone, onDone }: { goalActivity: OnboardingGoalActivityRef; timezone: string; onDone: () => void }) {
  const [state, setState] = useState<
    | { kind: 'LOADING' }
    | { kind: 'READY'; preview: ConstructDayPreview; goalActivityLinks: GoalActivityLink[] }
    | { kind: 'FAILED'; message: string; retryable: boolean }
  >({ kind: 'LOADING' });

  const runPreview = useCallback(async () => {
    setState({ kind: 'LOADING' });
    const planningDate = resolveOnboardingPlanningDate(timezone, new Date());
    const { row, intents } = buildOnboardingFirstActivityIntent(goalActivity, timezone, planningDate);
    const result = await previewConstructedDay(intents, planningDate);
    if (result.status === 'READY') {
      const goalActivityLinks = buildOnboardingFirstActivityGoalLinks(row, result.preview.constructedDay.proposedItems);
      setState({ kind: 'READY', preview: result.preview, goalActivityLinks });
    } else {
      setState({ kind: 'FAILED', ...presentOnboardingFirstActivityPreviewFailure(result) });
    }
  }, [goalActivity, timezone]);

  useEffect(() => {
    runPreview();
  }, [runPreview]);

  return (
    <StepCard>
      <h2 style={typography.sectionTitle}>Find time for your first activity</h2>

      {state.kind === 'LOADING' && (
        <>
          <p style={{ ...typography.body, marginTop: spacing.sm }}>Looking for a good time for &ldquo;{goalActivity.title}&rdquo;…</p>
          <div style={{ marginTop: spacing.xxl }}>
            <TextButton onClick={onDone} color={colors.textFaint} style={{ minHeight: 44, width: '100%', justifyContent: 'center', display: 'flex' }}>
              Skip for now
            </TextButton>
          </div>
        </>
      )}

      {state.kind === 'FAILED' && (
        <>
          <p style={{ ...typography.body, marginTop: spacing.sm }}>{state.message}</p>
          <p style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textMuted }}>
            Your goal is saved -- you can plan it anytime from Goals or Plan my day.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.xl }}>
            {state.retryable && (
              <SecondaryButton onClick={runPreview} style={{ width: '100%', minHeight: 44 }}>
                Try again
              </SecondaryButton>
            )}
            <PrimaryButton onClick={onDone} style={{ width: '100%' }}>
              Go to Home
            </PrimaryButton>
          </div>
        </>
      )}

      {state.kind === 'READY' && (
        <div style={{ marginTop: spacing.lg }}>
          <DayPlanPreviewController
            preview={state.preview}
            goalActivityLinks={state.goalActivityLinks}
            onDiscard={onDone}
            onSaved={onDone}
            onRefreshRequested={runPreview}
          />
        </div>
      )}
    </StepCard>
  );
}
