/**
 * Quick Capture V1 PR B -- pure presentation helpers for the "Things you
 * want to do" page (no I/O, no React).
 */
import type { DerivedCaptureState } from './captures';

export interface CaptureItem {
  id: string;
  title: string;
  derivedState: DerivedCaptureState;
  createdAt: string;
}

/** Only an OPEN capture can be selected, completed directly, or removed. */
export function isCaptureActionable(state: DerivedCaptureState): boolean {
  return state === 'OPEN';
}

export function presentCaptureStateLabel(state: DerivedCaptureState): string | null {
  return state === 'PLANNED' ? 'Planned' : null;
}

/** IDs only -- never titles, activity ids, durations or deadlines in the URL.
 * /plan-day re-resolves everything server-side (resolveCaptureHandoff). */
export function buildCapturePlanHref(captureIds: readonly string[]): string {
  return `/plan-day?${new URLSearchParams({ captures: captureIds.join(',') }).toString()}`;
}
