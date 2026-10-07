/**
 * Birth Data Correctness B2 -- the ONE canonicalization of a civil birth date for storage.
 *
 * THE CONTRACT (unchanged since migration 0006). `User.birthDate` / `SavedPerson.birthDate` are `timestamptz` columns that hold a UTC-MIDNIGHT SURROGATE for
 * the CIVIL birth date: the civil date 1990-06-15 is stored as the instant 1990-06-15T00:00:00.000Z. It is NOT the birth instant. Every reader rebuilds the civil
 * date from the UTC date part (`formatUTCDateString` / `.toISOString().slice(0, 10)`) and derives the real astronomical instant from that civil date + `birthTime` +
 * `birthTimezone` (`localDateTimeToUTC`). The surrogate is therefore only correct if the writer stores exactly UTC midnight.
 *
 * THE DEFECT THIS CLOSES. The three writers handed PostgreSQL the bare string '1990-06-15'. PostgreSQL resolves a date-only string in the SERVER SESSION TimeZone, so
 * on an east-of-UTC server (Asia/Kolkata, Pacific/Auckland, ...) the stored instant was local midnight = the PREVIOUS UTC day (1990-06-14T18:30Z), every reader then
 * recovered the wrong civil date, and the natal context, the timing search and the constructed day changed with the database server's timezone.
 *
 * THE FIX. The string handed to the database carries an explicit UTC designator, so its interpretation cannot depend on the session TimeZone, the application's
 * process TZ or the browser. It is pure string construction: no `Date`, no `Intl`, no clock, no environment. The calendar check is plain arithmetic (never
 * `new Date('YYYY-MM-DD')`, which would silently roll 2026-02-30 into March and map years 0-99 to 1900-1999). An input that is not a real civil date is REJECTED, never
 * normalized -- the same outcome as before (PostgreSQL refused such a value), only earlier and deterministic.
 */

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** 'YYYY-MM-DD' -> 'YYYY-MM-DDT00:00:00.000Z': the explicit UTC-midnight surrogate for that civil date. Throws on anything that is not a real civil date. */
export function canonicalizeCivilBirthDate(civilDate: string): string {
  const match = typeof civilDate === 'string' ? CIVIL_DATE.exec(civilDate) : null;
  if (!match) throw new TypeError('birthDate must be a civil date in YYYY-MM-DD form.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw new RangeError('birthDate must be a real calendar date.');
  return `${civilDate}T00:00:00.000Z`;
}
