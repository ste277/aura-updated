import {
  Body,
  AstroTime,
  Ecliptic,
  GeoVector,
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

/**
 * Lahiri Ayanamsa approximation in degrees (linear fit: 23.85 deg at the
 * J2000.0 epoch, +1.4 deg/century -- a mean approximation without nutation,
 * accurate to within ~30 arcsec of the true Chitrapaksha value per
 * independent reference tables, e.g. Jagannath Hora's Swiss-Ephemeris-based
 * historical ayanamsa tables).
 *
 * `AstroTime.ut` (astronomy-engine) is ALREADY "days since the J2000.0
 * epoch" (see astronomy-engine's own AstroTime constructor: `this.ut =
 * (date.getTime() - J2000.getTime()) / MillisPerDay`) -- so it must be used
 * directly as the century argument, not re-based against 51544.5 (the
 * Modified Julian Date OF the J2000.0 epoch itself). A prior version of
 * this function double-subtracted that epoch, producing a constant ~1.98
 * degree error at every date (1.4 * 51544.5/36525 degrees) -- see AURA
 * PCE-3B-FIX1 / PCE-4A and issue #297 for the full investigation and
 * independent-reference validation.
 */
export function lahiriAyanamsa(date: Date): number {
  const astroTime = new AstroTime(date);
  const t = astroTime.ut / 36525;
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
 * TITHI and KARANA both search the Moon-Sun SIDEREAL elongation angle (the
 * same `diff` quantity getTithi()/getKarana() derive their index from --
 * ayanamsha subtracts equally from both bodies' sidereal longitudes, so the
 * *difference* between them, and therefore every tithi/karana boundary, is
 * ayanamsha-invariant), via the same targeted-binary-search technique as
 * YOGA/NAKSHATRA below -- TITHI stepped to the next 12° boundary, KARANA
 * (a half-Tithi) to the next 6° boundary.
 * NAKSHATRA uses targeted binary search over Moon sidereal longitude.
 * YOGA searches a DIFFERENT quantity -- (moonDeg + sunDeg) % 360, not the
 * Moon-Sun difference TITHI/KARANA measure -- tracking the sidereal sum
 * rather than the Moon's own longitude.
 *
 * (AURA PA-2C: TITHI/KARANA previously used astronomy-engine's
 * MoonPhase()/SearchMoonPhase(), which internally call
 * GeoVector(..., false) -- aberration correction OFF -- while
 * getTithi()/getKarana() (via getSiderealLongitude()) use
 * GeoVector(..., true) -- aberration ON, the standard "apparent geocentric
 * position" convention used by real-world ephemeris/almanac calculation
 * (e.g. Swiss Ephemeris's documented default output; its SEFLG_NOABERR/
 * SEFLG_ASTROMETRIC flags are the explicit, non-default opt-OUT of
 * aberration). That mismatch produced a reproducible ~20.8 arcsecond gap
 * in the Moon-Sun elongation itself, converting to a ~39-46 second
 * transition-instant discrepancy against getTithi()/getKarana()'s own
 * ground truth, and a demonstrated interval-safety gap in
 * valuesTouchedByInterval() below -- see AURA PA-2B for the full
 * investigation and PA-2C for the correction and independent-reference
 * evidence. Corrected to the same aberration-true elongation search
 * already used by YOGA/NAKSHATRA, matching getTithi()/getKarana() exactly
 * -- no ayanamsha/methodology change, only the transition *search*
 * algorithm.)
 *
 * (Historical note, predating PA-2C: SearchMoonPhase itself had replaced a
 * prior SearchRelativeLongitude(Body.Moon, ...) call here that threw
 * unconditionally -- astronomy-engine's SearchRelativeLongitude only
 * supports planets relative to the Sun, not the Moon. That was a latent
 * bug: findNextTransition(date, 'TITHI') had never successfully returned a
 * value, unnoticed because its only caller, /api/panchang/today, feeds a
 * component (TodayOverview) that isn't mounted anywhere in the app. Fixed
 * at the time since getPanchangForDate() needs a working Tithi transition
 * search -- see the completion report for detail. The aberration mismatch
 * above was a separate, independent defect introduced by that same fix,
 * not present in the original always-throwing code.)
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
  if (targetType === 'TITHI' || targetType === 'KARANA') {
    // AURA PA-2C: Tithi/Karana transition search, by Moon-Sun sidereal
    // elongation -- NOT astronomy-engine's MoonPhase()/SearchMoonPhase(),
    // which compute geocentric ecliptic longitude via GeoVector(..., false)
    // (aberration correction OFF). getTithi()/getKarana() (and every other
    // value function in this file) use getSiderealLongitude(), which calls
    // GeoVector(..., true) (aberration ON) -- the standard convention for
    // "apparent geocentric position" in almanac-style calculation (e.g.
    // Swiss Ephemeris's documented default output, which requires the
    // explicit SEFLG_NOABERR/SEFLG_ASTROMETRIC flag to turn aberration
    // off). The ~20.8 arcsecond gap between these two conventions in the
    // Moon-Sun elongation itself converts to a reproducible ~39-46 second
    // transition-instant discrepancy against the value functions' own
    // ground truth -- see AURA PA-2B for the full investigation. Corrected
    // here to the same aberration-true elongation search already used by
    // the YOGA/NAKSHATRA branches below, rather than reusing MoonPhase.
    const currentDiff = ((getSiderealLongitude(Body.Moon, date) - getSiderealLongitude(Body.Sun, date)) + 360) % 360;
    const span = targetType === 'TITHI' ? 12 : 6;
    const targetIndex = Math.floor(currentDiff / span) + 1;
    const targetDeg = (targetIndex * span) % 360;

    // Elongation advances at ~(13.2 - 0.985) = ~12.2 deg/day. A Tithi (12
    // degree span) transitions within ~24h max; a Karana (6 degree span,
    // a half-Tithi) within ~13h max. Search windows match the original
    // SearchMoonPhase bounds (2 days / 1 day respectively) for the same
    // safety margin.
    let low = date.getTime();
    let high = date.getTime() + (targetType === 'TITHI' ? 2 : 1) * 24 * 3600 * 1000;

    for (let i = 0; i < 24; i++) {
      const mid = Math.floor((low + high) / 2);
      const midDiff = ((getSiderealLongitude(Body.Moon, new Date(mid)) - getSiderealLongitude(Body.Sun, new Date(mid))) + 360) % 360;

      let diff = midDiff - currentDiff;
      if (diff < 0) diff += 360;

      const targetDiff = targetDeg - currentDiff;
      const normTargetDiff = targetDiff < 0 ? targetDiff + 360 : targetDiff;

      if (diff >= normTargetDiff) {
        high = mid;
      } else {
        low = mid;
      }
    }

    return new Date(Math.floor((low + high) / 2));
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
