/**
 * AURA-PALM-04-I5 -- SYNTHETIC CAMERA HARNESS for the scanner journey. Test tooling only (bundled in memory by
 * test/palm04I5CameraBrowser.test.ts; never part of apps/web or any build). It mounts the real, dev-gated
 * PalmImageInput -- real camera adapter, real <video>, real session, normalisation and G5 quality check -- with two
 * test seams:
 *   - the hand detector returns the synthetic G5 fixture landmarks (no MediaPipe), optionally after a delay;
 *   - window.__PALM_CAMERA_MODE picks the camera:
 *       'mock'   a MOCKED camera: getUserMedia returns canvas.captureStream() of a DRAWN synthetic palm (never a
 *                photograph), optionally delayed, rejected with a DOMException name, or with an extra audio track;
 *       'native' the browser's own getUserMedia (Chrome's built-in fake device in the test), spied on;
 *       'none'   no camera API (unsupported browser / embedded view).
 * Every getUserMedia call's constraints and every track it produced are recorded on window for the test, and each
 * track stop is reported through window.__report (a Playwright binding) so it is observed even across navigation.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { PalmImageInput } from '../apps/web/components/palm-scan/PalmImageInput';

const W = window as any;
const HAND = [
  { x: 0.5, y: 0.85 }, { x: 0.36, y: 0.76 }, { x: 0.29, y: 0.64 }, { x: 0.24, y: 0.55 }, { x: 0.2, y: 0.47 },
  { x: 0.38, y: 0.45 }, { x: 0.37, y: 0.33 }, { x: 0.36, y: 0.25 }, { x: 0.36, y: 0.18 },
  { x: 0.5, y: 0.42 }, { x: 0.5, y: 0.29 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.13 },
  { x: 0.6, y: 0.44 }, { x: 0.61, y: 0.32 }, { x: 0.62, y: 0.24 }, { x: 0.62, y: 0.18 },
  { x: 0.68, y: 0.5 }, { x: 0.71, y: 0.41 }, { x: 0.73, y: 0.35 }, { x: 0.74, y: 0.3 },
];
W.__camCalls = [];
W.__camTracks = [];
W.__detectCalls = 0;
// Reports go to a Playwright binding and to a same-origin BroadcastChannel, so an observer page in the test sees a
// track stop even when this page is being navigated away (test tooling only).
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('palm-camera-test') : null;
const report = (k: string) => { try { W.__report?.(k); } catch { /* binding not installed */ } try { channel?.postMessage(k); } catch { /* closed */ } };

/** A drawn synthetic palm (the P4-I4 journey picture), redrawn slightly every frame so the stream keeps producing frames. */
function syntheticCameraCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const X = (k: number) => HAND[k].x * w, Y = (k: number) => HAND[k].y * h;
  const paint = (t: number) => {
    const bg = g.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#5b6b8c'); bg.addColorStop(1, '#2b3a55'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${(i * 37) % 255},${(i * 61) % 255},${(i * 17) % 255},0.15)`; g.fillRect((i * 97) % w, (i * 53) % h, 3, 3); }
    g.lineCap = 'round'; g.strokeStyle = '#e8b48f';
    for (const ch of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) { g.lineWidth = Math.min(w, h) * 0.075; g.beginPath(); ch.forEach((k, i) => (i ? g.lineTo(X(k), Y(k)) : g.moveTo(X(k), Y(k)))); g.stroke(); }
    g.fillStyle = '#f0c4a0'; g.beginPath(); [0, 1, 2, 5, 9, 13, 17].forEach((k, i) => (i ? g.lineTo(X(k), Y(k)) : g.moveTo(X(k), Y(k)))); g.closePath(); g.fill();
    for (let i = 0; i < 9000; i++) { const x = (0.15 + 0.65 * ((i * 7919) % 1000) / 1000) * w, y = (0.12 + 0.78 * ((i * 104729) % 1000) / 1000) * h; g.fillStyle = i % 2 ? 'rgba(90,50,30,0.35)' : 'rgba(255,240,225,0.35)'; g.fillRect(x, y, 4, 4); }
    g.strokeStyle = '#7a4a35'; g.lineWidth = 3;
    for (const ln of [[[0.67, 0.555], [0.52, 0.54], [0.44, 0.525]], [[0.37, 0.56], [0.54, 0.62], [0.62, 0.64]], [[0.36, 0.57], [0.4, 0.74], [0.45, 0.81]]]) { g.beginPath(); ln.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h))); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.02)'; g.fillRect((t % 50), 0, 2, 2); // a tiny change per frame
  };
  paint(0);
  let n = 0;
  const loop = () => { if (!c.isConnected && n > 0 && (c as any).__stopped) return; paint(++n); setTimeout(loop, 66); };
  setTimeout(loop, 66);
  return c;
}

const watchTrack = (t: MediaStreamTrack, label: string) => {
  W.__camTracks.push(t);
  const stop = t.stop.bind(t);
  (t as any).stop = () => { report(`stop:${label}`); stop(); };
  report(`start:${label}`);
};

const MODE = String(W.__PALM_CAMERA_MODE ?? 'mock');
let mockSeq = 0;
const mockGetUserMedia = (constraints: MediaStreamConstraints): Promise<MediaStream> => {
  W.__camCalls.push(JSON.parse(JSON.stringify(constraints)));
  const delay = Number(W.__camDelay ?? 0);
  const reject = W.__camReject as string | undefined;
  return new Promise((resolve, rejectP) => setTimeout(() => {
    if (reject) { rejectP(new DOMException('mocked camera refusal', reject)); return; }
    const canvas = syntheticCameraCanvas(1280, 960);
    const stream = (canvas as any).captureStream(15) as MediaStream;
    const id = ++mockSeq;
    stream.getVideoTracks().forEach((t) => watchTrack(t, `mock${id}-video`));
    if (W.__camAudio) {
      const ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      dest.stream.getAudioTracks().forEach((t) => { watchTrack(t, `mock${id}-audio`); stream.addTrack(t); });
    }
    resolve(stream);
  }, delay));
};

if (MODE === 'native' && navigator.mediaDevices?.getUserMedia) {
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  let seq = 0;
  navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    W.__camCalls.push(JSON.parse(JSON.stringify(constraints ?? null)));
    const s = await real(constraints);
    const id = ++seq;
    s.getTracks().forEach((t) => watchTrack(t, `native${id}-${t.kind}`));
    return s;
  };
}
const cameraEnv = MODE === 'mock' ? { secureContext: true, getUserMedia: mockGetUserMedia as any } : MODE === 'none' ? { secureContext: true, getUserMedia: null } : undefined;

const detDelay = Number(W.__detDelay ?? 0);
const sessionDeps = {
  detectorFactory: () => new Promise((r) => setTimeout(() => r({ detect: () => { W.__detectCalls++; return [{ landmarks: HAND, handednessLabel: 'Left', handednessScore: 0.98 }]; }, close() {} }), detDelay)),
};

const root = createRoot(document.getElementById('root')!);
const mount = () => root.render(
  <div style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
    <p data-testid="harness-label" style={{ color: '#facc15', font: '600 13px system-ui', margin: '0 0 8px' }}>Synthetic camera harness ({MODE}): drawn palm, mocked or fake camera, synthetic hand points.</p>
    <PalmImageInput key={W.__mountKey = (W.__mountKey ?? 0) + 1} sessionDeps={sessionDeps as any} cameraEnv={cameraEnv as any} />
  </div>,
);
mount();
W.__harness = { unmount: () => root.render(<p data-testid="harness-unmounted">unmounted</p>), remount: mount };
