/**
 * Ashtakavarga Engine V1 -- input validation.
 */
import { ASHTAKAVARGA_TARGETS, ZODIAC_SIGN_COUNT } from './constants';
import { AshtakavargaValidationError } from './types';
import type { AshtakavargaNatalInput, ZodiacSign } from './types';

function isValidSign(sign: unknown): sign is ZodiacSign {
  return typeof sign === 'number' && Number.isInteger(sign) && sign >= 0 && sign < ZODIAC_SIGN_COUNT;
}

export function assertValidNatalInput(input: AshtakavargaNatalInput): void {
  if (input == null || typeof input !== 'object' || input.planetarySigns == null || typeof input.planetarySigns !== 'object') {
    throw new AshtakavargaValidationError('AshtakavargaNatalInput must be an object with a planetarySigns object and a lagnaSign.');
  }

  for (const target of ASHTAKAVARGA_TARGETS) {
    const sign = input.planetarySigns[target];
    if (sign === undefined) {
      throw new AshtakavargaValidationError(`AshtakavargaNatalInput.planetarySigns is missing required planet: ${target}.`);
    }
    if (!isValidSign(sign)) {
      throw new AshtakavargaValidationError(`AshtakavargaNatalInput.planetarySigns.${target} must be an integer zodiac sign in [0, ${ZODIAC_SIGN_COUNT - 1}], got: ${sign}.`);
    }
  }

  if (input.lagnaSign === undefined) {
    throw new AshtakavargaValidationError('AshtakavargaNatalInput is missing required lagnaSign.');
  }
  if (!isValidSign(input.lagnaSign)) {
    throw new AshtakavargaValidationError(`AshtakavargaNatalInput.lagnaSign must be an integer zodiac sign in [0, ${ZODIAC_SIGN_COUNT - 1}], got: ${input.lagnaSign}.`);
  }
}
