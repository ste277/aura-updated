/**
 * Remaining-Day Recomposition V1 PR F3 -- proposal integrity (sign / verify / tamper), the pure final-state
 * destination validator, and structural pins for the acceptance boundary. The real transactional behavior is
 * proven against a live DB in remainingDayRecompositionAcceptanceDb.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { signRecompositionProposal, verifyRecompositionProposalToken, RECOMPOSITION_TOKEN_VERSION } from '../apps/web/lib/remainingDayRecompositionIntegrity';
import { validateDestinations } from '../apps/web/lib/remainingDayRecompositionAcceptance';
import { signPreviewItem, verifyPreviewItem } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { sign, createSessionToken, verifySessionToken } from '../apps/web/lib/auth';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 16, h, m));
const slot = (h: number, dur = 60) => ({ start: at(h), end: new Date(at(h).getTime() + dur * 60000) });

const mv = (planId: string, from: number, to: number) => ({ planId, decision: 'MOVE' as const, title: planId, current: slot(from), to: slot(to), durationMinutes: 60, reason: 'BETTER_TIMING_TIER', evidence: {} });
const keep = (planId: string, h: number) => ({ planId, decision: 'KEEP' as const, title: planId, current: slot(h), reason: 'NO_STRICT_IMPROVEMENT', evidence: {} });
const unres = (planId: string, h: number) => ({ planId, decision: 'UNRESOLVED' as const, title: planId, current: slot(h), reason: 'CURRENT_SLOT_INVALID_NO_ALTERNATIVE', evidence: {} });
const proposal = (decisions: any[], state = 'CHANGES_PROPOSED') => ({ generatedAt: at(10), targetDate: '2026-09-16', timezone: 'UTC', summary: { state }, decisions });
const tok = (decisions: any[], user = 'user-a') => signRecompositionProposal(user, proposal(decisions) as any)!;

// ---------- 8/10/75/76. canonical, deterministic, bound ----------
const base = [mv('b', 13, 14), keep('a', 12), unres('c', 16)];
const t1 = tok(base);
check('75/10. the token is deterministic and canonical: the same proposal signs to the same token regardless of decision order', typeof t1 === 'string' && t1 === tok([...base].reverse()) && t1 === tok([base[2], base[0], base[1]]));
{
  const v = verifyRecompositionProposalToken('user-a', t1);
  check('10. a verified token decodes to EXACTLY the signed proposal: user, generatedAt, target date, timezone and, per plan (ascending id), decision type, original slot and (MOVE only) destination', v.ok && v.proposal.userId === 'user-a' && v.proposal.generatedAt.toISOString() === at(10).toISOString() && v.proposal.targetDate === '2026-09-16' && v.proposal.timezone === 'UTC' && v.proposal.decisions.map((d) => `${d.planId}:${d.decision}`).join() === 'a:KEEP,b:MOVE,c:UNRESOLVED' && v.proposal.decisions[1].to!.start.toISOString() === at(14).toISOString() && v.proposal.decisions[0].to === null && v.proposal.decisions[1].current.start.toISOString() === at(13).toISOString());
}
check('76. generatedAt is signed once and round-trips exactly (no drift during serialization)', (() => { const v = verifyRecompositionProposalToken('user-a', t1); return v.ok && v.proposal.generatedAt.getTime() === at(10).getTime(); })());

// ---------- 13. only CHANGES_PROPOSED is signable ----------
check('13. NO_CHANGES / NEEDS_ATTENTION / any other state is never signed (nothing to accept)', ['NO_CHANGES', 'NEEDS_ATTENTION', 'TIMING_FAILED', ''].every((s) => signRecompositionProposal('user-a', proposal(base, s) as any) === null));

// ---------- 48/49/50. user binding, purpose, tampering ----------
check('48. another user\'s token is INVALID_TOKEN (the authenticated user must equal the bound user)', (() => { const r = verifyRecompositionProposalToken('user-b', t1); return !r.ok && r.code === 'INVALID_TOKEN'; })());
{
  const [body, sig] = t1.split('.');
  const flipped = `${body}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
  const forgedPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  forgedPayload.f[5][0][1] = 'MOVE'; // try to turn a KEEP into a MOVE, keeping the original signature
  const forgedBody = `${Buffer.from(JSON.stringify(forgedPayload)).toString('base64url')}.${sig}`;
  check('50. a mutated signature is rejected', !verifyRecompositionProposalToken('user-a', flipped).ok);
  check('50/3. a mutated payload (KEEP turned into MOVE, original signature kept) is rejected -- the client cannot change what the proposal means', !verifyRecompositionProposalToken('user-a', forgedBody).ok);
  check('50. missing / empty / non-string / oversized / garbage tokens are rejected without throwing', [undefined, null, '', 0, {}, ['x'], 'x', 'a.b', '...', 'z'.repeat(20000)].every((v) => { try { const r = verifyRecompositionProposalToken('user-a', v); return !r.ok && r.code === 'INVALID_TOKEN'; } catch { return false; } }));
}
const goodF = () => JSON.parse(Buffer.from(t1.split('.')[0], 'base64url').toString('utf8')).f as any[];
check('50/8. an unknown version, a missing version and a wrong purpose are rejected even when correctly signed', [{ k: 'rdr-proposal', v: 2, f: goodF() }, { k: 'rdr-proposal', f: goodF() }, { k: 'dc-preview-item', v: 1, f: goodF() }, { k: 'other', v: 1, f: goodF() }].every((p) => !verifyRecompositionProposalToken('user-a', sign(p)).ok) && RECOMPOSITION_TOKEN_VERSION === 1);
{
  const f = goodF();
  const cases: [string, any[]][] = [
    ['wrong field count', f.slice(0, 5)],
    ['non-CHANGES state', [f[0], f[1], f[2], f[3], 'NO_CHANGES', f[5]]],
    ['bad target date', [f[0], f[1], '2026-9-16', f[3], f[4], f[5]]],
    ['non-canonical generatedAt', [f[0], '2026-09-16 10:00', f[2], f[3], f[4], f[5]]],
    ['empty decisions', [f[0], f[1], f[2], f[3], f[4], []]],
    ['no MOVE at all', [f[0], f[1], f[2], f[3], f[4], [f[5][0], f[5][2]]]],
    ['unknown decision type', [f[0], f[1], f[2], f[3], f[4], [[...f[5][0].slice(0, 1), 'DEFER', ...f[5][0].slice(2)], f[5][1]]]],
    ['KEEP carrying a destination', [f[0], f[1], f[2], f[3], f[4], [[...f[5][0].slice(0, 4), '2026-09-16T15:00:00.000Z', '2026-09-16T16:00:00.000Z'], f[5][1]]]],
    ['MOVE without a destination', [f[0], f[1], f[2], f[3], f[4], [f[5][0], [...f[5][1].slice(0, 4), null, null]]]],
    ['duplicate / unsorted plan ids', [f[0], f[1], f[2], f[3], f[4], [f[5][1], f[5][0], f[5][2]]]],
    ['end before start', [f[0], f[1], f[2], f[3], f[4], [f[5][0], [f[5][1][0], 'MOVE', f[5][1][3], f[5][1][2], f[5][1][4], f[5][1][5]]]]],
    ['more than the 12-plan bound', [f[0], f[1], f[2], f[3], f[4], Array.from({ length: 13 }, (_, i) => [`p${String(i).padStart(2, '0')}`, 'MOVE', f[5][1][2], f[5][1][3], f[5][1][4], f[5][1][5]])]],
  ];
  for (const [label, fields] of cases) check(`50. a correctly signed but structurally invalid payload (${label}) fails closed`, !verifyRecompositionProposalToken('user-a', sign({ k: 'rdr-proposal', v: 1, f: fields })).ok);
}
check('49. purpose separation both ways: an F1 preview token is not a proposal token, a proposal token is not an F1 preview token, and a session token is neither', (() => {
  const window = { date: '2026-09-16', timezone: 'UTC', source: 'REMAINING_TODAY' as const, start: at(9), end: at(17) };
  const item = { intentId: 'i', title: 'T', start: at(10), end: at(11), placementSource: 'FIXED_CONSTRAINT' as const };
  const preview = signPreviewItem({ userId: 'user-a', window, item });
  return !verifyRecompositionProposalToken('user-a', preview).ok && !verifyPreviewItem({ userId: 'user-a', window, item }, t1).ok && !verifyRecompositionProposalToken('user-a', createSessionToken('user-a', 'a@example.com')).ok;
})());
check('8. the token carries no userId/email key, so it is not a session lookalike', (() => { const payload = JSON.parse(Buffer.from(t1.split('.')[0], 'base64url').toString('utf8')); return Object.keys(payload).sort().join() === 'f,k,v' && (verifySessionToken(t1) as any)?.userId === undefined; })());

// ---------- 26/27/56/57/58/22/24/59-60/67. pure final-state destination validation ----------
{
  const day = { from: at(0), to: new Date(at(0).getTime() + 24 * 3600000) };
  const window = { start: at(10), end: day.to };
  const NOW = at(10);
  const v = (moves: { planId: string; to: { start: Date; end: Date } }[], w = window, gaps: { start: Date; end: Date }[] = [], now = NOW) => validateDestinations(moves, now, day, w, gaps);
  check('56/26. a SWAP is valid as a final schedule (validation is never sequential: destinations only ever face each other and current blockers)', v([{ planId: 'a', to: slot(13) }, { planId: 'b', to: slot(12) }]) === null);
  check('57. a THREE-WAY ROTATION is valid as a final schedule', v([{ planId: 'a', to: slot(12) }, { planId: 'b', to: slot(13) }, { planId: 'c', to: slot(14) }]) === null);
  check('27. touching destinations ([start,end) semantics) are allowed', v([{ planId: 'a', to: slot(12) }, { planId: 'b', to: slot(13) }]) === null);
  check('58. two overlapping destinations are a CONFLICT (deterministic: reported on the later plan id)', (() => { const r = v([{ planId: 'b', to: slot(13, 90) }, { planId: 'a', to: slot(12, 90) }]); return !!r && r.reason === 'CONFLICT' && r.planId === 'b'; })());
  check('22/67. a destination that starts at or before the acceptance clock is DESTINATION_PAST', v([{ planId: 'a', to: slot(10) }])?.reason === 'DESTINATION_PAST' && v([{ planId: 'a', to: { start: at(9, 59), end: at(10, 59) } }])?.reason === 'DESTINATION_PAST' && v([{ planId: 'a', to: { start: at(10, 1), end: at(11, 1) } }]) === null);
  check('22/68. a cross-day destination is DESTINATION_OUTSIDE_TODAY (start before the local day, or end after it)', v([{ planId: 'a', to: { start: at(23), end: at(24, 30) } }])?.reason === 'DESTINATION_OUTSIDE_TODAY' && v([{ planId: 'a', to: { start: at(23), end: at(24) } }]) === null);
  check('24/60. availability: a destination outside the CURRENT window, or overlapping a gap, is AVAILABILITY_CHANGED; touching a gap is allowed', v([{ planId: 'a', to: slot(19) }], { start: at(10), end: at(18) })?.reason === 'AVAILABILITY_CHANGED' && v([{ planId: 'a', to: slot(13) }], window, [{ start: at(12, 30), end: at(14) }])?.reason === 'AVAILABILITY_CHANGED' && v([{ planId: 'a', to: slot(13) }], window, [{ start: at(14), end: at(15) }]) === null && v([{ planId: 'a', to: slot(11) }], window, [{ start: at(12), end: at(14) }]) === null);
  check('the first violation in plan-id order is reported deterministically', v([{ planId: 'z', to: slot(9) }, { planId: 'a', to: slot(8) }])?.planId === 'a');
}

// ---------- structural: acceptance boundary ----------
const acc = strip(read('apps/web/lib/remainingDayRecompositionAcceptance.ts'));
const routeSrc = strip(read('apps/web/app/api/day/recompose/accept/route.ts'));
const planMove = strip(read('apps/web/lib/planMove.ts'));
check('88. batch acceptance NEVER calls movePlannedActivity (no sequential Move per decision)', !/movePlannedActivity\s*\(/.test(acc) && /applyMoveWrites\(client/.test(acc) && (acc.match(/applyMoveWrites\(/g) ?? []).length === 1);
check('89. acceptance and its route never call constructDay / orchestrateConstructDay / recomposeRemainingDay (nothing is re-chosen); validation reuses only availability + blocker helpers', !/constructDay\s*\(|orchestrateConstructDay\s*\(|recomposeRemainingDay\s*\(|searchTiming|runTimingSearch/.test(acc + routeSrc));
check('29/30/87. lock hierarchy: the SAME per-user advisory namespace as Move and Day Constructor acceptance, then FOR UPDATE on every reconsidered plan ORDER BY id (deterministic lock order), all before any validation or write', /pg_advisory_xact_lock\(hashtext\(\$1\)\)', \[`day-constructor-accept:\$\{userId\}`\]/.test(acc) && acc.indexOf('pg_advisory_xact_lock') < acc.indexOf('ORDER BY id FOR UPDATE') && acc.indexOf('ORDER BY id FOR UPDATE') < acc.indexOf('applyMoveWrites(') && /const ids = proposal\.decisions\.map\(\(d\) => d\.planId\);/.test(acc) && /planId <= previousId/.test(strip(read('apps/web/lib/remainingDayRecompositionIntegrity.ts'))) && /day-constructor-accept:\$\{userId\}/.test(planMove) && /day-constructor-accept:\$\{userId\}/.test(strip(read('apps/web/lib/dayConstructorAcceptancePersistence.ts'))));
check('31. one transaction: a single BEGIN and one commit-or-rollback path; no second connection for writes', (acc.match(/beginTransaction\(\)/g) ?? []).length === 1 && /finish\(\{ status: 'ACCEPTED'/.test(acc) && /ROLLBACK/.test(acc));
check('32/78. Move semantics are SHARED, not duplicated: manual Move and batch acceptance both use findBlockingPlanForRange and applyMoveWrites from planMove.ts', /findBlockingPlanForRange\(client, userId, \[planId\]/.test(planMove) && /applyMoveWrites\(client, userId, a,/.test(planMove) && /findBlockingPlanForRange\(client, userId, sourceIds/.test(acc) && !/INSERT INTO "PlannedActivity"/.test(acc) && (planMove.match(/INSERT INTO "PlannedActivity"/g) ?? []).length === 1);
check('5/6/7/20. CLOCK (structural): the acceptance module reads no route/pre-lock clock (no new Date / Date.now), reads the transaction clock exactly ONCE via readClock AFTER the advisory and row locks and after replay recognition, and the production route passes no clock at all', !/new Date\(\)|Date\.now/.test(acc) && (acc.match(/deps\.readClock\(client\)/g) ?? []).length === 1 && (acc.match(/clock_timestamp\(\)/g) ?? []).length === 1 && acc.indexOf('pg_advisory_xact_lock') < acc.indexOf('ORDER BY id FOR UPDATE') && acc.indexOf('ORDER BY id FOR UPDATE') < acc.indexOf('deps.readClock(client)') && acc.indexOf("status: 'ALREADY_ACCEPTED'") < acc.indexOf('deps.readClock(client)') && acc.indexOf('deps.readClock(client)') < acc.indexOf('getDatePartsInTimezone(proposal.timezone, now)') && acc.indexOf('deps.readClock(client)') < acc.indexOf('applyMoveWrites(client') && /acceptRemainingDayRecomposition\(session\.userId, body\?\.proposalToken\)/.test(routeSrc) && !/new Date\(|Date\.now/.test(routeSrc));
check('52/11. the accept route reads ONLY body.proposalToken; plan ids, slots, decisions, timezone and target date never come from the request', /body\?\.proposalToken/.test(routeSrc) && !/body\??\.(decisions|moves|planId|timezone|targetDate|schedulingMode|slots|to)/.test(routeSrc) && !/req\.json/.test(routeSrc));
check('6/8/74. no proposal persistence and no new secret: the integrity module reuses auth sign/verify only, and neither module writes proposal state', /from '\.\/auth'/.test(strip(read('apps/web/lib/remainingDayRecompositionIntegrity.ts'))) && !/createHmac|process\.env|INSERT|beginTransaction/.test(strip(read('apps/web/lib/remainingDayRecompositionIntegrity.ts'))));
check('90/91/92/93. no schema, migration or dependency: still 39 migrations; the idempotency design is state-based (no PlanCreationIdempotency)', fs.readdirSync(path.join(root, 'apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d)).length === 39 && !/PlanCreationIdempotency|claimPlanCreation/.test(acc));
check('74/83. F2 stays read-only: the F2 service and route contain no write code, and only the server wiring signs (after the final proposal, for CHANGES_PROPOSED only)', !/signRecompositionProposal|Integrity/.test(strip(read('apps/web/lib/remainingDayRecomposition.ts'))) && /signRecompositionProposal\(user\.id, result\.proposal\)/.test(strip(read('apps/web/lib/remainingDayRecompositionServer.ts'))) && !/INSERT|UPDATE\s|DELETE|beginTransaction/.test(strip(read('apps/web/lib/remainingDayRecomposition.ts')) + strip(read('apps/web/lib/remainingDayRecompositionServer.ts')) + strip(read('apps/web/app/api/day/recompose/route.ts'))));
check('81/33. F1 preview integrity is untouched and its purpose tag is not reused', !/rdr-proposal/.test(read('apps/web/lib/dayConstructorPreviewIntegrity.ts')) && /dc-preview-item/.test(read('apps/web/lib/dayConstructorPreviewIntegrity.ts')) && !/dc-preview-item/.test(read('apps/web/lib/remainingDayRecompositionIntegrity.ts').replace(/`dc-preview-item`/g, '')));
check('97. scope: no Home / UI / trigger / auto-acceptance wiring anywhere', ['apps/web/components/HomeDashboard.tsx', 'apps/web/components/HomeTimeline.tsx', 'apps/web/lib/homeCompletion.ts', 'apps/web/lib/homeMove.ts'].every((f) => !/recompos/i.test(read(f))));

console.log(allPassed ? '\nALL RECOMPOSITION INTEGRITY CHECKS PASSED' : '\nSOME RECOMPOSITION INTEGRITY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
