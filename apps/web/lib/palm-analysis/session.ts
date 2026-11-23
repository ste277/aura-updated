/**
 * AURA-PALM-G5-I1 -- PalmAnalysisSession: the shared orchestrator every
 * image source goes through. It owns ordering, cancellation and cleanup so
 * the UI (and the G5-I2 camera adapter) only hands it inputs:
 *
 *   submitFile(file)                 upload adapter (this ticket)
 *   submitDrawable(src, w, h, kind)  camera adapter (G5-I2), same tail
 *   clear()                          remove the image and every derived value
 *   dispose()                        clear() + close the model; session is dead
 *
 * Guarantees (unit-tested in test/palmG5I1Pipeline.test.ts):
 *   - Every submit gets a new generation; work from an older generation is
 *     dropped at each await, and its frame is released, so a stale result can
 *     never appear after the image was removed or replaced.
 *   - At most one frame is alive; replacing or clearing releases the old one.
 *   - The model is loaded once, lazily, on the first submit; a failed load is
 *     forgotten so "Try again" really retries; dispose() closes it, including
 *     a load that finishes after dispose().
 *   - State is volatile memory only. Nothing is persisted, logged or sent.
 */
import { analyzePalmFrame } from './analyze';
import { isPalmImageInputEnabled } from './gate';
import { createDefaultDecoder, defaultCanvasFactory, normalizeDrawableFrame, normalizeImageBlob, type PalmNormalizeEnv } from './normalize';
import { palmInputError, validatePalmImageFile, type PalmBlobLike } from './validate';
import { PalmPipelineError, type PalmAnalysisResult, type PalmFrame, type PalmHandDetector, type PalmHandDetectorFactory, type PalmImageSourceKind, type PalmInputError } from './types';

export type PalmSessionPhase = 'idle' | 'validating' | 'loading-model' | 'analysing' | 'result' | 'error';

export interface PalmSessionState {
  readonly phase: PalmSessionPhase;
  /** Increments on every submit/clear; lets the UI key its preview. */
  readonly generation: number;
  /** The frame to preview (owned by the session; do not release it). */
  readonly frame: PalmFrame | null;
  readonly result: PalmAnalysisResult | null;
  readonly error: PalmInputError | null;
}

export interface PalmSessionDeps {
  detectorFactory: PalmHandDetectorFactory;
  normalizeEnv?: Partial<PalmNormalizeEnv>;
  /** Defaults to the real development gate. */
  isEnabled?: () => boolean;
  /** Yields to the browser so a loading state can paint (default: setTimeout 0). */
  yieldToUi?: () => Promise<void>;
}

export interface PalmAnalysisSession {
  getState(): PalmSessionState;
  subscribe(listener: (s: PalmSessionState) => void): () => void;
  submitFile(file: PalmBlobLike & Blob): Promise<void>;
  submitDrawable(drawable: unknown, width: number, height: number, source?: PalmImageSourceKind): Promise<void>;
  /** Retry analysis of the current frame (e.g. after a model-load failure). */
  retry(): Promise<void>;
  clear(): void;
  dispose(): void;
  readonly disposed: boolean;
}

const IDLE: Omit<PalmSessionState, 'generation'> = { phase: 'idle', frame: null, result: null, error: null };

