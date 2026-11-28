/**
 * AURA-PALM-04-I5 (plan G-8, decision D2) -- the CAMERA ADAPTER. DEVELOPMENT ONLY (behind the G5 image-input gate;
 * excluded from every production build with the rest of lib/palm-analysis). Synthetic and mocked streams in tests.
 *
 * The camera is one more image source for the existing pipeline. This module only owns the camera itself:
 *   start()   ask for the camera -- called ONLY from an explicit user action (the "Use camera" button);
 *             video only: `audio: false`, so the microphone is never requested;
 *   attach()  show the live stream in a <video> element (nothing is recorded);
 *   frame()   the current video frame as a drawable plus its size, for session.submitDrawable(), which draws it into
 *             the pipeline's own canvas (normalizeDrawableFrame) and runs the same quality check as an upload;
 *   stop()    stop EVERY track and detach the element. Called after taking the photo, on cancel, on error, when the
 *             page is hidden or left, and on unmount (dispose()).
 *
 * Guarantees (test/palm04I5CameraAdapter.test.ts):
 *   - every start() has its own epoch; a request that resolves after stop()/dispose() or a newer start() has its
 *     tracks stopped at once and is never attached or shown (a delayed callback can never restore a stopped camera);
 *   - a stream that unexpectedly carries an audio track, or no video track, is stopped and refused (fail closed);
 *   - a track that ends by itself (device unplugged, permission revoked by the OS) stops the camera with an error;
 *   - nothing is recorded, encoded, stored, logged or sent: there is no MediaRecorder, no ImageCapture, no
 *     enumerateDevices, no device label or id is read, and the stream never leaves this module and its <video>.
 * Releasing the stream and the element's reference does not claim the browser or the OS erased any camera buffer.
 */

export const PALM_CAMERA_VERSION = 'palm-04-camera@0.1.0';

/** Video only, the rear camera when there is one. The microphone is never requested. */
export const PALM_CAMERA_CONSTRAINTS = Object.freeze({
  audio: false as const,
  video: Object.freeze({ facingMode: Object.freeze({ ideal: 'environment' }), width: Object.freeze({ ideal: 1920 }), height: Object.freeze({ ideal: 1080 }) }),
});

export type PalmCameraErrorCode =
  | 'camera-unsupported' // no camera API in this browser (or this embedded view)
  | 'camera-insecure-context' // the page is not a secure context (https or localhost)
  | 'camera-denied' // the user or the browser refused permission
  | 'camera-not-found' // no suitable camera
  | 'camera-busy' // the camera could not be started (in use elsewhere, or a hardware error)
  | 'camera-failed' // any other failure, or a stream that is not video-only
  | 'camera-ended' // the camera stopped by itself while it was on
  | 'camera-preview-failed' // R1: the live preview could not be started (playback refused or the stream could not be attached)
  | 'camera-preview-timeout' // D6-I1 DR-1: no usable frame arrived within the bounded preview start-up time
  | 'camera-not-ready'; // a photo was requested before the first frame arrived

export const PALM_CAMERA_ERROR_TEXT: Readonly<Record<PalmCameraErrorCode, string>> = Object.freeze({
  'camera-unsupported': 'The camera is not available in this browser. You can upload a photo instead.',
  'camera-insecure-context': 'The camera can only be used on a secure (https) page. You can upload a photo instead.',
  'camera-denied': 'Camera permission was not given, so the camera stayed off. You can allow it in your browser settings and try again, or upload a photo instead.',
  'camera-not-found': 'No camera was found. You can upload a photo instead.',
  'camera-busy': 'The camera could not be started. It may be in use by another app. Close it and try again, or upload a photo instead.',
  'camera-failed': 'The camera could not be used. Try again, or upload a photo instead.',
  'camera-ended': 'The camera stopped. Try again, or upload a photo instead.',
  'camera-preview-failed': 'The camera preview could not be started, so the camera was turned off. Try again, or upload a photo instead.',
  'camera-preview-timeout': 'The camera preview did not start in time, so the camera was turned off. Try again, or upload a photo instead.',
  'camera-not-ready': 'The camera is still starting. Wait a moment, then take the photo again.',
});

