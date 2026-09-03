import {
  Body,
  AstroTime,
  Ecliptic,
  GeoVector,
  MoonPhase,
  SearchMoonPhase,
} from 'astronomy-engine';

export const NAKSHATRA_NAMES = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra',
  'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni',
  'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha',
  'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
];

export const TITHI_NAMES = [
  'Shukla Pratipada', 'Shukla Dvitiya', 'Shukla Tritiya', 'Shukla Chaturthi', 'Shukla Panchami',
  'Shukla Shasthi', 'Shukla Saptami', 'Shukla Ashtami', 'Shukla Navami', 'Shukla Dashami',
  'Shukla Ekadashi', 'Shukla Dvadashi', 'Shukla Trayodashi', 'Shukla Chaturdashi', 'Purnima',
  'Krishna Pratipada', 'Krishna Dvitiya', 'Krishna Tritiya', 'Krishna Chaturthi', 'Krishna Panchami',
  'Krishna Shasthi', 'Krishna Saptami', 'Krishna Ashtami', 'Krishna Navami', 'Krishna Dashami',
  'Krishna Ekadashi', 'Krishna Dvadashi', 'Krishna Trayodashi', 'Krishna Chaturdashi', 'Amavasya',
];

export const YOGA_NAMES = [
  'Vishkambha', 'Priti', 'Ayushman', 'Saubhagya', 'Shobhana', 'Atiganda', 'Sukarma', 'Dhriti',
  'Shula', 'Ganda', 'Vriddhi', 'Dhruva', 'Vyaghapata', 'Harshana', 'Vajra', 'Siddhi',
  'Vyatipata', 'Variyan', 'Parigha', 'Shiva', 'Siddha', 'Sadhya', 'Shubha', 'Shukla',
  'Brahma', 'Indra', 'Vaidhriti',
];

export const KARANA_NAMES = [
  'Bava', 'Balava', 'Kaulava', 'Taitila', 'Garaja', 'Vanija', 'Vishti',
  'Shakuni', 'Chatushpada', 'Naga', 'Kintughna',
];

/** 0=Sunday..6=Saturday, matching WeekdayIndex (packages/panchang/src/windows.ts)
 * and ZonedDateParts.weekday (apps/web/lib/timezone.ts's getDatePartsInTimezone). */
export const VARA_NAMES = [
  'Ravivara', 'Somavara', 'Mangalavara', 'Budhavara', 'Guruvara', 'Shukravara', 'Shanivara',
];

export function getVara(weekday: number): string {
  return VARA_NAMES[((weekday % 7) + 7) % 7];
}

/** Lahiri Ayanamsa approximation in degrees */
export function lahiriAyanamsa(date: Date): number {
  const astroTime = new AstroTime(date);
  const t = (astroTime.ut - 51544.5) / 36525;
  return 23.85 + 1.4 * t;
}

/**
 * Small bounded memo for getSiderealLongitude(): computing Tithi, Nakshatra,
 * Yoga, and Karana all at the same instant (as getPanchangForDate() does)
 * calls this 7 times for only 2 distinct (body, instant) pairs -- Moon and
 * Sun's position don't change between those calls. GeoVector/Ecliptic is the
 * genuinely expensive part of each Panchanga lookup, so caching it here
 * benefits every caller (getTithi/getNakshatra/getYoga/getKarana, and
 * therefore muhurtaEngine.ts, dailyAssistant.ts, timingSearch.ts, and the
 * panchang API routes) without any of them needing to change. Pure cache:
 * same formula, same output, just avoids redundant recomputation. Bounded
 * so long-running processes (findNextTransition's binary search visits many
 * distinct instants) don't grow this unboundedly.
 */
const SIDEREAL_LONGITUDE_CACHE_LIMIT = 64;
const siderealLongitudeCache = new Map<string, number>();

/** Get Sidereal Longitude of Moon/Sun */
export function getSiderealLongitude(body: Body, date: Date): number {
  const cacheKey = `${body}:${date.getTime()}`;
  const cached = siderealLongitudeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const astroTime = new AstroTime(date);
  const vec = GeoVector(body, astroTime, true);
  const ecl = Ecliptic(vec);
  const ayanamsa = lahiriAyanamsa(date);
  const longitude = (ecl.elon - ayanamsa + 360) % 360;

  if (siderealLongitudeCache.size >= SIDEREAL_LONGITUDE_CACHE_LIMIT) {
    const oldestKey = siderealLongitudeCache.keys().next().value;
    if (oldestKey !== undefined) siderealLongitudeCache.delete(oldestKey);
  }
  siderealLongitudeCache.set(cacheKey, longitude);
  return longitude;
}

