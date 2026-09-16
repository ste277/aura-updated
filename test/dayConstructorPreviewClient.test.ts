/**
 * Day Constructor V1 -- PR F2 preview client regression suite. Exercises
 * `parsePreviewResponseBody`/`reviveConstructDayPreviewDates`
 * (dayConstructorPreviewClient.ts) entirely through plain JS values -- no
 * network, no fetch mocking -- matching this repository's own established
 * convention (acceptConstructedDay.test.ts tests `parseAcceptResponseBody`
 * directly and never mocks `fetch` for its own thin network wrapper; this
 * file does the same for `previewConstructedDay`).
 */
import { parsePreviewResponseBody, reviveConstructDayPreviewDates, buildPreviewRequestBody } from '../apps/web/lib/dayConstructorPreviewClient';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function validPreviewJson() {
  return {
    targetDate: '2026-09-16',
    timezone: 'Asia/Kolkata',
    constructionWindow: { date: '2026-09-16', start: '2026-09-16T09:00:00.000Z', end: '2026-09-16T18:30:00.000Z', timezone: 'Asia/Kolkata', source: 'REMAINING_TODAY' },
    resolvedIntents: [{ requestedIntentId: 'row-1', dayIntent: { id: 'row-1', title: 'Workout', targetDate: '2026-09-16', importance: 'MEDIUM', flexibility: 'FLEXIBLE', source: 'USER_TYPED', originalOrder: 0 } }],
    constructedDay: {
      date: '2026-09-16',
      proposedItems: [
        { intentId: 'row-1', title: 'Workout', start: '2026-09-16T10:00:00.000Z', end: '2026-09-16T10:30:00.000Z', placementSource: 'SELECTED_CANDIDATE', timingFit: 'GOOD', candidateOrder: 0, requiresConfirmation: true },
      ],
      deferredItems: [],
      conflicts: [],
      requestedCapacity: { constructionWindowMinutes: 570, blockedMinutes: 0, usableMinutes: 570, requestedMinutes: 30 },
      proposedCapacity: { constructionWindowMinutes: 570, blockedMinutes: 0, usableMinutes: 570, requestedMinutes: 30 },
    },
    warnings: [],
  };
}

