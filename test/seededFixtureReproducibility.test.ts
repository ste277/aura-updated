/**
 * O5 P4b5 -- ENGINE-INDEPENDENT FIXTURE GENERATION (test-only, pure; the narrow cross-Node reproducibility test).
 *
 * ROOT CAUSE of the P4b3 / P4b4 incidence differing between Node 26 (437 / 426 / 9 / 367 / 50) and Node 20 CI (409 / 405 / 18 / 340 / 47) for the SAME seed:
 * the sweeps ordered candidate pools with `sort((a, b) => rank(a) - rank(b) || rnd() - 0.5)`. A comparator that draws randomness is not a function of its
 * arguments, so the order depends on how many times and between which pairs the engine's sort algorithm calls it -- engine behavior, not the seed.
 *
 * This test PROVES the root cause and the fix without needing two Node binaries: it runs the old pattern under two different (equally valid) sort
 * ALGORITHMS written here -- they disagree for the same seed -- and shows the replacement (a seeded Fisher-Yates shuffle, then a STABLE sort by a pure
 * rank comparator) produces identical results under both algorithms, under the engine's native sort, and equals a pinned stream. It also forbids the
 * pattern anywhere in the test tree. CI runs on Node 20 and the incidence suites pin exact authoritative counts, so any engine difference fails CI.
 *
 * SUPPORTED NODE: CI declares Node 20 (.github/workflows/ci.yml); `.nvmrc` records the same. Tests are expected to be identical on every supported engine.
 */
import fs from 'fs';
import path from 'path';
import { rankedShuffle, seededRandom, seededShuffle } from './fixtureSupport';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

type Cmp<T> = (a: T, b: T) => number;
/** Stable top-down merge sort: a DIFFERENT valid sort algorithm from the engine's (its comparison sequence differs). */
function mergeSort<T>(items: readonly T[], cmp: Cmp<T>): T[] {
  if (items.length <= 1) return [...items];
  const mid = items.length >> 1;
  const left = mergeSort(items.slice(0, mid), cmp);
  const right = mergeSort(items.slice(mid), cmp);
  const out: T[] = [];
  let i = 0; let j = 0;
  while (i < left.length && j < right.length) out.push(cmp(right[j], left[i]) < 0 ? right[j++] : left[i++]);
  while (i < left.length) out.push(left[i++]);
  while (j < right.length) out.push(right[j++]);
  return out;
}
/** Stable insertion sort: another valid algorithm. */
function insertionSort<T>(items: readonly T[], cmp: Cmp<T>): T[] {
  const out: T[] = [];
  for (const item of items) { let k = out.length; while (k > 0 && cmp(out[k - 1], item) > 0) k -= 1; out.splice(k, 0, item); }
  return out;
}

const RANKS = ['EXCELLENT', 'GOOD', 'USABLE', 'CAUTION'];
const makePool = (rnd: () => number) => Array.from({ length: 8 }, (_, i) => ({ id: i, label: RANKS[Math.floor(rnd() * 4)] }));
const rank = (p: { label: string }) => RANKS.indexOf(p.label);

// ROOT CAUSE: the old pattern is a function of the sort ALGORITHM, not only of the seed.
let oldPatternDisagrees = 0;
for (let seed = 1; seed <= 200; seed += 1) {
  const pool = makePool(seededRandom(seed * 7919));
  const viaMerge = ((): string => { const r = seededRandom(seed); return mergeSort(pool, (a, b) => rank(a) - rank(b) || r() - 0.5).map((p) => p.id).join(); })();
  const viaInsertion = ((): string => { const r = seededRandom(seed); return insertionSort(pool, (a, b) => rank(a) - rank(b) || r() - 0.5).map((p) => p.id).join(); })();
  if (viaMerge !== viaInsertion) oldPatternDisagrees += 1;
}
check(`ROOT CAUSE REPRODUCED: the old random-comparator pattern yields DIFFERENT orders for the SAME seed under two valid sort algorithms (${oldPatternDisagrees} of 200 seeds disagree) -- the order was engine-dependent`, oldPatternDisagrees > 20);

