// AURA-PALM-03-E1 -- personalised interpretation engine identity.
// DEVELOPMENT ONLY. SYNTHETIC ONLY. A separate identity from the frozen G6 engine (prototype/), which is not
// imported, wrapped or modified by E1. No real-image, camera, network or storage path exists in this package.

export const E1_ENGINE = Object.freeze({
  id: 'aura.palm.e1-reading',
  version: '0.1.0',
  libraryVersion: 'palm-03-c1-library@0.4.0-draft',
  featureSetVersion: 'palm-03-i1-feature-set@0.1.0',
  descriptorVersion: 'e1-zone-descriptor@0.1.0',
  syntheticOnly: true,
  contentStatus: 'UNREVIEWED_RESEARCH_CONTENT',
});


export const MODES = Object.freeze(['combined', 'indian-only', 'western-only']);
export const DEFAULT_MODE = 'combined';

/** Capabilities implemented by this milestone (C1 e1Planning essential tier). Nothing else is ever available. */
export const IMPLEMENTED_CAPABILITIES = Object.freeze(['E1-E1', 'E1-E2', 'E1-E3', 'E1-E4', 'E1-E5']);

/** The four product domains, in output order; their catalogue categories come from library.readingModes.domains. */
export const DOMAINS = Object.freeze(['personality', 'relationships', 'career', 'life-direction']);

/** Typed error for every rejection (invalid input, invalid catalogue, invalid option). */
export class E1Error extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = 'E1Error';
    this.code = code;
  }
}

/** C1 rev. 4 record inventory (29). The loader refuses a catalogue that adds, drops or reclassifies a record. */
export const RECORD_MANIFEST = Object.freeze({
  'eligible-initial': Object.freeze(["C1-IN-PITR-KNOWLEDGE", "C1-IN-URDHVA-MIDDLE", "C1-IN-URDHVA-INDEX", "C1-IN-URDHVA-RING", "C1-IN-URDHVA-LITTLE", "C1-WE-HEAD-STRAIGHT", "C1-WE-HEAD-SLOPING", "C1-WE-FINGER-LONG", "C1-WE-FINGER-SHORT", "C1-WE-RING-LONG", "C1-WE-HEART-JUPITER", "C1-WE-HEART-BETWEEN"]),
  'eligible-later': Object.freeze(["C1-IN-PALM-RAISED-GENEROUS", "C1-IN-MATSYA-PAIR-HOSPITALITY", "C1-IN-MARK-FISHTAIL-LEARNING", "C1-IN-MARK-CHARITY", "C1-WE-ORIGIN-SEPARATE", "C1-WE-THUMB-WILL", "C1-WE-THUMB-LOGIC"]),
  'held': Object.freeze(["C1-IN-URDHVA-UNBROKEN", "C1-IN-FINGER-FINE", "C1-IN-JOINTS-POPULAR"]),
  'excluded-initial': Object.freeze(["C1-WE-ORIGIN-JOINED", "C1-WE-INDEX-LONG"]),
  'historical-context-only': Object.freeze(["C1-IN-MARK-HISTORICAL-YAVA", "C1-IN-MARK-HISTORICAL-MATSYA", "C1-IN-MARK-HISTORICAL-SHANKHA", "C1-IN-MARK-HISTORICAL-CHATRA", "C1-IN-MARK-HISTORICAL-VEDI"]),
});

/**
 * R5: is `d` (a property descriptor) a data descriptor? Decided from the descriptor's OWN fields only. A descriptor
 * object returned by Object.getOwnPropertyDescriptor inherits from Object.prototype, so `'value' in d` or `d.value`
 * can be satisfied by an inherited Object.prototype.value on an accessor-only property (R4 witness).
 */
export const isOwnDataDescriptor = (d) => d !== undefined && Object.prototype.hasOwnProperty.call(d, 'value') && !Object.prototype.hasOwnProperty.call(d, 'get') && !Object.prototype.hasOwnProperty.call(d, 'set');

/**
 * R6: THE authoritative snapshot primitive for everything entering or passing through the reading pipeline
 * (caller options, caller input, the builder's feature set, intermediate construction and descriptor results, plans).
 * Every object is read exactly ONCE: its prototype once, its own keys once (Reflect.ownKeys), and each key's own
 * descriptor once; only own DATA properties are accepted (accessors, symbol keys, non-plain objects, functions and
 * non-JSON values fail closed). The result is a new deep, frozen, null-prototype structure: later reads cannot see
 * inherited values, and nothing the caller (or a proxy) does afterwards can change it. Validation and composition
 * then use this one captured structure. `holes: 'preserve'` keeps sparse-array holes (the I1 contract refuses them
 * itself); `'refuse'` fails on them.
 */
