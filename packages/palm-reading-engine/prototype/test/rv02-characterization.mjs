// R1.2 (R1.1-RV-02, DEFERRED) — characterisation of interpretation cut-offs. Pure; shared by the test and bin script.
import { selectVariants } from '../src/engine.mjs';
import { FAMILIES } from '../src/rules.mjs';

export const PROBES = Object.freeze([['B-m-1e-6', -1, -1e-6], ['B-m', -1, 0], ['B-m+1e-6', -1, 1e-6], ['B-1e-6', 0, -1e-6], ['B', 0, 0], ['B+1e-6', 0, 1e-6], ['B+m-1e-6', 1, -1e-6], ['B+m', 1, 0], ['B+m+1e-6', 1, 1e-6]]);

/** For every family with an internal boundary B and margin m: the variants (and ambiguity) selected at each probe value. */
export function characterizeBoundaries() {
  const rows = [];
  for (const f of FAMILIES) {
    const bounds = [...new Set(f.variants.flatMap((v) => [v.min, v.max]).filter((x) => x !== undefined))].sort((a, b) => a - b);
    for (const B of bounds) {
      const row = { family: f.id, boundary: B, margin: f.margin, probes: {} };
      for (const [name, sm, d] of PROBES) {
        const v = B + sm * f.margin + d;
        const r = selectVariants(f, v);
        row.probes[name] = { value: v, variants: r.variants.map((x) => x.id), ambiguous: r.ambiguous };
      }
      rows.push(row);
    }
  }
  return rows;
}
