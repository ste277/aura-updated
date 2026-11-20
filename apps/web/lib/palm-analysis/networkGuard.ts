/**
 * AURA-PALM-G5-I1 -- cross-origin request guard for the MediaPipe runtime.
 *
 * Finding (see 07_MEDIAPIPE_INTEGRATION_NOTES.md): @mediapipe/tasks-vision
 * 1.2.0 creates a usage logger for every task. It batches task type, running
 * mode and latency counters and POSTs them with `fetch` to
 * https://odml.pa.googleapis.com/v1/log every 60 s and on close(). It sends
 * no pixels or landmarks, but it is still a third-party request, which this
 * feature does not allow.
 *
 * While a MediaPipe detector is alive this guard wraps `fetch` so that any
 * request whose origin differs from the page's origin is rejected before it
 * reaches the network. MediaPipe's logger treats the rejection as a send
 * failure and permanently stops (it clears its own interval). Same-origin
 * requests (the self-hosted WASM and model, and the rest of the app) pass
 * through untouched. The guard is reference-counted and removed when the last
 * detector closes, and it only restores `fetch` if nobody re-wrapped it since.
 *
 * Only the count and the blocked HOST are recorded, never a URL path, query or
 * body, so the record cannot hold image or user data.
 */

type FetchFn = typeof fetch;

interface GuardState {
  refs: number;
  original: FetchFn | null;
  wrapper: FetchFn | null;
  blockedHosts: string[];
  permanentHolds: string[];
}

const state: GuardState = { refs: 0, original: null, wrapper: null, blockedHosts: [], permanentHolds: [] };

function pageOrigin(): string | null {
  try {
    return typeof location !== 'undefined' ? location.origin : null;
  } catch {
    return null;
  }
}

function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    if ('url' in (input as any)) return String((input as any).url);
    if ('href' in (input as any)) return String((input as any).href);
  }
  return String(input);
}

export function isSameOrigin(url: string, origin = pageOrigin()): boolean {
  if (!origin) return false;
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}

/** Install (or add a reference to) the guard. Returns a release function. */
export function acquireCrossOriginGuard(target: { fetch?: FetchFn } = globalThis as any): () => void {
  if (state.refs === 0) {
    const original = target.fetch;
    if (typeof original === 'function') {
      const wrapper: FetchFn = ((input: any, init?: any) => {
        const url = requestUrl(input);
        if (!isSameOrigin(url)) {
          let host = 'unknown';
          try { host = new URL(url).host; } catch { /* keep 'unknown' */ }
          state.blockedHosts.push(host);
          return Promise.reject(new TypeError('Blocked: cross-origin request from the on-device palm check'));
        }
        return original.call(target, input, init);
      }) as FetchFn;
      state.original = original;
      state.wrapper = wrapper;
      target.fetch = wrapper;
    }
  }
  state.refs++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.refs = Math.max(0, state.refs - 1);
    if (state.refs === 0) {
      if (state.wrapper && target.fetch === state.wrapper && state.original) target.fetch = state.original;
      state.original = null;
      state.wrapper = null;
    }
  };
}

/**
 * AURA-PALM-G5-I1-R2 (R1-F1): fail-closed containment. Used only when a
 * MediaPipe telemetry source may still be alive and cannot be shut down
 * (an initialisation that failed after MediaPipe created its usage logger,
 * or a close() that threw). The guard then stays installed until the page is
 * unloaded: the only thing that ends such a source. Only CROSS-ORIGIN fetch
 * is affected; same-origin requests (all of Aura's own API calls) pass.
 * Never call this for ordinary success or failure paths.
 */
export function holdCrossOriginGuardForPageLifetime(reason: string, target: { fetch?: FetchFn } = globalThis as any): void {
  acquireCrossOriginGuard(target); // the release function is deliberately discarded
  state.permanentHolds.push(reason);
}

/** Diagnostics for tests and the dev-only status line: hosts only. */
export function blockedCrossOriginHosts(): readonly string[] {
  return state.blockedHosts.slice();
}

export function isCrossOriginGuardActive(): boolean {
  return state.refs > 0;
}

/** Diagnostics: current reference count and the reasons for permanent holds. */
export function crossOriginGuardRefs(): { refs: number; permanentHolds: readonly string[] } {
  return { refs: state.refs, permanentHolds: state.permanentHolds.slice() };
}

/** Test-only reset. */
export function __resetCrossOriginGuardForTests(): void {
  state.refs = 0;
  state.original = null;
  state.wrapper = null;
  state.blockedHosts = [];
  state.permanentHolds = [];
}
