/**
 * AURA-PALM-04-I2 -- SYNTHETIC DEVELOPMENT HARNESS for the tracing overlay. Test tooling only: it lives in test/, is
 * bundled only by test/palm04I2TracingBrowser.test.ts into an in-memory page for a local browser, and is never part
 * of apps/web or any build. Synthetic fixtures only: a drawn (not photographed) palm and the G5 fixture landmarks.
 *
 * It mounts the real PalmTracingPanel (from components/palm-scan/PalmImageInput.tsx) on a real P4-I1 construction
 * context, and exposes window.__palmHarness so the browser test can replace, revoke and tear down the context the way
 * the analysis session does.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { PalmTracingPanel } from '../apps/web/components/palm-scan/PalmImageInput';
import { createConstructionContext, type PalmConstructionContext } from '../apps/web/lib/palm-analysis/construction';

type P = { x: number; y: number };

/** The G5 fixture hand (test/palmG5I1Fixtures.ts makeHand), inlined so the harness has no Node dependencies. */
const HAND: P[] = [
  { x: 0.5, y: 0.85 }, { x: 0.36, y: 0.76 }, { x: 0.29, y: 0.64 }, { x: 0.24, y: 0.55 }, { x: 0.2, y: 0.47 },
  { x: 0.38, y: 0.45 }, { x: 0.37, y: 0.33 }, { x: 0.36, y: 0.25 }, { x: 0.36, y: 0.18 },
  { x: 0.5, y: 0.42 }, { x: 0.5, y: 0.29 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.13 },
  { x: 0.6, y: 0.44 }, { x: 0.61, y: 0.32 }, { x: 0.62, y: 0.24 }, { x: 0.62, y: 0.18 },
  { x: 0.68, y: 0.5 }, { x: 0.71, y: 0.41 }, { x: 0.73, y: 0.35 }, { x: 0.74, y: 0.3 },
];

/** A synthetic palm picture: skin-toned palm and fingers drawn from the landmarks, plus three drawn guide strokes. */
function drawSyntheticPalm(w: number, h: number, hand: P[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2b3a55');
  bg.addColorStop(1, '#16213a');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const X = (p: P) => p.x * w, Y = (p: P) => p.y * h;
  const u = Math.min(w, h);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#d9a982';
  for (const chain of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) {
    g.lineWidth = u * 0.075;
    g.beginPath();
    chain.forEach((k, i) => (i ? g.lineTo(X(hand[k]), Y(hand[k])) : g.moveTo(X(hand[k]), Y(hand[k]))));
    g.stroke();
  }
  g.fillStyle = '#e0b08c';
  g.beginPath();
  [0, 1, 2, 5, 9, 13, 17].forEach((k, i) => (i ? g.lineTo(X(hand[k]), Y(hand[k])) : g.moveTo(X(hand[k]), Y(hand[k]))));
  g.closePath();
  g.fill();
  g.lineWidth = u * 0.06;
  g.stroke();
  // Drawn guide strokes where the synthetic lines run (illustration only; nothing reads them).
  g.strokeStyle = 'rgba(120, 70, 50, 0.75)';
  g.lineWidth = Math.max(2, u * 0.006);
  const stroke = (pts: Array<[number, number]>) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h))); g.stroke(); };
  stroke([[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]]);
  stroke([[0.37, 0.56], [0.45, 0.6], [0.54, 0.62], [0.62, 0.64]]);
  stroke([[0.36, 0.57], [0.37, 0.66], [0.4, 0.74], [0.45, 0.81]]);
  return c;
}

const SIZE = (window as any).__PALM_HARNESS_SIZE ?? { w: 960, h: 1280 };
const W = Number(SIZE.w);
const H = Number(SIZE.h);

let generation = 0;
let current: { context: PalmConstructionContext; revoke: () => void; image: HTMLCanvasElement } | null = null;
let mounted = true;
let remountKey = 0;

function makeContext(shift = 0) {
  generation += 1;
  const hand = HAND.map((p) => ({ x: p.x + shift, y: p.y }));
  const gen = generation;
  const made = createConstructionContext({ imageWidth: W, imageHeight: H, landmarks: hand, handednessLabel: 'Left', rotationDeg: 0, qualityIssues: [] }, gen, () => true);
  if (!made) throw new Error('synthetic context refused');
  return { ...made, image: drawSyntheticPalm(W, H, hand) };
}

const rootEl = document.getElementById('root')!;
const root = createRoot(rootEl);
function render() {
  if (!mounted || !current) { root.render(null); return; }
  root.render(
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <p data-testid="harness-label" style={{ color: '#facc15', font: '600 13px system-ui', margin: '0 0 8px' }}>Synthetic development harness. Drawn palm, synthetic landmarks. Not a photo.</p>
      <PalmTracingPanel key={remountKey} context={current.context} imageSource={current.image} onClose={() => { (window as any).__palmHarness.closed = true; }} />
    </div>,
  );
}

current = makeContext();
render();

(window as any).__palmHarness = {
  size: { w: W, h: H },
  landmarks: () => current?.context.read()?.landmarks ?? null,
  /** Session-style photo replacement: revoke the old context, hand the SAME panel instance the new one. */
  replace(shift = 0.02) { current?.revoke(); current = makeContext(shift); render(); },
  /** Revoke the context without re-rendering (the photo vanished while the panel is idle). */
  revoke() { current?.revoke(); },
  /** Remount with the same context (PalmImageInput's key change). */
  remount() { remountKey += 1; render(); },
  rerender() { render(); },
  unmount() { mounted = false; render(); },
  closed: false,
};
