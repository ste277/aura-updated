/**
 * AURA-PALM-D6-I1 -- loads E1's pinned library in a REAL BROWSER through the browser-compatible loader (test tooling
 * only; bundled in memory by test/palmD6I1JourneyBrowser.test.ts) and publishes a fingerprint for the Node parity check.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const packaged = require('../packages/palm-reading-engine/e1/src/packaged.mjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sha256Hex } = require('../packages/palm-reading-engine/e1/src/sha256.mjs');
const W = window as any;
try {
  const lib = packaged.pinnedLibrary();
  W.__loader = {
    ok: true,
    fingerprint: sha256Hex(new TextEncoder().encode(`${JSON.stringify(lib.catalogue)}|${JSON.stringify(lib.schema ?? null)}`)),
    digests: { ...packaged.C1_REV4_DIGESTS },
    records: lib.catalogue.interpretations.length,
    frozen: Object.isFrozen(lib) && Object.isFrozen(lib.catalogue),
  };
} catch (e) {
  W.__loader = { ok: false, error: String(e) };
}