export function createPalmAnalysisSession(deps: PalmSessionDeps): PalmAnalysisSession {
  const env: PalmNormalizeEnv = {
    createCanvas: deps.normalizeEnv?.createCanvas ?? defaultCanvasFactory,
    decode: deps.normalizeEnv?.decode ?? createDefaultDecoder(),
  };
  const enabled = deps.isEnabled ?? (() => isPalmImageInputEnabled());
  const yieldToUi = deps.yieldToUi ?? (() => new Promise<void>((r) => setTimeout(r, 0)));

  let generation = 0;
  let state: PalmSessionState = { ...IDLE, generation };
  let disposed = false;
  let detector: PalmHandDetector | null = null;
  let detectorPromise: Promise<PalmHandDetector> | null = null;
  const listeners = new Set<(s: PalmSessionState) => void>();

  const emit = (next: Omit<PalmSessionState, 'generation'>, gen: number) => {
    if (gen !== generation || disposed) return;
    state = { ...next, generation: gen };
    for (const l of Array.from(listeners)) l(state);
  };

  const releaseCurrentFrame = () => {
    state.frame?.release();
  };

  const loadDetector = (): Promise<PalmHandDetector> => {
    if (detector) return Promise.resolve(detector);
    if (!detectorPromise) {
      detectorPromise = deps.detectorFactory().then(
        (d) => {
          if (disposed) {
            d.close(); // finished loading after the user left: close at once
            throw new PalmPipelineError('feature-disabled');
          }
          detector = d;
          return d;
        },
        (err) => {
          detectorPromise = null; // forget the failure so a retry reloads
          throw err;
        }
      );
    }
    return detectorPromise;
  };

  const toError = (err: unknown): PalmInputError => {
    const code = err instanceof PalmPipelineError ? err.code : 'analysis-failed';
    return palmInputError(code);
  };

  /** Shared tail for every source: model -> analyse -> result. */
  const analyseFrame = async (frame: PalmFrame, gen: number) => {
    const stale = () => gen !== generation || disposed;
    if (!detector) {
      emit({ phase: 'loading-model', frame, result: null, error: null }, gen);
      try {
        await loadDetector();
      } catch (err) {
        if (stale()) return;
        emit({ phase: 'error', frame, result: null, error: toError(err) }, gen);
        return;
      }
      if (stale()) return;
    }
    emit({ phase: 'analysing', frame, result: null, error: null }, gen);
    await yieldToUi();
    if (stale() || frame.released) return;
    try {
      const result = analyzePalmFrame(frame, detector!);
      if (stale()) return;
      emit({ phase: 'result', frame, result, error: null }, gen);
    } catch (err) {
      if (stale()) return;
      emit({ phase: 'error', frame, result: null, error: toError(err) }, gen);
    }
  };

  const begin = (): number | null => {
    if (disposed) return null;
    releaseCurrentFrame();
    generation++;
    if (!enabled()) {
      emit({ phase: 'error', frame: null, result: null, error: palmInputError('feature-disabled') }, generation);
      return null;
    }
    return generation;
  };

  const session: PalmAnalysisSession = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async submitFile(file) {
      const gen = begin();
      if (gen === null) return;
      emit({ phase: 'validating', frame: null, result: null, error: null }, gen);
      const v = await validatePalmImageFile(file);
      if (gen !== generation || disposed) return;
      if (!v.ok) {
        emit({ phase: 'error', frame: null, result: null, error: v.error }, gen);
        return;
      }
      let frame: PalmFrame;
      try {
        frame = await normalizeImageBlob(file, v.header, env);
      } catch (err) {
        if (gen !== generation || disposed) return;
        emit({ phase: 'error', frame: null, result: null, error: toError(err) }, gen);
        return;
      }
      if (gen !== generation || disposed) {
        frame.release(); // superseded while decoding: never shown
        return;
      }
      await analyseFrame(frame, gen);
    },
    async submitDrawable(drawable, width, height, source = 'camera') {
      const gen = begin();
      if (gen === null) return;
      let frame: PalmFrame;
      try {
        frame = normalizeDrawableFrame(drawable, width, height, source, env);
      } catch (err) {
        emit({ phase: 'error', frame: null, result: null, error: toError(err) }, gen);
        return;
      }
      await analyseFrame(frame, gen);
    },
    async retry() {
      const frame = state.frame;
      if (disposed || !frame || frame.released || state.phase !== 'error') return;
      generation++;
      await analyseFrame(frame, generation);
    },
    clear() {
      if (disposed) return;
      releaseCurrentFrame();
      generation++;
      emit({ ...IDLE }, generation);
    },
    dispose() {
      if (disposed) return;
      releaseCurrentFrame();
      generation++;
      state = { ...IDLE, generation };
      disposed = true;
      listeners.clear();
      try { detector?.close(); } catch { /* ignore */ }
      detector = null;
      // A load still in flight is closed by loadDetector's disposed check.
    },
    get disposed() {
      return disposed;
    },
  };
  return session;
}
