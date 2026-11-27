/**
 * AURA-PALM-04-I1 -- the headless ASSISTED-TRACING MODEL (no UI).
 * DEVELOPMENT ONLY (behind the G5 image-input gate; excluded from production builds with the rest of
 * lib/palm-analysis). Synthetic tests only.
 *
 * The approved V1 workflow (AURA_PALM_04_ASSISTED_SCANNER_PLAN.md, D1-D6): after the photo is analysed, the user
 * traces each line on their own photo (heart, head, life, then the optional upward line), can move, delete and
 * undo points, can skip a line ("skip" or "I can't see it"), and confirms each trace. Marks are deferred (D3): the
 * model emits no mark input, so I1 records every mark as not-requested.
 *
 * Validity is I1's OWN verdict: every assessment runs the frozen I1 builder (features.ts buildPalmFeatureSet) on
 * the current trace and reports the line state it produces -- placed, or the specific I1 reason (too few points,
 * outside the palm frame, doubles back, ...). Nothing here ports or re-implements I1 placement, so the model can
 * never disagree with the feature set it hands on.
 *
 * Lifecycle and privacy: the model is bound to ONE construction context (construction.ts). It reads the context
 * on demand and never caches the landmarks. Once the session revokes the context (reset, photo replacement,
 * cancellation, teardown) every operation throws TracingError('context-cleared') and the model discards its traces,
 * so nothing from an old photo can be reused for a new one. No persistence, logging or transmission.
 */
import type { PalmConstructionContext, PalmConstructionData } from './construction';
import { ALL_LINES, buildPalmFeatureSet, type LineInput, type LineUnassessedReason, type NormPoint, type PalmFeatureSetInput, type PalmFeatureSetResult, type PalmLineId } from './features';
import { LM } from './quality';

export const PALM_TRACING_MODEL_VERSION = 'palm-04-tracing-model@0.1.0';

/** The approved tracing order: the three primary lines, then the optional upward line. */
export const TRACING_LINES: readonly PalmLineId[] = ALL_LINES;
/** Hard input cap (memory bound). I1 itself refuses more than TRACE_LIMITS.maxPoints with its own reason. */
export const MAX_TRACE_INPUT_POINTS = 1000;
const MAX_UNDO = 200;

export type TracingLineStatus = 'not-started' | 'tracing' | 'confirmed' | 'skipped';
export type TracingSkipReason = 'user-skipped' | 'user-cannot-see';

export type TracingErrorCode = 'context-cleared' | 'unknown-line' | 'invalid-point' | 'invalid-index' | 'invalid-state' | 'too-many-points' | 'invalid-option';

export class TracingError extends Error {
  readonly code: TracingErrorCode;
  constructor(code: TracingErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'TracingError';
    this.code = code;
  }
}

/** I1's verdict on the current trace of one line. */
export type TracePlacement = { readonly ok: true } | { readonly ok: false; readonly reason: LineUnassessedReason };

export interface TracingLineView {
  readonly line: PalmLineId;
  readonly status: TracingLineStatus;
  /** The trace, in normalised image coordinates (a copy). */
  readonly points: readonly unknown[];
  readonly skipReason: TracingSkipReason | null;
  /** I1's verdict for the current points (null when not started or skipped). */
  readonly placement: TracePlacement | null;
}

/**
 * Where to show the line hints: the finger-base knuckles (landmarks 5, 9, 13, 17) and the wrist (0), in normalised
 * image coordinates (what a tracing overlay draws), straight from the construction context. (The E1-side palm-frame
 * finger-base reference helper stays unused by app modules, as the closed E1 acceptance D2 requires.)
 */
export interface TracingGuides {
  readonly image: Readonly<{ index: NormPoint; middle: NormPoint; ring: NormPoint; little: NormPoint; wrist: NormPoint }>;
}

export interface TracingModel {
  /** False once the construction context was revoked; every operation then throws 'context-cleared'. */
  isActive(): boolean;
  line(id: PalmLineId): TracingLineView;
  lines(): readonly TracingLineView[];
  /** not-started | confirmed | skipped -> tracing (an existing trace is kept for editing). */
  start(id: PalmLineId): TracingLineView;
  addPoint(id: PalmLineId, p: NormPoint): TracingLineView;
  movePoint(id: PalmLineId, index: number, p: NormPoint): TracingLineView;
  deletePoint(id: PalmLineId, index: number): TracingLineView;
  /** Replace the whole trace (e.g. a stroke); values are passed to I1 as given, holes included. */
  setTrace(id: PalmLineId, points: readonly unknown[]): TracingLineView;
  /** tracing -> confirmed, only if I1 places the trace; otherwise returns I1's reason and changes nothing. */
  confirm(id: PalmLineId): { readonly ok: true; readonly line: TracingLineView } | { readonly ok: false; readonly reason: LineUnassessedReason; readonly line: TracingLineView };
  /** any -> skipped (the trace is cleared). */
  skip(id: PalmLineId, reason: TracingSkipReason): TracingLineView;
  /** any -> not-started (the trace is cleared). */
  reset(id: PalmLineId): TracingLineView;
  /** Undo the last change to any line. Returns false when there is nothing to undo. */
  undo(): boolean;
  guides(): TracingGuides;
  /** The I1 input for the current state: confirmed traces, unconfirmed traces (I1: not-confirmed), skips; no marks. */
  toFeatureSetInput(opts: { hand: 'left' | 'right'; dominantHand: 'left' | 'right' | 'unknown' }): PalmFeatureSetInput;
  /** buildPalmFeatureSet(toFeatureSetInput(opts)) -- the I1 feature set (measurements, lines, marks, quality). */
  buildFeatureSet(opts: { hand: 'left' | 'right'; dominantHand: 'left' | 'right' | 'unknown' }): PalmFeatureSetResult;
}

