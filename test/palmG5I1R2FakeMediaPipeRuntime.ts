/**
 * AURA-PALM-G5-I1-R2 -- a fake WASM runtime for the REAL MediaPipe JS layer.
 *
 * The real `@mediapipe/tasks-vision` 1.2.0 package (its CJS build, which is
 * what `import('@mediapipe/tasks-vision')` resolves to under ts-node) is used
 * UNMODIFIED: the real HandLandmarker.createFromOptions, the real task
 * factory and the real usage logger (with its 60 s timer and its fetch POST to
 * odml.pa.googleapis.com). Only three things are faked:
 *
 *   1. the WASM module (a Proxy whose `_xxx` functions are no-ops), loaded
 *      through MediaPipe's own `importScripts` path;
 *   2. the network transport (globalThis.fetch): a recorder that NEVER does
 *      I/O, so no telemetry can ever be transmitted by these tests;
 *   3. setInterval/clearInterval, so the logger's 60 s timer can be fired on
 *      demand.
 *
 * Failure injection points (per create, consumed in order from `modes`):
 *   'ok'              -- normal
 *   'factory-error'   -- the WASM module factory rejects (BEFORE the logger exists)
 *   'pre-graph-error' -- throws while building the graph (logger exists, queue empty)
 *   'graph-error'     -- a graph error after setGraph(): the logger has queued
 *                        its init event, then createFromOptions rejects
 *                        (the G5-I1-R1 T5 scenario)
 *   'close-error'     -- creates fine; close() throws in closeGraph
 */
export type FakeMode = 'ok' | 'factory-error' | 'pre-graph-error' | 'graph-error' | 'close-error';

export interface WireEntry { url: string; method: string; body: Uint8Array | null }

export const PAGE_ORIGIN = 'http://localhost:3000';
export const MODEL_SENTINEL_BYTE = 0xab;

export const runtime = {
  modes: [] as FakeMode[],
  defaultMode: 'ok' as FakeMode,
  wire: [] as WireEntry[],
  events: [] as string[],
  intervals: [] as { fn: () => void; ms: number; cleared: boolean }[],
  createCount: 0,
};

/** The transport: records and answers; never touches the network. */
export async function fakeTransport(input: any, init?: any): Promise<any> {
  const url = String(input?.url ?? input?.href ?? input);
  const body = init?.body instanceof Uint8Array ? init.body : init?.body ? new Uint8Array(Buffer.from(String(init.body))) : null;
  runtime.wire.push({ url, method: init?.method ?? 'GET', body });
  return new Response(new Uint8Array(64).fill(MODEL_SENTINEL_BYTE));
}

export const telemetry = () => runtime.wire.filter((w) => w.url.includes('googleapis.com'));

function makeModule(mode: FakeMode, n: number) {
  const heap = new ArrayBuffer(1 << 20);
  const base: Record<string, any> = {
    HEAPU8: new Uint8Array(heap), HEAPU32: new Uint32Array(heap), HEAPF32: new Float32Array(heap), HEAP32: new Int32Array(heap),
    canvas: null,
    FS_createDataFile() {}, FS_unlink() {}, stringToNewUTF8() { return 0; }, _malloc() { return 8; }, _free() {},
  };
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return (t as any)[k];
      if (typeof k !== 'string' || k === 'then') return undefined;
      return (..._a: unknown[]) => {
        if (k === '_attachProtoVectorListener' && mode === 'pre-graph-error') throw new Error('fake graph build failure');
        if (k === '_changeBinaryGraph') {
          runtime.events.push(`graph#${n}`);
          if (mode === 'graph-error' && typeof t.errorListener === 'function') t.errorListener(1, 'fake graph error');
        }
        if (k === '_closeGraph' && mode === 'close-error') throw new Error('fake close failure');
        return 0;
      };
    },
    set(t, k, v) { t[k as string] = v; return true; },
  });
}

let installed = false;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

export function installFakeMediaPipeRuntime(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as any;
  g.self = g;
  if (typeof g.document === 'undefined') g.document = {};
  g.OffscreenCanvas = class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { return null; } };
  Object.defineProperty(g, 'location', { value: { origin: PAGE_ORIGIN }, configurable: true, writable: true });
  g.fetch = fakeTransport;
  g.importScripts = () => {
    const n = ++runtime.createCount;
    const mode = runtime.modes.length ? runtime.modes.shift()! : runtime.defaultMode;
    runtime.events.push(`factory#${n}:${mode}`);
    g.ModuleFactory = async () => {
      if (mode === 'factory-error') throw new Error('fake wasm load failure');
      return makeModule(mode, n);
    };
  };
  g.setInterval = (fn: () => void, ms: number) => { runtime.intervals.push({ fn, ms, cleared: false }); return runtime.intervals.length as any; };
  g.clearInterval = (id: any) => { const it = runtime.intervals[Number(id) - 1]; if (it) it.cleared = true; else realClearInterval(id); };
}

/** Fire every live (uncleared) MediaPipe logger timer once, as 60 s passing would. */
export async function fireLoggerTimers(): Promise<number> {
  let fired = 0;
  for (const it of runtime.intervals) if (!it.cleared && it.ms === 60000) { it.fn(); fired++; }
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return fired;
}

export function resetRuntime(): void {
  runtime.modes = [];
  runtime.defaultMode = 'ok';
  runtime.wire = [];
  runtime.events = [];
  runtime.createCount = 0;
  for (const it of runtime.intervals) it.cleared = true; // previous tests' timers are history
  runtime.intervals = [];
  (globalThis as any).fetch = fakeTransport;
}

export const liveLoggerTimers = () => runtime.intervals.filter((i) => !i.cleared && i.ms === 60000).length;
export const loggersCreated = () => runtime.intervals.filter((i) => i.ms === 60000).length;
export { realSetInterval };
