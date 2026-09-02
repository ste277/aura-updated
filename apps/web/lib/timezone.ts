/**
 * Resolves the correct UTC offset (in minutes) for a given IANA timezone on a
 * given date, correctly handling daylight saving time. This is why locations
 * outside India need a `timezone` (IANA name) rather than a fixed
 * `tzOffsetMinutes` — India has no DST, so a fixed offset happened to be safe
 * there, but it would be silently wrong for roughly half the year in places
 * like New York, London, or Sydney.
 *
 * Uses Intl.DateTimeFormat rather than a hand-maintained DST rules table —
 * the browser/Node's timezone database is authoritative and kept up to date
 * by the platform, not by us.
 */
export function resolveTzOffsetMinutes(ianaTimezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    timeZoneName: 'shortOffset',
  });

  const parts = dtf.formatToParts(date);
  const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';

  // offsetPart looks like "GMT+5:30", "GMT-4", "GMT+8"
  const match = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;

  return sign * (hours * 60 + minutes);
}

/**
 * The current minute-of-day (0-1439) *in the given IANA timezone*, not the
 * browser's own local timezone. This matters as soon as a user's browser and
 * their selected AuraSchedule location can differ — e.g. someone in California
 * checking Chennai's timings for family there. Using `new Date().getHours()`
 * would silently show the wrong "now" position on the dial in that case.
 */
export function getMinuteOfDayInTimezone(ianaTimezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return hour * 60 + minute;
}

/** Same idea as getMinuteOfDayInTimezone, but with second-level precision — used
 * for the live countdown, where whole-minute granularity would look static/broken
 * for most of each minute. */
export function getSecondOfDayInTimezone(ianaTimezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const second = parseInt(parts.find((p) => p.type === 'second')?.value ?? '0', 10);
  return hour * 3600 + minute * 60 + second;
}

export interface ZonedDateParts {
  year: number;
  /** 1-12, matching SolarInput's convention (not Date#getMonth's 0-11) */
  month: number;
  day: number;
  /** 0=Sunday..6=Saturday, matching Date#getDay and WeekdayIndex */
  weekday: number;
  /** "YYYY-MM-DD" in the given timezone */
  dateStr: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * The calendar date and weekday *in the given IANA timezone* for an instant.
 * The panchang windows for "today" hinge on these: the weekday selects the
 * Rahu Kalam / Gulika / Yama segments, and the date drives the ephemeris.
 * Deriving them from the browser clock (or worse, `toISOString()`, which is
 * UTC) computes the wrong day's windows whenever the user's browser timezone
 * and their selected city differ — or, for the UTC variant, for every user
 * east of Greenwich during their late evening.
 */
export function getDatePartsInTimezone(ianaTimezone: string, date: Date): ZonedDateParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  const weekday = WEEKDAY_INDEX[get('weekday')] ?? 0;
  const dateStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { year, month, day, weekday, dateStr };
}

/**
 * Converts a local date+time (as typed into a birth-data form, e.g. "1990-03-15"
 * + "14:30" in "Asia/Kolkata") to the actual UTC instant it represents. One
 * correction pass is sufficient in practice — offsets don't change within a
 * single day except exactly at a DST transition moment, which is an acceptable
 * edge case for a birth-time input.
 */
export function localDateTimeToUTC(dateStr: string, timeStr: string, ianaTimezone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  // First guess: treat the components as if they were UTC, then correct.
  const guessUTC = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMinutes = resolveTzOffsetMinutes(ianaTimezone, guessUTC);
  return new Date(guessUTC.getTime() - offsetMinutes * 60000);
}

/**
 * Planning Custom Location UX Fix -- a real IANA timezone check ("Choose a
 * valid time zone", not "any non-empty string"). Intl.DateTimeFormat throws
 * synchronously on an unrecognized zone name, which is the only reliable way
 * to validate one without a hand-maintained list -- but it is NOT, by
 * itself, strict enough: ICU also accepts legacy 3-4 letter zone
 * abbreviations without throwing (confirmed: 'IST', 'UTC', 'GMT', 'EST',
 * 'PST' all pass a bare try/catch), and 'IST' is exactly one of the
 * ambiguous inputs this fix exists to reject (Indian/Israel/Irish Standard
 * Time all share that abbreviation). Every real IANA identifier this app
 * uses follows "Area/Location" (e.g. 'Asia/Kolkata', 'America/New_York'),
 * so requiring a '/' rejects the abbreviation case while accepting every
 * genuine zone -- simpler and more robust than hand-maintaining a blocklist
 * of known-bad abbreviations. ('UTC+5:30', 'GMT+5:30', 'India' were already
 * rejected by the throw check alone -- Intl.DateTimeFormat itself throws on
 * those.) Reused server-side (isValidCustomLocation, apps/web/lib/cities.ts)
 * and client-side (the custom-location form), so both agree on exactly the
 * same definition of "valid".
 */