interface LineState { status: TracingLineStatus; points: unknown[]; skipReason: TracingSkipReason | null }

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const own = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);

/** Copy a trace value as plain data, preserving holes and non-point values for I1 to judge. */
function copyPoints(points: readonly unknown[]): unknown[] {
  const out: unknown[] = new Array(points.length);
  for (let k = 0; k < points.length; k++) {
    if (!own(points, k)) continue; // a hole stays a hole (I1: trace-point-invalid)
    const p = points[k];
    out[k] = p !== null && typeof p === 'object' ? { x: (p as { x?: unknown }).x, y: (p as { y?: unknown }).y } : p;
  }
  return out;
}
const cleanPoint = (p: NormPoint): NormPoint => {
  if (p === null || typeof p !== 'object' || !isFiniteNum(p.x) || !isFiniteNum(p.y)) throw new TracingError('invalid-point', 'a point needs finite x and y');
  return { x: p.x, y: p.y };
};

/** Create the tracing model for one construction context. Throws 'context-cleared' if it is not active. */
export function createTracingModel(context: PalmConstructionContext): TracingModel {
  if (!context || !context.isActive()) throw new TracingError('context-cleared');
  const state = new Map<PalmLineId, LineState>(TRACING_LINES.map((id) => [id, { status: 'not-started', points: [], skipReason: null }]));
  const undoStack: Array<{ id: PalmLineId; prev: LineState }> = [];
  let dead = false;

  /** The context data for this operation, or throw (and discard every trace) once it is revoked. */
  const live = (): PalmConstructionData => {
    const data = dead ? null : context.read();
    if (!data) {
      dead = true;
      for (const s of state.values()) { s.points = []; s.skipReason = null; s.status = 'not-started'; }
      undoStack.length = 0;
      throw new TracingError('context-cleared', 'the photo this tracing belonged to was reset, replaced or closed');
    }
    return data;
  };
  const lineOf = (id: PalmLineId): LineState => {
    const s = state.get(id);
    if (!s) throw new TracingError('unknown-line', `unknown line ${String(id)}`);
    return s;
  };
  const snapshot = (s: LineState): LineState => ({ status: s.status, points: copyPoints(s.points), skipReason: s.skipReason });
  const remember = (id: PalmLineId) => {
    undoStack.push({ id, prev: snapshot(lineOf(id)) });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  };

  const baseInput = (data: PalmConstructionData, lines: readonly LineInput[], hand: 'left' | 'right' = 'left', dominantHand: 'left' | 'right' | 'unknown' = 'unknown'): PalmFeatureSetInput => ({
    hand,
    dominantHand,
    landmarks: data.landmarks,
    imageWidth: data.imageWidth,
    imageHeight: data.imageHeight,
    qualityIssues: data.qualityIssues,
    rotationDeg: data.rotationDeg,
    ...(data.handednessLabel === undefined ? {} : { handednessLabel: data.handednessLabel }),
    lines,
    marks: [], // D3: marks are deferred from the V1 experience
  });

  /** I1's verdict: build the feature set with ONLY this trace, confirmed, and read I1's line state. */
  const placementOf = (data: PalmConstructionData, id: PalmLineId, points: unknown[]): TracePlacement => {
    const built = buildPalmFeatureSet(baseInput(data, [{ line: id, action: 'traced', points: points as NormPoint[], confirmed: true }]));
    if (!built.ok) return Object.freeze({ ok: false as const, reason: 'trace-point-invalid' as LineUnassessedReason }); // structural refusal (not reachable with copied plain points)
    const l = built.featureSet.lines[id];
    return l.provenance === 'user-confirmed' ? Object.freeze({ ok: true as const }) : Object.freeze({ ok: false as const, reason: l.reason });
  };

  const view = (data: PalmConstructionData, id: PalmLineId): TracingLineView => {
    const s = lineOf(id);
    const placement = s.status === 'tracing' || s.status === 'confirmed' ? placementOf(data, id, s.points) : null;
    return Object.freeze({ line: id, status: s.status, points: Object.freeze(copyPoints(s.points)), skipReason: s.skipReason, placement });
  };

  const editable = (s: LineState, id: PalmLineId) => {
    if (s.status !== 'tracing') throw new TracingError('invalid-state', `line ${id} is ${s.status}; start() it to edit`);
  };

  const model: TracingModel = {
    isActive: () => !dead && context.isActive(),
    line(id) { const data = live(); return view(data, id); },
    lines() { const data = live(); return Object.freeze(TRACING_LINES.map((id) => view(data, id))); },
    start(id) {
      const data = live();
      const s = lineOf(id);
      if (s.status !== 'tracing') { remember(id); s.status = 'tracing'; s.skipReason = null; }
      return view(data, id);
    },
    addPoint(id, p) {
      const data = live();
      const s = lineOf(id);
      editable(s, id);
      const q = cleanPoint(p);
      if (s.points.length >= MAX_TRACE_INPUT_POINTS) throw new TracingError('too-many-points');
      remember(id);
      s.points.push(q);
      return view(data, id);
    },
    movePoint(id, index, p) {
      const data = live();
      const s = lineOf(id);
      editable(s, id);
      if (!Number.isInteger(index) || index < 0 || index >= s.points.length) throw new TracingError('invalid-index');
      const q = cleanPoint(p);
      remember(id);
      s.points[index] = q;
      return view(data, id);
    },
    deletePoint(id, index) {
      const data = live();
      const s = lineOf(id);
      editable(s, id);
      if (!Number.isInteger(index) || index < 0 || index >= s.points.length) throw new TracingError('invalid-index');
      remember(id);
      s.points.splice(index, 1);
      return view(data, id);
    },
    setTrace(id, points) {
      const data = live();
      const s = lineOf(id);
      editable(s, id);
      if (!Array.isArray(points)) throw new TracingError('invalid-point', 'a trace is an array of points');
      if (points.length > MAX_TRACE_INPUT_POINTS) throw new TracingError('too-many-points');
      remember(id);
      s.points = copyPoints(points);
      return view(data, id);
    },
    confirm(id) {
      const data = live();
      const s = lineOf(id);
      editable(s, id);
      const placement = placementOf(data, id, s.points);
      if (!placement.ok) return Object.freeze({ ok: false as const, reason: placement.reason, line: view(data, id) });
      remember(id);
      s.status = 'confirmed';
      return Object.freeze({ ok: true as const, line: view(data, id) });
    },
    skip(id, reason) {
      const data = live();
      const s = lineOf(id);
      if (reason !== 'user-skipped' && reason !== 'user-cannot-see') throw new TracingError('invalid-option', 'skip reason must be user-skipped or user-cannot-see');
      remember(id);
      s.status = 'skipped';
      s.skipReason = reason;
      s.points = [];
      return view(data, id);
    },
    reset(id) {
      const data = live();
      const s = lineOf(id);
      remember(id);
      s.status = 'not-started';
      s.skipReason = null;
      s.points = [];
      return view(data, id);
    },
    undo() {
      live();
      const last = undoStack.pop();
      if (!last) return false;
      const s = lineOf(last.id);
      s.status = last.prev.status;
      s.points = copyPoints(last.prev.points);
      s.skipReason = last.prev.skipReason;
      return true;
    },
    guides() {
      const data = live();
      const at = (k: number): NormPoint => Object.freeze({ x: data.landmarks[k].x, y: data.landmarks[k].y });
      return Object.freeze({
        image: Object.freeze({ index: at(LM.INDEX_MCP), middle: at(LM.MIDDLE_MCP), ring: at(LM.RING_MCP), little: at(LM.PINKY_MCP), wrist: at(LM.WRIST) }),
      });
    },
    toFeatureSetInput(opts) {
      const data = live();
      if (!opts || (opts.hand !== 'left' && opts.hand !== 'right') || !['left', 'right', 'unknown'].includes(opts.dominantHand)) throw new TracingError('invalid-option', 'hand must be left|right and dominantHand left|right|unknown');
      const lines: LineInput[] = [];
      for (const id of TRACING_LINES) {
        const s = lineOf(id);
        if (s.status === 'confirmed') lines.push({ line: id, action: 'traced', points: copyPoints(s.points) as NormPoint[], confirmed: true });
        else if (s.status === 'tracing') lines.push({ line: id, action: 'traced', points: copyPoints(s.points) as NormPoint[], confirmed: false });
        else if (s.status === 'skipped' && s.skipReason) lines.push({ line: id, action: 'skipped', reason: s.skipReason });
        // not-started: omitted (I1: not-requested)
      }
      return baseInput(data, lines, opts.hand, opts.dominantHand);
    },
    buildFeatureSet(opts) {
      return buildPalmFeatureSet(model.toFeatureSetInput(opts));
    },
  };
  return Object.freeze(model);
}
