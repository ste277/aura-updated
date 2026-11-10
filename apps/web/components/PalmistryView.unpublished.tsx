'use client';

import React from 'react';

/**
 * AURA-PALM-01-P1 -- production stand-in for ./PalmistryView while the
 * Palmistry content has NOT been approved by a qualified human reviewer.
 *
 * apps/web/palmistry-build-exclusion.js swaps this file in for every
 * production build (next build) while packages/palmistry/src/review-status.json
 * is not "APPROVED", so none of the educational content, sources, hand
 * diagram or Explore card copy is bundled. It must stay content-free and
 * must export exactly the names page.tsx imports from ./PalmistryView
 * (checked by test/palm01I1ExploreJsdom.test.ts).
 */

export function isPalmistryAvailable(): boolean {
  return false;
}

export function PalmistryView(_props: { onBack: () => void; initialEntryId?: string | null }): React.ReactElement | null {
  return null;
}

export const PALMISTRY_EXPLORE_CARD: { kicker: string; actionLabel: string; description: string; footer: string } | null = null;
