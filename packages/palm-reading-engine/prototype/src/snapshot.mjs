// AURA-PALM-G6-D0-R1.1 — validated input snapshot (R1-RV-02; G6-D0 RV-09, RV-10).
// Pure module: no I/O, no network, no clock, no randomness.
//
// The engine never reads the caller's object after this step. snapshotInput() walks ONLY the keys that the
// `aura.palm.features` v0.1.0 contract defines (a fixed, finite shape), reads each property exactly once through its
// own property descriptor, and copies accepted values into fresh, deep-frozen, null-prototype objects and plain arrays.
//
// Accepted: plain JSON-compatible data — objects whose prototype is Object.prototype or null, true arrays
// (Array.prototype, dense, no extra own properties), strings, numbers, booleans, null. `undefined` = absent.
// Rejected (controlled codes, never an uncaught exception):
//   unreadable-input   accessor (getter/setter) properties; any exception while inspecting (Proxy traps, revoked proxies)
//   unsupported-value  BigInt, Symbol, function values
//   unsupported-shape  non-plain objects (class instances, Date, Map, boxed primitives, typed arrays), symbol or
//                      non-enumerable keys, arrays with extra own properties (e.g. an own Symbol.iterator) or holes
//   too-many           an array longer than SNAPSHOT_ARRAY_LIMIT (bounds copying and error output)
//   unknown-field      a key the contract does not define (closed schema; non-fatal: validation still reports the rest)
// Values of the wrong JSON type (e.g. an object where an array is expected) are replaced by an empty frozen
// placeholder of the other kind WITHOUT reading their contents, so validation reports its usual code.
//
// Limitation (documented, not hidden): inspecting a Proxy necessarily runs its traps. A Proxy whose traps throw is
// rejected as unreadable-input. A Proxy whose traps return ordinary data descriptors is read exactly once and its
// answers are frozen into the snapshot, so it cannot change the reading afterwards.

import { MAX_REPORTED_ERRORS } from './schema.mjs';

export const SNAPSHOT_ARRAY_LIMIT = 1024;

const FATAL = new Set(['unreadable-input', 'unsupported-value', 'unsupported-shape', 'too-many']);
const EMPTY_OBJECT = Object.freeze(Object.create(null));
const EMPTY_ARRAY = Object.freeze([]);

// ---- contract shape ----
const P = { kind: 'prim' };
const obj = (fields, presence = []) => ({ kind: 'obj', fields, presence });
const arr = (of) => ({ kind: 'arr', of });
/** Keys that validation rejects with its own specific code; copied as a presence marker (`true`), never read deeply. */
const DECLARED_DESCRIPTOR_KEYS = ['lengthNorm', 'curvature', 'orientationDeg', 'centroid', 'order', 'pointOrder', 'direction', 'closed', 'reversed'];
const LANDMARK_CONFLATION_KEYS = ['items', 'lines', 'creases'];
const SRC = obj({ detector: P, version: P });

export const INPUT_SHAPE = obj({
  schema: P, schemaVersion: P, synthetic: P,
  capture: obj({
    handedness: obj({ value: P, source: P }),
    dominantHand: P,
    orientation: obj({ rotationDeg: P, palmFacing: P }),
    quality: obj({ status: P, issues: arr(P) }),
  }),
  landmarks: obj({ present: P, source: SRC }, LANDMARK_CONFLATION_KEYS),
  creases: obj({
    source: SRC,
    coordinateFrame: P,
    items: arr(obj({
      id: P,
      geometry: obj({ points: arr(obj({ x: P, y: P })) }, DECLARED_DESCRIPTOR_KEYS),
      continuity: obj({ gapsBridged: P, breaks: P }),
      branches: arr(obj({ atT: P, direction: P, lengthNorm: P })),
      detection: obj({ confidence: P, confidenceBasis: P }),
      identity: obj({ anatomicalClass: P, classConfidence: P, classSource: P, alternatives: arr(obj({ anatomicalClass: P, classConfidence: P })) }),
    })),
    expectedButMissing: arr(P),
    conflicts: arr(obj({ ids: arr(P), kind: P })),
  }),
  scanConfidence: obj({ value: P, basis: P }),
});

const isIndexKey = (k, n) => typeof k === 'string' && /^(0|[1-9]\d*)$/.test(k) && Number(k) < n;

/**
 * Snapshot `input` against INPUT_SHAPE. Returns { value, errors, total, fatal } (errors capped; total uncapped).
 * `value` is deep-frozen plain data (or null when fatal). Never throws; never mutates `input`.
 */