export function isValidIanaTimezone(timezone: string): boolean {
  if (!timezone || !timezone.includes('/')) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function formatUtcOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

export interface TimezoneOption {
  /** Canonical IANA identifier -- the only form ever persisted, e.g. 'Asia/Kolkata'. */
  id: string;
  /** Human-readable long name, e.g. 'India Standard Time'. Display only. */
  label: string;
  /** e.g. 'UTC+05:30', resolved for "now" (a search picker only needs to be
   * approximately right; DST correctness for a specific saved date is
   * resolveTzOffsetMinutes's job, used everywhere the offset actually
   * matters for a calculation). */
  offsetLabel: string;
}

function describeTimezone(id: string, at: Date): TimezoneOption | null {
  if (!isValidIanaTimezone(id)) return null;
  let label = id;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'long' }).formatToParts(at);
    label = parts.find((p) => p.type === 'timeZoneName')?.value ?? id;
  } catch {
    // Keep the id itself as a fallback label -- still usable, just less pretty.
  }
  return { id, label, offsetLabel: formatUtcOffsetLabel(resolveTzOffsetMinutes(id, at)) };
}

let cachedTimezoneOptions: TimezoneOption[] | null = null;

/** All runtime-supported IANA zones, described once and cached at module
 * scope -- Intl.supportedValuesOf('timeZone') plus one Intl.DateTimeFormat
 * call per zone is cheap in absolute terms (~400 zones) but not something to
 * redo on every keystroke of a search box. */
/**
 * Zones this app already stores/displays (see CITY_OPTIONS in
 * apps/web/lib/cities.ts) whose exact spelling this runtime's
 * Intl.supportedValuesOf('timeZone') does not itself list, because ICU
 * canonicalizes them to an older link/alias name (confirmed:
 * 'Asia/Kolkata' resolves through Intl to 'Asia/Calcutta', and only
 * 'Asia/Calcutta' appears in the runtime's own "supported values" list).
 * Both spellings are equally valid, functioning IANA identifiers -- this
 * app has always used the newer one (every CITY_OPTIONS India entry, and
 * therefore every existing India-based user's stored `timezone`), so it
 * must stay searchable and selectable as itself, never silently pushed
 * aside in favor of the runtime's own canonical alias. Duplicated as a
 * literal here (rather than importing CITY_OPTIONS from cities.ts) to avoid
 * a circular import -- cities.ts already imports isValidIanaTimezone from
 * this file.
 */
const SUPPLEMENTAL_TIMEZONE_IDS = ['Asia/Kolkata'];

function allTimezoneOptions(): TimezoneOption[] {
  if (cachedTimezoneOptions) return cachedTimezoneOptions;
  // Cast rather than widen this file's lib target -- Intl.supportedValuesOf
  // is well-supported at runtime (Node 18+, all evergreen browsers) but its
  // type declaration needs a newer `lib` than this monorepo's root
  // tsconfig.json (used by the pure/ts-node test suite) targets.
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const runtimeIds: string[] = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : [];
  const ids = Array.from(new Set([...runtimeIds, ...SUPPLEMENTAL_TIMEZONE_IDS]));
  const now = new Date();
  const options: TimezoneOption[] = [];
  for (const id of ids) {
    const described = describeTimezone(id, now);
    if (described) options.push(described);
  }
  cachedTimezoneOptions = options;
  return cachedTimezoneOptions;
}

/** Lowercased word segments of an id/label, splitting on '/', '_', and
 * spaces -- e.g. "America/Boa_Vista" -> ["america","boa","vista"]. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Searchable IANA timezone picker (Planning Custom Location UX Fix, section
 * 5: "strongly prefer replacing free-text entry with a searchable selector
 * if this can be done using... runtime timezone data without introducing a
 * large dependency"). No external timezone-name database -- Intl already
 * carries one. Matches against the IANA id first (so "Kolkata" finds
 * "Asia/Kolkata"), falling back to the long display label (so "India" finds
 * "Asia/Kolkata" via "India Standard Time") only when nothing matched by id.
 *
 * Matching is word-PREFIX, not raw substring: a query must start some
 * "/"/"_"-separated word segment (e.g. "kol" matches "Kolkata", "dub"
 * matches "Dubai"). A raw substring match would also surface nonsense --
 * confirmed while testing exactly the input this fix exists to guard
 * against: searching "IST" (the ambiguous abbreviation a confused user
 * might type) against a substring check matches "America/Boa_Vista" and
 * "Indian/Christmas" (both merely CONTAIN "ist" mid-word) alongside the one
 * genuinely relevant "Europe/Istanbul" (which actually starts with "Ist").
 * Word-prefix matching keeps the real result and drops the noise.
 */
export function searchTimezones(query: string, limit = 8): TimezoneOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const all = allTimezoneOptions();
  const idMatches = all.filter((option) => wordsOf(option.id).some((word) => word.startsWith(needle)));
  if (idMatches.length > 0) return idMatches.slice(0, limit);
  return all.filter((option) => wordsOf(option.label).some((word) => word.startsWith(needle))).slice(0, limit);
}
