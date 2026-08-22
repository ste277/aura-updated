import {
  defaultExpiresAt,
  DEFAULT_EXPIRY_AFTER_EVENT_DAYS,
  explanationSnapshotForScope,
  generatePublicMomentToken,
  isMomentExpired,
  resolvePublicOrigin,
  buildMomentShareUrl,
  toPublicAuraMoment,
} from '../apps/web/lib/auraMoments';
import type { AuraMoment } from '../apps/web/lib/db';

// resolvePublicOrigin()/buildMomentShareUrl() only read req.headers.get()
// and req.nextUrl.host, so a structurally-compatible plain object stands in
// for NextRequest here -- avoids this root-level test needing to resolve
// 'next/server' type declarations, which aren't reachable from ts-node's
// module resolution outside apps/web.
type FakeNextRequest = { headers: { get(key: string): string | null }; nextUrl: { host: string } };

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// PUBLIC TOKEN (brief section 4)
// ============================================================

const tokenA = generatePublicMomentToken();
const tokenB = generatePublicMomentToken();
check('generatePublicMomentToken produces a non-empty string', tokenA.length > 0);
check('generatePublicMomentToken produces a reasonably long, high-entropy token (24 bytes base64url ~= 32 chars)', tokenA.length >= 30);
check('generatePublicMomentToken is URL-safe (base64url charset only, no +/=)', /^[A-Za-z0-9_-]+$/.test(tokenA));
check('generatePublicMomentToken produces a DIFFERENT token on each call (not derived from fixed input)', tokenA !== tokenB);
check('generatePublicMomentToken is not decodable as JSON (not "Base64-encoded JSON as the token")', (() => {
  try {
    JSON.parse(Buffer.from(tokenA, 'base64url').toString('utf-8'));
    return false; // if this parses as JSON, the token likely encodes structured data -- exactly what section 4 forbids
  } catch {
    return true;
  }
})());

// ============================================================
// SHARE URL / PUBLIC ORIGIN
// ============================================================

function fakeRequest(headers: Record<string, string>, nextUrlHost: string): Parameters<typeof resolvePublicOrigin>[0] {
  const fake: FakeNextRequest = {
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    nextUrl: { host: nextUrlHost },
  };
  return fake as unknown as Parameters<typeof resolvePublicOrigin>[0];
}

check('resolvePublicOrigin prefers x-forwarded-host/proto over nextUrl (reverse-proxy safe)', resolvePublicOrigin(fakeRequest({ 'x-forwarded-host': 'aura.app', 'x-forwarded-proto': 'https' }, 'localhost:3001')) === 'https://aura.app');
check('resolvePublicOrigin falls back to the host header when no x-forwarded-host', resolvePublicOrigin(fakeRequest({ host: 'aura.app' }, 'localhost:3001')) === 'https://aura.app');
check('resolvePublicOrigin uses http for a bare localhost host with no forwarded proto', resolvePublicOrigin(fakeRequest({}, 'localhost:3001')) === 'http://localhost:3001');
check('buildMomentShareUrl builds a /moment/<token> URL under the resolved origin', buildMomentShareUrl(fakeRequest({ 'x-forwarded-host': 'aura.app', 'x-forwarded-proto': 'https' }, 'localhost'), 'abc123') === 'https://aura.app/moment/abc123');
check('buildMomentShareUrl never encodes any profile data into the URL -- it is exactly origin + /moment/ + the opaque token', buildMomentShareUrl(fakeRequest({ host: 'aura.app' }, 'x'), 'token-xyz') === 'https://aura.app/moment/token-xyz');

// ============================================================
// EXPIRY POLICY (brief section 16)
// ============================================================

const endAt = new Date('2026-10-18T18:04:00.000Z');
const expiresAt = defaultExpiresAt(endAt);
check(`defaultExpiresAt is exactly ${DEFAULT_EXPIRY_AFTER_EVENT_DAYS} days after endAt`, expiresAt.getTime() - endAt.getTime() === DEFAULT_EXPIRY_AFTER_EVENT_DAYS * 24 * 60 * 60 * 1000);
check('isMomentExpired is false when expiresAt is in the future', isMomentExpired({ expiresAt: new Date(Date.now() + 60_000) }) === false);
check('isMomentExpired is true when expiresAt is in the past', isMomentExpired({ expiresAt: new Date(Date.now() - 60_000) }) === true);
check('isMomentExpired is false when expiresAt is null (no expiry set)', isMomentExpired({ expiresAt: null }) === false);

