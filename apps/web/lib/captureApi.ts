import { deriveCaptureState, type DerivedCaptureState } from './captures';
import type { CaptureWithLinkedPlanStatus } from './db';

export interface CaptureView {
  id: string;
  title: string;
  derivedState: DerivedCaptureState;
  createdAt: Date;
}

/** The product-safe Capture shape: no userId, plannedActivityId, raw status or
 * completedAt -- those are internal lifecycle data. */
export function toCaptureView(row: CaptureWithLinkedPlanStatus): CaptureView {
  return {
    id: row.id,
    title: row.title,
    derivedState: deriveCaptureState({ status: row.status, completedAt: row.completedAt, linkedPlanStatus: row.linkedPlanStatus }),
    createdAt: row.createdAt,
  };
}
