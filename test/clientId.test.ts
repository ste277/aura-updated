import { readFileSync } from 'fs';
import { join } from 'path';
import { generateClientRequestId } from '../apps/web/lib/clientId';

let allPassed = true;
function check(label: string, cond: boolean) {
  if (!cond) allPassed = false;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`);
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// --- Fast path: crypto.randomUUID() available (the normal, secure-context case) ---
{
  const id = generateClientRequestId();
  check('fast path: returns a valid RFC 4122 v4 UUID', UUID_V4_RE.test(id));
}

{
  const seen = new Set<string>();
  for (let i = 0; i < 10_000; i++) seen.add(generateClientRequestId());
  check('fast path: 10,000 calls produce 10,000 unique ids', seen.size === 10_000);
}

// --- Fallback path: simulate crypto.randomUUID being unavailable, exactly the
// AURA-MOBILE-01-M2-A/AND-01 Android insecure-origin condition. ---
{
  const originalRandomUUID = crypto.randomUUID;
  delete (crypto as any).randomUUID;
  try {
    const id = generateClientRequestId();
    check('fallback path: returns a valid RFC 4122 v4 UUID', UUID_V4_RE.test(id));

    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(generateClientRequestId());
    check('fallback path: 10,000 calls produce 10,000 unique ids', seen.size === 10_000);
  } finally {
    crypto.randomUUID = originalRandomUUID;
  }
}

// --- Fallback path: crypto.randomUUID present but throwing (some environments
// expose the function yet still throw outside a secure context). ---
{
  const originalRandomUUID = crypto.randomUUID;
  crypto.randomUUID = (() => {
    throw new Error('simulated insecure-context throw');
  }) as typeof crypto.randomUUID;
  try {
    const id = generateClientRequestId();
    check('throwing-function path: still returns a valid RFC 4122 v4 UUID', UUID_V4_RE.test(id));
  } finally {
    crypto.randomUUID = originalRandomUUID;
  }
}

// --- Confirm no Math.random() involvement. Node's global `crypto.getRandomValues`
// cannot be monkey-patched to count calls (it's a non-writable platform property --
// confirmed: reassigning it is a silent no-op), so this is checked at the source
// level instead: the fallback implementation must call crypto.getRandomValues and
// must never reference Math.random. ---
{
  const source = readFileSync(join(__dirname, '../apps/web/lib/clientId.ts'), 'utf-8');
  check('source calls crypto.getRandomValues', source.includes('crypto.getRandomValues('));
  check('source never references Math.random', !source.includes('Math.random'));
}

console.log(allPassed ? '\nAll clientId tests passed.' : '\nSome clientId tests FAILED.');
process.exit(allPassed ? 0 : 1);
