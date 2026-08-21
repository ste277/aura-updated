/**
 * Pure presentation helper: detects overlaps between already-calculated
 * PanchangWindowSpans. This does NOT compute Muhurta scoring or decide
 * whether an overlap is "good" or "bad" -- it only reports which windows
 * share time with which other windows, so the UI can render that fact
 * honestly (e.g. "Abhijit overlaps Rahu Kalam") instead of silently
 * presenting a window as if it were the only thing happening then.
 */

import type { PanchangWindowSpan } from './panchangDay';

export interface WindowOverlap {
  window: PanchangWindowSpan;
  /** Every other window whose [start, end) shares time with `window`. */
  overlaps: PanchangWindowSpan[];
}

/**
 * For each window, finds every OTHER window in the same list whose span
 * overlaps it. Two windows overlap when `aStart < bEnd && bStart < aEnd`
 * (standard half-open interval overlap -- windows that merely touch at a
 * shared boundary instant do not count as overlapping).
 *
 * Returns one entry per input window, in the same order, each listing its
 * own overlaps (empty array if none). Never mutates or reorders the input.
 */
export function findWindowOverlaps(windows: PanchangWindowSpan[]): WindowOverlap[] {
  const parsed = windows.map((w) => ({ window: w, startMs: Date.parse(w.start), endMs: Date.parse(w.end) }));

  return parsed.map((a, indexA) => ({
    window: a.window,
    overlaps: parsed
      .filter((b, indexB) => indexB !== indexA && a.startMs < b.endMs && b.startMs < a.endMs)
      .map((b) => b.window),
  }));
}