function main() {
  // ============================================================
  // reviveConstructDayPreviewDates -- the exhaustive Date-field enumeration
  // (1-10)
  // ============================================================
  {
    const revived = reviveConstructDayPreviewDates(validPreviewJson());
    check('1. a valid preview revives successfully', revived !== null);
    if (revived) {
      check('2. constructionWindow.start becomes a real Date instance', revived.constructionWindow.start instanceof Date);
      check('3. constructionWindow.end becomes a real Date instance', revived.constructionWindow.end instanceof Date);
      check('4. constructionWindow.start carries the correct instant', revived.constructionWindow.start.getTime() === Date.parse('2026-09-16T09:00:00.000Z'));
      check('5. proposedItems[0].start becomes a real Date instance', revived.constructedDay.proposedItems[0].start instanceof Date);
      check('6. proposedItems[0].end becomes a real Date instance', revived.constructedDay.proposedItems[0].end instanceof Date);
      check('7. proposedItems[0].end carries the correct instant', revived.constructedDay.proposedItems[0].end.getTime() === Date.parse('2026-09-16T10:30:00.000Z'));
      check('8. non-date fields (deferredItems/conflicts/capacity/resolvedIntents) pass through unchanged', revived.constructedDay.deferredItems.length === 0 && revived.constructedDay.conflicts.length === 0 && revived.constructedDay.requestedCapacity.requestedMinutes === 30 && revived.resolvedIntents[0].dayIntent.title === 'Workout');
      check('9. every other proposedItem field (title/placementSource/timingFit) is preserved verbatim', revived.constructedDay.proposedItems[0].title === 'Workout' && revived.constructedDay.proposedItems[0].placementSource === 'SELECTED_CANDIDATE' && revived.constructedDay.proposedItems[0].timingFit === 'GOOD');
      check('10. warnings/targetDate/timezone pass through unchanged', revived.warnings.length === 0 && revived.targetDate === '2026-09-16' && revived.timezone === 'Asia/Kolkata');
    }
  }

  // ============================================================
  // reviveConstructDayPreviewDates -- malformed input never partially
  // revives (11-19)
  // ============================================================
  check('11. null input is rejected', reviveConstructDayPreviewDates(null) === null);
  check('12. a non-object input is rejected', reviveConstructDayPreviewDates('nope') === null);
  check('13. missing constructionWindow is rejected', reviveConstructDayPreviewDates({ ...validPreviewJson(), constructionWindow: undefined }) === null);
  check('14. an unparseable constructionWindow.start is rejected', reviveConstructDayPreviewDates({ ...validPreviewJson(), constructionWindow: { ...validPreviewJson().constructionWindow, start: 'not-a-date' } }) === null);
  check('15. a missing constructionWindow.end is rejected', reviveConstructDayPreviewDates({ ...validPreviewJson(), constructionWindow: { ...validPreviewJson().constructionWindow, end: undefined } }) === null);
  check('16. missing constructedDay is rejected', reviveConstructDayPreviewDates({ ...validPreviewJson(), constructedDay: undefined }) === null);
  check('17. a non-array proposedItems is rejected', reviveConstructDayPreviewDates({ ...validPreviewJson(), constructedDay: { ...validPreviewJson().constructedDay, proposedItems: 'nope' } }) === null);
  {
    const withBadItem = validPreviewJson();
    withBadItem.constructedDay.proposedItems = [...withBadItem.constructedDay.proposedItems, { intentId: 'row-2', title: 'Bad', start: 'garbage', end: '2026-09-16T11:00:00.000Z', placementSource: 'SELECTED_CANDIDATE', requiresConfirmation: true } as any];
    check('18. ONE unparseable item among several rejects the WHOLE preview, never a partially-revived array', reviveConstructDayPreviewDates(withBadItem) === null);
  }
  check('19. an empty proposedItems array is still valid (a legitimate ALL_DEFERRED-shaped preview)', reviveConstructDayPreviewDates({ ...validPreviewJson(), constructedDay: { ...validPreviewJson().constructedDay, proposedItems: [] } }) !== null);

  // ============================================================
  // parsePreviewResponseBody -- domain statuses at HTTP 200 (20-27)
  // ============================================================
  check('20. READY + a valid preview parses to status READY', parsePreviewResponseBody({ status: 'READY', preview: validPreviewJson() }, 200).status === 'READY');
  check('21. READY + a malformed preview parses to UNKNOWN_RESPONSE, never a half-built READY', parsePreviewResponseBody({ status: 'READY', preview: { bogus: true } }, 200).status === 'UNKNOWN_RESPONSE');
  check('22. NO_USABLE_CAPACITY passes through', parsePreviewResponseBody({ status: 'NO_USABLE_CAPACITY' }, 200).status === 'NO_USABLE_CAPACITY');
  check('23. INVALID_CONSTRUCTION_WINDOW passes through', parsePreviewResponseBody({ status: 'INVALID_CONSTRUCTION_WINDOW' }, 200).status === 'INVALID_CONSTRUCTION_WINDOW');
  check('24. TIMEZONE_MISSING passes through', parsePreviewResponseBody({ status: 'TIMEZONE_MISSING' }, 200).status === 'TIMEZONE_MISSING');
  check('25. INVALID_REQUEST passes through', parsePreviewResponseBody({ status: 'INVALID_REQUEST' }, 200).status === 'INVALID_REQUEST');
  check('26. TIMING_SEARCH_FAILED passes through', parsePreviewResponseBody({ status: 'TIMING_SEARCH_FAILED' }, 200).status === 'TIMING_SEARCH_FAILED');
  check('27. an unrecognized status string at HTTP 200 is UNKNOWN_RESPONSE', parsePreviewResponseBody({ status: 'SOMETHING_NEW' }, 200).status === 'UNKNOWN_RESPONSE');

  // ============================================================
  // parsePreviewResponseBody -- protocol-level failures (28-33)
  // ============================================================
  check('28. HTTP 401 is HTTP_ERROR with the real status code, never treated as a domain result', (() => { const r = parsePreviewResponseBody({ error: 'Not authenticated.' }, 401); return r.status === 'HTTP_ERROR' && (r as any).httpStatus === 401; })());
  check('29. HTTP 400 is HTTP_ERROR', parsePreviewResponseBody({ error: 'bad request' }, 400).status === 'HTTP_ERROR');
  check('30. HTTP 404 is HTTP_ERROR', parsePreviewResponseBody({ error: 'not found' }, 404).status === 'HTTP_ERROR');
  check('31. HTTP 500 is HTTP_ERROR', parsePreviewResponseBody({ error: 'oops' }, 500).status === 'HTTP_ERROR');
  check(
    '32. a non-200 response is NEVER reinterpreted as a domain status even if the body happens to contain one (protocol failure always wins)',
    parsePreviewResponseBody({ status: 'READY', preview: validPreviewJson() }, 500).status === 'HTTP_ERROR'
  );
  check('33. a non-object body is UNKNOWN_RESPONSE regardless of HTTP status', parsePreviewResponseBody(null, 200).status === 'UNKNOWN_RESPONSE');

  // ============================================================
  // buildPreviewRequestBody -- planning-date hardening (this ticket's own
  // section 7): targetDate is ALWAYS sent once established, never omitted
  // (34-37)
  // ============================================================
  {
    const body = buildPreviewRequestBody([{ id: 'r1', title: 'Workout', flexibility: 'FLEXIBLE' }], '2026-09-16');
    check('34. the built request always includes targetDate', body.targetDate === '2026-09-16');
    check('35. intents pass through unchanged', body.intents.length === 1 && body.intents[0].id === 'r1');
  }
  check('36. the built request has exactly two top-level keys (targetDate, intents) -- no userId/timezone/now/constructionWindowSource', Object.keys(buildPreviewRequestBody([], '2026-09-16')).sort().join(',') === 'intents,targetDate');
  check(
    '37. JSON.stringify(buildPreviewRequestBody(...)) round-trips targetDate as the exact same string (never coerced through a Date)',
    JSON.parse(JSON.stringify(buildPreviewRequestBody([], '2026-09-16'))).targetDate === '2026-09-16'
  );

  if (!allPassed) {
    console.error('\nSome Day Constructor Preview Client checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAY CONSTRUCTOR PREVIEW CLIENT CHECKS PASSED');
  }
}

main();
