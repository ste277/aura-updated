/**
 * Constructor Decision Intelligence -- O5 P3b: the precedence dimensions that rank STRONGER than Decision Pressure.
 *
 * The intended eventual precedence (P2 audit) is
 *
 *   deadline today  ->  importance  ->  deadline  ->  [ DecisionPressure ]  ->  originalOrder
 *
 * and the Constructor's CURRENT precedence (`compareByOverloadPrecedence`, dayIntent.ts) is the same list without the
 * bracketed dimension. A shadow observation needs to ask one question of a loser and a historical owner: "do they tie on
 * every dimension that would outrank pressure?" That is exactly the current comparator with its last tie-break
 * (`originalOrder`) neutralised -- so this module answers it by DELEGATING to `compareByOverloadPrecedence` with both
 * originalOrder values set equal, rather than re-implementing deadline-today / importance / deadline logic a second time
 * (a second copy could drift subtly from the comparator the Constructor actually uses). The comparator is not modified
 * and not wrapped into the active path; this module is read only by the inert shadow stage.
 *
 * WHAT IT READS: deadline, importance -- and nothing else. It never reads `originalOrder` (it is pinned to 0 on both
 * sides, so the comparator's final tie-break always returns 0), never reads timing quality, a candidate window, capacity,
 * decision facts or evidence, and has no notion of pressure itself: pressure is a separate authority that this module
 * neither imports nor reads. The importance / deadline vocabulary is confined to THIS module on purpose, so the shadow
 * evaluator (which does read pressure) never names a value signal.
 *
 * PURE: no I/O, no clock (`today` is an explicit input), no environment, no state.
 */

import { compareByOverloadPrecedence, type DayIntent } from './dayIntent';

/** The only intent facts that outrank pressure. A detached, immutable projection -- no id, title, source or timing. */
export interface AbovePressureFacts {
  readonly importance: DayIntent['importance'];
  readonly deadline?: string;
}

export type AbovePressureComparison = 'A_STRONGER' | 'TIE' | 'B_STRONGER';

/** Projects the stronger-than-pressure facts out of a normalised Constructor intent (the same fields the comparator reads). */
export function projectAbovePressureFacts(intent: Pick<DayIntent, 'importance' | 'deadline'>): AbovePressureFacts {
  return Object.freeze(intent.deadline === undefined ? { importance: intent.importance } : { importance: intent.importance, deadline: intent.deadline });
}

/**
 * Compares two intents on exactly the dimensions stronger than pressure -- deadline today, importance, deadline -- using
 * the Constructor's own comparator with `originalOrder` equalised. `A_STRONGER` means `a` would be preserved ahead of `b`
 * by those dimensions alone; `TIE` means they tie on all of them (only the weaker originalOrder, or a pressure
 * dimension, could separate them).
 */
export function compareAbovePressure(a: AbovePressureFacts, b: AbovePressureFacts, today: string): AbovePressureComparison {
  // The comparator reads exactly deadline, importance and originalOrder (pinned by the P0c guard); the shells below carry
  // exactly those three, with originalOrder neutralised on both sides.
  const shell = (facts: AbovePressureFacts) => ({ importance: facts.importance, deadline: facts.deadline, originalOrder: 0 }) as unknown as DayIntent;
  const delta = compareByOverloadPrecedence(shell(a), shell(b), today);
  return delta < 0 ? 'A_STRONGER' : delta > 0 ? 'B_STRONGER' : 'TIE';
}
