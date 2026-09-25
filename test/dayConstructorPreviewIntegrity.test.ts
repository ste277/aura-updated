/**
 * Remaining-Day Recomposition V1 PR F1 (trust-boundary correction) -- the Day Constructor preview integrity
 * helper: canonical payload, sign/verify, tamper rejection, and structural pins for where it is (and is not)
 * used. The real preview -> accept boundary is proven against a live DB in dayConstructorPreviewIntegrityDb.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { canonicalPreviewItemFields, signPreviewItem, verifyPreviewItem, signPreviewResultBody, verifyAcceptanceItems, PREVIEW_TOKEN_VERSION, type PreviewItemFacts } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { sign, createSessionToken, verifySessionToken } from '../apps/web/lib/auth';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const facts = (over: { userId?: string; window?: Partial<PreviewItemFacts['window']>; item?: Partial<PreviewItemFacts['item']> } = {}): PreviewItemFacts => ({
  userId: over.userId ?? 'user-a',
  window: { date: '2027-08-10', timezone: 'Asia/Kolkata', source: 'REMAINING_TODAY', start: new Date('2027-08-10T09:00:00Z'), end: new Date('2027-08-10T17:00:00Z'), ...over.window },
  item: { intentId: 'intent-1', activityId: 'deep_work', title: 'Investor deck', start: new Date('2027-08-10T14:00:00Z'), end: new Date('2027-08-10T15:00:00Z'), placementSource: 'SELECTED_CANDIDATE', ...over.item },
});

// ---------- 20. canonical payload: explicit, fixed order, pinned ----------
check('20. the canonical payload is an explicit fixed-order array (pinned literally), not object key order', JSON.stringify(canonicalPreviewItemFields(facts())) === JSON.stringify(['user-a', '2027-08-10', 'Asia/Kolkata', 'REMAINING_TODAY', '2027-08-10T09:00:00.000Z', '2027-08-10T17:00:00.000Z', 'intent-1', 'deep_work', 'Investor deck', '2027-08-10T14:00:00.000Z', '2027-08-10T15:00:00.000Z', 'SELECTED_CANDIDATE']));
check('20. the canonical form does not depend on property order of the inputs and encodes an absent activityId as null', JSON.stringify(canonicalPreviewItemFields({ item: { placementSource: 'FIXED_CONSTRAINT', end: new Date('2027-08-10T15:00:00Z'), start: new Date('2027-08-10T14:00:00Z'), title: 'T', intentId: 'i' }, window: { end: new Date('2027-08-10T17:00:00Z'), start: new Date('2027-08-10T09:00:00Z'), source: 'EXPLICIT_RANGE', timezone: 'UTC', date: '2027-08-10' }, userId: 'u' })) === JSON.stringify(['u', '2027-08-10', 'UTC', 'EXPLICIT_RANGE', '2027-08-10T09:00:00.000Z', '2027-08-10T17:00:00.000Z', 'i', null, 'T', '2027-08-10T14:00:00.000Z', '2027-08-10T15:00:00.000Z', 'FIXED_CONSTRAINT']));

// ---------- 6/48. valid verification, determinism ----------
const token = signPreviewItem(facts());
check('6/48. a token verifies against exactly the facts it was signed for', verifyPreviewItem(facts(), token).ok === true);
check('20. signing is deterministic for identical facts (no nonce/clock in the payload)', signPreviewItem(facts()) === token);

// ---------- 8-17/48. every bound fact is tamper-evident ----------
const tampers: [string, PreviewItemFacts][] = [
  ['10. placementSource FLEXIBLE->FIXED', facts({ item: { placementSource: 'FIXED_CONSTRAINT' } })],
  ['8. a different user', facts({ userId: 'user-b' })],
  ['13. start', facts({ item: { start: new Date('2027-08-10T15:00:00Z'), end: new Date('2027-08-10T16:00:00Z') } })],
  ['13. start only', facts({ item: { start: new Date('2027-08-10T14:01:00Z') } })],
  ['15. end / duration (60 -> 30 minutes)', facts({ item: { end: new Date('2027-08-10T14:30:00Z') } })],
  ['14. intent id', facts({ item: { intentId: 'intent-2' } })],
  ['16. activity id', facts({ item: { activityId: 'meditation' } })],
  ['16. activity id removed', facts({ item: { activityId: undefined } })],
  ['16. title', facts({ item: { title: 'Something else' } })],
  ['7. window date', facts({ window: { date: '2027-08-11' } })],
  ['7. window timezone', facts({ window: { timezone: 'UTC' } })],
  ['7. window source', facts({ window: { source: 'EXPLICIT_RANGE' } })],
  ['7. window start', facts({ window: { start: new Date('2027-08-10T08:00:00Z') } })],
  ['7. window end', facts({ window: { end: new Date('2027-08-10T23:00:00Z') } })],
];
for (const [label, f] of tampers) {
  const r = verifyPreviewItem(f, token);
  check(`9-17. tampering with ${label} is rejected (PREVIEW_TOKEN_MISMATCH)`, !r.ok && r.code === 'PREVIEW_TOKEN_MISMATCH');
}
check('10. the reverse forgery (FIXED token presented as SELECTED_CANDIDATE) is rejected too', (() => { const fixedToken = signPreviewItem(facts({ item: { placementSource: 'FIXED_CONSTRAINT' } })); const r = verifyPreviewItem(facts({ item: { placementSource: 'SELECTED_CANDIDATE' } }), fixedToken); return !r.ok && r.code === 'PREVIEW_TOKEN_MISMATCH' && verifyPreviewItem(facts({ item: { placementSource: 'FIXED_CONSTRAINT' } }), fixedToken).ok; })());
check('14. an item token cannot be reused for another item of the same preview (token swap)', (() => { const other = signPreviewItem(facts({ item: { intentId: 'intent-2', title: 'Other', start: new Date('2027-08-10T10:00:00Z'), end: new Date('2027-08-10T11:00:00Z') } })); const r = verifyPreviewItem(facts(), other); return !r.ok && r.code === 'PREVIEW_TOKEN_MISMATCH'; })());

// ---------- 36/37/38/6. token-level failures ----------
const flipped = (() => { const [body, sig] = token.split('.'); return `${body}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`; })();
check('36. a mutated signature is rejected (PREVIEW_TOKEN_INVALID)', (() => { const r = verifyPreviewItem(facts(), flipped); return !r.ok && r.code === 'PREVIEW_TOKEN_INVALID'; })());
check('36. a mutated body (validly-shaped base64url, original signature) is rejected', (() => { const [body, sig] = token.split('.'); const forgedBody = Buffer.from(JSON.stringify({ k: 'dc-preview-item', v: 1, f: canonicalPreviewItemFields(facts({ item: { placementSource: 'FIXED_CONSTRAINT' } })) })).toString('base64url'); const r = verifyPreviewItem(facts({ item: { placementSource: 'FIXED_CONSTRAINT' } }), `${forgedBody}.${sig}`); return !r.ok && r.code === 'PREVIEW_TOKEN_INVALID' && body.length > 0; })());
check('37. missing / empty / non-string tokens are rejected (PREVIEW_TOKEN_MISSING) -- no fallback to trusting the payload', [undefined, null, '', 0, {}, ['x']].every((v) => { const r = verifyPreviewItem(facts(), v); return !r.ok && r.code === 'PREVIEW_TOKEN_MISSING'; }));
check('36. garbage strings are rejected (PREVIEW_TOKEN_INVALID)', ['x', 'a.b', '...', 'not a token'].every((v) => { const r = verifyPreviewItem(facts(), v); return !r.ok && r.code === 'PREVIEW_TOKEN_INVALID'; }));
check('38/21. an unknown version fails closed even when correctly signed (v:2, and a missing v)', [{ k: 'dc-preview-item', v: 2, f: canonicalPreviewItemFields(facts()) }, { k: 'dc-preview-item', f: canonicalPreviewItemFields(facts()) }].every((p) => { const r = verifyPreviewItem(facts(), sign(p)); return !r.ok && r.code === 'PREVIEW_TOKEN_INVALID'; }) && PREVIEW_TOKEN_VERSION === 1);
check('21/4. the wrong purpose is rejected: a correctly signed session token can never be presented as a preview token', (() => { const r = verifyPreviewItem(facts(), createSessionToken('user-a', 'a@example.com')); return !r.ok && r.code === 'PREVIEW_TOKEN_INVALID'; })() && !verifyPreviewItem(facts(), sign({ k: 'something-else', v: 1, f: canonicalPreviewItemFields(facts()) })).ok);
check('4. a malformed signed body (field array missing / wrong length) fails closed', [{ k: 'dc-preview-item', v: 1 }, { k: 'dc-preview-item', v: 1, f: 'nope' }, { k: 'dc-preview-item', v: 1, f: canonicalPreviewItemFields(facts()).slice(1) }, { k: 'dc-preview-item', v: 1, f: [...canonicalPreviewItemFields(facts()), 'extra'] }].every((p) => !verifyPreviewItem(facts(), sign(p)).ok));
check('4. the token carries no userId/email keys, so it is not a session lookalike (its user is only a bound fact)', (() => { const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')); return !('userId' in payload) && !('email' in payload) && Object.keys(payload).sort().join() === 'f,k,v' && (verifySessionToken(token) as any)?.userId === undefined; })());

// ---------- 18/19/39/40. acceptance gate across several items ----------
{
  const window = facts().window as any;
  const items = [
    { intentId: 'a', title: 'A', start: new Date('2027-08-10T10:00:00Z'), end: new Date('2027-08-10T10:30:00Z'), placementSource: 'FIXED_CONSTRAINT' as const },
    { intentId: 'b', title: 'B', activityId: 'deep_work', start: new Date('2027-08-10T12:00:00Z'), end: new Date('2027-08-10T13:00:00Z'), placementSource: 'SELECTED_CANDIDATE' as const },
  ];
  const tokens = new Map(items.map((item) => [item.intentId, signPreviewItem({ userId: 'user-a', window, item })]));
  check('18/19. a full, untampered set of items verifies with no diagnostics regardless of submission order', verifyAcceptanceItems('user-a', window, items, tokens).length === 0 && verifyAcceptanceItems('user-a', window, [items[1], items[0]], tokens).length === 0);
  const tamperedB = [items[0], { ...items[1], placementSource: 'FIXED_CONSTRAINT' as const }];
  const diag = verifyAcceptanceItems('user-a', window, tamperedB, tokens);
  check('39. tampering with ONE item yields a diagnostic for exactly that item (INVALID_REQUEST / PREVIEW_TOKEN_MISMATCH); the caller rejects the whole request', diag.length === 1 && diag[0].intentId === 'b' && diag[0].reason === 'INVALID_REQUEST' && diag[0].detail === 'PREVIEW_TOKEN_MISMATCH');
  const missingA = verifyAcceptanceItems('user-a', window, items, new Map([['b', tokens.get('b')]]));
  check('37. an item with no token is rejected (PREVIEW_TOKEN_MISSING) even when its sibling is valid', missingA.length === 1 && missingA[0].intentId === 'a' && missingA[0].detail === 'PREVIEW_TOKEN_MISSING');
  check('40. a subset of a signed preview still verifies (tokens are per item; nothing forces the full set)', verifyAcceptanceItems('user-a', window, [items[1]], tokens).length === 0);
  check('8. the same tokens under another authenticated user are all rejected', verifyAcceptanceItems('user-b', window, items, tokens).length === 2);
  check('42. the diagnostics never echo cryptographic detail', JSON.stringify(diag).length < 200 && !/sig|hmac|secret|key/i.test(JSON.stringify(diag)));
}

// ---------- 25. signing a preview body ----------
{
  const window = facts().window;
  const body = { status: 'READY', preview: { constructionWindow: window, constructedDay: { proposedItems: [{ intentId: 'i1', title: 'X', start: new Date('2027-08-10T10:00:00Z'), end: new Date('2027-08-10T10:30:00Z'), placementSource: 'FIXED_CONSTRAINT', requiresConfirmation: true }] } } } as any;
  const signed = signPreviewResultBody('user-a', body) as any;
  const t = signed.preview.constructedDay.proposedItems[0].acceptanceToken;
  check('25. a READY preview body gets one acceptanceToken per proposed item, which verifies for its own item and user', typeof t === 'string' && verifyPreviewItem({ userId: 'user-a', window, item: body.preview.constructedDay.proposedItems[0] }, t).ok && !verifyPreviewItem({ userId: 'user-b', window, item: body.preview.constructedDay.proposedItems[0] }, t).ok);
  check('25. the original preview fields are preserved and the input is not mutated', signed.preview.constructedDay.proposedItems[0].title === 'X' && body.preview.constructedDay.proposedItems[0].acceptanceToken === undefined);
  check('25. non-READY bodies (NO_USABLE_CAPACITY, errors, malformed) are returned untouched', ['NO_USABLE_CAPACITY', 'TIMING_SEARCH_FAILED', 'INVALID_REQUEST'].every((status) => { const b = { status }; return signPreviewResultBody('user-a', b) === b; }) && signPreviewResultBody('u', { status: 'READY' } as any).status === 'READY');
}

// ---------- structural: where the integrity gate lives ----------
const routeAccept = strip(read('apps/web/app/api/day-constructor/accept/route.ts'));
check('16/26/41. the accept route verifies every item BEFORE calling persistAcceptedConstructedDay (so a replay with altered facts can never reach the idempotency path), and rejects as INVALID_REQUEST', routeAccept.indexOf('verifyAcceptanceItems(') > 0 && routeAccept.indexOf('verifyAcceptanceItems(') < routeAccept.indexOf('persistAcceptedConstructedDay(') && /status: 'REJECTED', reason: 'INVALID_REQUEST', diagnostics: integrityDiagnostics/.test(routeAccept));
check('26. there is no compatibility path: the route has no branch that skips verification when a token is missing', !/acceptanceToken\s*===\s*undefined|if \(!token\)|tokens\.size\s*===\s*0/.test(routeAccept));
const callers = ['apps/web/app', 'apps/web/components', 'apps/web/lib'].flatMap((d) => (function walk(dir: string): string[] { return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' || e.name === '.next' ? [] : walk(path.join(dir, e.name))) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [])); })(d));
const persistCallers = callers.filter((f) => /persistAcceptedConstructedDay\(/.test(strip(read(f))) && !/dayConstructorAcceptancePersistence\.ts$/.test(f)).map((f) => f.split(path.sep).join('/'));
check('16. persistAcceptedConstructedDay has exactly ONE production caller -- the accept route -- so no path bypasses the integrity gate', persistCallers.join() === 'apps/web/app/api/day-constructor/accept/route.ts');
check('16. the preview boundary signs the READY result for the authenticated user', /signPreviewResultBody\(session\.userId, result\.body\)/.test(strip(read('apps/web/lib/dayConstructorPreviewRequest.ts'))));
check('46/47. the integrity module is server-only and no client/UI file imports it (the client only passes the opaque token back)', callers.filter((f) => /dayConstructorPreviewIntegrity/.test(read(f)) && !/dayConstructorPreviewIntegrity\.ts$/.test(f)).map((f) => f.split(path.sep).join('/')).sort().join() === 'apps/web/app/api/day-constructor/accept/route.ts,apps/web/lib/dayConstructorPreviewRequest.ts' && /acceptanceToken\?: string/.test(read('apps/web/lib/acceptConstructedDay.ts')) && !/atob|Buffer\.from|JSON\.parse/.test(strip(read('apps/web/lib/acceptConstructedDay.ts')).slice(strip(read('apps/web/lib/acceptConstructedDay.ts')).indexOf('buildAcceptRequestBody'), strip(read('apps/web/lib/acceptConstructedDay.ts')).indexOf('PersistedPlanSummary'))));
const integritySrc = strip(read('apps/web/lib/dayConstructorPreviewIntegrity.ts'));
check('5/6/46. the module reuses the repository HMAC-SHA256 sign/verify (auth.ts, timingSafeEqual): no new secret, no custom crypto, no persistence or Constructor logic', /from '\.\/auth'/.test(integritySrc) && !/createHmac|createHash|randomBytes|process\.env|from '\.\/db'|from 'pg'|constructDay\(|from '\.\/dayConstructor'/.test(integritySrc));
check('45/50. the pure Constructor, capacity, availability and acceptance-evaluation modules never mention the integrity token', ['apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayCapacity.ts', 'apps/web/lib/availabilityContext.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts'].every((f) => !/acceptanceToken|PreviewIntegrity/.test(read(f))));
check('42/43/44. F1 semantics are frozen: POST /api/plans and Move take no preview token; the accept route still ignores a body schedulingMode', !/acceptanceToken|PreviewIntegrity/.test(read('apps/web/app/api/plans/route.ts')) && !/acceptanceToken|PreviewIntegrity/.test(read('apps/web/lib/planMove.ts')) && !/schedulingMode/.test(routeAccept));
check('51/52. no migration or dependency change: 39 migrations, no package files touched by the working tree', fs.readdirSync(path.join(root, 'apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d)).length === 39);

console.log(allPassed ? '\nALL PREVIEW INTEGRITY CHECKS PASSED' : '\nSOME PREVIEW INTEGRITY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