// ============================================================
// EXPLANATION SNAPSHOT (brief section 3/17 -- server-templated, relationship-neutral)
// ============================================================

check('explanationSnapshotForScope(SHARED) mentions "both", not a specific relationship word', explanationSnapshotForScope('SHARED').toLowerCase().includes('both') && !/partner|spouse|boyfriend|girlfriend/i.test(explanationSnapshotForScope('SHARED')));
check('explanationSnapshotForScope(GENERAL) and (PERSONAL) are each distinct, non-empty strings', explanationSnapshotForScope('GENERAL').length > 0 && explanationSnapshotForScope('PERSONAL').length > 0 && explanationSnapshotForScope('GENERAL') !== explanationSnapshotForScope('PERSONAL'));

// ============================================================
// SECURITY: PublicAuraMoment DTO never leaks private/natal fields
// ============================================================

const fullMoment: AuraMoment = {
  id: 'internal-id-should-never-appear-publicly',
  ownerUserId: 'owner-user-id-should-never-appear-publicly',
  publicToken: 'the-token-itself-should-not-be-echoed-back',
  scope: 'SHARED',
  activityId: 'griha-pravesh',
  activityTitle: 'Griha Pravesh',
  activityIcon: '🏡',
  startAt: new Date('2026-10-18T04:42:00.000Z'),
  endAt: new Date('2026-10-18T06:04:00.000Z'),
  timezone: 'Asia/Kolkata',
  savedPersonId: 'saved-person-id-should-never-appear-publicly',
  sharedPersonDisplayName: 'Anu',
  senderDisplayName: 'Stephen',
  ratingLabel: 'STRONG_SHARED_FIT',
  explanationSnapshot: 'Aura found this timing to work well for both of you.',
  status: 'ACTIVE',
  responseState: null,
  respondedAt: null,
  createdAt: new Date('2026-08-22T00:00:00.000Z'),
  expiresAt: new Date('2026-10-25T00:00:00.000Z'),
};

const publicDto = toPublicAuraMoment(fullMoment);
const serialized = JSON.stringify(publicDto);

check('PublicAuraMoment DTO has EXACTLY the allow-listed keys (no accidental extra fields)', Object.keys(publicDto).sort().join(',') === ['activityTitle', 'activityIcon', 'startAt', 'endAt', 'timezone', 'senderDisplayName', 'sharedPersonDisplayName', 'scope', 'ratingLabel', 'explanationSnapshot', 'responseState'].sort().join(','));
check('PublicAuraMoment DTO never contains the internal id', !serialized.includes('internal-id-should-never-appear-publicly'));
check('PublicAuraMoment DTO never contains ownerUserId', !serialized.includes('owner-user-id-should-never-appear-publicly') && !('ownerUserId' in publicDto));
check('PublicAuraMoment DTO never echoes back the publicToken itself', !serialized.includes('the-token-itself-should-not-be-echoed-back') && !('publicToken' in publicDto));
check('PublicAuraMoment DTO never contains savedPersonId (only the safe display name)', !serialized.includes('saved-person-id-should-never-appear-publicly') && !('savedPersonId' in publicDto));
check('PublicAuraMoment DTO never contains any birth/natal field name at all', !/birthDate|birthTime|birthTimezone|birthLatitude|birthLongitude|janmaNakshatra|janmaRashi|natalNakshatraIndex/i.test(serialized));
check('PublicAuraMoment DTO does carry the safe display fields the brief explicitly allows', publicDto.senderDisplayName === 'Stephen' && publicDto.sharedPersonDisplayName === 'Anu' && publicDto.activityTitle === 'Griha Pravesh');
check('PublicAuraMoment DTO dates are ISO strings, not raw Date objects (JSON-safe)', typeof publicDto.startAt === 'string' && typeof publicDto.endAt === 'string');

console.log(allPassed ? '\nALL AURA MOMENT CHECKS PASSED' : '\nSOME AURA MOMENT CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