export function getTithi(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const sunDeg = getSiderealLongitude(Body.Sun, date);
  const diff = (moonDeg - sunDeg + 360) % 360;
  const zeroIndex = Math.floor(diff / 12);
  const index = zeroIndex + 1;
  return { index, name: TITHI_NAMES[zeroIndex] ?? `Tithi ${index}` };
}

export function getNakshatra(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const span = 360 / 27; // 13.3333°
  const zeroIndex = Math.floor(moonDeg / span);
  const index = zeroIndex + 1;
  return { index, name: NAKSHATRA_NAMES[zeroIndex] ?? `Nakshatra ${index}` };
}

export function getYoga(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const sunDeg = getSiderealLongitude(Body.Sun, date);
  const sum = (moonDeg + sunDeg) % 360;
  const span = 360 / 27;
  const zeroIndex = Math.floor(sum / span);
  const index = zeroIndex + 1;
  return { index, name: YOGA_NAMES[zeroIndex] ?? `Yoga ${index}` };
}

export function getKarana(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const sunDeg = getSiderealLongitude(Body.Sun, date);
  const diff = (moonDeg - sunDeg + 360) % 360;
  const halfTithi = Math.floor(diff / 6) + 1; // 1 to 60 half-tithis

  // Classical Karana sequence assignment:
  // Half-Tithi 1: Kintughna
  // Half-Tithis 2-57: Cycle of 7 movable karanas (Bava through Vishti) 8 times
  // Half-Tithi 58: Shakuni
  // Half-Tithi 59: Chatushpada
  // Half-Tithi 60: Naga
  let name = '';
  if (halfTithi === 1) {
    name = 'Kintughna';
  } else if (halfTithi >= 58) {
    const fixedIndex = halfTithi - 58; // 0=Shakuni, 1=Chatushpada, 2=Naga
    name = KARANA_NAMES[7 + fixedIndex];
  } else {
    const movableIndex = (halfTithi - 2) % 7;
    name = KARANA_NAMES[movableIndex];
  }

  return { index: halfTithi, name };
}

/**
 * Finds exact next transition date.
 * TITHI uses SearchMoonPhase on the Moon-Sun elongation angle (the same
 * quantity getTithi() derives its index from -- ayanamsha subtracts equally
 * from both bodies' sidereal longitudes, so the *difference* between them,
 * and therefore every tithi boundary, is ayanamsha-invariant; SearchMoonPhase
 * finds the same physical instant using tropical longitudes directly, which
 * is both simpler and avoids relying on a sidereal degree target).
 * NAKSHATRA uses targeted binary search over Moon sidereal longitude.
 * KARANA reuses the exact same Moon-Sun elongation quantity as TITHI (a
 * Karana is a half-Tithi -- getKarana() derives its index from the identical
 * `diff` this function's TITHI branch searches on, just partitioned into 6°
 * steps instead of 12°), so it reuses SearchMoonPhase the same way, stepped
 * to the next 6° boundary.
 * YOGA searches a DIFFERENT quantity -- (moonDeg + sunDeg) % 360, not the
 * Moon-Sun difference SearchMoonPhase measures -- so it cannot reuse
 * SearchMoonPhase; it uses the same targeted-binary-search technique as
 * NAKSHATRA instead, tracking the sidereal sum rather than the Moon's own
 * longitude.
 *
 * (SearchMoonPhase replaced a prior SearchRelativeLongitude(Body.Moon, ...)
 * call here that threw unconditionally -- astronomy-engine's
 * SearchRelativeLongitude only supports planets relative to the Sun, not the
 * Moon. This was a latent bug: findNextTransition(date, 'TITHI') has never
 * successfully returned a value. It went unnoticed because its only caller,
 * /api/panchang/today, feeds a component (TodayOverview) that isn't mounted
 * anywhere in the app today. Fixed here since getPanchangForDate() needs a
 * working Tithi transition search, and per the brief's "fix if an existing
 * bug is found" allowance -- see the completion report for detail. No
 * ayanamsha/methodology change: getTithi()'s own value calculation is
 * untouched, only the previously-broken transition *search* is fixed.)
 *
 * Marriage Muhurtham Foundation V1: YOGA/KARANA support was added so
 * spanOverlapsAuthoritativeEventAvoid() (packages/recommendation/src/
 * muhurthamFinder.ts) can walk Yoga/Karana transitions the same way it
 * already walks Tithi/Nakshatra transitions, for INTERVAL SAFETY only (a
 * candidate whose span crosses into a prohibited Yoga/Karana mid-window is
 * still rejected). This does NOT add Yoga/Karana boundary CANDIDATE
 * discovery (collectPanchangaTransitionCandidateMinutes still only walks
 * Tithi/Nakshatra) -- that remains explicitly deferred to a later PR.
 */
