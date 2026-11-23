/**
 * AURA-PALM-G5-I1 -- the ONE hand detector: MediaPipe HandLandmarker
 * (@mediapipe/tasks-vision, pinned 1.2.0, Apache-2.0), same approach and
 * options as the G4-A prototype (IMAGE mode, CPU delegate, numHands 2 so a
 * second hand can be reported instead of silently ignored).
 *
 * - Runs in the browser from SELF-HOSTED files only: the WASM runtime and
 *   hand_landmarker.task are served from this origin under
 *   PALM_MEDIAPIPE_ASSET_BASE (populated by scripts/palm-dev-assets.js in a
 *   development checkout; the directory is gitignored and never deployed).
 * - The JS bundle is loaded with a dynamic import() only when a photo is
 *   chosen, so nothing is downloaded just by opening the palm guide.
 * - A cross-origin fetch guard is held for the detector's whole lifetime to
 *   stop MediaPipe's built-in usage logger (see networkGuard.ts).
 * - No landmarks or pixels are logged anywhere.
 *
 * AURA-PALM-G5-I1-R2 (R1-F1) -- telemetry lifecycle ownership.
 * MediaPipe creates its usage logger INSIDE HandLandmarker.createFromOptions,
 * right after the WASM module loads and BEFORE the model and graph are set up
 * (and it queues an "init" event before graph errors are thrown). That
 * factory gives no handle to the half-built task when it rejects, so a failed
 * createFromOptions can leave a logger with a live 60 s timer that nothing can
 * close. Releasing the guard at that point let its next send reach fetch
 * (G5-I1-R1, harness T5). So, phase by phase:
 *
 *   A. Before createFromOptions: the dynamic import and the file-set paths
 *      (checked to be same-origin). No MediaPipe task exists yet, so a
 *      failure here releases the guard and stays retryable
 *      ('model-unavailable').
 *   B. createFromOptions: a telemetry source MAY exist from here on. If it
 *      rejects (missing or bad WASM/model, graph error, out of memory), the
 *      source is unreachable, so the runtime is QUARANTINED:
 *      the guard is held for the rest of the page's life (the only thing
 *      that ends that timer), and every later create is refused with
 *      'runtime-unsafe' until the page is reloaded. No new task is created,
 *      so repeated failures cannot accumulate telemetry sources.
 *   C. close(): MediaPipe flushes its logger synchronously inside close()
 *      while the guard is still held. If close() throws, its logger state is
 *      unknown, so the runtime is quarantined the same way.
 *
 * Initialisations are serialised (one at a time per page), because MediaPipe
 * loads its WASM through page globals and two concurrent loads could race.
 * The guard is NOT kept after a successful close(): on every normal path it
 * is released, so unrelated Aura networking is unaffected.
 */
import { acquireCrossOriginGuard, holdCrossOriginGuardForPageLifetime, isSameOrigin } from './networkGuard';
import { PalmPipelineError, type PalmFrame, type PalmHandDetection, type PalmHandDetector } from './types';

export const PALM_MEDIAPIPE_VERSION = '1.2.0';
export const PALM_MEDIAPIPE_ASSET_BASE = `/palm-dev-assets/mediapipe-${PALM_MEDIAPIPE_VERSION}`;

export function isPalmRuntimeSupported(g: any = globalThis): boolean {
  return typeof g.WebAssembly === 'object' && typeof g.WebAssembly.instantiate === 'function' && typeof g.document !== 'undefined';
}

/** Minimal shape of the parts of @mediapipe/tasks-vision this module uses. */
interface VisionModule {
  FilesetResolver: { forVisionTasks(basePath: string): Promise<{ wasmLoaderPath: string; wasmBinaryPath: string }> };
  HandLandmarker: { createFromOptions(fileset: any, options: any): Promise<{ detect(img: any): any; close(): void }> };
}

let quarantineReason: string | null = null;
let initChain: Promise<unknown> = Promise.resolve();

