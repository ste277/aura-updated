// AURA DB3 -- GET /api/daily-briefing/today?date=YYYY-MM-DD (historical
// extension of the DB2 route). Run with: npx ts-node
// test/dailyBriefingHistoricalApi.test.ts (needs DATABASE_URL pointed at
// a disposable local Postgres with migrations applied).
import { GET as route } from '../apps/web/app/api/daily-briefing/today/route';
import { upsertUserByEmail, updateBirthProfile, beginTransaction } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { getDatePartsInTimezone, addDaysToDateStr } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function req(tok: string | null, url: string): any {
  return {
    cookies: { get: (n: string) => (tok && n === 'as_session' ? { value: tok } : undefined) },
    headers: new Headers(),
    nextUrl: new URL(url),
  };
}

async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

async function main() {
  const TZ_IST = 'Asia/Kolkata';
  const TZ_NEG = 'America/New_York';

  const ist = await upsertUserByEmail({ email: 'test-db3-ist@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ_IST });
  await updateBirthProfile(ist.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ_IST });
  const istTok = createSessionToken(ist.id, ist.email);

  const neg = await upsertUserByEmail({ email: 'test-db3-neg@example.com', cityName: 'New York', latitude: 40.7128, longitude: -74.006, timezone: TZ_NEG });
  await updateBirthProfile(neg.id, { birthDate: '1985-12-01', birthTime: '14:45', birthCityName: 'New York', birthLatitude: 40.7128, birthLongitude: -74.006, birthTimezone: TZ_NEG });
  const negTok = createSessionToken(neg.id, neg.email);

  const other = await upsertUserByEmail({ email: 'test-db3-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ_IST });
  await updateBirthProfile(other.id, { birthDate: '1975-03-02', birthTime: '04:10', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ_IST });
  const otherTok = createSessionToken(other.id, other.email);

  const istToday = getDatePartsInTimezone(TZ_IST, new Date()).dateStr;
  const istYesterday = addDaysToDateStr(istToday, -1);
  const negToday = getDatePartsInTimezone(TZ_NEG, new Date()).dateStr;

  const BASE = 'http://localhost/api/daily-briefing/today';

  try {
    // ---- 1. No-parameter backward compatibility: identical to DB2 behavior ----
    const r1 = await route(req(istTok, BASE));
    const b1 = await r1.json();
    check('1. no ?date= -> 200 OK, resolves to the user\'s own current local date (unchanged DB2 behavior)', r1.status === 200 && b1.status === 'OK' && b1.briefing.localDate === istToday);

    // ---- 2. Authenticated historical-date request (yesterday) ----
    const r2 = await route(req(istTok, `${BASE}?date=${istYesterday}`));
    const b2 = await r2.json();
    check('2. ?date=yesterday -> 200 OK, briefing.localDate matches the EXACT requested date', r2.status === 200 && b2.status === 'OK' && b2.briefing.localDate === istYesterday);
    check('2. today\'s and yesterday\'s briefings are genuinely different responses (different referenceInstantUTC)', b1.briefing.referenceInstantUTC !== b2.briefing.referenceInstantUTC);

    // ---- 3. Missing authentication ----
    const r3 = await route(req(null, BASE));
    check('3. no session -> 401 AUTH_REQUIRED (unchanged)', r3.status === 401 && (await r3.json()).status === 'AUTH_REQUIRED');

    // ---- 4. Cross-user data isolation (historical date) ----
    const r4a = await route(req(istTok, `${BASE}?date=${istYesterday}`));
    const r4b = await route(req(otherTok, `${BASE}?date=${istYesterday}`));
    const b4a = await r4a.json();
    const b4b = await r4b.json();
    check('4. the SAME requested historical date for two different users returns two different natal/evidence results', b4a.briefing.natalMoonSign !== b4b.briefing.natalMoonSign || b4a.briefing.natalNakshatra !== b4b.briefing.natalNakshatra);

    // ---- 5. Strict YYYY-MM-DD validation ----
    const r5a = await route(req(istTok, `${BASE}?date=2026-1-5`)); // not zero-padded
    check('5. non-zero-padded date ("2026-1-5") -> 400 INVALID_INPUT/INVALID_LOCAL_DATE', r5a.status === 400 && (await r5a.json()).reason === 'INVALID_LOCAL_DATE');
    const r5b = await route(req(istTok, `${BASE}?date=not-a-date`));
    check('5. garbage date string -> 400 INVALID_INPUT/INVALID_LOCAL_DATE', r5b.status === 400 && (await r5b.json()).reason === 'INVALID_LOCAL_DATE');
    const r5c = await route(req(istTok, `${BASE}?date=${istYesterday}T00:00:00Z`)); // timestamp, not a bare date
    check('5. a full timestamp instead of a bare date -> 400 INVALID_INPUT/INVALID_LOCAL_DATE', r5c.status === 400 && (await r5c.json()).reason === 'INVALID_LOCAL_DATE');

    // ---- 6. Impossible (calendrically unreal) dates ----
    const r6a = await route(req(istTok, `${BASE}?date=2026-02-30`)); // Feb 30 does not exist
    check('6. calendrically impossible date (2026-02-30) -> 400 INVALID_INPUT/INVALID_LOCAL_DATE', r6a.status === 400 && (await r6a.json()).reason === 'INVALID_LOCAL_DATE');
    const r6b = await route(req(istTok, `${BASE}?date=2026-13-01`)); // month 13
    check('6. impossible month (2026-13-01) -> 400 INVALID_INPUT/INVALID_LOCAL_DATE', r6b.status === 400 && (await r6b.json()).reason === 'INVALID_LOCAL_DATE');

    // ---- 7. Future dates rejected ----
    const futureDate = addDaysToDateStr(istToday, 1);
    const r7 = await route(req(istTok, `${BASE}?date=${futureDate}`));
    const b7 = await r7.json();
    check('7. tomorrow (a valid, real, but FUTURE date) -> 400 INVALID_INPUT/DATE_OUT_OF_RANGE, never silently accepted', r7.status === 400 && b7.status === 'INVALID_INPUT' && b7.reason === 'DATE_OUT_OF_RANGE');
    check('7. the out-of-range response states the actual supported max/min date (not a vague error)', b7.maxDate === istToday);

    // ---- 8. Historical-range boundary ----
    const r8a = await route(req(istTok, `${BASE}?date=${addDaysToDateStr(istToday, -7)}`)); // exactly at the documented bound
    check('8. exactly 7 days back (the documented bound) -> 200 OK (inclusive boundary)', r8a.status === 200 && (await r8a.json()).status === 'OK');
    const r8b = await route(req(istTok, `${BASE}?date=${addDaysToDateStr(istToday, -8)}`)); // one day beyond the bound
    const b8b = await r8b.json();
    check('8. 8 days back (one past the documented bound) -> 400 INVALID_INPUT/DATE_OUT_OF_RANGE', r8b.status === 400 && b8b.reason === 'DATE_OUT_OF_RANGE');

    // ---- 9. IST and negative-offset timezones ----
    const r9 = await route(req(negTok, BASE));
    const b9 = await r9.json();
    check('9. a negative-offset (America/New_York) user\'s no-param request resolves via THEIR OWN timezone, not the server/UTC default', r9.status === 200 && b9.briefing.localDate === negToday);
    const r9y = await route(req(negTok, `${BASE}?date=${addDaysToDateStr(negToday, -1)}`));
    check('9. a negative-offset user\'s historical date resolves correctly too', r9y.status === 200 && (await r9y.json()).briefing.localDate === addDaysToDateStr(negToday, -1));

    // ---- 10. Local midnight rollover (date range bound uses the USER's own "today", not a fixed server instant) ----
    const r10 = await route(req(istTok, `${BASE}?date=${istToday}`)); // today itself, the upper edge of the range
    check('10. the user\'s own current local date itself (the upper range edge) is always accepted, never rejected as "future"', r10.status === 200 && (await r10.json()).status === 'OK');

    // ---- 11. Typed unavailable response (incomplete profile) still works with ?date= ----
    const incomplete = await upsertUserByEmail({ email: 'test-db3-incomplete@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ_IST });
    const incompleteTok = createSessionToken(incomplete.id, incomplete.email);
    const r11 = await route(req(incompleteTok, `${BASE}?date=${istYesterday}`));
    const b11 = await r11.json();
    check('11. incomplete birth profile + historical date -> still 200 UNAVAILABLE/INCOMPLETE_BIRTH_PROFILE (not an error, not fabricated)', r11.status === 200 && b11.status === 'UNAVAILABLE' && b11.reason === 'INCOMPLETE_BIRTH_PROFILE');
    await sql(`DELETE FROM "User" WHERE email = $1`, [incomplete.email]);

    // ---- 12. Private cache headers preserved on every response shape ----
    check('12. OK response has Cache-Control: private, no-store', (r1.headers.get('Cache-Control') || '').includes('no-store'));
    check('12. INVALID_INPUT (400) response ALSO has Cache-Control: private, no-store', (r5a.headers.get('Cache-Control') || '').includes('no-store'));
    check('12. UNAVAILABLE response ALSO has Cache-Control: private, no-store', (r11.headers.get('Cache-Control') || '').includes('no-store'));
  } finally {
    await sql(`DELETE FROM "User" WHERE email = ANY($1)`, [[ist.email, neg.email, other.email]]).catch(() => {});
  }

  if (!allPassed) { console.error('SOME DB3 HISTORICAL API CHECKS FAILED'); process.exit(1); }
  console.log('ALL DB3 HISTORICAL API CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
