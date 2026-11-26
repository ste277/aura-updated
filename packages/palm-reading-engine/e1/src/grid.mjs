// AURA-PALM-03-E1 -- numerical contract for interpretation (R2 F5, revised in R3).
//
// I1 serializes palm-frame coordinates with round4 (Math.round(v * 1e4) / 1e4) and measurements with round3; every
// C1 threshold and margin is a multiple of 0.0001. E1 uses the SAME membership rule I1 produces: a value is on the
// interpretation grid iff Math.round(v * 1e4) / 1e4 === v exactly (a round3 value always satisfies it). There is no
// tolerance, so 0.20000000001 is off the grid (R3, finding F5).
//
// Interpretation thresholds are all below 10. A finite I1 value whose magnitude exceeds MAX_INTERPRETABLE cannot be
// compared safely as an integer step count; it is NOT an error in the reading -- the caller withholds only the
// interpretation that depends on it, with a diagnostic (e.g. an I1 ratio of 9e+304 from a degenerate synthetic hand).
// Within the bound, values are compared as exact integer steps of 0.0001 (|n| <= 1e10, far below 2^53).

export const GRID_SCALE = 10000;
export const MAX_INTERPRETABLE = 1e6;

/** 'ok' | 'off-grid' | 'out-of-range' | 'not-finite' for a candidate numeric value. */
export function gridStatus(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'not-finite';
  if (Math.abs(v) > MAX_INTERPRETABLE) return 'out-of-range';
  return Math.round(v * GRID_SCALE) / GRID_SCALE === v ? 'ok' : 'off-grid';
}

/** Integer grid units for an on-grid, in-range value; null otherwise. */
export function toGrid(v) {
  return gridStatus(v) === 'ok' ? Math.round(v * GRID_SCALE) + 0 : null;
}

export const fromGrid = (n) => n / GRID_SCALE;
