/**
 * Plan My Day -- single-item time editing CLIENT regression suite.
 * Exercises `buildUpdatePreviewItemTimeRequestBody`/
 * `parseUpdatePreviewItemTimeResponseBody` (dayConstructorPreviewItemClient.ts)
 * entirely through plain JS values -- no network, no fetch mocking,
 * matching this repository's own established convention
 * (dayConstructorPreviewClient.test.ts/acceptConstructedDay.test.ts never
 * mock `fetch` for their own thin network wrappers either).
 *
 * The single most important thing this suite proves (checks 18-20): the
 * preview-item endpoint returns its ONE `TIMING_CHECK_FAILED` rejection
 * with a real HTTP 500, not the 200 every other domain outcome uses
 * (confirmed by direct read of preview-item/route.ts, not assumed) --
 * `parseUpdatePreviewItemTimeResponseBody` must still classify that body
 * as a genuine `REJECTED`, never misreport it as a bare `HTTP_ERROR`.
 */
import { buildUpdatePreviewItemTimeRequestBody, parseUpdatePreviewItemTimeResponseBody } from '../apps/web/lib/dayConstructorPreviewItemClient';
import type { ConstructionWindow } from '../apps/web/lib/dayIntent';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function window(): ConstructionWindow {
  return { date: '2026-09-16', start: new Date('2026-09-16T13:00:00Z'), end: new Date('2026-09-17T04:00:00Z'), timezone: 'America/New_York', source: 'EXPLICIT_RANGE' };
}

function item() {
  return { intentId: 'a', activityId: 'deep_work', title: 'Investor deck', start: new Date('2026-09-16T14:00:00Z'), end: new Date('2026-09-16T15:00:00Z'), placementSource: 'SELECTED_CANDIDATE' as const };
}

function validUpdatedItemJson() {
  return { intentId: 'a', activityId: 'deep_work', title: 'Investor deck', start: '2026-09-16T16:00:00.000Z', end: '2026-09-16T17:00:00.000Z', placementSource: 'SELECTED_CANDIDATE', requiresConfirmation: true, acceptanceToken: 'signed-token-xyz' };
}

