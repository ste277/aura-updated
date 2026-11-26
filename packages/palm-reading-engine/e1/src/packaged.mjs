// AURA-PALM-03-E1-R3 -- the packaged C1 rev. 4 catalogue and schema, validated once (finding F2). The text-emitting
// reading path uses ONLY this library; there is no caller-supplied catalogue or schema override.
import catalogue from '../library/catalogue.json' with { type: 'json' };
import schema from '../library/schema.json' with { type: 'json' };
import { loadLibrary } from './library.mjs';

let pinned = null;
export function pinnedLibrary() {
  if (!pinned) pinned = loadLibrary(catalogue, schema);
  return pinned;
}
export { catalogue as PACKAGED_CATALOGUE, schema as PACKAGED_SCHEMA };