export function captureOwnData(value, { code = 'invalid-input', holes = 'refuse', maxDepth = 12, maxArray = 100000, at = '$' } = {}) {
  const fail = (where, why) => { throw new E1Error(code, `${where}: ${why} (no trustworthy snapshot)`); };
  const copy = (v, where, depth) => {
    if (v === null || v === undefined || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') return v; // primitives are values, not references
    if (typeof v !== 'object') fail(where, `unsupported value type ${typeof v}`);
    if (depth > maxDepth) fail(where, 'nested too deeply');
    let proto, keys;
    try { proto = Object.getPrototypeOf(v); keys = Reflect.ownKeys(v); } catch (e) { fail(where, `unreadable (${String(e?.message ?? e)})`); }
    const isArr = Array.isArray(v);
    if (isArr ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail(where, isArr ? 'not a plain array' : 'not a plain object');
    const descs = new Map();
    for (const k of keys) {
      if (typeof k !== 'string') fail(where, 'symbol keys are not accepted');
      let d;
      try { d = Object.getOwnPropertyDescriptor(v, k); } catch (e) { fail(`${where}.${k}`, `unreadable (${String(e?.message ?? e)})`); }
      if (d === undefined) fail(`${where}.${k}`, 'listed key without a property');
      descs.set(k, d);
    }
    if (isArr) {
      const lenD = descs.get('length');
      const len = lenD && isOwnDataDescriptor(lenD) ? lenD.value : -1;
      if (!Number.isSafeInteger(len) || len < 0 || len > maxArray) fail(where, 'invalid array length');
      const out = new Array(len);
      for (const [k, d] of descs) {
        if (k === 'length') continue;
        const i = Number(k);
        if (!(Number.isInteger(i) && i >= 0 && i < len && String(i) === k)) fail(where, `unexpected array property ${k}`);
        if (!isOwnDataDescriptor(d)) fail(`${where}[${k}]`, 'accessor properties are not accepted');
        out[i] = copy(d.value, `${where}[${k}]`, depth + 1);
      }
      if (holes === 'refuse') for (let i = 0; i < len; i++) if (!descs.has(String(i))) fail(where, `hole at [${i}]`);
      return Object.freeze(out);
    }
    const out = Object.create(null);
    for (const [k, d] of descs) {
      if (!isOwnDataDescriptor(d)) fail(`${where}.${k}`, 'accessor properties are not accepted');
      if (k === '__proto__') fail(where, 'the key __proto__ is not accepted');
      out[k] = copy(d.value, `${where}.${k}`, depth + 1);
    }
    return Object.freeze(out);
  };
  return copy(value, at, 0);
}

/**
 * R4/R5/R6 (finding F7): the explicit synthetic declaration -- the ONE validation used by every reading and planning
 * entry point (reading.ts generateSyntheticReading, compose.mjs planSelection), before any work begins.
 * R6: the options are CAPTURED ONCE (captureOwnData: one read of keys and of each descriptor) and the captured
 * snapshot is what is validated and what is returned; a proxy or getter cannot validate one value and supply another.
 * The captured `synthetic` must be an own data property exactly equal to the primitive boolean true. Omitted,
 * inherited, accessor (including accessor + inherited descriptor `value`), false, boxed, non-boolean and malformed
 * declarations are refused; every other own key must be listed in `allowed`.
 */
export function requireSyntheticOptions(options, allowed) {
  const refuse = (why) => { throw new E1Error('synthetic-required', `pass an own { synthetic: true } declaration (${why}); real input is not authorised`); };
  if (options === null || typeof options !== 'object' || Array.isArray(options)) refuse('options must be a plain object');
  let snap;
  try { snap = captureOwnData(options, { code: 'synthetic-required', maxDepth: 1, at: 'options' }); } catch (e) { refuse(`options could not be captured: ${String(e?.message ?? e)}`); }
  if (Array.isArray(snap)) refuse('options must be a plain object');
  if (!Object.prototype.hasOwnProperty.call(snap, 'synthetic')) refuse('no own synthetic property');
  if (snap.synthetic !== true) refuse('synthetic must be exactly true');
  for (const k of Object.keys(snap)) if (!allowed.includes(k)) throw new E1Error('invalid-option', `unsupported option: ${k}`);
  return snap;
}
