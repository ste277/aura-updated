// G6-D0-R1.2 — writes fixtures/rv02-boundary-characterization.json: the behaviour of every variant cut-off immediately
// below, at and above each boundary and margin edge, as implemented (R1.1-RV-02, DEFERRED: thresholds unchanged).
// Dev script only (writes one fixture file); the engine performs no I/O.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { characterizeBoundaries } from '../test/rv02-characterization.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'fixtures', 'rv02-boundary-characterization.json');
fs.writeFileSync(out, JSON.stringify(characterizeBoundaries(), null, 2) + '\n');
console.log(`wrote ${out}`);
