// AURA-PALM-D6-I1 (owner-approved B2) -- the browser-compatible loader keeps the R4 content-integrity guarantees:
// the embedded text is byte-identical to the two pinned JSON files, the local SHA-256 equals node:crypto, the
// loader yields the same deep-frozen validated library as parsing the files directly, and any drift fails closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../src/sha256.mjs';
import { CATALOGUE_TEXT, SCHEMA_TEXT } from '../library/packaged-content.mjs';
import { packagedContentSource } from '../library/generate-packaged-content.mjs';
import * as packaged from '../src/packaged.mjs';
import { loadLibrary } from '../src/library.mjs';

const E1 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeSha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('BL1 the embedded content is byte-identical to library/catalogue.json and library/schema.json, and the module is exactly the generator output', () => {
  assert.ok(Buffer.from(CATALOGUE_TEXT, 'utf8').equals(fs.readFileSync(path.join(E1, 'library', 'catalogue.json'))));
  assert.ok(Buffer.from(SCHEMA_TEXT, 'utf8').equals(fs.readFileSync(path.join(E1, 'library', 'schema.json'))));
  assert.equal(fs.readFileSync(path.join(E1, 'library', 'packaged-content.mjs'), 'utf8'), packagedContentSource());
});

test('BL2 the local SHA-256 equals node:crypto (pinned files, block boundaries, multi-byte text, random data)', () => {
  const cases = [new Uint8Array(0), new TextEncoder().encode('abc'), new TextEncoder().encode('ā·ç€😀'.repeat(37))];
  for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) cases.push(crypto.randomBytes(n));
  cases.push(new Uint8Array(fs.readFileSync(path.join(E1, 'library', 'catalogue.json'))), new Uint8Array(fs.readFileSync(path.join(E1, 'library', 'schema.json'))));
  for (const c of cases) assert.equal(sha256Hex(new Uint8Array(c)), nodeSha(c), `length ${c.length}`);
  assert.equal(sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.throws(() => sha256Hex('abc'), TypeError);
});

test('BL3 the loader digests match C1 rev. 4, and its library equals one loaded straight from the files (deep-frozen)', () => {
  assert.equal(sha256Hex(new TextEncoder().encode(CATALOGUE_TEXT)), packaged.C1_REV4_DIGESTS.catalogue);
  assert.equal(sha256Hex(new TextEncoder().encode(SCHEMA_TEXT)), packaged.C1_REV4_DIGESTS.schema);
  const lib = packaged.pinnedLibrary();
  const direct = loadLibrary(JSON.parse(fs.readFileSync(path.join(E1, 'library', 'catalogue.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(E1, 'library', 'schema.json'), 'utf8')));
  assert.equal(JSON.stringify(lib.catalogue), JSON.stringify(direct.catalogue));
  assert.equal(JSON.stringify(lib.schema ?? null), JSON.stringify(direct.schema ?? null));
  assert.ok(Object.isFrozen(lib) && Object.isFrozen(lib.catalogue) && Object.isFrozen(lib.catalogue.interpretations[0]));
});
