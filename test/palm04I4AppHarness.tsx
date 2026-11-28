/**
 * AURA-PALM-04-I4 -- SYNTHETIC APP HARNESS for the integrated scanner journey. Test tooling only (bundled in memory by
 * test/palm04I4JourneyBrowser.test.ts; never part of apps/web or any build). It mounts the real, dev-gated
 * PalmImageInput -- real file input, real validation, real browser decoding and normalisation, real G5 quality check --
 * with ONE test seam: the hand detector returns the synthetic G5 fixture landmarks (no MediaPipe, no model files).
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { PalmImageInput } from '../apps/web/components/palm-scan/PalmImageInput';

const HAND = [
  { x: 0.5, y: 0.85 }, { x: 0.36, y: 0.76 }, { x: 0.29, y: 0.64 }, { x: 0.24, y: 0.55 }, { x: 0.2, y: 0.47 },
  { x: 0.38, y: 0.45 }, { x: 0.37, y: 0.33 }, { x: 0.36, y: 0.25 }, { x: 0.36, y: 0.18 },
  { x: 0.5, y: 0.42 }, { x: 0.5, y: 0.29 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.13 },
  { x: 0.6, y: 0.44 }, { x: 0.61, y: 0.32 }, { x: 0.62, y: 0.24 }, { x: 0.62, y: 0.18 },
  { x: 0.68, y: 0.5 }, { x: 0.71, y: 0.41 }, { x: 0.73, y: 0.35 }, { x: 0.74, y: 0.3 },
];
// A rotation in degrees for the synthetic hand (the poor-quality journey uses a tilted hand: G5 "hand-rotated").
const ROT = Number((window as any).__PALM_APP_ROTATE ?? 0);
const rot = (p: { x: number; y: number }) => { const a = (ROT * Math.PI) / 180, cx = 0.5, cy = 0.55; return { x: cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a), y: cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a) }; };
const sessionDeps = { detectorFactory: async () => ({ detect: () => [{ landmarks: HAND.map(rot), handednessLabel: 'Left', handednessScore: 0.98 }], close() {} }) };

createRoot(document.getElementById('root')!).render(
  <div style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
    <p data-testid="harness-label" style={{ color: '#facc15', font: '600 13px system-ui', margin: '0 0 8px' }}>Synthetic app harness: real upload flow, synthetic photo and hand points.</p>
    <PalmImageInput sessionDeps={sessionDeps as any} />
  </div>,
);