export function findNextTransition(date: Date, targetType: 'TITHI' | 'NAKSHATRA' | 'YOGA' | 'KARANA'): Date {
  const astroTime = new AstroTime(date);

  if (targetType === 'TITHI') {
    const currentPhase = MoonPhase(date);
    const targetPhase = (Math.floor(currentPhase / 12) + 1) * 12 % 360;
    // A tithi is 19-26 hours long; 2 days is a safe search bound with margin.
    const res = SearchMoonPhase(targetPhase, astroTime, 2);
    if (!res) throw new Error(`findNextTransition: no TITHI transition found within 2 days of ${date.toISOString()}.`);
    return res.date;
  }

  if (targetType === 'KARANA') {
    const currentPhase = MoonPhase(date);
    const targetPhase = (Math.floor(currentPhase / 6) + 1) * 6 % 360;
    // A Karana is a half-Tithi, roughly 9.5-13 hours; 1 day is a safe search bound with margin.
    const res = SearchMoonPhase(targetPhase, astroTime, 1);
    if (!res) throw new Error(`findNextTransition: no KARANA transition found within 1 day of ${date.toISOString()}.`);
    return res.date;
  }

  if (targetType === 'YOGA') {
    // Yoga transition search: find exact time (moonDeg + sunDeg) % 360
    // crosses into the next 13°20' segment -- same binary-search shape as
    // NAKSHATRA below, tracking the Moon+Sun sidereal sum instead of the
    // Moon's own longitude.
    const currentSum = (getSiderealLongitude(Body.Moon, date) + getSiderealLongitude(Body.Sun, date)) % 360;
    const span = 360 / 27;
    const targetIndex = Math.floor(currentSum / span) + 1;
    const targetDeg = (targetIndex * span) % 360;

    // Search window: the sidereal sum advances at ~14.2°/day (Moon ~13.2 +
    // Sun ~1), so a Yoga (13.33° span) transitions within ~23h max; 30 hours
    // is a safe bound with margin.
    let low = date.getTime();
    let high = date.getTime() + 30 * 3600 * 1000;

    for (let i = 0; i < 20; i++) {
      const mid = Math.floor((low + high) / 2);
      const midSum = (getSiderealLongitude(Body.Moon, new Date(mid)) + getSiderealLongitude(Body.Sun, new Date(mid))) % 360;

      let diff = midSum - currentSum;
      if (diff < 0) diff += 360;

      const targetDiff = targetDeg - currentSum;
      const normTargetDiff = targetDiff < 0 ? targetDiff + 360 : targetDiff;

      if (diff >= normTargetDiff) {
        high = mid;
      } else {
        low = mid;
      }
    }

    return new Date(Math.floor((low + high) / 2));
  }

  // Nakshatra transition search: Find exact time Moon crosses into next 13°20' segment
  const currentMoonDeg = getSiderealLongitude(Body.Moon, date);
  const span = 360 / 27; // 13.333333333°
  const targetIndex = Math.floor(currentMoonDeg / span) + 1;
  const targetDeg = (targetIndex * span) % 360;

  // Search window: Moon moves ~13.2°/day, so transition is within 28 hours max
  let low = date.getTime();
  let high = date.getTime() + 28 * 3600 * 1000;

  for (let i = 0; i < 20; i++) {
    const mid = Math.floor((low + high) / 2);
    const midDeg = getSiderealLongitude(Body.Moon, new Date(mid));

    // Check crossed boundary handling 360/0 wrap
    let diff = midDeg - currentMoonDeg;
    if (diff < 0) diff += 360;

    const targetDiff = targetDeg - currentMoonDeg;
    const normTargetDiff = targetDiff < 0 ? targetDiff + 360 : targetDiff;

    if (diff >= normTargetDiff) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return new Date(Math.floor((low + high) / 2));
}

/**
 * Generic named-value transition finder: advances in 15-minute steps from
 * `start` until `getName()` returns something other than its value at
 * `start`, then binary-searches the boundary. Used for Yoga and Karana,
 * which (unlike Tithi/Nakshatra) don't have a direct degree-based transition
 * formula here -- moved from apps/web/app/api/panchang/today/route.ts
 * verbatim (same search step/iteration counts) so getPanchangForDate() and
 * the legacy /today route share one implementation instead of two.
 */
export function findNextNamedTransition(
  start: Date,
  getName: (date: Date) => string,
  searchHours: number
): Date | null {
  const initialName = getName(start);
  const stepMs = 15 * 60 * 1000;
  const endMs = start.getTime() + searchHours * 60 * 60 * 1000;

  let low = start.getTime();
  for (let high = low + stepMs; high <= endMs; high += stepMs) {
    if (getName(new Date(high)) === initialName) {
      low = high;
      continue;
    }

    for (let i = 0; i < 20; i++) {
      const mid = Math.floor((low + high) / 2);
      if (getName(new Date(mid)) === initialName) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return new Date(high);
  }

  return null;
}
