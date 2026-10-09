'use client';

import { useState } from 'react';
import { colors, spacing, radius, typography } from './theme';
import { PrimaryButton, SecondaryButton, TextButton } from './ui';
import { LocationPicker } from './LocationPicker';
import { findCity } from '../lib/cities';
import type { DailyEnergyInsight } from '../lib/scoreEngine';

interface CityOption {
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

type OnboardingStep = 'WELCOME' | 'LOCATION' | 'RECOMMENDATION';

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

  const stepIndex = step === 'WELCOME' ? 1 : step === 'LOCATION' ? 2 : 3;

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
            onGoHome={onExit}
          />
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