/** Why the runtime is quarantined, or null when it is safe to use. */
export function palmRuntimeQuarantineReason(): string | null {
  return quarantineReason;
}

function quarantine(reason: string): void {
  if (!quarantineReason) quarantineReason = reason;
  // Keep the cross-origin guard for the page's lifetime: an unreachable
  // MediaPipe logger may still fire. Callers release their own reference
  // afterwards; this hold keeps the guard installed.
  holdCrossOriginGuardForPageLifetime(`palm-mediapipe:${reason}`);
}

function isSafeAssetBase(assetBase: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(assetBase) || assetBase.startsWith('//')) return false;
  // Resolve the way the browser will (catches "/\host" forms too).
  return isSameOrigin(`${assetBase}/x`);
}

export function createMediaPipeHandDetector(assetBase: string = PALM_MEDIAPIPE_ASSET_BASE): Promise<PalmHandDetector> {
  const run = initChain.then(() => createSerialised(assetBase));
  initChain = run.catch(() => undefined);
  return run;
}

async function createSerialised(assetBase: string): Promise<PalmHandDetector> {
  if (quarantineReason) throw new PalmPipelineError('runtime-unsafe');
  if (!isPalmRuntimeSupported()) throw new PalmPipelineError('unsupported-browser');
  if (/^[a-z][a-z0-9+.-]*:/i.test(assetBase) || assetBase.startsWith('//')) {
    // Absolute URLs are refused outright: assets must be same-origin paths.
    throw new PalmPipelineError('model-unavailable', 'asset base must be a same-origin path');
  }
  if (!isSafeAssetBase(assetBase)) throw new PalmPipelineError('model-unavailable', 'asset base must be a same-origin path');

  const releaseGuard = acquireCrossOriginGuard();

  // Phase A -- no MediaPipe task (and so no usage logger) exists yet.
  let vision: VisionModule;
  let fileset: { wasmLoaderPath: string; wasmBinaryPath: string };
  try {
    vision = (await import('@mediapipe/tasks-vision')) as unknown as VisionModule;
    fileset = await vision.FilesetResolver.forVisionTasks(`${assetBase}/wasm`);
    if (!isSameOrigin(fileset.wasmLoaderPath) || !isSameOrigin(fileset.wasmBinaryPath)) throw new Error('runtime outside this origin');
  } catch {
    releaseGuard();
    throw new PalmPipelineError('model-unavailable');
  }

  // Phase B -- from here a usage logger may exist.
  let landmarker: { detect(img: any): any; close(): void };
  try {
    landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${assetBase}/hand_landmarker.task`, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numHands: 2,
    });
  } catch {
    // The half-built task (and its logger timer) is unreachable: fail closed.
    quarantine('init-failed');
    releaseGuard();
    throw new PalmPipelineError('runtime-unsafe');
  }

  // Phase C -- a live detector owns one guard reference until close().
  const lm = landmarker;
  let closed = false;
  return {
    detect(frame: PalmFrame): PalmHandDetection[] {
      if (closed) throw new PalmPipelineError('analysis-failed', 'detector closed');
      const res = lm.detect(frame.canvas);
      const out: PalmHandDetection[] = (res.landmarks || []).map((landmarks: any[], i: number) => ({
        landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        handednessLabel: res.handednesses?.[i]?.[0]?.categoryName,
        handednessScore: res.handednesses?.[i]?.[0]?.score,
      }));
      return out;
    },
    close() {
      if (closed) return;
      closed = true;
      let cleanedUp = false;
      try {
        lm.close(); // MediaPipe flushes its logger here: the guard is still held.
        cleanedUp = true;
      } catch {
        /* handled below */
      }
      if (!cleanedUp) quarantine('close-failed'); // logger state unknown: keep containment
      releaseGuard();
    },
  };
}

/** Test-only reset of the module's runtime state. */
export function __resetPalmRuntimeForTests(): void {
  quarantineReason = null;
  initChain = Promise.resolve();
}