/** Errors after which trying the camera again can help (denied, unsupported, insecure and not-found cannot). */
export const PALM_CAMERA_RETRYABLE: readonly PalmCameraErrorCode[] = Object.freeze(['camera-busy', 'camera-failed', 'camera-ended', 'camera-preview-failed', 'camera-preview-timeout', 'camera-not-ready']);

/** D6-I1 (DR-1): once the stream is acquired, a usable preview frame must arrive within this time. */
export const PALM_CAMERA_PREVIEW_TIMEOUT_MS = 8000;

export type PalmCameraPhase = 'idle' | 'requesting' | 'live' | 'error';
export type PalmCameraStopReason = 'cancel' | 'done' | 'hidden' | 'pagehide' | 'error' | 'unmount' | 'restart';

export interface PalmCameraState {
  readonly phase: PalmCameraPhase;
  readonly error: { readonly code: PalmCameraErrorCode; readonly message: string; readonly retryable: boolean } | null;
  /** Why the camera last stopped (null while it has never stopped). */
  readonly stopped: PalmCameraStopReason | null;
  /** Increments on every start and stop; lets the UI ignore stale work. */
  readonly epoch: number;
}

// Minimal structural types, so tests can inject fakes and nothing global is patched.
export interface PalmTrackLike {
  readonly kind: string;
  readonly readyState?: string;
  stop(): void;
  addEventListener?(type: 'ended', listener: () => void): void;
  removeEventListener?(type: 'ended', listener: () => void): void;
}
export interface PalmStreamLike { getTracks(): PalmTrackLike[] }
export interface PalmVideoLike {
  srcObject: unknown;
  muted?: boolean;
  playsInline?: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly readyState?: number;
  setAttribute?(name: string, value: string): void;
  play?(): Promise<void> | void;
  pause?(): void;
}
export interface PalmCameraEnv {
  /** The browser's getUserMedia (bound), or null/undefined when there is none. */
  getUserMedia?: ((constraints: typeof PALM_CAMERA_CONSTRAINTS) => Promise<PalmStreamLike>) | null;
  /** window.isSecureContext. */
  secureContext?: boolean;
  /** D6-I1 test seams: the preview start-up limit (default PALM_CAMERA_PREVIEW_TIMEOUT_MS) and the timer functions. */
  previewTimeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type PalmCameraSupport = 'available' | 'insecure-context' | 'unsupported';

/** The browser's camera surface. This is the only place in Aura that touches it. */
export function defaultPalmCameraEnv(): PalmCameraEnv {
  const g = globalThis as { isSecureContext?: boolean; navigator?: { mediaDevices?: { getUserMedia?: (c: unknown) => Promise<unknown> } } };
  const md = g.navigator?.mediaDevices;
  const gum = md && typeof md.getUserMedia === 'function' ? (c: typeof PALM_CAMERA_CONSTRAINTS) => md.getUserMedia!(c) as Promise<PalmStreamLike> : null;
  return { getUserMedia: gum, secureContext: g.isSecureContext !== false };
}

export function palmCameraSupport(env: PalmCameraEnv = defaultPalmCameraEnv()): PalmCameraSupport {
  if (env.secureContext === false) return 'insecure-context';
  return typeof env.getUserMedia === 'function' ? 'available' : 'unsupported';
}

/** A getUserMedia rejection as a camera error code (by DOMException name; never by message text). */
export function cameraErrorCode(err: unknown): PalmCameraErrorCode {
  const name = (err && typeof err === 'object' && typeof (err as { name?: unknown }).name === 'string') ? (err as { name: string }).name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'camera-denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'camera-not-found';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'camera-busy';
  return 'camera-failed';
}

const errorOf = (code: PalmCameraErrorCode): NonNullable<PalmCameraState['error']> =>
  Object.freeze({ code, message: PALM_CAMERA_ERROR_TEXT[code], retryable: PALM_CAMERA_RETRYABLE.includes(code) });

export interface PalmCamera {
  getState(): PalmCameraState;
  subscribe(listener: (s: PalmCameraState) => void): () => void;
  support(): PalmCameraSupport;
  /** Ask for the camera. Call ONLY from an explicit user action. A second call while requesting or live does nothing. */
  start(): Promise<void>;
  /** Show the live stream in this element (null detaches the previous one). */
  attach(video: PalmVideoLike | null): void;
  /** The current frame of the live stream, or null (camera-not-ready is reported) when there is none yet. */
  frame(): { drawable: PalmVideoLike; width: number; height: number } | null;
  /** Stop every track, detach the element and drop the stream. Idempotent. */
  stop(reason?: PalmCameraStopReason): void;
  /** stop('unmount'); the camera can never be started again. */
  dispose(): void;
  readonly disposed: boolean;
  /** Diagnostics for tests: tracks this camera has obtained and not yet stopped. */
  liveTrackCount(): number;
  toJSON(): { kind: string; phase: PalmCameraPhase };
}

export function createPalmCamera(env: PalmCameraEnv = defaultPalmCameraEnv()): PalmCamera {
  let state: PalmCameraState = { phase: 'idle', error: null, stopped: null, epoch: 0 };
  let disposed = false;
  let stream: PalmStreamLike | null = null;
  let video: PalmVideoLike | null = null;
  let onEnded: (() => void) | null = null;
  let showSeq = 0; // R1: each preview start; a failure from an earlier one is ignored
  // D6-I1 (DR-1): the bounded preview start-up timer of the CURRENT stream (null when none is pending)
  let previewTimer: unknown = null;
  const setTimer = env.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = env.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const previewLimit = typeof env.previewTimeoutMs === 'number' && env.previewTimeoutMs > 0 ? env.previewTimeoutMs : PALM_CAMERA_PREVIEW_TIMEOUT_MS;
  const cancelPreviewTimer = () => { if (previewTimer !== null) { try { clearTimer(previewTimer); } catch { /* ignore */ } previewTimer = null; } };
  const usableFrame = (el: PalmVideoLike | null) => !!el && el.videoWidth > 0 && el.videoHeight > 0 && (typeof el.readyState !== 'number' || el.readyState >= 2);
  const live = new Set<PalmTrackLike>();
  const listeners = new Set<(s: PalmCameraState) => void>();

  const set = (next: Partial<PalmCameraState>) => {
    state = Object.freeze({ ...state, ...next });
    for (const l of Array.from(listeners)) l(state);
  };

  const stopTracks = (s: PalmStreamLike | null) => {
    if (!s) return;
    let tracks: PalmTrackLike[] = [];
    try { tracks = s.getTracks(); } catch { /* a broken stream has nothing more to stop */ }
    for (const t of tracks) {
      try { if (onEnded) t.removeEventListener?.('ended', onEnded); } catch { /* ignore */ }
      try { t.stop(); } catch { /* already stopped */ }
      live.delete(t);
    }
  };

  const detach = (el: PalmVideoLike | null) => {
    if (!el) return;
    try { el.pause?.(); } catch { /* ignore */ }
    try { el.srcObject = null; } catch { /* ignore */ }
  };

  /**
   * Show the live stream in the attached element. R1 (50362 F1): a preview that cannot start is TERMINAL for its
   * stream -- an attach that throws, a play() that throws, or a play() that rejects stops every track of THAT stream,
   * detaches it and reports camera-preview-failed (retryable; upload stays available). The failure counts only while
   * the same stream, element, epoch and preview start are still current, so a late failure from an older stream or an
   * earlier preview start (one that stop(), a newer start() or a re-attach superseded) can never stop, detach or
   * invalidate a newer stream.
   */
  const show = () => {
    if (!video || !stream || state.phase !== 'live') return;
    const el = video;
    const s = stream;
    const epoch = state.epoch;
    const seq = ++showSeq;
    const failed = () => {
      if (stream === s && video === el && state.epoch === epoch && showSeq === seq && state.phase === 'live') release('error', 'camera-preview-failed');
    };
    try {
      el.muted = true;
      el.playsInline = true;
      el.setAttribute?.('playsinline', '');
      el.setAttribute?.('muted', '');
      el.srcObject = s;
    } catch { failed(); return; }
    let p: Promise<void> | void;
    try { p = el.play?.(); } catch { failed(); return; }
    if (p && typeof (p as Promise<void>).then === 'function') (p as Promise<void>).then(undefined, failed);
  };

  /** Release everything this camera holds; `phase` is what the camera shows afterwards. */
  const release = (reason: PalmCameraStopReason, error: PalmCameraErrorCode | null) => {
    cancelPreviewTimer();
    const s = stream;
    stream = null;
    stopTracks(s);
    onEnded = null;
    detach(video);
    set({ phase: error ? 'error' : 'idle', error: error ? errorOf(error) : null, stopped: reason, epoch: state.epoch + 1 });
  };

  const camera: PalmCamera = {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    support: () => palmCameraSupport(env),
    async start() {
      if (disposed || state.phase === 'requesting' || state.phase === 'live') return;
      const support = palmCameraSupport(env);
      if (support !== 'available') {
        set({ phase: 'error', error: errorOf(support === 'insecure-context' ? 'camera-insecure-context' : 'camera-unsupported'), epoch: state.epoch + 1 });
        return;
      }
      const epoch = state.epoch + 1;
      set({ phase: 'requesting', error: null, epoch });
      let s: PalmStreamLike;
      try {
        s = await env.getUserMedia!(PALM_CAMERA_CONSTRAINTS);
      } catch (err) {
        if (disposed || state.epoch !== epoch) return; // cancelled while asking: stay stopped
        set({ phase: 'error', error: errorOf(cameraErrorCode(err)), epoch: epoch + 1 });
        return;
      }
      let tracks: PalmTrackLike[] = [];
      try { tracks = s.getTracks(); } catch { tracks = []; }
      for (const t of tracks) live.add(t);
      if (disposed || state.epoch !== epoch) { stopTracks(s); return; } // a late grant is stopped at once, never shown
      // fail closed: video only, at least one live video track
      if (tracks.some((t) => t.kind !== 'video') || !tracks.some((t) => t.kind === 'video' && t.readyState !== 'ended')) {
        stopTracks(s);
        set({ phase: 'error', error: errorOf('camera-failed'), epoch: epoch + 1 });
        return;
      }
      stream = s;
      const ended = () => { if (stream === s && state.epoch === epoch) release('error', 'camera-ended'); };
      onEnded = ended;
      for (const t of tracks) { try { t.addEventListener?.('ended', ended); } catch { /* ignore */ } }
      set({ phase: 'live', error: null });
      // D6-I1 (DR-1): from here, the preview has a bounded time to deliver a usable frame. The check runs only for THIS
      // stream and epoch; stop, photo, error and dispose cancel it, and a newer session ignores an old timer.
      cancelPreviewTimer();
      const timer = setTimer(() => {
        if (previewTimer !== timer) return; // superseded
        previewTimer = null;
        if (stream === s && state.epoch === epoch && state.phase === 'live' && !usableFrame(video)) release('error', 'camera-preview-timeout');
      }, previewLimit);
      previewTimer = timer;
      show();
    },
    attach(el) {
      if (video && video !== el) detach(video);
      video = el;
      if (el && state.phase === 'live') show();
    },
    frame() {
      if (state.phase !== 'live' || !video || !stream) return null;
      const w = video.videoWidth, h = video.videoHeight;
      if (!(w > 0 && h > 0) || (typeof video.readyState === 'number' && video.readyState < 2)) {
        set({ error: errorOf('camera-not-ready') }); // stays live; the user can try again
        return null;
      }
      return { drawable: video, width: w, height: h };
    },
    stop(reason = 'cancel') {
      if (state.phase === 'idle' && !stream && state.stopped !== null) { detach(video); return; }
      release(reason, null);
    },
    dispose() {
      if (disposed) return;
      camera.stop('unmount');
      disposed = true;
      video = null;
      listeners.clear();
    },
    get disposed() { return disposed; },
    liveTrackCount: () => Array.from(live).filter((t) => t.readyState !== 'ended').length,
    toJSON: () => ({ kind: PALM_CAMERA_VERSION, phase: state.phase }),
  };
  return camera;
}