export function snapshotInput(input) {
  // R1.2 (R1.1-RV-03): errors are COUNTED without limit but only the first MAX_REPORTED_ERRORS are KEPT, in walk order
  // (deterministic). Fatality is tracked on every error, including uncounted-in-list ones, so a fatal error beyond the
  // cap still makes the snapshot fatal.
  const errors = [];
  let total = 0, fatal = false;
  const err = (path, code, msg) => {
    total++;
    if (FATAL.has(code)) fatal = true;
    if (errors.length < MAX_REPORTED_ERRORS) errors.push({ path, code, msg });
  };
  let value;
  try { value = copy(input, INPUT_SHAPE, '$', err); }
  catch { err('$', 'unreadable-input', 'The feature payload could not be read.'); }
  return { value: fatal ? null : value, errors, total, fatal };
}

function copyPrimitive(v, path, err) {
  const t = typeof v;
  if (v === null || t === 'string' || t === 'number' || t === 'boolean' || t === 'undefined') return v;
  if (t === 'bigint' || t === 'symbol' || t === 'function') { err(path, 'unsupported-value', 'Only JSON-compatible values are accepted.'); return undefined; }
  return null; // unreachable for primitives; objects handled by callers
}

/** Read one own data property; reject accessors. Returns { present, value }. */
function readOwn(o, k, path, err) {
  const d = Reflect.getOwnPropertyDescriptor(o, k);
  if (d === undefined) return { present: false };
  if (!('value' in d)) { err(path, 'unreadable-input', 'Accessor properties are not accepted; supply plain data.'); return { present: false }; }
  if (d.enumerable !== true) { err(path, 'unsupported-shape', 'Non-enumerable properties are not accepted; supply plain data.'); return { present: false }; }
  return { present: true, value: d.value };
}

function copy(v, shape, path, err) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'function') { err(path, 'unsupported-value', 'Only JSON-compatible values are accepted.'); return undefined; }
    return copyPrimitive(v, path, err);
  }
  const isArr = Array.isArray(v); // throws for revoked proxies → caught by snapshotInput
  const proto = Object.getPrototypeOf(v);
  // Non-plain objects (class instances, Set/Map/Date, typed arrays, boxed primitives, Array subclasses) are rejected
  // wherever they appear, before any type check, so they are never mistaken for a merely mistyped value.
  if (isArr ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) { err(path, 'unsupported-shape', isArr ? 'Only plain arrays are accepted.' : 'Only plain objects are accepted.'); return undefined; }
  if (shape.kind === 'prim') return isArr ? EMPTY_ARRAY : EMPTY_OBJECT; // wrong type: placeholder, contents unread
  if (isArr) {
    if (shape.kind !== 'arr') return EMPTY_ARRAY;
    const lenD = Reflect.getOwnPropertyDescriptor(v, 'length'); // a non-enumerable data property on real arrays
    const n = lenD && 'value' in lenD ? lenD.value : NaN;
    if (!Number.isInteger(n) || n < 0) { err(path, 'unsupported-shape', 'Only plain arrays are accepted.'); return undefined; }
    if (n > SNAPSHOT_ARRAY_LIMIT) { err(path, 'too-many', `At most ${SNAPSHOT_ARRAY_LIMIT} entries are accepted.`); return undefined; }
    const keys = Reflect.ownKeys(v);
    if (keys.length !== n + 1 || !keys.every((k) => k === 'length' || isIndexKey(k, n))) { err(path, 'unsupported-shape', 'Arrays must be dense and carry no extra properties.'); return undefined; }
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const r = readOwn(v, String(i), `${path}[${i}]`, err);
      if (!r.present) return undefined;
      out[i] = copy(r.value, shape.of, `${path}[${i}]`, err);
    }
    return Object.freeze(out);
  }
  if (shape.kind !== 'obj') return EMPTY_OBJECT;
  const keys = Reflect.ownKeys(v);
  const out = Object.create(null);
  for (const k of keys) {
    if (typeof k !== 'string') { err(path, 'unsupported-shape', 'Symbol-keyed properties are not accepted.'); return undefined; }
    const known = Object.prototype.hasOwnProperty.call(shape.fields, k);
    const marker = !known && shape.presence.includes(k);
    if (!known && !marker) { err(`${path}.${k.length > 40 ? `${k.slice(0, 40)}…` : k}`, 'unknown-field', 'This field is not part of the feature contract.'); continue; }
    const r = readOwn(v, k, `${path}.${k}`, err);
    if (!r.present) continue;
    if (marker) { out[k] = true; continue; } // presence only: validation emits its specific code
    const c = copy(r.value, shape.fields[k], `${path}.${k}`, err);
    if (c !== undefined) out[k] = c;
  }
  return Object.freeze(out);
}
