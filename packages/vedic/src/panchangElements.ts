import {
  SearchRelativeLongitude,
  Body,
  AstroTime,
  Ecliptic,
  GeoVector,
} from 'astronomy-engine';

/** Lahiri Ayanamsa approximation in degrees */
export function lahiriAyanamsa(date: Date): number {
  const astroTime = new AstroTime(date);
  const t = (astroTime.ut - 51544.5) / 36525;
  return 23.85 + 1.4 * t;
}

/** Get Sidereal Longitude of Moon/Sun */
export function getSiderealLongitude(body: Body, date: Date): number {
  const astroTime = new AstroTime(date);
  const vec = GeoVector(body, astroTime, true);
  const ecl = Ecliptic(vec);
  const ayanamsa = lahiriAyanamsa(date);
  return (ecl.elon - ayanamsa + 360) % 360;
}

export function getTithi(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const sunDeg = getSiderealLongitude(Body.Sun, date);
  const diff = (moonDeg - sunDeg + 360) % 360;
  const index = Math.floor(diff / 12) + 1;
  return { index, name: `Tithi ${index}` };
}

export function getNakshatra(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const span = 360 / 27; // 13.3333°
  const index = Math.floor(moonDeg / span) + 1;
  return { index, name: `Nakshatra ${index}` };
}

export function getYoga(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const sunDeg = getSiderealLongitude(Body.Sun, date);
  const sum = (moonDeg + sunDeg) % 360;
  const span = 360 / 27;
  const index = Math.floor(sum / span) + 1;
  return { index, name: `Yoga ${index}` };
}

export function getKarana(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const sunDeg = getSiderealLongitude(Body.Sun, date);
  const diff = (moonDeg - sunDeg + 360) % 360;
  const halfTithi = Math.floor(diff / 6) + 1;
  return { index: halfTithi, name: `Karana ${halfTithi}` };
}

/**
 * Finds exact next transition date.
 * TITHI uses SearchRelativeLongitude.
 * NAKSHATRA uses targeted binary search over Moon sidereal longitude.
 */
export function findNextTransition(date: Date, targetType: 'TITHI' | 'NAKSHATRA'): Date {
  const astroTime = new AstroTime(date);

  if (targetType === 'TITHI') {
    const res = SearchRelativeLongitude(Body.Moon, Body.Sun, 12, astroTime);
    return res.date;
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