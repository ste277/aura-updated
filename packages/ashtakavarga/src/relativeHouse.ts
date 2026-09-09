/**
 * Ashtakavarga Engine V1 -- relative-house calculation.
 *
 * Classical Ashtakavarga contribution tables are keyed by INCLUSIVE
 * astrological house counting, 1-12, not zero-based sign distance:
 * counting the contributor's own sign as house 1, the next sign as
 * house 2, and so on. This is the one canonical helper every rule
 * lookup in this package goes through -- see prastara.ts.
 */
import { ZODIAC_SIGN_COUNT } from './constants';
import type { ZodiacSign, RelativeHouse } from './types';

/**
 * The inclusive relative house of `to` as counted from `from`:
 * `((to - from + 12) % 12) + 1`. Same sign = 1, next sign = 2, ...,
 * previous sign = 12. Both `from`/`to` are 0-11 zodiac-sign indices;
 * the `+ 12` before the modulo makes this correct for every ordering of
 * `from`/`to` (JavaScript's `%` can return a negative result for a
 * negative left operand, which `+ 12` guards against here exactly the
 * same way normalize360-style helpers elsewhere in this repository
 * guard degree values).
 */
export function relativeHouse(from: ZodiacSign, to: ZodiacSign): RelativeHouse {
  return ((to - from + ZODIAC_SIGN_COUNT) % ZODIAC_SIGN_COUNT) + 1;
}