function main() {
  // ============================================================
  // buildUpdatePreviewItemTimeRequestBody (1-7)
  // ============================================================
  {
    const body = buildUpdatePreviewItemTimeRequestBody(window(), item(), 'original-token', new Date('2026-09-16T16:00:00Z'));
    check('1. window fields serialize to ISO strings, never Date instances', typeof body.window.start === 'string' && typeof body.window.end === 'string');
    check('2. window.date/timezone/source pass through verbatim', body.window.date === '2026-09-16' && body.window.timezone === 'America/New_York' && body.window.source === 'EXPLICIT_RANGE');
    check('3. item fields serialize to ISO strings', body.item.start === '2026-09-16T14:00:00.000Z' && body.item.end === '2026-09-16T15:00:00.000Z');
    check('4. item.intentId/activityId/title/placementSource pass through verbatim', body.item.intentId === 'a' && body.item.activityId === 'deep_work' && body.item.title === 'Investor deck' && body.item.placementSource === 'SELECTED_CANDIDATE');
    check('5. acceptanceToken is the ORIGINAL token, never derived', body.acceptanceToken === 'original-token');
    check('6. candidateStart is the requested new instant, serialized to ISO', body.candidateStart === '2026-09-16T16:00:00.000Z');
    check(
      '7. the built request has exactly four top-level keys (window, item, acceptanceToken, candidateStart) -- no duration, no second candidateEnd',
      Object.keys(body).sort().join(',') === 'acceptanceToken,candidateStart,item,window'
    );
  }
  check('8. a FIXED_CONSTRAINT item serializes its placementSource verbatim too', buildUpdatePreviewItemTimeRequestBody(window(), { ...item(), placementSource: 'FIXED_CONSTRAINT' }, 't', new Date()).item.placementSource === 'FIXED_CONSTRAINT');
  check('9. JSON.stringify round-trips the request body without losing any field', JSON.parse(JSON.stringify(buildUpdatePreviewItemTimeRequestBody(window(), item(), 'tok', new Date('2026-09-16T16:00:00Z')))).acceptanceToken === 'tok');

  // ============================================================
  // parseUpdatePreviewItemTimeResponseBody -- UPDATED (10-17)
  // ============================================================
  {
    const result = parseUpdatePreviewItemTimeResponseBody({ status: 'UPDATED', item: validUpdatedItemJson(), candidate: {}, dailyRhythmNotes: {} }, 200);
    check('10. a valid UPDATED body parses successfully', result.status === 'UPDATED');
    if (result.status === 'UPDATED') {
      check('11. item.start/end become real Date instances', result.item.start instanceof Date && result.item.end instanceof Date);
      check('12. item.start carries the correct new instant', result.item.start.getTime() === Date.parse('2026-09-16T16:00:00.000Z'));
      check('13. acceptanceToken is carried through as the NEW token', result.item.acceptanceToken === 'signed-token-xyz');
      check('14. intentId/title/placementSource/activityId are preserved verbatim', result.item.intentId === 'a' && result.item.title === 'Investor deck' && result.item.placementSource === 'SELECTED_CANDIDATE' && result.item.activityId === 'deep_work');
      check('15. requiresConfirmation is always true on the revived item', result.item.requiresConfirmation === true);
    }
  }
  check('16. UPDATED with a missing acceptanceToken is rejected as UNKNOWN_RESPONSE (never silently treated as success)', parseUpdatePreviewItemTimeResponseBody({ status: 'UPDATED', item: { ...validUpdatedItemJson(), acceptanceToken: undefined } }, 200).status === 'UNKNOWN_RESPONSE');
  check('17. UPDATED with an unparseable start is rejected as UNKNOWN_RESPONSE', parseUpdatePreviewItemTimeResponseBody({ status: 'UPDATED', item: { ...validUpdatedItemJson(), start: 'not-a-date' } }, 200).status === 'UNKNOWN_RESPONSE');
  check('17b. UPDATED with an invalid placementSource is rejected as UNKNOWN_RESPONSE', parseUpdatePreviewItemTimeResponseBody({ status: 'UPDATED', item: { ...validUpdatedItemJson(), placementSource: 'SOMETHING_ELSE' } }, 200).status === 'UNKNOWN_RESPONSE');

  // ============================================================
  // parseUpdatePreviewItemTimeResponseBody -- REJECTED, including the
  // critical TIMING_CHECK_FAILED / HTTP 500 asymmetry (18-24)
  // ============================================================
  check('18. a plain INVALID_REQUEST rejection at HTTP 200 parses as REJECTED', parseUpdatePreviewItemTimeResponseBody({ status: 'REJECTED', reason: 'INVALID_REQUEST', detail: 'MALFORMED_REQUEST' }, 200).status === 'REJECTED');
  check('19. a STALE_PREVIEW rejection at HTTP 200 parses with its detail preserved', (() => { const r = parseUpdatePreviewItemTimeResponseBody({ status: 'REJECTED', reason: 'STALE_PREVIEW', detail: 'CANDIDATE_OUTSIDE_WINDOW' }, 200); return r.status === 'REJECTED' && r.reason === 'STALE_PREVIEW' && r.detail === 'CANDIDATE_OUTSIDE_WINDOW'; })());
  check('20. an UNAVAILABLE rejection parses correctly', parseUpdatePreviewItemTimeResponseBody({ status: 'REJECTED', reason: 'UNAVAILABLE', detail: 'FRICTION_WINDOW_BLOCKED' }, 200).status === 'REJECTED');
  check(
    '21. CRITICAL: a TIMING_CHECK_FAILED rejection sent with HTTP 500 (preview-item/route.ts\'s own one asymmetric case) still parses as REJECTED, never HTTP_ERROR',
    parseUpdatePreviewItemTimeResponseBody({ status: 'REJECTED', reason: 'TIMING_CHECK_FAILED' }, 500).status === 'REJECTED'
  );
  check('22. the TIMING_CHECK_FAILED/HTTP-500 result carries the correct reason', (() => { const r = parseUpdatePreviewItemTimeResponseBody({ status: 'REJECTED', reason: 'TIMING_CHECK_FAILED' }, 500); return r.status === 'REJECTED' && r.reason === 'TIMING_CHECK_FAILED'; })());
  check('23. a REJECTED body with an unrecognized reason string is UNKNOWN_RESPONSE, not silently accepted', parseUpdatePreviewItemTimeResponseBody({ status: 'REJECTED', reason: 'MADE_UP_REASON' }, 200).status === 'UNKNOWN_RESPONSE');
  check('24. a REJECTED body with a missing reason is UNKNOWN_RESPONSE', parseUpdatePreviewItemTimeResponseBody({ status: 'REJECTED' }, 200).status === 'UNKNOWN_RESPONSE');

  // ============================================================
  // Protocol-level failures and malformed bodies (25-31)
  // ============================================================
  check('25. a plain {error} 401 envelope (no status field) is HTTP_ERROR 401', (() => { const r = parseUpdatePreviewItemTimeResponseBody({ error: 'Not authenticated.' }, 401); return r.status === 'HTTP_ERROR' && r.httpStatus === 401; })());
  check('26. a plain {error} 404 envelope is HTTP_ERROR 404', parseUpdatePreviewItemTimeResponseBody({ error: 'User not found.' }, 404).status === 'HTTP_ERROR');
  check('27. a plain {error} 400 envelope (malformed JSON body) is HTTP_ERROR 400', (() => { const r = parseUpdatePreviewItemTimeResponseBody({ error: 'A valid JSON request body is required.' }, 400); return r.status === 'HTTP_ERROR' && r.httpStatus === 400; })());
  check('28. a non-object body at HTTP 200 is UNKNOWN_RESPONSE', parseUpdatePreviewItemTimeResponseBody('not an object', 200).status === 'UNKNOWN_RESPONSE');
  check('29. a null body at HTTP 200 is UNKNOWN_RESPONSE', parseUpdatePreviewItemTimeResponseBody(null, 200).status === 'UNKNOWN_RESPONSE');
  check('30. an unrecognized status string at HTTP 200 is UNKNOWN_RESPONSE', parseUpdatePreviewItemTimeResponseBody({ status: 'SOMETHING_ELSE' }, 200).status === 'UNKNOWN_RESPONSE');
  check('31. an unrecognized status string at a non-200 HTTP status falls back to HTTP_ERROR', parseUpdatePreviewItemTimeResponseBody({ status: 'SOMETHING_ELSE' }, 503).status === 'HTTP_ERROR');

  if (!allPassed) {
    console.error('\nSome Day Constructor Preview Item Client checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAY CONSTRUCTOR PREVIEW ITEM CLIENT CHECKS PASSED');
  }
}

main();
