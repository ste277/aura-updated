// AURA-PALM-03-E1 -- minimal JSON Schema (draft 2020-12) validator for the C1 library schema.
// The project has no JSON Schema dependency and the engine package has no dependencies at all (G6 validates with
// hand-written code in prototype/src/schema.mjs), so E1 implements exactly the keywords the C1 schema uses and
// REJECTS any schema that uses another keyword: a keyword it does not understand can never silently pass.

const SUPPORTED = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description',
  'type', 'properties', 'required', 'additionalProperties', 'enum', 'const', 'items', 'minItems', 'maxItems', 'pattern', 'format',
]);
// R2 (finding F3): a real calendar date (Date.parse rolls 2026-02-30 over to March). Pure arithmetic, no clock.
function isCalendarDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1];
}
const FORMATS = { date: isCalendarDate };

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  if (t === 'object') return isPlain(v);
  return actual === t;
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => own(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/** Throws if the schema uses any keyword outside SUPPORTED (walks every subschema). */
export function assertSupportedSchema(schema) {
  const bad = [];
  const walk = (n, at) => {
    if (!isPlain(n)) return;
    for (const [k, v] of Object.entries(n)) {
      if (!SUPPORTED.has(k)) bad.push(`${at}/${k}`);
      if (k === 'properties' || k === '$defs') for (const [pk, pv] of Object.entries(v)) walk(pv, `${at}/${k}/${pk}`);
      else if (k === 'items' || k === 'additionalProperties') walk(v, `${at}/${k}`);
      if (k === 'format' && !own(FORMATS, v)) bad.push(`${at}/format:${v}`);
    }
  };
  walk(schema, '#');
  return bad;
}

/** Validate `value` against `schema` (root schema used to resolve local $refs). Returns a list of error strings. */
export function validateAgainstSchema(value, schema) {
  const errors = [];
  const resolve = (ref) => {
    if (!ref.startsWith('#/')) { errors.push(`unsupported $ref ${ref}`); return {}; }
    let n = schema;
    for (const part of ref.slice(2).split('/')) { if (!isPlain(n) || !own(n, part)) { errors.push(`unresolvable $ref ${ref}`); return {}; } n = n[part]; }
    return n;
  };
  const v = (val, sch, at) => {
    if (own(sch, '$ref')) v(val, resolve(sch.$ref), at);
    if (own(sch, 'type')) {
      const ts = Array.isArray(sch.type) ? sch.type : [sch.type];
      if (!ts.some((t) => typeMatches(val, t))) { errors.push(`${at}: type ${typeOf(val)} not in ${ts.join('|')}`); return; }
    }
    if (own(sch, 'const') && !deepEqual(val, sch.const)) errors.push(`${at}: must equal const ${JSON.stringify(sch.const)}`);
    if (own(sch, 'enum') && !sch.enum.some((e) => deepEqual(val, e))) errors.push(`${at}: ${JSON.stringify(val)} not in enum`);
    if (typeof val === 'string') {
      if (own(sch, 'pattern') && !new RegExp(sch.pattern, 'u').test(val)) errors.push(`${at}: does not match ${sch.pattern}`);
      if (own(sch, 'format') && !FORMATS[sch.format](val)) errors.push(`${at}: not a valid ${sch.format}`);
    }
    if (Array.isArray(val)) {
      if (own(sch, 'minItems') && val.length < sch.minItems) errors.push(`${at}: fewer than ${sch.minItems} items`);
      if (own(sch, 'maxItems') && val.length > sch.maxItems) errors.push(`${at}: more than ${sch.maxItems} items`);
      if (own(sch, 'items')) for (let i = 0; i < val.length; i++) { if (!own(val, i)) errors.push(`${at}/${i}: sparse`); else v(val[i], sch.items, `${at}/${i}`); }
    }
    if (isPlain(val)) {
      for (const r of sch.required ?? []) if (!own(val, r)) errors.push(`${at}: missing required ${r}`);
      const props = sch.properties ?? {};
      for (const [k, x] of Object.entries(val)) {
        if (own(props, k)) v(x, props[k], `${at}/${k}`);
        else if (sch.additionalProperties === false) errors.push(`${at}: unknown property ${k}`);
        else if (isPlain(sch.additionalProperties)) v(x, sch.additionalProperties, `${at}/${k}`);
      }
    }
  };
  v(value, schema, '#');
  return errors;
}