// THE FIX: seeded Fisher-Yates, then a stable sort with a pure comparator -- identical under every algorithm and the native sort.
let fixedDisagrees = 0;
for (let seed = 1; seed <= 200; seed += 1) {
  const pool = makePool(seededRandom(seed * 7919));
  const shuffled = seededShuffle([...pool], seededRandom(seed));
  const native = rankedShuffle([...pool], seededRandom(seed), rank).map((p) => p.id).join();
  const viaMerge = mergeSort(shuffled, (a, b) => rank(a) - rank(b)).map((p) => p.id).join();
  const viaInsertion = insertionSort(shuffled, (a, b) => rank(a) - rank(b)).map((p) => p.id).join();
  if (native !== viaMerge || native !== viaInsertion) fixedDisagrees += 1;
}
check('THE FIX IS ENGINE-INDEPENDENT: seeded Fisher-Yates + a stable sort by a pure rank comparator gives the same order as a merge sort, an insertion sort and the native sort for all 200 seeds', fixedDisagrees === 0);

// The shuffle itself is a pinned deterministic stream (consumes exactly length - 1 draws; same on every engine).
const stream = seededShuffle(Array.from({ length: 12 }, (_, i) => i), seededRandom(20261007)).join();
check(`THE SHUFFLE STREAM IS PINNED (seed 20261007, 12 items): ${stream}`, stream === '10,1,6,7,9,4,11,8,2,3,0,5');
let draws = 0; const counted = () => { draws += 1; return seededRandom(5)(); };
seededShuffle([1, 2, 3, 4, 5, 6], counted);
check('seededShuffle consumes exactly (length - 1) random draws', draws === 5);
const permutations = new Set<string>();
for (let seed = 1; seed <= 400; seed += 1) permutations.add(seededShuffle([1, 2, 3], seededRandom(seed * 7919 + 13)).join());
check('seededShuffle can reach every permutation of three items (no bias to a subset)', permutations.size === 6);

// The pattern is forbidden anywhere in the test tree.
const SORT_WITH_RANDOM = /\.sort\([^;\n]*\b(?:rnd|random|Math\.random|rand)\s*\(\s*\)/;
const offenders = fs.readdirSync(__dirname).filter((n) => /\.ts$/.test(n) && n !== 'seededFixtureReproducibility.test.ts').filter((n) => SORT_WITH_RANDOM.test(fs.readFileSync(path.join(__dirname, n), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
check(`NO RANDOM SORT COMPARATOR anywhere in the test tree${offenders.length ? ': ' + offenders.join(', ') : ''}`, offenders.length === 0);
check('the detector catches the old pattern (and its Math.random variant) when injected', SORT_WITH_RANDOM.test('x.sort((a, b) => f(a) - f(b) || rnd() - 0.5);') && SORT_WITH_RANDOM.test('x.sort(() => Math.random() - 0.5)') && !SORT_WITH_RANDOM.test('x.sort((a, b) => f(a) - f(b));'));

// The four seeded sweeps use the shared deterministic helper.
const SWEEPS = ['counterfactualAcceptance', 'localCounterfactual', 'schedulingAttemptAuthority', 'shadowPolicyObservation'];
check('the four seeded sweeps import the shared deterministic helper and call it', SWEEPS.every((n) => { const s = fs.readFileSync(path.join(__dirname, `${n}.test.ts`), 'utf8'); return /import \{ rankedShuffle \} from '\.\/fixtureSupport';/.test(s) && /rankedShuffle\(/.test(s); }));
const nvmrc = fs.existsSync(path.join(__dirname, '..', '.nvmrc')) ? fs.readFileSync(path.join(__dirname, '..', '.nvmrc'), 'utf8').trim() : '';
const ci = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
check('SUPPORTED NODE IS DECLARED: CI declares Node 20 and `.nvmrc` records the same major', /node-version: 20/.test(ci) && nvmrc === '20');

if (!allPassed) { console.error('SOME SEEDED FIXTURE REPRODUCIBILITY CHECKS FAILED'); process.exit(1); }
console.log('ALL SEEDED FIXTURE REPRODUCIBILITY CHECKS PASSED');
