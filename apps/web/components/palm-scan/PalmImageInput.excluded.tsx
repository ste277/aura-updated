'use client';

/**
 * AURA-PALM-G5-I1-R2 (R1-F3) -- production stand-in for ./PalmImageInput.
 *
 * apps/web/palm-image-input-build-exclusion.js swaps this file in for EVERY
 * production build, whatever the Palmistry content-approval state, because
 * production release of palm image input has not been authorised. It renders
 * nothing, imports nothing from lib/palm-analysis or MediaPipe, and must stay
 * free of the image-input sentinels that scripts/check-palmistry-bundle.js
 * looks for.
 */
export interface PalmImageInputProps {
  sessionDeps?: unknown;
}

export function PalmImageInput(_props: PalmImageInputProps): null {
  return null;
}
