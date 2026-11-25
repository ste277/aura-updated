// AURA-PALM-03-E1-R2 -- numerical equality on the serialized coordinate grid.
// I1 serializes palm-frame coordinates to 4 decimals and measurements to 3 decimals, and every C1 threshold and
// margin is a multiple of 0.0001. E1 therefore compares values as INTEGER steps of 0.0001 (grid units), so equality
// at a threshold, a margin, a tie tolerance or a minimum gap is exact and cannot depend on where a hand lies in the
// frame (independent finding F5). No floating-point tolerance is added: a value that is not on the grid is refused.

export const GRID_SCALE = 10000; // one grid unit = 0.0001 palm widths / ratio units

/** Integer grid units for a value that lies on the 0.0001 grid; null when it does not (or is not finite). */
export function toGrid(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const s = v * GRID_SCALE;
  const n = Math.round(s);
  // the representation error of a 4-dp decimal times 1e4 is ~1e-11 here; anything above 1e-6 of a step is off-grid
  return Math.abs(s - n) <= 1e-6 ? n + 0 : null;
}

export const fromGrid = (n) => n / GRID_SCALE;
