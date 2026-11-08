import { NextResponse } from 'next/server';
import { SolarComputationError, SolarInputValidationError, SolarNoEventError } from '../../../packages/astronomy/src/ephemeris';

/**
 * PA-3C-C1A -- shared structured-error mapping for Panchangam API routes.
 *
 * Replaces returning the raw internal `Error.message` to the client
 * (confirmed pre-existing leak in /api/panchang/route.ts, PA-3C-A2/A3/A4
 * decision #2) with a stable `code` the client can switch on, and
 * distinguishes a legitimate no-event condition (422 -- the request was
 * valid, the resource just doesn't exist for that location/date) from
 * malformed input (400) and a genuine computation anomaly (500). Returns
 * `null` for anything that isn't one of the three typed solar errors, so
 * the caller can rethrow and avoid masking an unrelated bug.
 */
export function solarErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof SolarNoEventError) {
    return NextResponse.json(
      {
        error: 'No sunrise or sunset occurs at this location on this date (continuous daylight or darkness).',
        code: err.code,
        condition: err.condition,
      },
      { status: 422 }
    );
  }
  if (err instanceof SolarInputValidationError) {
    return NextResponse.json(
      { error: 'The stored location or date for this request is invalid.', code: err.code },
      { status: 400 }
    );
  }
  if (err instanceof SolarComputationError) {
    return NextResponse.json(
      { error: 'Unable to compute solar data for this request.', code: err.code },
      { status: 500 }
    );
  }
  return null;
}
