import { getPanchangForDate } from '../packages/panchang/src/panchangDay';
import { getDatePartsInTimezone, isValidCalendarDateString, resolveTzOffsetMinutes } from '../packages/panchang/src/localDate';
import { getKarana, getNakshatra, getTithi, getVara, getYoga } from '../packages/vedic/src/panchangElements';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennai = { latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' };
const newYork = { latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' };
const tokyo = { latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' };

// ============================================================
// A. CURRENT BEHAVIOUR -- pinned "now" reproduces the exact pre-existing
// /api/panchang/today calculation (same reference instant, same functions),
// proving getPanchangForDate() is a true delegation, not a second
// implementation.
// ============================================================

const pinnedNow = new Date('2026-07-28T06:45:00.000Z'); // 12:15 PM IST
const todayLocal = getDatePartsInTimezone(chennai.timezone, pinnedNow);
check('Pinned instant resolves to the expected Chennai local date', todayLocal.dateStr === '2026-07-28');

const directTithi = getTithi(pinnedNow);
const directNakshatra = getNakshatra(pinnedNow);
const directYoga = getYoga(pinnedNow);
const directKarana = getKarana(pinnedNow);

const todayResult = getPanchangForDate({
  localDate: todayLocal.dateStr,
  ...chennai,
  referenceInstant: pinnedNow,
});

check('getPanchangForDate(referenceInstant=now).tithi matches calling getTithi(now) directly', todayResult.panchanga.tithi.name === directTithi.name);
check('getPanchangForDate(referenceInstant=now).nakshatra matches calling getNakshatra(now) directly', todayResult.panchanga.nakshatra.name === directNakshatra.name);
check('getPanchangForDate(referenceInstant=now).yoga matches calling getYoga(now) directly', todayResult.panchanga.yoga.name === directYoga.name);
check('getPanchangForDate(referenceInstant=now).karana matches calling getKarana(now) directly', todayResult.panchanga.karana.name === directKarana.name);
check('Paksha is derived the same way the legacy /today route computed it (tithi index <= 15 -> Shukla)', todayResult.panchanga.tithi.paksha === (directTithi.index <= 15 ? 'Shukla' : 'Krishna'));
check('Tithi endsAt is a valid future ISO instant (the TITHI transition search now works -- see completion report)', todayResult.panchanga.tithi.endsAt !== null && new Date(todayResult.panchanga.tithi.endsAt!).getTime() > pinnedNow.getTime());

// Pinned against the ephemeris.test.ts fixture (Chennai 2026-07-28, verified
// against live sunrise/sunset sources): sunrise 05:52, sunset 18:39 IST,
// and the exact same 5 window times that fixture prints.
const pinnedDay = getPanchangForDate({ localDate: '2026-07-28', ...chennai });
const toIstClock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
check('Sunrise matches the verified ephemeris.test.ts fixture (05:52 IST)', toIstClock(pinnedDay.solar.sunrise) === '05:52');
check('Sunset matches the verified ephemeris.test.ts fixture (18:39 IST)', toIstClock(pinnedDay.solar.sunset) === '18:39');
const windowByType = (type: string) => pinnedDay.windows.find((w) => w.type === type)!;
check('Brahma matches the verified fixture (04:16-05:04 IST)', toIstClock(windowByType('BRAHMA').start) === '04:16' && toIstClock(windowByType('BRAHMA').end) === '05:04');
check('Abhijit matches the verified fixture (11:50-12:42 IST)', toIstClock(windowByType('ABHIJIT').start) === '11:50' && toIstClock(windowByType('ABHIJIT').end) === '12:42');
check('Rahu Kalam matches the verified fixture (15:27-17:03 IST)', toIstClock(windowByType('RAHU_KALAM').start) === '15:27' && toIstClock(windowByType('RAHU_KALAM').end) === '17:03');
check('Gulika matches the verified fixture (12:16-13:51 IST)', toIstClock(windowByType('GULIKA').start) === '12:16' && toIstClock(windowByType('GULIKA').end) === '13:51');
check('Yama matches the verified fixture (09:04-10:40 IST)', toIstClock(windowByType('YAMA').start) === '09:04' && toIstClock(windowByType('YAMA').end) === '10:40');

// ============================================================
// B. ARBITRARY DATE -- future and past, no hidden "today" dependency.
// ============================================================

const futureDate = getPanchangForDate({ localDate: '2027-03-10', ...newYork });
check('Future date does not throw and echoes the requested date exactly', futureDate.date === '2027-03-10');
check('Future date produces a valid Tithi', futureDate.panchanga.tithi.name.length > 0);

const pastDate = getPanchangForDate({ localDate: '2020-01-01', ...chennai });
check('Past date does not throw and echoes the requested date exactly', pastDate.date === '2020-01-01');
check('Past date produces a valid Nakshatra', pastDate.panchanga.nakshatra.name.length > 0);

// ============================================================
// C. LOCATION -- two different locations, same date, independent results.
// ============================================================

const chennaiOnDate = getPanchangForDate({ localDate: '2026-12-21', ...chennai });
const newYorkOnDate = getPanchangForDate({ localDate: '2026-12-21', ...newYork });
check('Two different locations on the same date produce different sunrise clock times', toIstClock(chennaiOnDate.solar.sunrise) !== new Date(newYorkOnDate.solar.sunrise).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }));
check('Location is echoed back per-request, not shared/global state', chennaiOnDate.location.timezone === 'Asia/Kolkata' && newYorkOnDate.location.timezone === 'America/New_York');
check('Chennai and New York produce different Abhijit window instants for the same calendar date (independent solar noon)', windowStart(chennaiOnDate, 'ABHIJIT') !== windowStart(newYorkOnDate, 'ABHIJIT'));

// ============================================================
// D. TIMEZONE -- positive offset, negative offset, DST, no off-by-one shift.
// ============================================================

check('Positive UTC offset (IST, +5:30) resolves correctly', resolveTzOffsetMinutes('Asia/Kolkata', new Date('2026-07-28T00:00:00Z')) === 330);
check('Negative UTC offset (New York, EST, -5:00) resolves correctly', resolveTzOffsetMinutes('America/New_York', new Date('2027-01-15T00:00:00Z')) === -300);
check('Negative UTC offset shifts for DST (New York, EDT, -4:00 in July)', resolveTzOffsetMinutes('America/New_York', new Date('2026-07-15T00:00:00Z')) === -240);

const nyPreDst = getPanchangForDate({ localDate: '2027-03-10', ...newYork }); // before 2027 DST start (2nd Sunday of March = Mar 14)
const nyPostDst = getPanchangForDate({ localDate: '2027-03-20', ...newYork }); // after DST start
const nyPreDstOffset = resolveTzOffsetMinutes(newYork.timezone, new Date(nyPreDst.solar.sunrise));
const nyPostDstOffset = resolveTzOffsetMinutes(newYork.timezone, new Date(nyPostDst.solar.sunrise));
check('getPanchangForDate results span a real DST transition (EST before, EDT after)', nyPreDstOffset === -300 && nyPostDstOffset === -240);
// Local sunrise clock time should stay in a plausible ~6-7am band across the
// transition (a UTC-hour comparison here would be a coincidence-prone proxy
// -- e.g. 11:16 UTC and 11:00 UTC both round to hour 11 despite the correct
// 1-hour DST shift, which is exactly what happens for this date pair).
const nyPreDstLocalMinute = new Date(nyPreDst.solar.sunrise).getUTCHours() * 60 + new Date(nyPreDst.solar.sunrise).getUTCMinutes() + nyPreDstOffset;
const nyPostDstLocalMinute = new Date(nyPostDst.solar.sunrise).getUTCHours() * 60 + new Date(nyPostDst.solar.sunrise).getUTCMinutes() + nyPostDstOffset;
check('Local sunrise clock time is plausible both before and after the DST transition (roughly 6-7am)', nyPreDstLocalMinute >= 360 && nyPreDstLocalMinute <= 420 && nyPostDstLocalMinute >= 360 && nyPostDstLocalMinute <= 420);

// No off-by-one date shift: request a date far east (Tokyo, UTC+9) and confirm
// the computed sunrise instant, converted back to Tokyo local time, lands on
// the exact requested calendar date -- not the previous or next day.
const tokyoDay = getPanchangForDate({ localDate: '2026-01-01', ...tokyo });
check('Requested date is echoed exactly (Tokyo, UTC+9, New Year\'s Day)', tokyoDay.date === '2026-01-01');
const tokyoSunriseLocalDate = getDatePartsInTimezone(tokyo.timezone, new Date(tokyoDay.solar.sunrise));
check('Computed sunrise for the requested date falls on that same local calendar date (no shift to Dec 31 or Jan 2)', tokyoSunriseLocalDate.dateStr === '2026-01-01');

// A UTC- timezone late in the local day: request Dec 31 for New York and
// confirm windows land on Dec 31 local, not Jan 1.
const nyYearEnd = getPanchangForDate({ localDate: '2026-12-31', ...newYork });
const nyYearEndSunsetLocalDate = getDatePartsInTimezone(newYork.timezone, new Date(nyYearEnd.solar.sunset));
check('UTC- timezone: requested date does not silently shift forward a day', nyYearEndSunsetLocalDate.dateStr === '2026-12-31');

check('isValidCalendarDateString accepts a real date', isValidCalendarDateString('2026-08-21'));
check('isValidCalendarDateString rejects a non-existent calendar date (Feb 30)', !isValidCalendarDateString('2026-02-30'));
check('isValidCalendarDateString rejects a malformed string', !isValidCalendarDateString('08/21/2026'));
check('getPanchangForDate throws a clear error for an invalid date string rather than silently shifting', (() => {
  try { getPanchangForDate({ localDate: '2026-02-30', ...chennai }); return false; } catch { return true; }
})());

// ============================================================
// E. WINDOWS -- containment, overlap preservation.
// ============================================================

function windowStart(day: ReturnType<typeof getPanchangForDate>, type: string): number {
  return new Date(day.windows.find((w) => w.type === type)!.start).getTime();
}
function windowEnd(day: ReturnType<typeof getPanchangForDate>, type: string): number {
  return new Date(day.windows.find((w) => w.type === type)!.end).getTime();
}
const sunriseMs = new Date(pinnedDay.solar.sunrise).getTime();
const sunsetMs = new Date(pinnedDay.solar.sunset).getTime();

check('sunrise < sunset', sunriseMs < sunsetMs);
check('Rahu Kalam is contained within daytime (between sunrise and sunset)', windowStart(pinnedDay, 'RAHU_KALAM') >= sunriseMs && windowEnd(pinnedDay, 'RAHU_KALAM') <= sunsetMs);
check('Yama is contained within daytime', windowStart(pinnedDay, 'YAMA') >= sunriseMs && windowEnd(pinnedDay, 'YAMA') <= sunsetMs);
check('Gulika is contained within daytime', windowStart(pinnedDay, 'GULIKA') >= sunriseMs && windowEnd(pinnedDay, 'GULIKA') <= sunsetMs);
check('Abhijit is centered around solar midday (contains sunrise+sunset midpoint)', windowStart(pinnedDay, 'ABHIJIT') <= (sunriseMs + sunsetMs) / 2 && windowEnd(pinnedDay, 'ABHIJIT') >= (sunriseMs + sunsetMs) / 2);
check('Brahma Muhurta ends before (or at) sunrise', windowEnd(pinnedDay, 'BRAHMA') <= sunriseMs);
check('All 5 currently-supported windows are present (BRAHMA, ABHIJIT, RAHU_KALAM, GULIKA, YAMA)', new Set(pinnedDay.windows.map((w) => w.type)).size === 5
  && ['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'GULIKA', 'YAMA'].every((t) => pinnedDay.windows.some((w) => w.type === t)));

// Overlapping windows remain separate, independent entries -- not flattened
// into a mutually-exclusive timeline. 2026-07-28 (Tuesday) is a real example:
// Abhijit 11:50-12:42 and Gulika 12:16-13:51 genuinely overlap (12:16-12:42).
const abhijitWindow = pinnedDay.windows.find((w) => w.type === 'ABHIJIT')!;
const gulikaWindow = pinnedDay.windows.find((w) => w.type === 'GULIKA')!;
const genuinelyOverlaps = new Date(abhijitWindow.start).getTime() < new Date(gulikaWindow.end).getTime()
  && new Date(gulikaWindow.start).getTime() < new Date(abhijitWindow.end).getTime();
check('Abhijit and Gulika genuinely overlap on this fixture date (test premise check)', genuinelyOverlaps);
check('Both overlapping windows (Abhijit, Gulika) remain present as independent entries, not merged/deduplicated', pinnedDay.windows.filter((w) => w.type === 'ABHIJIT' || w.type === 'GULIKA').length === 2);
check('Each overlapping window keeps its own distinct start/end (not collapsed to a shared span)', abhijitWindow.start !== gulikaWindow.start && abhijitWindow.end !== gulikaWindow.end);

// ============================================================
// F. PANCHANGA -- all five elements present, Vara matches local calendar day.
// ============================================================

check('Tithi is present', pinnedDay.panchanga.tithi.name.length > 0);
check('Nakshatra is present', pinnedDay.panchanga.nakshatra.name.length > 0);
check('Yoga is present', pinnedDay.panchanga.yoga.name.length > 0);
check('Karana is present', pinnedDay.panchanga.karana.name.length > 0);
check('Vara is present', pinnedDay.panchanga.vara.length > 0);
// 2026-07-28 is a Tuesday (verified via external calendar).
check('Vara matches the local calendar day (2026-07-28 is a Tuesday -> Mangalavara)', pinnedDay.panchanga.vara === getVara(2) && pinnedDay.panchanga.vara === 'Mangalavara');
// Cross-check Vara against getDatePartsInTimezone's own weekday derivation for the same date.
const pinnedDateParts = getDatePartsInTimezone(chennai.timezone, new Date(`${pinnedDay.date}T12:00:00+05:30`));
check('Vara is consistent with getDatePartsInTimezone\'s weekday for the same local date', getVara(pinnedDateParts.weekday) === pinnedDay.panchanga.vara);

console.log(allPassed ? '\nALL PANCHANG DAY CHECKS PASSED' : '\nSOME PANCHANG DAY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
