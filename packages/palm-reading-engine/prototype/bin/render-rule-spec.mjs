// G6-D0 (R1.2) — writes 03_INTERPRETATION_RULE_SPEC.md (package root) from the pure renderer in bin/rule-spec.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRuleSpec } from './rule-spec.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', '..', '03_INTERPRETATION_RULE_SPEC.md');
fs.writeFileSync(out, renderRuleSpec());
console.log(`wrote ${out}`);
