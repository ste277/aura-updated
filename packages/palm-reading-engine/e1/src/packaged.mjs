// AURA-PALM-03-E1 -- the packaged C1 rev. 4 catalogue and schema (findings F2, R3 and R4).
//
// R4: the authoritative content is immutable from initialization. It is NOT imported as a JSON module (a JSON
// module object is shared through the module map, so any code importing the same path first could mutate it before
// E1 validates it). Instead, when this module is evaluated, it:
//   1. reads library/catalogue.json and library/schema.json as bytes;
//   2. checks the bytes against the C1 rev. 4 deliverables' SHA-256 digests (byte identity with the preserved
//      originals, not a seal or signature: nothing is signed and no key exists);
//   3. parses those bytes into fresh objects that no other code has seen, and deep-freezes them;
//   4. validates them once (loadLibrary), which yields the deep-frozen library that composition reads.
// Validation and reading generation therefore use the same immutable content. No mutable reference to the
// catalogue, the schema or any nested object is exported; the text-emitting path has no library override.
// A failure at any step makes this module fail to load, so no reading can be produced (fail closed).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadLibrary } from './library.mjs';
import { E1Error } from './identity.mjs';

/** SHA-256 of the C1 rev. 4 deliverables (AURA_PALM_03_C1_INTERPRETATION_CATALOGUE.draft.json and _LIBRARY_SCHEMA.json). */
export const C1_REV4_DIGESTS = Object.freeze({
  catalogue: '8dff3252d9c9d9ad7e51d447591e671fa2e4aa528dddf396d0530e2e36f1b6be',
  schema: '5d1a38b855388a40606d6fc3153dd7235d330f9e78cae5393ddab35c3d4853c3',
});

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };

function readPinned(name, digest) {
  const bytes = readFileSync(new URL(`../library/${name}.json`, import.meta.url));
  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== digest) throw new E1Error('invalid-catalogue', `library/${name}.json is not the C1 rev. 4 deliverable (sha256 ${got})`);
  return deepFreeze(JSON.parse(bytes.toString('utf8')));
}

const PINNED = loadLibrary(readPinned('catalogue', C1_REV4_DIGESTS.catalogue), readPinned('schema', C1_REV4_DIGESTS.schema));

/** The packaged library: validated once at initialization, deep-frozen, identical for every caller. */
export function pinnedLibrary() {
  return PINNED;
}
