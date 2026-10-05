/**
 * Deterministic, ENGINE-INDEPENDENT fixture helpers for the seeded property / incidence sweeps (test-only; no production consumer).
 *
 * WHY THIS EXISTS (O5 P4b5). The sweeps used `array.sort((a, b) => rank(a) - rank(b) || rnd() - 0.5)`. A comparator that draws randomness is not a
 * function of its arguments, so the resulting order depends on HOW MANY times, and between WHICH pairs, a given JavaScript engine's sort implementation
 * calls it. The same seed therefore generated different fixtures (and different incidence: Node 26 gave 437 / 426 / 9 / 367 / 50, Node 20 gave
 * 409 / 405 / 18 / 340 / 47) -- the incidence was not comparable evidence across engines.
 *
 * THE FIX. Randomness is consumed in ONE explicit, fixed order by a seeded Fisher-Yates shuffle; ordering by rank is then a stable sort with a
 * comparator that is a pure function of its two arguments (ES2019 requires a stable sort). Equal seed => equal fixtures on every supported engine.
 */

/** The sweeps' seeded PRNG (Park-Miller, multiplier 48271): returns a float in (0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

/** In-place seeded Fisher-Yates shuffle. Consumes exactly (length - 1) random numbers, from the end of the array to the start. */
export function seededShuffle<T>(items: T[], rnd: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const held = items[i];
    items[i] = items[j];
    items[j] = held;
  }
  return items;
}

/**
 * Random order WITHIN equal rank, rank order across: a seeded shuffle, then a STABLE sort by `rank` alone (a pure comparator). In place; returns the array.
 */
export function rankedShuffle<T>(items: T[], rnd: () => number, rank: (item: T) => number): T[] {
  seededShuffle(items, rnd);
  return items.sort((a, b) => rank(a) - rank(b));
}
