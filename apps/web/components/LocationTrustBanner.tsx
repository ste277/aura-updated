'use client';

import React from 'react';
import { colors, spacing, radius, typography } from './theme';
import { PrimaryButton } from './ui';

/**
 * Onboarding V1 PR 1 -- Location Trust Foundation: the ONE centralized,
 * nonblocking disclosure that `locationConfirmedAt` exists to drive.
 * Rendered once in page.tsx, above every tab's own content, so it is
 * visible on Home and every other primary app surface without each
 * feature independently re-implementing the same disclosure.
 *
 * Renders nothing once `locationConfirmed` is true -- never a
 * permanently-dismissible flag (this is a correctness/trust signal, not
 * a cosmetic nudge, so it reappears every session until the user takes
 * the one explicit action that resolves it for good: confirming their
 * location through the existing Location & Time picker).
 *
 * Never implies the unconfirmed location IS verified, and never blocks
 * anything -- the rest of the app renders and functions identically
 * whether this banner is visible or not; it is purely additive
 * disclosure, reusing the EXISTING location-editing experience for its
 * one action rather than inventing a new one.
 */
export function LocationTrustBanner({
  locationConfirmed,
  cityName,
  onConfirmLocation,
}: {
  locationConfirmed: boolean;
  cityName: string;
  onConfirmLocation: () => void;
}) {
  if (locationConfirmed) return null;

  return (
    <section
      role="status"
      style={{
        width: '100%',
        boxSizing: 'border-box',
        background: colors.surfaceSubtle,
        border: `1px solid ${colors.borderSubtle}`,
        borderRadius: radius.lg,
        padding: spacing.lg,
        marginBottom: spacing.md,
      }}
    >
      <div style={{ ...typography.bodyStrong }}>Showing times for {cityName}.</div>
      <p style={{ ...typography.caption, color: colors.textFaint, marginTop: 4, lineHeight: 1.4 }}>
        Confirm your location for accurate guidance.
      </p>
      <div style={{ marginTop: spacing.md }}>
        <PrimaryButton onClick={onConfirmLocation}>Confirm location</PrimaryButton>
      </div>
    </section>
  );
}
